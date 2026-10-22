# Step 4: The server and the voice bridge

**Goal:** build a Node server that accepts a WebSocket from a browser, opens a second
WebSocket to the Alebex engine, and passes everything across.

**Files you create:** `src/words.js`, `src/context.js`, `src/proxy.js` (first version),
`src/app.js` (first version), `local-server.js` (first version)

## The idea

### Two phone lines, joined in the middle

```
   Browser                     Your server (proxy.js)                Engine
 ┌─────────┐   socket A    ┌──────────────────────────┐  socket B  ┌────────┐
 │         │══════════════►│ binary (mic audio)  ─────┼═══════════►│        │
 │         │               │   ...only once "live"    │            │        │
 │         │──────────────►│ session_start → opens B  │            │        │
 │         │               │ mark, ping   ────────────┼───────────►│        │
 │         │               │ end_call     ────────────┼───────────►│        │
 │         │               │ anything else: dropped   │            │        │
 │         │               │                          │            │        │
 │         │◄══════════════┼──── binary   ◄═══════════┼════════════│        │
 │         │◄──────────────┼──── every text frame ◄───┼────────────│        │
 │         │               │     (and it peeks at     │            │        │
 └─────────┘               │      call_started,       │            └────────┘
                           │      call_ended, error)  │
                           └──────────────────────────┘
```

For every browser that connects, the proxy opens exactly one connection to the engine. It
copies messages across. On the way, it:

- **adds secrets.** The key goes on socket B, never on socket A.
- **decides the setup.** The browser only says which language. The server picks the agent,
  the glossary and the context.
- **filters.** The browser can only send a few kinds of message upwards. It cannot start a
  call with a different agent.
- **watches.** It notices when the call goes live and when it ends.

### What the engine expects

From [`AGENTS.md`](../AGENTS.md), section "Run a browser call":

- Connect to `wss://api.voice.alebex.ai/public/ws/call`, with the key in the
  `Sec-WebSocket-Protocol` header as `alebex.token.<key>`.
- Send `{"type": "start_call", "agent": {"id": "..."}}` first. Optional extras:
  `knowledgeBase`, `context`, `customTools`.
- Wait for `{"type": "call_started", "call_id": "..."}`.
- Then send microphone audio as binary frames, and get audio back as `audio` text frames.

### The context: today's facts, in words

The AI does not know today's date unless you tell it. The context tells it. Because the AI
speaks, the prompt forbids digits, and the context follows the same rule: "Wednesday,
October seventh, twenty twenty-six", not `2026-10-07`.

## Build it

### `src/words.js`: numbers as spoken words

```js
// Numbers, dates and times as spoken words, for the call context (Appendix E).

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
  "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth",
  "nineteenth", "twentieth", "twenty-first", "twenty-second", "twenty-third", "twenty-fourth", "twenty-fifth",
  "twenty-sixth", "twenty-seventh", "twenty-eighth", "twenty-ninth", "thirtieth", "thirty-first"];

// Cardinal 0..99 in words.
export function numberWords(n) {
  n = Math.trunc(Number(n));
  if (n < 0 || n > 99 || Number.isNaN(n)) return String(n);
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = n % 10;
  return o ? `${t}-${ONES[o]}` : t;
}

// Day of month 1..31 as an ordinal.
export function ordinal(n) {
  return ORDINALS[n] ?? String(n);
}

// Years as two pairs: 2026 -> "twenty twenty-six", 2007 -> "two thousand and seven", 1999 -> "nineteen ninety-nine".
export function yearWords(y) {
  y = Math.trunc(Number(y));
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  if (hi === 20 && lo < 10) return lo ? `two thousand and ${ONES[lo]}` : "two thousand";
  if (lo === 0) return `${numberWords(hi)} hundred`;
  if (lo < 10) return `${numberWords(hi)} oh ${ONES[lo]}`;
  return `${numberWords(hi)} ${numberWords(lo)}`;
}

// 10:30 -> "ten thirty in the morning", 15:05 -> "three oh five in the afternoon", 12:00 -> "twelve o'clock in the afternoon".
export function timeWords(date) {
  const h24 = date.getHours();
  const m = date.getMinutes();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const period = h24 < 5 ? "at night" : h24 < 12 ? "in the morning" : h24 < 17 ? "in the afternoon" : h24 < 21 ? "in the evening" : "at night";
  const minutes = m === 0 ? "o'clock" : m < 10 ? `oh ${ONES[m]}` : numberWords(m);
  return `${numberWords(h12)} ${minutes} ${period}`;
}

// "Wednesday, October seventh, twenty twenty-six, at ten thirty in the morning, Eastern Daylight Time."
export function dateTimeWords(date = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-CA", { weekday: "long" }).format(date);
  const month = new Intl.DateTimeFormat("en-CA", { month: "long" }).format(date);
  const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: "long" })
    .formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "local time";
  return `${weekday}, ${month} ${ordinal(date.getDate())}, ${yearWords(date.getFullYear())}, at ${timeWords(date)}, ${zone}`;
}
```

- **Lookup tables** (`ONES`, `TENS`, `ORDINALS`) hold the words. The functions only pick
  from them. Minutes and hours never go past 59, so 0 to 99 is enough.
- **`numberWords(45)`**: `TENS[4]` is "forty", `ONES[5]` is "five", giving "forty-five".
- **`yearWords`** splits a year into two pairs, the way people say it: 2026 becomes 20 and
  26, which reads "twenty twenty-six". Years 2000 to 2009 are a special case ("two thousand
  and seven").
- **`timeWords`** turns 24-hour time into 12-hour time with a part of the day, so 15:05
  becomes "three oh five in the afternoon".
- **`dateTimeWords`** uses `Intl.DateTimeFormat`, which is built into JavaScript and already
  knows the names of weekdays, months and time zones. `formatToParts` splits a formatted
  date into labelled pieces, so the code can pull out only the time-zone name.

### `src/context.js`: the per-call facts

```js
// Builds the per-call `context` text (AGENTS.md "Caller context"; plan Appendix D).
// Facts only, no instructions, numbers in words. Names and roles are no longer typed in:
// the agent collects them by voice and saves them with record_session_details.
import { dateTimeWords } from "./words.js";

export function buildContext({ language = "", intake = false } = {}, now = new Date()) {
  const lines = ["Session details.", `Date and time: ${dateTimeWords(now)}.`];
  if (language) lines.push(`Patient's language: ${language}.`);
  lines.push(intake
    ? "Intake form: fill it at the end of the visit from what the patient says."
    : "Intake form: not needed for this visit.");
  return lines.join("\n").slice(0, 4000);
}
```

For a Vietnamese visit with the intake form on, it produces:

```
Session details.
Date and time: Wednesday, October seventh, twenty twenty-six, at ten thirty in the morning, Eastern Daylight Time.
Patient's language: Vietnamese.
Intake form: fill it at the end of the visit from what the patient says.
```

- **Facts only.** The engine shows the context to the AI as "facts about this caller", never
  as orders. So the context says *what is true* ("Intake form: not needed"), and the prompt
  says *what to do* about it (step 4 of HOW THE SESSION GOES).
- **`.slice(0, 4000)`**: the engine allows at most 4,000 characters of context.
- **`now = new Date()`** as a parameter makes the function easy to test with a fixed date.

### `src/proxy.js`: the voice bridge (first version)

This is the heart of the server. This first version bridges a call. Steps 6, 7 and 8 add
saving, tools and a smarter End button.

```js
// One browser session <-> one upstream Alebex call (AGENTS.md "Run a browser call").
// The API key never reaches the browser: this side opens the engine socket and sends start_call itself.
// session_start is {type, language, intake}: the agent id, glossary and context follow from the
// language registry, and the three custom tools ride on start_call when a public URL exists.
// End flow: the browser sends end_session. When the intake form is still to be recorded (intake on,
// no record_intake yet, tools on) the proxy raises the visit.ending live event (AGENTS.md "Live call
// events"), waits for the intake_recorded push, lets the spoken thanks finish, then sends end_call.
// Otherwise end_call goes up at once. A raw end_call from the browser is still the hard stop.
import crypto from "node:crypto";
import WebSocket from "ws";
import { buildContext } from "./context.js";
import { getLanguage, agentIdFor, enabledLanguages } from "./languages.js";

const RELAY_UP = new Set(["mark", "ping"]); // browser text frames passed upstream verbatim; end_call is handled below
const KNOWN = new Set(["call_started", "audio", "mark", "clear_audio", "transcript", "conversation_message", "call_ended", "error", "pong", "event_status"]);
const unknownSeen = new Set();

export function handleBrowserSocket(browser, { glossaries = {}, log = console } = {}) {
  let upstream = null;
  let session = null;
  let live = false; // call_started received: mic frames may flow
  let closed = false;

  const tag = () => `[session ${session?.id ?? "-"}]`;
  const toBrowser = (frame) => {
    if (browser.readyState === WebSocket.OPEN) browser.send(typeof frame === "string" ? frame : JSON.stringify(frame));
  };
  const sendUp = (frame) => {
    if (upstream?.readyState !== WebSocket.OPEN) return false;
    upstream.send(JSON.stringify(frame));
    return true;
  };

  function shutdown(reason) {
    if (closed) return;
    closed = true;
    try { if (upstream && upstream.readyState <= WebSocket.OPEN) upstream.close(1000, "session over"); } catch {}
    try { if (browser.readyState <= WebSocket.OPEN) browser.close(1000, "session over"); } catch {}
    log.info(`${tag()} closed (${reason})`);
  }

  function endCall(why) {
    log.info(`${tag()} end_call (${why})`);
    if (!sendUp({ type: "end_call" })) shutdown(`end_call with no upstream (${why})`);
  }

  browser.on("message", (data, isBinary) => {
    if (isBinary) {
      if (live && upstream?.readyState === WebSocket.OPEN) upstream.send(data, { binary: true });
      return;
    }
    let frame;
    try { frame = JSON.parse(data.toString("utf8")); } catch { return; }
    if (!session) {
      if (frame.type === "session_start") startSession(frame);
      else toBrowser({ type: "error", code: "bad_message", message: "send session_start first" });
      return;
    }
    if (frame.type === "end_call") { endCall("browser end_call"); return; }
    if (RELAY_UP.has(frame.type)) sendUp(frame);
    // start_call, call_event and anything else from the browser is dropped on purpose.
  });
  browser.on("close", () => shutdown("browser-closed"));
  browser.on("error", (err) => { log.warn(`${tag()} browser socket error: ${err.message}`); shutdown("browser-error"); });

  function startSession(frame) {
    const lang = getLanguage(String(frame.language ?? ""));
    if (!lang) {
      const codes = enabledLanguages().map((l) => l.code).join(", ") || "none";
      toBrowser({ type: "error", code: "invalid_config", message: `Unknown language "${frame.language ?? ""}". Available: ${codes}.` });
      browser.close(1008, "unknown language");
      return;
    }
    const agentId = agentIdFor(lang);
    if (!agentId) {
      toBrowser({ type: "error", code: "invalid_config", message: `No agent id for ${lang.name} (${lang.agentEnv} in .env). Run npm run setup.` });
      browser.close(1011, "no agent");
      return;
    }
    const intake = frame.intake === true || frame.intake === "true";
    const context = buildContext({ language: lang.name, intake });
    session = { id: crypto.randomBytes(4).toString("hex"), language: lang.code, intake }; // Step 6 saves this to disk
    const glossary = glossaries[lang.code] ?? "";
    log.info(`${tag()} start (${lang.name}, glossary ${glossary.length} chars)\n${context}`);
    toBrowser({ type: "session_created", session_id: session.id, language: lang.code, intake, tools_enabled: false });

    const engine = `${process.env.ALEBEX_ENGINE_URL.replace(/^http/, "ws").replace(/\/+$/, "")}/public/ws/call`;
    upstream = new WebSocket(engine, [`alebex.token.${process.env.ALEBEX_API_KEY}`]);

    upstream.on("open", () => {
      const startCall = { type: "start_call", agent: { id: agentId } };
      if (glossary) startCall.knowledgeBase = glossary;
      if (context) startCall.context = context;
      upstream.send(JSON.stringify(startCall));
    });

    upstream.on("message", (data, isBinary) => {
      if (isBinary) { if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary: true }); return; }
      const text = data.toString("utf8");
      toBrowser(text); // every upstream text frame goes down verbatim
      let frame;
      try { frame = JSON.parse(text); } catch { return; }
      if (frame.type === "call_started") {
        live = true;
        log.info(`${tag()} call_started ${frame.call_id}`);
      } else if (frame.type === "call_ended") {
        shutdown(frame.reason ?? (frame.ended_by ? `ended by ${frame.ended_by}` : "call_ended"));
      } else if (frame.type === "error") {
        log.warn(`${tag()} engine error ${frame.code}: ${frame.message}`);
      } else if (!KNOWN.has(frame.type) && !unknownSeen.has(frame.type)) {
        unknownSeen.add(frame.type);
        log.info(`${tag()} unknown upstream frame type "${frame.type}": ${text.slice(0, 400)}`);
      }
    });
    upstream.on("close", (code, reason) => shutdown(`upstream-closed ${code} ${reason?.toString() ?? ""}`.trim()));
    upstream.on("error", (err) => {
      log.warn(`${tag()} upstream socket error: ${err.message}`);
      toBrowser({ type: "error", code: "upstream_error", message: err.message });
      shutdown("upstream-error");
    });
  }
}
```

The comment at the top describes the finished file, so it mentions features you build later.
That is on purpose: when you finish Step 8, your file matches the repo's.

The shape of the file:

```
handleBrowserSocket(browser)        ← called once for every browser that connects
 ├─ its own variables: upstream, session, live, closed
 ├─ small helpers: tag(), toBrowser(), sendUp()
 ├─ shutdown(reason)                ← close both sockets, only once
 ├─ endCall(why)                    ← ask the engine to hang up
 ├─ browser.on("message")           ← every frame from the browser lands here
 └─ startSession(frame)             ← runs on the first session_start
      ├─ check the language and the agent id
      ├─ build the context, make a session id, send session_created
      └─ open socket B, send start_call, pass the engine's frames down
```

Now the details:

- **One function call per browser.** `handleBrowserSocket` runs once per connection. The
  variables inside it (`upstream`, `session`, `live`, `closed`) belong to that one
  connection. Ten browsers means ten separate sets. This is called a **closure**.
- **`readyState`**: a socket is `CONNECTING` (0), `OPEN` (1), `CLOSING` (2) or `CLOSED`
  (3). The code only sends on an `OPEN` socket, and `<= WebSocket.OPEN` means "still
  connecting or open, so close it".
- **`toBrowser` and `sendUp`** each check the state first, so a late message never crashes
  the server. `sendUp` returns `false` when it could not send, and `endCall` uses that.
- **`shutdown` runs only once** thanks to the `closed` flag. Many things can trigger it: the
  browser closes, the engine closes, an error. Each of those can trigger the others: closing
  socket B fires B's `close` event, which calls `shutdown` again. The flag stops that loop.
- **The `live` gate.** Microphone audio is passed up only after `call_started`. Until then
  the engine is not listening.
- **Text and binary.** The `ws` library tells you which kind each frame is (`isBinary`).
  Binary frames are audio and are passed through untouched. Text frames are parsed as JSON.
  `try { JSON.parse } catch { return; }` ignores anything that is not JSON.
- **The first message must be `session_start`.** Anything else gets a polite error frame.
- **The allow-list.** After the start, only `end_call`, `mark` and `ping` go up.
  `start_call` and `call_event` are dropped on purpose: the server, not the page, decides
  what the call does.
- **Close codes.** `1008` means "you sent something not allowed" (unknown language).
  `1011` means "the server has a problem" (no agent id). `1000` means "normal close".
- **Opening socket B.** `ALEBEX_ENGINE_URL` starts with `https`. `.replace(/^http/, "ws")`
  turns `https://` into `wss://` (and `http://` into `ws://`). `.replace(/\/+$/, "")`
  removes any slashes at the end. The second argument to `new WebSocket` is the list of
  subprotocols, which becomes the `Sec-WebSocket-Protocol` header that carries the key.
- **`start_call`** gets the glossary as `knowledgeBase` and the context.
- **Every engine text frame goes to the browser as it is** (`toBrowser(text)`). The server
  also reads a few of them: `call_started` opens the `live` gate, and `call_ended` shuts
  everything down.
- **Unknown frame types are logged once.** This helped while learning the engine: a new
  frame type shows up in the log the first time it appears, without flooding it.
- **The session id is temporary for now.** `crypto.randomBytes(4).toString("hex")` makes
  eight random letters and digits, such as `6088bc95`. In Step 6, real saved sessions replace
  it.

### `src/app.js`: the web app (first version)

```js
// Builds the Express app and the WebSocket upgrade handler. Shared by local-server.js (which
// also starts ngrok, registers the webhook and listens) and api/index.js (Vercel: exports the
// http.Server, no boot steps, static files served by Vercel's CDN).
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { handleBrowserSocket } from "./proxy.js";
import { enabledLanguages, agentIdFor, loadGlossaries } from "./languages.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
// /ws/session is the real path; the other two are what a Vercel rewrite or a direct call may use.
const WS_PATHS = new Set(["/ws/session", "/api/index", "/api/ws"]);

export function logStartupChecks(log = console) {
  for (const key of ["ALEBEX_API_KEY", "ALEBEX_API_URL", "ALEBEX_ENGINE_URL", "TOOL_SECRET"]) {
    if (!process.env[key]) log.warn(`[server] ${key} is not set`);
  }
  const languages = enabledLanguages();
  if (!languages.length) log.warn("[server] no language pack found under prompts/lang; sessions cannot start");
  for (const lang of languages) {
    if (!agentIdFor(lang)) log.warn(`[server] ${lang.agentEnv} is not set; run npm run setup (${lang.name} sessions will not start)`);
  }
  return languages;
}

export function createApp({ log = console, serveStatic = true } = {}) {
  const languages = enabledLanguages();
  const glossaries = loadGlossaries();
  log.info(`[server] languages: ${languages.map((l) => `${l.name} (${l.code}, glossary ${glossaries[l.code].length} chars)`).join(", ") || "none"}`);

  const app = express();
  app.disable("x-powered-by");
  if (serveStatic) app.use(express.static(path.join(ROOT, "public")));

  app.get("/api/config", (req, res) => res.json({
    languages: languages.map(({ code, name }) => ({ code, name })),
    wsPath: process.env.WS_PATH || "/ws/session",
    maxSessionSeconds: Number(process.env.MAX_SESSION_SECONDS) || null,
    hosted: Boolean(process.env.VERCEL),
  }));
  return { app, glossaries, languages };
}

export function attachWebSockets(server, { glossaries, log = console }) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (!WS_PATHS.has(pathname)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => handleBrowserSocket(ws, { glossaries, log }));
  });
  return wss;
}
```

One port answers two kinds of request:

```
 http.Server on port 3000
   ├── normal requests ───► Express app ──► files in public/, /api/config
   └── "upgrade" requests ─► path is /ws/session? ── no ──► socket.destroy()
                                    │
                                   yes ──► ws library ──► handleBrowserSocket(ws)
```

- **`logStartupChecks`** warns about missing settings as soon as the server starts. That is
  better than finding out when the first patient is in the room.
- **`createApp`** builds the Express app:
  - `app.disable("x-powered-by")` stops Express from announcing itself in every response.
    There is no reason to tell strangers what software you run.
  - `express.static(".../public")` serves the page's files: a request for `/app.js` gets
    `public/app.js`.
  - **`/api/config`** tells the page which languages it can offer, and where the WebSocket
    lives. `wsPath`, `maxSessionSeconds` and `hosted` only matter on Vercel (Step 10).
    Locally they stay at their defaults.
  - The glossaries are read **once**, when the server starts, and passed on to every
    session. That avoids reading the disk on every call.
  - `serveStatic` and the extra paths in `WS_PATHS` are also for Vercel (Step 10).
- **`attachWebSockets`**: a WebSocket starts life as a normal HTTP request that says
  "please upgrade this connection". `noServer: true` means the `ws` library does not open
  its own port; you hand it the upgrade requests yourself. That way one port serves both
  the page and the socket. Requests for any other path are refused with
  `socket.destroy()`.

### `local-server.js`: the start file (first version)

```js
// Local entry point (npm start): public https URL (PUBLIC_BASE_URL or ngrok) -> webhook
// registration -> HTTP + WebSocket server. The Vercel entry point is api/index.js.
import "dotenv/config";
import http from "node:http";
import { createApp, attachWebSockets, logStartupChecks } from "./src/app.js";

const PORT = Number(process.env.PORT || 3000);
logStartupChecks(console);

const { app, glossaries } = createApp({ log: console });
const server = http.createServer(app);
attachWebSockets(server, { glossaries, log: console });
server.listen(PORT, () => console.log(`Interpreter server listening on http://localhost:${PORT}`));
```

`http.createServer(app)` makes a plain Node HTTP server that hands normal requests to
Express. Keeping our own `server` object (instead of calling `app.listen`) is what lets
`attachWebSockets` add the upgrade handler to it.

The file is small on purpose. All the real work is in `src/app.js`, so the Vercel start file
(Step 10) can reuse it.

## Try it

1. Start the server:

   ```bash
   npm start
   ```

   You should see:

   ```
   [server] languages: Vietnamese (vi, glossary 10854 chars), Mandarin (zh, glossary 8646 chars)
   Interpreter server listening on http://localhost:3000
   ```

   If a warning says an `ALEBEX_AGENT_ID_...` is not set, run `npm run setup` (Step 3).

2. In a second terminal:

   ```bash
   curl http://localhost:3000/api/config
   ```

   You should get JSON with your two languages.

3. **Hear the greeting without a browser.** Make a throwaway test script,
   `scripts/try-socket.js`. It is not part of the finished repo: Step 10's
   `smoke-call.js` is the grown-up version of it.

   ```js
   // Throwaway test: open a session, send silence, echo marks, hang up 3 s after the call starts.
   import WebSocket from "ws";

   const ws = new WebSocket("ws://localhost:3000/ws/session");
   const silence = Buffer.alloc(640); // 20 ms of silence: 320 samples x 2 bytes
   let mic = null;
   let audioFrames = 0;

   ws.on("open", () => {
     ws.send(JSON.stringify({ type: "session_start", language: "vi", intake: false }));
     mic = setInterval(() => ws.send(silence), 20); // a "microphone" that hears nothing
   });

   ws.on("message", (data, isBinary) => {
     if (isBinary) return;
     const frame = JSON.parse(data.toString());
     if (frame.type === "audio") { audioFrames++; return; }
     console.log(frame.type, JSON.stringify(frame).slice(0, 120));
     if (frame.type === "mark") ws.send(JSON.stringify(frame)); // nothing plays here, so echo at once
     if (frame.type === "call_started") setTimeout(() => ws.send(JSON.stringify({ type: "end_call" })), 3000);
   });

   ws.on("close", () => {
     clearInterval(mic);
     console.log(`closed; ${audioFrames} audio frames received`);
   });
   ```

   Run it while the server is running (it uses a few seconds of call time):

   ```bash
   node scripts/try-socket.js
   ```

   You should see `session_created`, then the greeting arriving (a `mark` and its text as a
   `conversation_message`, in either order), `call_started`, and finally `call_ended`,
   followed by a count of audio frames.
   Those audio frames are the greeting you will hear in Step 5. The server's log shows the
   context it sent.

## Why it is written this way

- **The server never looks inside the audio.** It passes the bytes along. That keeps the
  proxy simple and fast.
- **The browser cannot steer the call.** It picks a language and nothing else. Agent ids,
  the glossary, tools and events are all decided on the server.
- **Each call carries its own glossary and context.** Nothing per-call is stored on the
  agent, so two sessions at the same time never mix.
- **Errors become messages.** A missing agent id or an unknown language reaches the browser
  as a readable `error` frame, not a silent hang-up.

## Recap

- `words.js` and `context.js` build today's facts as spoken words.
- `proxy.js` joins two WebSockets: browser to server, and server to engine, adding the key
  and the setup on the way.
- `app.js` serves files, `/api/config`, and the WebSocket on one port.
- `local-server.js` starts it all.

Next: [Step 5: sound in the browser](05-browser-audio.md).
