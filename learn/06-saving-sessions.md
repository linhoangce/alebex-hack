# Step 6: Saving sessions

**Goal:** save every session (who was there, the transcript, what the AI recorded) to disk,
and build a page that lists past sessions.

**Files you create:** `src/sessions.js`, `public/sessions.html`
**Files you change:** `src/proxy.js`, `src/app.js`

## The idea

### A database made of files

A real product would use a database. For a hackathon on one machine, **one JSON file per
session** is enough, and you can open it in any text editor:

```
data/
├── sessions/
│   ├── 20261007-103012-a1f3.json      ← one visit
│   └── 20261007-111545-09bc.json
└── recordings/
    └── 20261007-103012-a1f3.wav       ← its audio (Step 9)
```

The **session id** is the date and time plus four random characters, for example
`20261007-103012-a1f3`. It sorts by time, a person can read it, and the random part stops
two sessions started in the same second from clashing.

### One file, filled in by many steps

A session file starts almost empty. Different parts of the app fill it in over time:

| Field | What it holds | Filled by | Step |
|---|---|---|---|
| `id`, `language`, `intake`, `mode`, `createdAt`, `context` | The basics | the proxy, at start | 6 |
| `callId` | The engine's id for this call | the proxy, on `call_started` | 6 |
| `messages`, `frames` | The transcript (clean lines and raw frames) | the proxy, as lines arrive | 6 |
| `endedAt`, `endedReason` | When and why it ended | the proxy, at shutdown | 6 |
| `details` | Clinician and patient names | the `record_session_details` tool | 7 |
| `urgentFlags` | Red-flag symptoms | the `flag_urgent_symptom` tool | 7 |
| `intakeRecord` | The intake form | the `record_intake` tool | 7, 8 |
| `summary`, `durationSeconds`, `toolCalls`, `report`, `recordingPath`, `liveMessages` | The engine's report after the call | the webhook | 9 |

Every update follows the same three moves: **read** the file, **merge** in the new fields,
**write** it back.

## Build it

### `src/sessions.js`

```js
// JSON file store: one file per session under data/sessions/<id>.json.
// Small synchronous writes; fine for a hackathon on one machine.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";

// data/ in the repo locally. On Vercel the bundle is read-only, so the function's temp disk
// (ephemeral, per instance) holds sessions for the life of the instance.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : process.env.VERCEL ? path.join(os.tmpdir(), "alebex-data") : fileURLToPath(new URL("../data/", import.meta.url));
export const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
export const RECORDINGS_DIR = path.join(DATA_DIR, "recordings");
fs.mkdirSync(SESSIONS_DIR, { recursive: true });
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const fileFor = (id) => path.join(SESSIONS_DIR, `${id}.json`);
const safeId = (id) => /^[A-Za-z0-9_-]+$/.test(String(id));

function newId(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${stamp}-${crypto.randomBytes(2).toString("hex")}`;
}

function write(session) {
  fs.writeFileSync(fileFor(session.id), JSON.stringify(session, null, 2), "utf8");
  return session;
}

export function createSession(fields = {}) {
  const now = new Date();
  const intake = Boolean(fields.intake);
  return write({
    id: newId(now),
    language: fields.language ?? "",            // registry code: vi, zh
    intake,                                      // true: the intake form is filled at the end of the visit; false: not needed
    mode: intake ? "intake form" : "no intake form",
    createdAt: now.toISOString(),
    endedAt: null,
    endedReason: null,
    callId: null,
    context: fields.context ?? "",
    details: null,        // record_session_details: clinician_name, clinician_role, patient_name, preferred_address
    intakeRecord: null,   // record_intake: the English intake answers
    urgentFlags: [],      // flag_urgent_symptom, one entry per distinct flag
    messages: [],         // normalized {role, text, at, type} from transcript / conversation_message frames
    frames: [],           // the raw transcript / conversation_message frames, kept for inspection
    summary: null,        // from the end-of-call webhook
    durationSeconds: null,
    toolCalls: [],
    report: null,
    recordingPath: null,
  });
}

export function getSession(id) {
  if (!safeId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), "utf8"));
  } catch {
    return null;
  }
}

export function updateSession(id, patch) {
  const s = getSession(id);
  if (!s) return null;
  return write({ ...s, ...patch });
}

// The engine marks the language of some agent lines with a "[LANG:vi] " prefix in transcript text
// (speech is unaffected). It is stripped wherever text is stored or shown.
export const LANG_MARK_RE = /^\[LANG:[a-z]+\]\s*/i;
export const stripLangMark = (text) => String(text ?? "").replace(LANG_MARK_RE, "");

// Normalize a transcript line. Observed on the first live call (smoke test):
//   {"type":"conversation_message","role":"assistant","content":"...","timestamp":"2026-10-07T20:49:17.862766"}
// The `transcript` frame (what the engine heard) was not seen yet, so its fields are read defensively.
export function normalizeMessage(frame) {
  const text = frame.content ?? frame.text ?? frame.message ?? frame.transcript ?? "";
  let role = frame.role ?? frame.speaker ?? frame.source ?? (frame.type === "transcript" ? "caller" : "agent");
  role = String(role).toLowerCase();
  if (["user", "caller", "customer", "human"].includes(role)) role = "caller";
  if (["assistant", "agent", "ai", "bot"].includes(role)) role = "agent";
  const isFinal = frame.final ?? frame.is_final ?? frame.isFinal ?? (frame.partial === undefined ? true : !frame.partial);
  return { role, text: stripLangMark(text), final: Boolean(isFinal), type: frame.type, engineTime: frame.timestamp ?? null };
}

export function appendFrame(id, frame) {
  const s = getSession(id);
  if (!s) return null;
  (s.frames ??= []).push(frame);
  const m = normalizeMessage(frame);
  if (m.text && m.final) {
    (s.messages ??= []).push({ role: m.role, text: m.text, at: new Date().toISOString(), engineTime: m.engineTime, type: m.type });
  }
  return write(s);
}

export function findSessionByCallId(callId) {
  if (!callId) return null;
  return listSessions().map((s) => getSession(s.id)).find((s) => s && s.callId === callId) ?? null;
}

// Summaries, newest first. Tolerates files written by earlier builds.
export function listSessions() {
  return fs.readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => getSession(f.slice(0, -5)))
    .filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((s) => ({
      id: s.id,
      language: s.language ?? "",
      intake: Boolean(s.intake),
      mode: s.mode ?? "",
      createdAt: s.createdAt,
      endedAt: s.endedAt,
      endedReason: s.endedReason,
      callId: s.callId,
      patientName: s.details?.patient_name ?? "",
      clinicianName: s.details?.clinician_name ?? "",
      messageCount: s.messages?.length ?? 0,
      hasSummary: Boolean(s.summary),
      urgentCount: s.urgentFlags?.length ?? 0,
      hasIntake: Boolean(s.intakeRecord),
      hasRecording: Boolean(s.recordingPath),
      durationSeconds: s.durationSeconds ?? null,
    }));
}
```

(Step 10 adds one more function, `clearSessions`, at the end of this file.)

Part by part:

- **Where files go** (`DATA_DIR`). If the `DATA_DIR` setting is present, use it. On Vercel
  (where `process.env.VERCEL` is set) the project folder is read-only, so use the system's
  temporary folder. Otherwise, use `data/` in the project. `mkdirSync(..., { recursive: true })`
  creates the folders if they are missing and does nothing if they exist.
- **`newId`** builds `YYYYMMDD-HHMMSS-xxxx`. `padStart(2, "0")` turns `7` into `07`.
  `crypto.randomBytes(2).toString("hex")` gives four random hex characters.
- **`write`** saves the whole object as nicely indented JSON (`null, 2`), so you can read the
  file yourself.
- **`createSession`** lists every field up front, set to `null` or `[]`. One look at this
  function tells you everything a session can hold.
- **`getSession` checks the id first.** `safeId` only allows letters, digits, `_` and `-`.
  Without that check, a request for the id `../../.env` would read a file outside the
  sessions folder. This is called a **path traversal** attack. If the file is missing or
  broken, `getSession` returns `null` instead of throwing.
- **`updateSession(id, patch)`** is read, merge, write. `{ ...s, ...patch }` copies every
  field of `s`, then every field of `patch` on top. It returns the new session, or `null` if
  the id does not exist.
- **`stripLangMark`** removes the engine's `[LANG:vi] ` mark from transcript text (the same
  mark the page removes in Step 5).
- **`normalizeMessage`** turns any transcript frame into
  `{ role, text, final, type, engineTime }`, reading several possible field names, exactly
  like `describe` on the page.
- **`appendFrame`** keeps two things:
  - `frames`: every raw frame, untouched, for checking later what the engine really sent.
  - `messages`: only final lines with text, cleaned up. This is what people read.

  `(s.frames ??= []).push(frame)` means "if `s.frames` is null or missing, set it to `[]`;
  then push". It also copes with files written by older versions of the code.
- **`findSessionByCallId`** looks through every session for a matching `callId`. Tools
  (Step 7) and the webhook (Step 9) know the call's id, not your session id. Reading every
  file is slow with thousands of sessions, but fine for a demo.
- **`listSessions`** returns small summaries, newest first, for the history page. Dates
  are ISO strings such as `2026-10-07T10:30:12.000Z`, which sort correctly as plain text.
- **`RECORDINGS_DIR`** is created now and used in Step 9.

### Change `src/proxy.js`: save as you go

Make these seven changes. The rest of the file stays the same.

**1.** Remove the `crypto` import at the top. You no longer make ids here:

```js
import crypto from "node:crypto";
```

**2.** Under the `context.js` import, import the session helpers:

```js
import { createSession, updateSession, appendFrame, normalizeMessage } from "./sessions.js";
```

**3.** Above `const KNOWN = ...`, add the set of frame types worth saving:

```js
const RECORD = new Set(["transcript", "conversation_message"]);
```

**4.** In `shutdown`, right after `closed = true;`, record the end time once:

```js
    if (session && !session.endedAt) {
      session = updateSession(session.id, { endedAt: new Date().toISOString(), endedReason: session.endedReason ?? reason }) ?? session;
    }
```

**5.** Still in `shutdown`, replace the last line with one that also counts the saved lines:

```js
    log.info(`${tag()} closed (${reason}); ${session?.messages?.length ?? 0} transcript lines saved`);
```

**6.** In `startSession`, replace the temporary id line
(`session = { id: crypto.randomBytes(4)... };`) with a real saved session:

```js
    session = createSession({ language: lang.code, intake, context });
```

**7.** In `upstream.on("message", ...)`, replace the `call_started` and `call_ended`
branches with these, which also save the call id, each transcript line, and the reason the
call ended:

```js
      if (frame.type === "call_started") {
        live = true;
        session = updateSession(session.id, { callId: frame.call_id }) ?? session;
        log.info(`${tag()} call_started ${frame.call_id}`);
      } else if (RECORD.has(frame.type)) {
        session = appendFrame(session.id, frame) ?? session;
        const m = normalizeMessage(frame);
        if (m.text && m.final) log.info(`${tag()} ${m.role}: ${m.text}`);
      } else if (frame.type === "call_ended") {
        session.endedReason = frame.reason ?? (frame.ended_by ? `ended by ${frame.ended_by}` : "call_ended");
        shutdown(session.endedReason);
```

(The `error` branch and the rest that follow stay as they were.)

Why `session = updateSession(...) ?? session`? `updateSession` returns the freshly saved
object, so the proxy's copy stays up to date. If the file has vanished, it returns `null`,
and `?? session` keeps the old copy so nothing crashes.

### Change `src/app.js`: two read-only routes

**1.** Under the `proxy.js` import, add:

```js
import { listSessions, getSession } from "./sessions.js";
```

**2.** Right after the `/api/config` route, add:

```js
  app.get("/api/sessions", (req, res) => res.json(listSessions()));
  app.get("/api/sessions/:id", (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session not found" });
    res.json(session);
  });
```

`:id` is a **route parameter**: for `/api/sessions/20261007-103012-a1f3`, Express puts
`20261007-103012-a1f3` in `req.params.id`. A missing session gets a `404`.

### `public/sessions.html`: the history page

One file with its script inside:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Interpreter sessions</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <header>
      <h1>Past sessions</h1>
      <nav><a href="index.html">Live session</a></nav>
    </header>

    <section class="panel" id="list-panel">
      <div id="list" class="list"><div class="empty">Loading…</div></div>
    </section>

    <section class="panel" id="detail" hidden>
      <h2 id="detail-title"></h2>
      <div class="meta" id="detail-meta"></div>
      <div id="detail-flags"></div>
      <div id="detail-details"></div>
      <div id="detail-intake"></div>
      <div id="detail-summary"></div>
      <div id="detail-recording"></div>
      <h2>Transcript</h2>
      <div id="detail-transcript" class="transcript"></div>
      <h2>Context sent to the agent</h2>
      <pre class="block" id="detail-context"></pre>
    </section>
  </main>

  <script>
    const VI_RE = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
    const CJK_RE = /[㐀-鿿]/;
    const LANG_NAMES = { vi: "Vietnamese", zh: "Mandarin", yue: "Cantonese" };
    const LANG_MARK_RE = /^\[LANG:[a-z]+\]\s*/i; // the engine's language mark, kept in older session files
    const INTAKE_LABELS = {
      date_of_birth: "Date of birth", reason_for_visit: "Reason for visit", onset_and_course: "Onset and course",
      pain_score: "Pain score", allergies: "Allergies", medications: "Medications", medical_history: "Medical history",
      pregnancy: "Pregnancy", other_notes: "Other notes", urgent: "Urgent", urgent_detail: "Urgent detail",
    };
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const when = (iso) => (iso ? new Date(iso).toLocaleString() : "");
    const langOf = (text) => (VI_RE.test(text) ? "vi" : CJK_RE.test(text) ? "zh" : "en");
    const langName = (code) => LANG_NAMES[code] || code || "";
    const dl = (rows) => `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;

    async function loadList() {
      const res = await fetch("/api/sessions");
      const items = await res.json();
      const list = $("list");
      if (!items.length) { list.innerHTML = '<div class="empty">No sessions yet.</div>'; return; }
      list.innerHTML = items.map((s) => `
        <a href="#${esc(s.id)}">
          <strong>${esc(s.patientName || "Unnamed patient")}</strong> · ${esc(langName(s.language))} · intake form: ${s.intake ? "yes" : "no"}
          ${s.urgentCount ? '<span class="tag urgent">Urgent</span>' : ""}<br>
          <small>${esc(when(s.createdAt))} · ${s.messageCount} lines${s.hasSummary ? " · summary" : ""}${s.hasIntake ? " · intake" : ""}${s.hasRecording ? " · recording" : ""}${s.endedAt ? "" : " · open"}</small>
        </a>`).join("");
    }

    async function loadDetail(id) {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
      if (!res.ok) { $("detail").hidden = true; return; }
      const s = await res.json();
      const d = s.details || {};
      $("detail").hidden = false;
      $("detail-title").textContent = `${d.patient_name || "Unnamed patient"} · ${langName(s.language)} · ${when(s.createdAt)}`;
      const dur = s.durationSeconds != null ? ` · ${s.durationSeconds} s` : "";
      $("detail-meta").textContent = `intake form: ${s.intake ? "yes" : "no"} · call ${s.callId || "-"} · ${s.endedReason || (s.endedAt ? "ended" : "open")}${dur}`;
      $("detail-flags").innerHTML = (s.urgentFlags || []).map((f) => `<div class="flag">Urgent: ${esc(f.symptom)} (${esc(String(f.category || "").replace(/_/g, " "))}${f.severity ? ", " + esc(f.severity) : ""})${f.at ? ` <small>${esc(when(f.at))}</small>` : ""}</div>`).join("");
      $("detail-details").innerHTML = s.details
        ? `<div class="card"><h2>In the room</h2>${dl([
            ["Clinician", [d.clinician_name, d.clinician_role].filter(Boolean).join(", ") || "not given"],
            ["Patient", d.patient_name || "not given"],
            ["Form of address", d.preferred_address || "not given"],
          ])}</div>`
        : "";
      const intake = s.intakeRecord;
      $("detail-intake").innerHTML = intake
        ? `<div class="card"><h2>Intake ${intake.urgent ? '<span class="tag urgent">Urgent</span>' : ""}</h2>${dl(
            Object.entries(INTAKE_LABELS)
              .filter(([k]) => k !== "urgent" && intake[k] !== undefined && intake[k] !== null && intake[k] !== "")
              .map(([k, label]) => [label, intake[k]]))}</div>`
        : "";
      $("detail-summary").innerHTML = s.summary ? `<h2>Alebex summary</h2><p>${esc(s.summary)}</p>` : "";
      $("detail-recording").innerHTML = s.recordingPath
        ? `<h2>Recording</h2><audio controls preload="none" src="/recordings/${encodeURIComponent(s.id)}.wav"></audio> <a href="/recordings/${encodeURIComponent(s.id)}.wav">Download</a>`
        : "";
      const lines = (s.messages || []);
      $("detail-transcript").innerHTML = lines.length
        ? lines.map((m) => {
            const text = String(m.text ?? "").replace(LANG_MARK_RE, "");
            const lang = langOf(text);
            return `<div class="msg ${esc(m.role)}"><div class="head"><span class="who">${m.role === "agent" ? "Interpreter" : "Room"}</span><span class="lang ${lang}">${lang.toUpperCase()}</span></div><p>${esc(text)}</p></div>`;
          }).join("")
        : '<div class="empty">No transcript lines were recorded.</div>';
      $("detail-context").textContent = s.context || "";
      $("detail").scrollIntoView({ behavior: "smooth" });
    }

    window.addEventListener("hashchange", () => loadDetail(location.hash.slice(1)));
    loadList().then(() => { if (location.hash.length > 1) loadDetail(location.hash.slice(1)); });
  </script>
</body>
</html>
```

- **`esc()` escapes text before it goes into HTML.** This page builds HTML as strings and
  uses `innerHTML`, which is quick to write. But the text comes from speech recognition and
  the AI. If a transcript line contained `<img src=x onerror=alert(1)>`, `innerHTML` would
  run it. `esc` turns `<` into `&lt;` and so on, so text always shows as text. Every piece
  of text that comes from a session goes through `esc` or `textContent`. Only plain numbers,
  such as the line count, are inserted as they are.
- **`dl(rows)`** builds a definition list (`<dt>` label, `<dd>` value) from pairs.
- **Routing with `#`.** Each list item links to `#<session id>`. Changing the part after
  `#` does not reload the page. It fires a `hashchange` event, and the script loads that
  session's details. Opening `sessions.html#20261007-103012-a1f3` directly also works,
  thanks to the check at the bottom.
- **Sections appear only when there is data.** `s.details ? ... : ""`, `s.summary ? ... : ""`
  and so on. Today only the transcript and context are filled. Steps 7 and 9 fill the rest,
  and this page shows them without any changes.

## Try it

1. Restart the server and run a short session from the main page.
2. Look in `data/sessions/`. There is a new `.json` file. Open it: you will see your
   transcript in `messages` and the context the AI received.
3. Open `http://localhost:3000/api/sessions` to see the summaries as JSON.
4. Open `http://localhost:3000/sessions.html` and click your session.

The server log now prints each final line as it arrives, for example
`[session 20261007-103012-a1f3] agent: Hello. I'm an A I interpreter...`, and when it closes:
`closed (customer-ended-call); 6 transcript lines saved`.

## Why it is written this way

- **Synchronous file writes** (`writeFileSync`) are the simplest code: no waiting, no
  half-written files from two writes running at once. On one machine with a few sessions,
  they are fast enough.
- **Keep the raw frames as well as the clean lines.** When something looks wrong, you can
  see exactly what the engine sent.
- **Every reader is defensive.** `getSession` returns `null` instead of throwing, and
  `listSessions` copes with older files (`s.messages?.length ?? 0`). The data format can
  change without breaking old sessions.

## Recap

- Each session is one JSON file, created at start and updated by read, merge, write.
- The proxy now saves the call id, every final transcript line, and when the call ended.
- `/api/sessions` and `sessions.html` show the history.
- `esc()` keeps text from becoming HTML.

Next: [Step 7: tools](07-tools.md).
