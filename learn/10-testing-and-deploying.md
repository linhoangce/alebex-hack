# Step 10: Testing and deploying

**Goal:** add an automated test call, a clean-up route, and the files that let the app run on
Vercel with a public address.

**Files you create:** `scripts/smoke-call.js`, `api/index.js`, `vercel.json`,
`.vercelignore`, `scripts/setup-webhook.js`
**Files you change:** `src/sessions.js`, `src/app.js` (both now match the repo)

## Part A: an automated smoke test

### The idea

A **smoke test** is a quick check that the main path works end to end: "turn it on and see
if smoke comes out". Clicking through the page by hand after every change is slow. This
script plays the part of the browser, and the part of the engine for one tool call, and
prints PASS or FAIL for each check.

```
 smoke-call.js                  your server                     engine
   │── session_start ─────────────►│──── start_call ─────────────►│
   │◄─ audio (greeting), mark ─────│◄────────────────────────────── │  saves the greeting as a WAV
   │── mark (echo at once) ───────►│──────────────────────────────►│
   │◄─ call_started ───────────────│                                │
   │                               │                                │
   │── POST /voice-tools/session-details (pretending to be the engine)
   │◄─ session_details frame pushed back on the socket  ✔ tool route + registry + push
   │                               │                                │
   │── end_session (like the End button) ─────────────────────────►│
   │◄─ event_status frames, call_ended   ✔ events on, call closes in time
   ▼
 PASS / FAIL lines, exit code 0 or 1
```

It replaces the throwaway `try-socket.js` from Step 4. You can delete that file now.

### `scripts/smoke-call.js`

```js
// Automated smoke test: one short call through the local proxy with a silent "microphone".
//   node scripts/smoke-call.js [vi|zh] [--no-intake]     (default vi; SMOKE_LANGUAGE also works)
// Sends the session_start shape the client uses ({language, intake}), saves the greeting audio to
// data/spike/greeting-<lang>.wav and every text frame to data/spike/frames-<lang>[-no-intake].jsonl.
// After call_started it POSTs a sample record_session_details call to the server's tool endpoint,
// in the engine's envelope ({tool, arguments, call}) with the bearer header and X-Session-Id, and
// asserts that the session_details frame is pushed back on this socket within 2 s: that proves the
// tool route, the session registry and the push-to-browser path.
// Then it ends the call the way the End button does, with end_session. With the intake form on
// (the default) the proxy raises the visit.ending live event, so event_status frames must arrive
// and none may be `rejected` (a `rejected` with reason not_enabled_for_call means the agent's
// behaviour.callEvents is still off: run npm run setup), and call_ended must follow within 30 s.
// With --no-intake the proxy sends end_call at once, so call_ended should arrive within about 2 s.
// Bills a few seconds of call time. Run with the server up:
//   npm run smoke            npm run smoke -- zh            npm run smoke -- vi --no-intake
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const ARGS = process.argv.slice(2);
const LANG = String(ARGS.find((a) => !a.startsWith("--")) || process.env.SMOKE_LANGUAGE || "vi").toLowerCase();
const INTAKE = !(ARGS.includes("--no-intake") || /^(0|false|no|off)$/i.test(process.env.SMOKE_INTAKE ?? ""));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = path.join(ROOT, "data", "spike");
fs.mkdirSync(OUT, { recursive: true });
const WAV_PATH = path.join(OUT, `greeting-${LANG}.wav`);
const FRAMES_PATH = path.join(OUT, `frames-${LANG}${INTAKE ? "" : "-no-intake"}.jsonl`);
fs.writeFileSync(FRAMES_PATH, "");

const HTTP = (process.env.SMOKE_HTTP_URL || "http://localhost:3000").replace(/\/+$/, "");
const URL_WS = process.env.SMOKE_WS_URL || `${HTTP.replace(/^http/, "ws")}/ws/session`;
const MAX_MS = 20000;          // end_session goes out by this point whatever happened
const AFTER_MARK_MS = 2000;    // grace after the greeting's mark, to catch its transcript frames
const PUSH_TIMEOUT_MS = 2000;  // how long the session_details frame may take after the tool POST
const END_TIMEOUT_MS = 30000;  // call_ended must follow end_session within this
const QUICK_END_MS = 2000;     // without the intake form, end_session is a plain end_call: expected close time

const SAMPLE_DETAILS = {
  vi: { clinician_name: "Sarah Chen", clinician_role: "physician", patient_name: "Nguyễn Thị Lan", preferred_address: "bà" },
  zh: { clinician_name: "Sarah Chen", clinician_role: "physician", patient_name: "Wang Lihua", preferred_address: "王女士" },
};

const zeroFrame = Buffer.alloc(640);
const audioChunks = [];
const types = new Set();
const errors = [];
const eventStatuses = []; // {status, reason, name, line, ms} in order of arrival; ms is after end_session
let sessionId = null;
let callId = null;
let sampleRate = 24000;
let firstMarkAt = null;
let firstTranscript = null;
let endSent = false;
let endSentAt = null;
let callEndedMs = null;    // end_session -> call_ended
let intakeFrameMs = null;  // end_session -> intake_recorded push, if the agent recorded the form
let finished = false;
let micTimer = null;
let toolStatus = null;   // HTTP status of the sample tool POST
let pushArrived = null;  // true when the session_details frame came back on this socket in time
let pushMs = null;
let resolvePush = null;
let pushPromise = null;
const t0 = Date.now();
const sinceEnd = () => (endSentAt ? Date.now() - endSentAt : null);

const ws = new WebSocket(URL_WS);

function writeWav(chunks, rate) {
  const data = Buffer.concat(chunks);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);        // fmt chunk size
  header.writeUInt16LE(1, 20);         // PCM
  header.writeUInt16LE(1, 22);         // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);  // byte rate
  header.writeUInt16LE(2, 32);         // block align
  header.writeUInt16LE(16, 34);        // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(WAV_PATH, Buffer.concat([header, data]));
  return data.length / 2 / rate;
}

// The engine's envelope for a record_session_details call, as src/toolRoutes.js receives it.
async function postSessionDetails() {
  const details = SAMPLE_DETAILS[LANG] ?? SAMPLE_DETAILS.vi;
  const body = {
    tool: "record_session_details",
    arguments: details,
    call: { id: callId, agentId: null, from: null, to: null, startedAt: new Date(t0).toISOString() },
  };
  pushPromise = new Promise((resolve) => {
    resolvePush = resolve;
    setTimeout(() => resolve(false), PUSH_TIMEOUT_MS);
  });
  const t = Date.now();
  try {
    const res = await fetch(`${HTTP}/voice-tools/session-details`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TOOL_SECRET ?? ""}`, "X-Session-Id": sessionId },
      body: JSON.stringify(body),
    });
    toolStatus = res.status;
    console.log(`tool POST /voice-tools/session-details -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  } catch (err) {
    toolStatus = `failed: ${err.message}`;
    console.log(`tool POST failed: ${err.message}`);
  }
  pushArrived = await pushPromise;
  if (pushArrived) pushMs = Date.now() - t;
  console.log(pushArrived ? `session_details frame arrived ${pushMs} ms after the POST` : `session_details frame did NOT arrive within ${PUSH_TIMEOUT_MS} ms`);
}

function finish(why) {
  if (finished) return;
  finished = true;
  clearInterval(micTimer);
  const seconds = writeWav(audioChunks, sampleRate);
  const invalidConfig = errors.some((e) => /invalid_config/.test(e));
  const rejected = eventStatuses.filter((e) => e.status === "rejected");
  const sequence = eventStatuses.map((e) => `${e.status}${e.reason ? `(${e.reason})` : ""}@${e.ms ?? "?"}ms`).join(" -> ") || "(none)";
  console.log("\n=== smoke test summary ===");
  console.log(`language: ${LANG}; intake form: ${INTAKE ? "on" : "off"}`);
  console.log(`finished: ${why} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`session id: ${sessionId}`);
  console.log(`call id: ${callId}`);
  console.log(`customTools accepted: ${invalidConfig ? "NO (invalid_config)" : callId ? "yes (call_started, no invalid_config)" : "unknown (no call_started)"}`);
  console.log(`tool POST status: ${toolStatus ?? "(not sent)"}; session_details push: ${pushArrived === true ? `arrived in ${pushMs} ms` : pushArrived === false ? "MISSING" : "(not tested)"}`);
  console.log(`event_status sequence (ms after end_session): ${sequence}`);
  console.log(`intake_recorded push: ${intakeFrameMs != null ? `${intakeFrameMs} ms after end_session` : "(none)"}`);
  console.log(`end_session -> call_ended: ${callEndedMs != null ? `${callEndedMs} ms` : "call_ended NOT received"}`);
  console.log(`audio frames collected: ${audioChunks.length} (${seconds.toFixed(1)} s at ${sampleRate} Hz)`);
  console.log(`frame types seen: ${[...types].join(", ")}`);
  console.log(`first transcript/conversation_message frame: ${firstTranscript ?? "(none received)"}`);
  console.log(`error frames: ${errors.length ? errors.join("\n") : "none"}`);
  if (rejected.some((e) => e.reason === "not_enabled_for_call")) console.log("visit.ending was rejected with not_enabled_for_call: the agent's behaviour.callEvents is off; run npm run setup and retry");
  const checks = [
    ["no error frames", errors.length === 0],
    ["session_details push arrived", pushArrived === true],
    [`call_ended within ${END_TIMEOUT_MS / 1000} s of end_session`, callEndedMs != null && callEndedMs <= END_TIMEOUT_MS],
    ["no event_status rejected", rejected.length === 0],
  ];
  if (INTAKE) checks.push(["event_status frames arrived (callEvents on)", eventStatuses.length > 0]);
  else checks.push(["no event_status without the intake form", eventStatuses.length === 0], [`closed within ${QUICK_END_MS} ms`, callEndedMs != null && callEndedMs <= QUICK_END_MS]);
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  console.log(`wrote ${WAV_PATH}`);
  console.log(`wrote ${FRAMES_PATH}`);
  try { ws.close(); } catch {}
  const ok = checks.every(([, v]) => v);
  setTimeout(() => process.exit(ok ? 0 : 1), 200);
}

// What the End button sends. The proxy turns it into the visit.ending event or a plain end_call.
async function endSession(why) {
  if (endSent) return;
  endSent = true;
  if (pushPromise) await pushPromise; // let the registry-push check finish first
  console.log(`sending end_session (${why}) at +${((Date.now() - t0) / 1000).toFixed(1)} s`);
  endSentAt = Date.now();
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "end_session" }));
  setTimeout(() => finish(`no call_ended within ${END_TIMEOUT_MS / 1000} s of end_session`), END_TIMEOUT_MS);
}

ws.on("open", () => {
  console.log(`connected to ${URL_WS}`);
  ws.send(JSON.stringify({ type: "session_start", language: LANG, intake: INTAKE }));
  micTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(zeroFrame); }, 20);
  setTimeout(() => endSession("time limit"), MAX_MS);
});

ws.on("message", (data, isBinary) => {
  if (isBinary) return;
  const text = data.toString("utf8");
  fs.appendFileSync(FRAMES_PATH, text + "\n");
  let frame;
  try { frame = JSON.parse(text); } catch { return; }
  types.add(frame.type);
  switch (frame.type) {
    case "session_created":
      sessionId = frame.session_id;
      console.log(`session ${sessionId} (${frame.language}, intake ${frame.intake}, tools ${frame.tools_enabled ? "on" : "off"})`);
      break;
    case "call_started":
      callId = frame.call_id;
      console.log(`call_started ${callId} at +${((Date.now() - t0) / 1000).toFixed(1)} s`);
      postSessionDetails();
      break;
    case "session_details":
      console.log(`session_details frame: ${text.slice(0, 300)}`);
      if (resolvePush) resolvePush(true);
      break;
    case "intake_recorded":
      intakeFrameMs = sinceEnd();
      console.log(`intake_recorded frame at +${intakeFrameMs ?? "?"} ms after end_session: ${text.slice(0, 300)}`);
      break;
    case "event_status": {
      const ms = sinceEnd();
      eventStatuses.push({ status: frame.status, reason: frame.reason ?? null, name: frame.name ?? null, line: frame.line ?? null, ms });
      console.log(`event_status ${frame.name ?? "?"}: ${frame.status}${frame.reason ? ` (${frame.reason})` : ""}${frame.line ? ` line=${JSON.stringify(frame.line)}` : ""} at +${ms ?? "?"} ms after end_session`);
      break;
    }
    case "audio":
      if (frame.sample_rate) sampleRate = frame.sample_rate;
      if (!firstMarkAt) audioChunks.push(Buffer.from(frame.data, "base64"));
      break;
    case "mark":
      ws.send(JSON.stringify(frame)); // nothing is playing here, so echo at once
      if (!firstMarkAt) {
        firstMarkAt = Date.now();
        console.log(`first mark at +${((firstMarkAt - t0) / 1000).toFixed(1)} s, ${audioChunks.length} audio frames`);
        setTimeout(() => endSession("greeting collected"), AFTER_MARK_MS);
      }
      break;
    case "transcript":
    case "conversation_message":
      if (!firstTranscript) firstTranscript = text;
      console.log(`${frame.type}: ${text.slice(0, 300)}`);
      break;
    case "error":
      errors.push(text);
      console.log(`error frame: ${text}`);
      break;
    case "call_ended":
      callEndedMs = sinceEnd();
      console.log(`call_ended at +${callEndedMs ?? "?"} ms after end_session: ${text}`);
      finish("call_ended");
      break;
    default:
      console.log(`${frame.type}: ${text.slice(0, 200)}`);
  }
});

ws.on("close", (code) => finish(`socket closed (${code})`));
ws.on("error", (err) => { console.error(`socket error: ${err.message}`); finish("socket error"); });
```

The main parts:

- **Options.** `npm run smoke` tests Vietnamese with the intake form. `npm run smoke -- zh`
  tests Mandarin. `--no-intake` tests the quick-close path. (Everything after `--` is passed
  to the script.)
- **A silent microphone.** `zeroFrame` (640 zero bytes) is sent every 20 ms, just like the
  real page would send.
- **The greeting is saved.** Audio chunks are collected until the first `mark`, then written
  to `data/spike/greeting-vi.wav`. You can play the file to *hear* that the voice works.
  Every text frame is also written to `data/spike/frames-vi.jsonl` (one JSON object per
  line), which is handy for studying the protocol.
- **`writeWav`** builds the 44-byte header that turns raw PCM16 into a `.wav` file that
  any player can open:

  | Bytes | Value | Meaning |
  |---|---|---|
  | 0 to 3 | `RIFF` | "this is a RIFF file" |
  | 4 to 7 | 36 + data length | the size of everything after this field |
  | 8 to 11 | `WAVE` | "it holds a wave" |
  | 12 to 15 | `fmt ` | the format section starts |
  | 16 to 19 | 16 | the format section is 16 bytes long |
  | 20 to 21 | 1 | PCM, no compression |
  | 22 to 23 | 1 | one channel (mono) |
  | 24 to 27 | rate | samples per second (24000) |
  | 28 to 31 | rate × 2 | bytes per second |
  | 32 to 33 | 2 | bytes per sample |
  | 34 to 35 | 16 | bits per sample |
  | 36 to 39 | `data` | the samples start |
  | 40 to 43 | data length | how many bytes of samples |

  `writeUInt32LE` and `writeUInt16LE` write numbers little-endian, as the format requires.
- **`postSessionDetails`** sends exactly the request the engine would send (the same
  envelope, headers and secret) and waits up to 2 seconds for the `session_details` frame to
  come back on the socket. That one check proves three parts at once: the tool route, the
  registry and the push to the browser.
- **The end.** It sends `end_session`, just like the End button. With the intake form on,
  `event_status` frames must arrive and none may be `rejected`. If one is rejected with
  `not_enabled_for_call`, the script tells you to run `npm run setup`.
- **`finish`** prints a summary and the list of checks, then exits with `0` if all passed
  and `1` otherwise. The exit code lets other tools, such as a CI system, know the result.

### Try it

With the server running (and ngrok up, so tools are on):

```bash
npm run smoke
npm run smoke -- zh
npm run smoke -- vi --no-intake
```

The end of the output should be all `PASS`:

```
PASS no error frames
PASS session_details push arrived
PASS call_ended within 30 s of end_session
PASS no event_status rejected
PASS event_status frames arrived (callEvents on)
```

Each run uses a few seconds of call time.

## Part B: a clean-up route

Test sessions pile up in `data/`. This admin route deletes them all. It is protected with
the same `TOOL_SECRET`.

### Change `src/sessions.js`

Add this function at the end of the file:

```js

// Delete every stored session and recording on this machine (or this hosted instance).
export function clearSessions() {
  let deleted = 0;
  for (const [dir, ext] of [[SESSIONS_DIR, ".json"], [RECORDINGS_DIR, ".wav"]]) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(ext)) continue;
      try { fs.unlinkSync(path.join(dir, name)); deleted++; } catch {}
    }
  }
  return deleted;
}
```

It only deletes files with the expected ending (`.json` in sessions, `.wav` in
recordings), and it counts what it removed.

### Change `src/app.js`

**1.** Add `clearSessions` to the `sessions.js` import:

```js
import { listSessions, getSession, clearSessions, RECORDINGS_DIR } from "./sessions.js";
```

**2.** Between the `GET /api/sessions` route and the `GET /api/sessions/:id` route, add:

```js
  // Clear stored sessions (admin): Authorization: Bearer <TOOL_SECRET>.
  app.delete("/api/sessions", (req, res) => {
    const secret = process.env.TOOL_SECRET;
    if (!secret || req.get("authorization") !== `Bearer ${secret}`) return res.status(401).json({ error: "unauthorized" });
    const deleted = clearSessions();
    log.info(`[sessions] cleared ${deleted} stored files`);
    res.json({ deleted });
  });
```

`app.delete` answers only the HTTP `DELETE` method, so it does not clash with `app.get` on
the same path. If no `TOOL_SECRET` is set, the route refuses everyone.

Your `src/sessions.js` and `src/app.js` now match the repo's.

### Try it

```bash
curl -X DELETE http://localhost:3000/api/sessions                                     # 401
curl -X DELETE http://localhost:3000/api/sessions -H "Authorization: Bearer YOUR_TOOL_SECRET"
# {"deleted":12}
```

## Part C: deploying to Vercel

### The idea

Vercel runs your code as a **serverless function**: there is no server of your own to keep
running. Vercel starts your code when a request comes in. That changes a few things:

```
                     Your laptop (npm start)          Vercel
 start file          local-server.js                  api/index.js
 public address      ngrok, started by the server     https://<project>.vercel.app (automatic)
 page files          served by Express                served by Vercel's CDN
 WebSocket           ws on your http.Server           Vercel's WebSocket support (beta when built)
 session files       data/ in the project             the function's temporary folder (wiped at times)
 session length      no limit                         the function's time limit (300 s here)
 webhook             registered on every start        registered once, from your laptop
 .env                a file                           settings in the Vercel project
```

The code was built so the same `src/app.js` serves both. That is why `createApp` has a
`serveStatic` option, `sessions.js` checks `process.env.VERCEL`, and `ngrok.js` checks
`VERCEL_PROJECT_PRODUCTION_URL`. You wrote all three earlier.

### `api/index.js`: the Vercel start file

```js
// Vercel entry point: one function serves the HTTP routes and the /ws/session WebSocket proxy
// (Vercel's WebSocket beta: export an http.Server with a ws server attached). No ngrok and no
// webhook registration here: PUBLIC_BASE_URL (or the project's production URL) is the public
// base, and the webhook is registered once from a developer machine. Static files in public/
// are served by Vercel's CDN. Sessions live on the function's temp disk.
import "dotenv/config";
import http from "node:http";
import { createApp, attachWebSockets, logStartupChecks } from "../src/app.js";

logStartupChecks(console);
const { app, glossaries } = createApp({
  log: console,
  webhookRegistered: Boolean(process.env.ALEBEX_WEBHOOK_SECRET),
  serveStatic: false,
});
const server = http.createServer(app);
attachWebSockets(server, { glossaries, log: console });

export default server;
```

Compare it with `local-server.js`. There is no ngrok, no webhook registration and no
`listen()`. It builds the same app, attaches the same WebSocket handler, and **exports**
the server so Vercel can run it. `serveStatic: false` because Vercel's CDN serves
`public/`. `webhookRegistered` is true if the webhook secret is set in Vercel's settings.

### `vercel.json`: routing

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "functions": {
    "api/index.js": { "maxDuration": 300, "includeFiles": "prompts/**" }
  },
  "rewrites": [
    { "source": "/ws/session", "destination": "/api/index" },
    { "source": "/voice-tools/:path*", "destination": "/api/index" },
    { "source": "/alebex/:path*", "destination": "/api/index" },
    { "source": "/api/config", "destination": "/api/index" },
    { "source": "/api/sessions", "destination": "/api/index" },
    { "source": "/api/sessions/:id", "destination": "/api/index" },
    { "source": "/recordings/:path*", "destination": "/api/index" }
  ]
}
```

- **`functions`**: the one function, `api/index.js`.
  - `maxDuration: 300` lets one request (here, one WebSocket session) last up to 300
    seconds. When the limit is reached, the session ends. The README notes that this is
    five minutes on Vercel's Hobby plan.
  - `includeFiles: "prompts/**"` bundles the prompt folder with the function, because
    `loadGlossaries` reads it at run time. Without it, the glossaries would be missing.
- **`rewrites`** send these paths to the function. Everything else (the page, `app.js`,
  `styles.css`) is a static file.
- Because of the rewrite, the function may see the path as `/api/index` instead of
  `/ws/session`. That is why `WS_PATHS` in `src/app.js` accepts both (and `/api/ws`).

### `.vercelignore`: what not to upload

```
data
.env
env.env
node_modules
AGENTS.md
alebex-voice-prompting-best-practices.md
scripts/smoke-call.js
local-server.js
.env.local
.env*.local
```

Secrets, local data, the two big reference documents, and the files only used locally
(`local-server.js`, the smoke test) stay off Vercel.

### `scripts/setup-webhook.js`: register the hosted address once

```js
// Manual mode: register or update the end-of-call webhook for a fixed PUBLIC_BASE_URL without
// starting the server. npm start does the same on every boot (with the ngrok URL it started),
// so this is only for a public URL you manage yourself.
import "dotenv/config";
import { ensureWebhook, WEBHOOK_NAME } from "../src/webhook.js";

const base = (process.env.PUBLIC_BASE_URL ?? "").trim();
if (!/^https:\/\//.test(base)) {
  console.error("Set PUBLIC_BASE_URL (an https URL) in .env first, or just run npm start, which starts ngrok and registers the webhook itself.");
  process.exit(1);
}

ensureWebhook(base)
  .then((r) => console.log(`webhook ${WEBHOOK_NAME} ${r.action}: ${r.url} (id ${r.id}; signing secret ${r.secretStored ? "stored in .env" : "MISSING"})`))
  .catch((err) => {
    console.error(`setup:webhook failed${err.code ? ` (${err.code})` : ""}: ${err.message}`);
    process.exit(1);
  });
```

On Vercel, nothing registers the webhook on start, and the function cannot write `.env`
anyway. So you register it once from your laptop, with the production address. This
script reuses `ensureWebhook` from Step 9.

### Deploy, step by step

1. Install the Vercel command-line tool and link the folder to a project:

   ```bash
   npm install -g vercel
   vercel login
   vercel link
   ```

2. In the Vercel project settings, add the environment variables from your `.env`:
   `ALEBEX_API_KEY`, `ALEBEX_API_URL`, `ALEBEX_ENGINE_URL`, `TOOL_SECRET`,
   `ALEBEX_AGENT_ID_VI`, `ALEBEX_AGENT_ID_ZH`. Optionally add `MAX_SESSION_SECONDS=300`, so
   the page explains why a hosted session stopped after five minutes.

3. Deploy:

   ```bash
   vercel deploy --prod
   ```

4. Point the webhook at the hosted app (use your own address):

   ```bash
   PUBLIC_BASE_URL=https://your-project.vercel.app npm run setup:webhook
   ```

   Then copy `ALEBEX_WEBHOOK_SECRET` from your `.env` into the Vercel settings and deploy
   again.

5. Open `https://your-project.vercel.app`, and run a session.

**One webhook, two places.** There is a single webhook named `interpreter-end-of-call`. Every
`npm start` on your laptop points it back at your ngrok address. After local testing, run
step 4 again, or hosted sessions will not get their reports.

### Limits of the hosted version

- **Sessions end at the time limit** (300 seconds in `vercel.json`).
- **The temporary folder is per instance and can be wiped**, so the history page on Vercel
  is short-lived.
- **Several instances.** As noted in Step 7, a tool request or the webhook may reach a
  different instance from the one holding the WebSocket. Then the card does not appear
  (`[browser not connected]` in the log), or the session file is not found.

## Recap

- `npm run smoke` runs a real short call and checks the tool route, the registry, events
  and closing. It ends with PASS or FAIL.
- `DELETE /api/sessions` with the tool secret clears local data.
- `api/index.js` reuses `src/app.js` on Vercel. `vercel.json` routes the API paths and the
  socket to it and bundles `prompts/`.
- Every file now matches the repo.

**You have built the whole app.** The [cheat sheet](11-cheat-sheet.md) has the full message
list, every setting, a troubleshooting table, a fake engine for free practice, and
exercises to keep going.
