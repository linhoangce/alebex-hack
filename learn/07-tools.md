# Step 7: Tools, so the AI can call your server

**Goal:** let the AI save information during the visit (who is in the room, red flags, the
intake form) by calling your server, and show each result on screen as a card.

**Files you create:** `src/ngrok.js`, `src/tools.js`, `src/registry.js`, `src/toolRoutes.js`
**Files you change:** `src/proxy.js`, `src/app.js`, `local-server.js`, `public/app.js`

## The idea

### A tool is a web address the AI may call

You describe a tool to the AI: its name, when to use it, and what information to send. When
the conversation calls for it, the engine sends a `POST` to that address with the details
it picked out of the conversation. Whatever your server replies is handed back to the AI.

```
 Patient: "My name is Nguyễn Thị Lan. Please call me bà."
     │
     ▼
 Engine: "that completes step 2, so call record_session_details"
     │   says the spoken_line out loud: "Cảm ơn bà."
     │
     │ POST https://<your public address>/voice-tools/session-details
     │ Authorization: Bearer <TOOL_SECRET>
     │ X-Session-Id: 20261007-103012-a1f3
     │ {"tool":"record_session_details",
     │  "arguments":{"clinician_name":"Sarah Chen","patient_name":"Nguyễn Thị Lan",...},
     │  "call":{"id":"public-9f3c..."}}
     ▼
 Your server (toolRoutes.js)
     │ 1. checks the secret
     │ 2. finds the session
     │ 3. saves details into the session file
     │ 4. pushes {"type":"session_details",...} to that session's browser ──► card appears
     │ 5. replies {"saved": true}
     ▼
 Engine hands {"saved": true} to the AI, which carries on
```

The app has three tools:

| Tool | When the AI calls it | Route on your server | Card or banner on screen |
|---|---|---|---|
| `record_session_details` | Once, after the opening questions | `/voice-tools/session-details` | "In the room" card |
| `flag_urgent_symptom` | Whenever the patient reports a red flag | `/voice-tools/flag-urgent` | Red banner |
| `record_intake` | Once, at the end of the visit | `/voice-tools/record-intake` | Intake card |

### Problem 1: the engine cannot reach `localhost`

The engine runs in the cloud. Your laptop's `localhost:3000` cannot be reached from the
internet, and the engine refuses private addresses anyway. **ngrok** fixes this. It
creates a public `https://...ngrok...` address and forwards every request to your
laptop through a **tunnel**:

```
 Engine (internet) ──► https://abc123.ngrok-free.app ──tunnel──► ngrok on your laptop ──► localhost:3000
```

If there is no public address, the server still runs in a **reduced mode**: interpreting
works, but no tools are sent, so there are no cards.

### Problem 2: the tool request arrives on a different connection

The tool `POST` is a brand-new HTTP request. It is not the browser's WebSocket. So how
does the server find the right browser to send the card to?

With a **registry**, a phone book kept in memory:

```
 registry (a Map)
 ┌───────────────────────────┬──────────────────────────────────────┐
 │ session id                │ how to reach its browser             │
 ├───────────────────────────┼──────────────────────────────────────┤
 │ 20261007-103012-a1f3      │ toBrowser()  of WebSocket #1         │
 │ 20261007-111545-09bc      │ toBrowser()  of WebSocket #2         │
 └───────────────────────────┴──────────────────────────────────────┘
   proxy.js writes an entry when a session starts and erases it when it ends.
   toolRoutes.js looks up the session id and calls that function.
```

And how does the tool request say which session it belongs to? Tools are sent **with each
call** (in `start_call`), not stored on the agent. So every call's tools can carry that
call's session id in a header, `X-Session-Id`. The engine sends the header back on every
tool request, and no searching is needed.

## Build it

### 0. Install ngrok

Create a free account at ngrok.com, install the `ngrok` program, and connect it to your
account once with the token from the ngrok dashboard:

```bash
ngrok config add-authtoken <your-ngrok-token>
ngrok config check          # should say the config is valid
```

You do not start ngrok yourself. The server does it.

### `src/ngrok.js`: find or start a public address

```js
// The public https base the engine needs for tool calls and the end-of-call webhook.
// Order: PUBLIC_BASE_URL when set (manual mode); else an ngrok tunnel already running on this
// machine (read from ngrok's local API); else `ngrok http <port>` is started as a child process
// that is killed when this process exits. Returns the https URL, or null after a clear warning,
// in which case the server runs degraded: no tools, no cards, no webhook; interpreting still works.
import { spawn } from "node:child_process";

const NGROK_API = "http://127.0.0.1:4040/api/tunnels";
const START_TIMEOUT_MS = 15000;
const POLL_MS = 500;

let publicUrl = null;
let child = null;

// The tunnel found at boot; else PUBLIC_BASE_URL; else the Vercel production host. Null when
// nothing public is known (tools and webhook off).
export function getPublicBaseUrl() {
  if (publicUrl) return publicUrl;
  const manual = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (/^https:\/\//.test(manual)) return manual;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}` : null;
}

// The https tunnel pointing at localhost:<port>, from the local ngrok API, or null.
async function existingTunnel(port) {
  try {
    const res = await fetch(NGROK_API, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const { tunnels = [] } = await res.json();
    const addrRe = new RegExp(`:${port}/?$`);
    const hit = tunnels.find((t) => t.proto === "https" && addrRe.test(t.config?.addr ?? ""));
    return hit?.public_url ?? null;
  } catch {
    return null;
  }
}

function stopChild() {
  if (!child) return;
  const c = child;
  child = null;
  try { c.kill(); } catch {}
}

// Spawn ngrok with JSON logs on stdout; its "started tunnel" line carries the public url.
function startNgrok(port, log) {
  let urlFromLog = null;
  child = spawn("ngrok", ["http", String(port), "--log=stdout", "--log-format=json"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const onLine = (line) => {
    let entry;
    try { entry = JSON.parse(line); } catch { return; }
    if (entry.url && /^https:/.test(entry.url) && /started tunnel/i.test(entry.msg ?? "")) urlFromLog = entry.url;
    if (["eror", "error", "crit"].includes(entry.lvl)) log.warn(`[ngrok] ${entry.err ?? entry.msg ?? line}`);
  };
  const drain = (stream) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      lines.forEach(onLine);
    });
  };
  drain(child.stdout);
  drain(child.stderr);
  child.on("error", (err) => { log.warn(`[ngrok] could not start ngrok: ${err.message}`); child = null; });
  child.on("exit", (code) => { if (child) { log.warn(`[ngrok] ngrok exited with code ${code}`); child = null; } });

  process.on("exit", stopChild);
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
    try { process.once(sig, () => { stopChild(); process.exit(0); }); } catch {}
  }
  return () => urlFromLog;
}

export async function ensurePublicUrl(port, log = console) {
  const manual = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (manual) {
    if (/^https:\/\//.test(manual)) {
      publicUrl = manual;
      log.info(`[public-url] using PUBLIC_BASE_URL ${publicUrl}`);
      return publicUrl;
    }
    log.warn(`[public-url] PUBLIC_BASE_URL must be an https URL; ignoring "${manual}"`);
  }

  const running = await existingTunnel(port);
  if (running) {
    publicUrl = running;
    log.info(`[public-url] reusing the running ngrok tunnel ${publicUrl}`);
    return publicUrl;
  }

  log.info(`[public-url] starting ngrok http ${port}`);
  const urlFromLog = startNgrok(port, log);
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (!child) break; // it died or never started
    const url = urlFromLog() ?? (await existingTunnel(port));
    if (url) {
      publicUrl = url;
      log.info(`[public-url] ngrok tunnel ${publicUrl} -> http://localhost:${port}`);
      return publicUrl;
    }
  }
  stopChild();
  log.warn("[public-url] no public URL: ngrok did not come up within 15 s. Check that ngrok is installed and `ngrok config check` passes, or set PUBLIC_BASE_URL. Running degraded: no tools, no cards, no end-of-call webhook; interpreting still works.");
  return null;
}
```

`ensurePublicUrl` tries four things, in order:

```
 1. PUBLIC_BASE_URL set in .env?         ──yes──► use it (you run your own tunnel or host)
 2. an ngrok tunnel already running?      ──yes──► reuse it (asks ngrok's local API on port 4040)
 3. start "ngrok http 3000" as a child   ──url seen within 15 s──► use it
 4. otherwise                             ──► warn, return null: reduced mode, no tools
```

- **`getPublicBaseUrl()`** is what the rest of the code asks later. On Vercel there is no
  ngrok, so it falls back to `VERCEL_PROJECT_PRODUCTION_URL`, a setting Vercel provides.
- **`existingTunnel`** calls ngrok's own local API at `http://127.0.0.1:4040/api/tunnels`
  and looks for an `https` tunnel that points at this port.
  `AbortSignal.timeout(1500)` gives up after 1.5 seconds if ngrok is not running.
- **`startNgrok`** runs ngrok as a **child process** with `spawn`. With
  `--log=stdout --log-format=json`, ngrok writes one JSON object per line, and the
  "started tunnel" line includes the public `url`.
- **`drain`** turns a stream of chunks into whole lines. A chunk can end halfway through a
  line, so the unfinished part waits in `buf` until the rest arrives.
- **Clean-up.** `process.on("exit", stopChild)` and the signal handlers (`SIGINT` is
  Ctrl+C) stop ngrok when the server stops. Without them, an orphaned ngrok would keep
  running.
- **The polling loop** checks every 500 ms whether a URL has appeared, either in the logs or
  through the local API, and gives up after 15 seconds.

### `src/tools.js`: describing the tools

```js
// customTools builders sent on every start_call (AGENTS.md "Custom tools"; plan Appendix E).
// The public base comes from src/ngrok.js at call time (a tunnel started at boot is picked up),
// never from the environment at import time. Each tool carries the bearer secret and the session
// id as headers so src/toolRoutes.js can route without a lookup. The engine adds `spoken_line`
// to every tool itself, so it is not declared here.
import { getPublicBaseUrl } from "./ngrok.js";

export const toolsAvailable = () => Boolean(getPublicBaseUrl() && process.env.TOOL_SECRET);

function base() {
  const url = (getPublicBaseUrl() ?? "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(url)) throw new Error("no public https base URL (ngrok) for tools");
  return url;
}

function headersFor(sessionId) {
  return { Authorization: `Bearer ${process.env.TOOL_SECRET}`, "X-Session-Id": String(sessionId) };
}

// Who is in the room, collected by voice in the opening (step two of the prompt).
export function recordSessionDetails(sessionId) {
  return {
    name: "record_session_details",
    description:
      "Save who is in the room, once the opening questions have been answered: the clinician's name and role, and the patient's name and the form of address they chose. Call it exactly once, right after the patient has given their name and preferred form of address, before interpreting begins. Do not call it again later.",
    url: `${base()}/voice-tools/session-details`,
    headers: headersFor(sessionId),
    timeoutMs: 5000,
    parameters: {
      type: "object",
      properties: {
        clinician_name: { type: "string", description: "As the clinician said it, in English" },
        clinician_role: { type: "string", description: "For example physician, nurse, nurse practitioner, resident, pharmacist, social worker" },
        patient_name: { type: "string", description: "The patient's name as they said it, in their own spelling where known" },
        preferred_address: { type: "string", description: "The form of address the patient chose, in their language" },
      },
      required: ["patient_name"],
    },
  };
}

// The intake form, filled in English from what the patient said during the visit, saved once when the visit is over.
export function recordIntake(sessionId) {
  return {
    name: "record_intake",
    description:
      "Save the intake form for the clinician, in English, from what the patient said during the visit. Call it exactly once, when the visit is over: when the clinician says so, or when the app's visit.ending event arrives. Never call it during the visit and never ask questions to fill it; leave uncovered fields out.",
    url: `${base()}/voice-tools/record-intake`,
    headers: headersFor(sessionId),
    timeoutMs: 5000,
    parameters: {
      type: "object",
      properties: {
        date_of_birth: { type: "string", description: "Year, month, day, as the patient said it" },
        reason_for_visit: { type: "string" },
        onset_and_course: { type: "string" },
        pain_score: { type: "integer", description: "Zero to ten; omit if not given" },
        allergies: { type: "string" },
        medications: { type: "string" },
        medical_history: { type: "string" },
        pregnancy: { type: "string", enum: ["yes", "no", "possibly", "not_applicable", "declined"] },
        other_notes: { type: "string" },
        urgent: { type: "boolean", description: "True if the patient reported a red-flag symptom" },
        urgent_detail: { type: "string" },
      },
      required: [],
    },
  };
}

// The interpreter silently flags a red-flag symptom reported by the patient, at any point.
export function flagUrgentSymptom(sessionId) {
  return {
    name: "flag_urgent_symptom",
    description:
      "Record that the PATIENT reported a red-flag symptom so the care team sees an alert on screen: chest pain, trouble breathing, heavy bleeding, thoughts of suicide or self-harm, signs of a severe allergic reaction, or stroke signs such as face drooping or sudden weakness. Call it the moment the patient says one of these, in addition to interpreting their words in full. Do not call it when the clinician asks about these symptoms as a question, when the patient denies them, or for mild or old symptoms.",
    url: `${base()}/voice-tools/flag-urgent`,
    headers: headersFor(sessionId),
    timeoutMs: 5000,
    parameters: {
      type: "object",
      properties: {
        symptom: { type: "string", description: "What the patient reported, in English, in their own words" },
        category: { type: "string", enum: ["chest_pain", "breathing", "bleeding", "self_harm", "allergic_reaction", "stroke_signs", "other"] },
        severity: { type: "string", enum: ["emergency", "urgent"] },
      },
      required: ["symptom", "category"],
    },
  };
}

// The array for one call's start_call frame, or null when there is no public URL or no secret.
export function customToolsFor(sessionId) {
  if (!toolsAvailable()) return null;
  return [recordSessionDetails(sessionId), recordIntake(sessionId), flagUrgentSymptom(sessionId)];
}
```

Each tool is an object the engine understands (see "The tool object" in
[`AGENTS.md`](../AGENTS.md)):

| Field | Meaning |
|---|---|
| `name` | What the prompt calls it, such as `record_intake`. |
| `description` | **The only text the AI reads when deciding whether to call it.** Write the trigger: when to call it, and also when *not* to. |
| `url` | Where the engine sends the `POST`. Must be public and `https`. |
| `headers` | Sent with every request: the secret and this session's id. |
| `timeoutMs` | How long the engine waits for an answer (here 5 seconds). |
| `parameters` | A JSON Schema of the arguments. `enum` lists the only allowed values, and `required` lists what must always be sent. |

- **The descriptions do real work.** Look at `flag_urgent_symptom`: "Do not call it when
  the clinician asks about these symptoms as a question, when the patient denies them...".
  Without those words, "Do you have chest pain?" could set off a false alarm.
- **`enum` wherever the choice is closed** (`category`, `severity`, `pregnancy`), so the AI
  cannot invent a new category.
- **`required: []` for `record_intake`.** Every intake field is optional, because the visit
  may not cover them all. The prompt says "leave out anything the visit did not cover".
- **No `spoken_line` here.** The engine adds it to every tool by itself, and refuses a tool
  that declares it.
- **`base()` reads the public address when the call starts**, not when the file is
  imported. The ngrok tunnel only exists after the server has started.
- **`customToolsFor(sessionId)`** returns all three tools for one call, or `null` when tools
  are off (no public address or no `TOOL_SECRET`).

### `src/registry.js`: the phone book

```js
// Live sessions: session id -> a function that sends one frame to that session's browser, plus
// listeners that want to see the frames pushed to a session (the proxy watches for intake_recorded
// to run the End flow). The proxy registers a session when it starts and removes it on shutdown;
// the tool routes (src/toolRoutes.js) push the session_details / intake_recorded / urgent_flag
// frames through here.
const senders = new Map();
const listeners = new Map(); // session id -> Set of (frame) => void

export function registerSession(id, send) {
  senders.set(id, send);
}

export function unregisterSession(id) {
  senders.delete(id);
  listeners.delete(id);
}

// Subscribe to every frame pushed to one session; returns the unsubscribe function.
export function onSessionFrame(id, listener) {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size && listeners.get(id) === set) listeners.delete(id);
  };
}

// True when the frame was handed to a connected browser; false when the session is not live.
// Listeners are told either way.
export function pushToSession(id, frame) {
  const send = senders.get(id);
  let delivered = false;
  if (send) {
    try {
      send(frame);
      delivered = true;
    } catch {}
  }
  for (const listener of listeners.get(id) ?? []) {
    try { listener(frame); } catch {}
  }
  return delivered;
}

export const liveSessionCount = () => senders.size;
```

- **`senders`**: session id → the function that sends one frame to that session's browser.
- **`registerSession` / `unregisterSession`**: the proxy calls these when a session starts
  and ends.
- **`pushToSession(id, frame)`** sends the frame if the browser is connected, and returns
  `true` or `false`. Each send is wrapped in `try`, so one broken connection cannot crash a
  tool request.
- **`listeners` and `onSessionFrame`** let other code *watch* what is pushed to a session.
  Nothing uses this yet. In Step 8 the proxy watches for `intake_recorded`.
  `onSessionFrame` returns a function that stops the watching (an "unsubscribe" function).
- **`liveSessionCount`** is a small helper for checking how many sessions are open. Nothing
  in the app calls it.

Why a `Map` and not a plain object? A `Map` is made for keys that come and go, and it has
`size`, `has` and `delete` built in.

### `src/toolRoutes.js`: answering the AI

```js
// The three custom-tool endpoints the engine POSTs to mid-call
// (AGENTS.md "What the engine sends your endpoint": {tool, arguments, call}).
// Mounted at /voice-tools with its own JSON parser. Every request carries
// `Authorization: Bearer TOOL_SECRET` and `X-Session-Id` (set per call in src/tools.js); the
// session falls back to body.call.id. Side effects are keyed on the session id, so a repeated
// call overwrites the same record. Each route saves to the session file, pushes a frame to the
// session's browser through src/registry.js and answers the engine with a tiny JSON body.
import crypto from "node:crypto";
import express from "express";
import { getSession, updateSession, findSessionByCallId } from "./sessions.js";
import { pushToSession } from "./registry.js";

const DETAIL_FIELDS = ["clinician_name", "clinician_role", "patient_name", "preferred_address"];
const INTAKE_TEXT_FIELDS = ["date_of_birth", "reason_for_visit", "onset_and_course", "allergies", "medications", "medical_history", "pregnancy", "other_notes", "urgent_detail"];
const CATEGORIES = new Set(["chest_pain", "breathing", "bleeding", "self_harm", "allergic_reaction", "stroke_signs", "other"]);
const SEVERITIES = new Set(["emergency", "urgent"]);

// One clean string from whatever the model sent; "" when absent.
function text(value, max = 1000) {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function bearerOk(header, secret) {
  if (!secret || typeof header !== "string") return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function toolRouter({ log = console } = {}) {
  const router = express.Router();
  router.use(express.json({ limit: "64kb" }));
  // A malformed body is a 400 the model can read, not Express's HTML page.
  router.use((err, req, res, next) => res.status(400).json({ error: `bad request body: ${err.message}` }));

  router.use((req, res, next) => {
    if (!bearerOk(req.get("authorization"), process.env.TOOL_SECRET)) {
      log.warn(`[tools] ${req.path}: bad tool credential`);
      return res.status(401).json({ error: "bad tool credential" });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const headerId = req.get("x-session-id");
    const session = (headerId && getSession(headerId)) || (body.call?.id ? findSessionByCallId(body.call.id) : null);
    if (!session) {
      log.warn(`[tools] ${body.tool ?? req.path}: no session for X-Session-Id "${headerId ?? ""}" / call ${body.call?.id ?? "-"}`);
      return res.status(404).json({ error: "unknown session" });
    }
    req.session = session;
    req.args = body.arguments && typeof body.arguments === "object" ? body.arguments : {};
    next();
  });

  // record_session_details -> session.details, frame session_details
  router.post("/session-details", (req, res) => {
    const details = Object.fromEntries(DETAIL_FIELDS.map((k) => [k, text(req.args[k], 200)]));
    details.recordedAt = new Date().toISOString();
    updateSession(req.session.id, { details });
    const pushed = pushToSession(req.session.id, { type: "session_details", details });
    log.info(`[tools] [session ${req.session.id}] record_session_details: clinician ${details.clinician_name || "-"} (${details.clinician_role || "-"}), patient ${details.patient_name || "-"} (${details.preferred_address || "-"})${pushed ? "" : " [browser not connected]"}`);
    res.json({ saved: true });
  });

  // record_intake -> session.intakeRecord, frame intake_recorded
  router.post("/record-intake", (req, res) => {
    const a = req.args;
    const intake = Object.fromEntries(INTAKE_TEXT_FIELDS.map((k) => [k, text(a[k])]));
    const score = Number(a.pain_score);
    intake.pain_score = a.pain_score !== undefined && a.pain_score !== null && a.pain_score !== "" && Number.isInteger(score) && score >= 0 && score <= 10 ? score : null;
    intake.urgent = a.urgent === true || a.urgent === "true";
    intake.recordedAt = new Date().toISOString();
    updateSession(req.session.id, { intakeRecord: intake });
    const pushed = pushToSession(req.session.id, { type: "intake_recorded", intake });
    log.info(`[tools] [session ${req.session.id}] record_intake${intake.urgent ? " (URGENT)" : ""}: ${intake.reason_for_visit || "-"}${pushed ? "" : " [browser not connected]"}`);
    res.json({ saved: true });
  });

  // flag_urgent_symptom -> session.urgentFlags (one entry per distinct flag), frame urgent_flag
  router.post("/flag-urgent", (req, res) => {
    const a = req.args;
    const flag = {
      symptom: text(a.symptom, 300),
      category: CATEGORIES.has(a.category) ? a.category : "other",
      severity: SEVERITIES.has(a.severity) ? a.severity : "urgent",
      at: new Date().toISOString(),
    };
    const flags = (req.session.urgentFlags ?? []).filter((f) => !(f.symptom === flag.symptom && f.category === flag.category && f.severity === flag.severity));
    flags.push(flag);
    updateSession(req.session.id, { urgentFlags: flags });
    pushToSession(req.session.id, { type: "urgent_flag", ...flag });
    log.warn(`[tools] [session ${req.session.id}] URGENT ${flag.category} (${flag.severity}): ${flag.symptom}`);
    res.json({ noted: true, note: "Recorded silently. Say nothing about this to the room." });
  });

  return router;
}
```

The router is a small Express app of its own, mounted at `/voice-tools`. Every request goes
through the same steps:

```
 POST /voice-tools/<name>
   │
   ├─ express.json          read the JSON body (64 kB at most)
   │     └─ bad JSON? ──► the error handler answers 400 {"error": "bad request body: ..."}
   ├─ secret check          wrong or missing Bearer? ──► 401
   ├─ find the session      X-Session-Id header, else call.id ──► none? 404
   │                        puts req.session and req.args on the request
   └─ the route itself      clean the values, save, push to the browser, reply
```

- **The error handler has four arguments** (`err, req, res, next`). That is how Express
  recognises an error handler. Placed right after `express.json`, it catches broken JSON
  and replies with JSON. The AI can read that reply, which it could not do with Express's
  default HTML error page.
- **`bearerOk` uses `crypto.timingSafeEqual`.** A normal `===` comparison stops at the
  first wrong character, so a wrong first character fails a tiny bit faster than a wrong
  last character. With enough attempts, an attacker could measure those tiny differences
  and guess the secret one character at a time. `timingSafeEqual` always takes the same
  time. It requires both inputs to be the same length, so the code checks the length
  first.
- **Two ways to find the session.** The `X-Session-Id` header is the quick way. `call.id`
  (the engine's call id, matched against the saved `callId`) is the backup.
- **`text()` cleans every value from the AI.** Numbers and true/false become strings;
  anything that is not a string becomes `""`; runs of spaces and line breaks become one
  space; and the text is cut to a maximum length. The AI usually sends good data, but the
  server must never trust it blindly.
- **`/session-details`** keeps the four fields, adds a timestamp, saves them as
  `details`, and pushes `session_details` to the browser.
- **`/record-intake`** cleans the text fields. `pain_score` is accepted only as a whole
  number from 0 to 10, and becomes `null` otherwise. `urgent` accepts `true` or `"true"`.
  The result is saved as `intakeRecord` and pushed as `intake_recorded`.
- **`/flag-urgent`** checks `category` and `severity` against the allowed lists, removes
  any identical earlier flag, adds the new one, and logs a warning with `URGENT` in it.
- **The replies are tiny and meaningful.** The AI reads them. `{"saved": true}` matches the
  prompt's "if a tool errors or does not return saved...". The urgent reply includes a note,
  "Recorded silently. Say nothing about this to the room.", which reminds the AI not to
  alarm the patient.
- **Calling a tool twice is harmless.** The engine never retries, but the AI might call the
  same tool twice. Each route overwrites the same record (or removes the duplicate flag), so
  a repeat changes nothing.

### Change `src/proxy.js`: send tools, join the phone book

**1.** Under the `languages.js` import, add:

```js
import { customToolsFor } from "./tools.js";
import { registerSession, unregisterSession } from "./registry.js";
```

**2.** Under `let closed = false;`, add:

```js
  let customTools = null;
```

**3.** In `shutdown`, replace the `if (session && !session.endedAt) { ... }` block from
Step 6 with this one, which also removes the session from the phone book:

```js
    if (session) {
      unregisterSession(session.id);
      if (!session.endedAt) {
        session = updateSession(session.id, { endedAt: new Date().toISOString(), endedReason: session.endedReason ?? reason }) ?? session;
      }
    }
```

**4.** In `startSession`, right after `session = createSession(...)`, add:

```js
    registerSession(session.id, toBrowser);
    customTools = customToolsFor(session.id);
```

Then replace the `log.info(... start ...)` line and the `toBrowser({ type: "session_created", ... })`
line under it with these two, which report whether tools are on:

```js
    log.info(`${tag()} start (${lang.name}, ${session.mode}, tools ${customTools ? "on" : "off"}, glossary ${glossary.length} chars)\n${context}`);
    toBrowser({ type: "session_created", session_id: session.id, language: lang.code, intake, tools_enabled: Boolean(customTools) });
```

**5.** In `upstream.on("open", ...)`, under `if (context) startCall.context = context;`, add:

```js
      if (customTools) startCall.customTools = customTools;
```

### Change `src/app.js`: mount the tool routes

**1.** Under the `languages.js` import, add:

```js
import { getPublicBaseUrl } from "./ngrok.js";
import { toolsAvailable } from "./tools.js";
import { toolRouter } from "./toolRoutes.js";
```

**2.** Right after the `express.static` line, add:

```js
  app.use("/voice-tools", toolRouter({ log }));  // its own express.json
```

**3.** In `/api/config`, under `languages: ...`, add two fields so the page knows whether
cards will work:

```js
    toolsEnabled: toolsAvailable(),
    publicUrl: getPublicBaseUrl(),
```

Note that there is no `app.use(express.json())` for the whole app. The tool router has its
own JSON reader. In Step 9 you will see why that matters.

### Change `local-server.js`: get a public address first

**1.** Under the `app.js` import, add:

```js
import { ensurePublicUrl } from "./src/ngrok.js";
import { toolsAvailable } from "./src/tools.js";
```

**2.** Right after `logStartupChecks(console);`, add:

```js
const publicUrl = await ensurePublicUrl(PORT, console);
console.log(toolsAvailable()
  ? `[server] tools on: the engine will POST to ${publicUrl}/voice-tools/*`
  : "[server] tools off (no public URL or no TOOL_SECRET): sessions run without cards, flags or summaries");
```

That is a top-level `await`: the file waits for the public address before it starts the
server. ES modules allow `await` outside a function.

### Change `public/app.js`: cards and the banner

**1.** In the `ui` object, after the `language: ..., fillIntake: ...` line, add the card and
banner elements:

```js
  sessionCard: $("session-card"), cardClinician: $("card-clinician"), cardPatient: $("card-patient"), cardAddress: $("card-address"),
  intakeCard: $("intake-card"), intakeFields: $("intake-fields"), intakeUrgent: $("intake-urgent"),
  banner: $("urgent-banner"), bannerText: $("urgent-text"), bannerDismiss: $("urgent-dismiss"),
```

**2.** Under the `LANG_MARK_RE` line, add the intake form's labels, in display order:

```js
const INTAKE_LABELS = {
  date_of_birth: "Date of birth", reason_for_visit: "Reason for visit", onset_and_course: "Onset and course",
  pain_score: "Pain score", allergies: "Allergies", medications: "Medications", medical_history: "Medical history",
  pregnancy: "Pregnancy", other_notes: "Other notes", urgent_detail: "Urgent detail",
};
```

**3.** Above `loadConfig`, add the card functions. Replace the comment line
`// --- Server config: the language list ---` with all of this:

```js
// --- Cards: filled from server-pushed frames, cleared on Start ---
function clearCards() {
  ui.sessionCard.hidden = true;
  ui.intakeCard.hidden = true;
  ui.banner.hidden = true;
  ui.intakeFields.innerHTML = "";
  ui.intakeUrgent.hidden = true;
  for (const el of [ui.cardClinician, ui.cardPatient, ui.cardAddress]) el.textContent = "—";
}

function showDetails(d) {
  d = d || {};
  ui.cardClinician.textContent = [d.clinician_name, d.clinician_role].filter(Boolean).join(", ") || "not given";
  ui.cardPatient.textContent = d.patient_name || "not given";
  ui.cardAddress.textContent = d.preferred_address || "not given";
  ui.sessionCard.hidden = false;
}

function showIntake(i) {
  i = i || {};
  ui.intakeFields.innerHTML = "";
  for (const [key, label] of Object.entries(INTAKE_LABELS)) {
    const v = i[key];
    if (v === undefined || v === null || v === "") continue;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(v);
    ui.intakeFields.append(dt, dd);
  }
  if (!ui.intakeFields.children.length) {
    const dd = document.createElement("dd");
    dd.className = "muted";
    dd.textContent = "No answers were recorded.";
    ui.intakeFields.append(dd);
  }
  ui.intakeUrgent.hidden = !i.urgent;
  ui.intakeCard.hidden = false;
}

function showUrgent(f) {
  const category = String(f.category || "").replace(/_/g, " ");
  const detail = [category, f.severity].filter(Boolean).join(", ");
  ui.bannerText.textContent = `${f.symptom || "red-flag symptom"}${detail ? ` (${detail})` : ""}`;
  ui.banner.hidden = false;
}

// --- Server config: the language list and whether the tool path (cards) is on ---
```

**4.** In `loadConfig`, extend the `if (!langs.length) { ... }` block with an `else if`
that warns when tools are off. The end of the block becomes:

```js
      notice("No language pack is set up on the server. Run npm run setup.", "error");
    } else if (!cfg.toolsEnabled) {
      notice("The server has no public URL (ngrok did not start): the cards, the urgent banner and the end-of-call summary are off this run. Interpreting still works.", "info");
    }
```

**5.** In `start`, right before `setPhase("");`, add:

```js
  clearCards();
```

**6.** In `handleFrame`, in the `session_created` case, under the line that sets
`ui.callId.textContent`, add:

```js
      if (frame.tools_enabled === false) notice("This session runs without tools: no cards, banner or summary. Interpreting still works.", "info");
```

**7.** Still in `handleFrame`, add three cases right after the `transcript` /
`conversation_message` case:

```js
    case "session_details":
      showDetails(frame.details);
      setPhase("Interpreting");
      break;
    case "intake_recorded":
      showIntake(frame.intake);
      break;
    case "urgent_flag":
      showUrgent(frame);
      break;
```

**8.** At the bottom, under the `ui.end.addEventListener(...)` line, let the clinician close
the banner:

```js
ui.bannerDismiss.addEventListener("click", () => { ui.banner.hidden = true; });
```

The card functions build elements with `textContent`, never `innerHTML` with values in it.
Values come from the AI, so they are always shown as plain text.

## Try it

1. **Start the server.** The first lines now include the public address:

   ```
   [public-url] starting ngrok http 3000
   [public-url] ngrok tunnel https://abc123.ngrok-free.app -> http://localhost:3000
   [server] tools on: the engine will POST to https://abc123.ngrok-free.app/voice-tools/*
   ```

2. **Fake a tool call yourself.** Start a session in the browser and note the session id
   shown under the buttons. Then, in a terminal (put your own secret and session id in):

   ```bash
   curl -X POST http://localhost:3000/voice-tools/session-details \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_TOOL_SECRET" \
     -H "X-Session-Id: YOUR_SESSION_ID" \
     -d '{"tool":"record_session_details","arguments":{"clinician_name":"Sarah Chen","clinician_role":"physician","patient_name":"Nguyễn Thị Lan","preferred_address":"bà"},"call":{"id":"test"}}'
   ```

   The reply is `{"saved":true}`, and the "In the room" card appears on the page straight
   away. Try `flag-urgent` with
   `{"arguments":{"symptom":"chest pain","category":"chest_pain","severity":"emergency"}}`
   and watch the red banner. Try a wrong secret: you get `401`.

3. **Now for real.** Start a new session and answer the opening questions out loud. When
   the patient has given their name and form of address, the card fills by itself and the
   phase pill changes to "Interpreting". As the patient, say you have chest pain: the
   interpreter says it to the clinician in English, and the banner appears.

4. Open `sessions.html`. The session now shows the "In the room" card and the urgent flag,
   with no change to that page.

## Why it is written this way

- **Tools travel with each call, not on the agent.** The address and headers can then
  differ per call (here: the session id), and the engine sends them back on every request.
- **A shared secret in a header.** The engine adds the header to every tool request. The
  page never sees it, because the server opens the engine connection (Step 4).
- **Reduced mode instead of a crash.** Without a public address, interpreting still works.
  The page explains what is missing.
- **One server, one memory.** The registry lives in the server's memory. On your laptop,
  the WebSocket and the tool request reach the same process. On a hosting service that runs
  several copies of the server (Vercel can, in Step 10), a tool request may reach a copy
  that does not hold the WebSocket. The log then says `[browser not connected]`, and the card
  does not appear.

## Recap

- ngrok gives the engine a public `https` address that reaches your laptop.
- `tools.js` describes three tools, and their descriptions tell the AI when to call them.
- `toolRoutes.js` checks the secret, finds the session, cleans the values, saves, pushes a
  frame and replies.
- `registry.js` connects a tool request to the right browser.
- The page turns `session_details`, `urgent_flag` and `intake_recorded` into cards.

Next: [Step 8: ending a visit](08-ending-a-visit.md).
