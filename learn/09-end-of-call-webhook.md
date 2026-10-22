# Step 9: The end-of-call report

**Goal:** receive Alebex's report after each call (an AI summary, the full transcript, a
recording), check that it really came from Alebex, and add it to the session.

**Files you create:** `src/signature.js`, `src/webhook.js`, `src/webhookRoute.js`
**Files you change:** `src/app.js`, `local-server.js` (it now matches the repo)

## The idea

### A letter after the call

A **webhook** is an address on your server that another service calls when something
happens. Here, when a call ends, Alebex sends one `POST` to your webhook with a report:

```
 call ends
    │   a few seconds later
    ▼
 Alebex ── POST https://<public address>/alebex/end-of-call ──► your server
           X-Alebex-Signature: t=1790865252,v1=5257a8...
           {"id":"public-9f3c...", "summary":"...", "messages":[...],
            "recordingUrl":"https://...wav?X-Amz-Expires=3600...", "durationSeconds":252, ...}
                                                                   │
                                     1. check the signature        │
                                     2. find the session by "id"   │ (the call id)
                                     3. merge the report into it   │
                                     4. reply 204 quickly          │
                                     5. then download the recording (the link lasts 60 min)
```

What the report adds that the live call did not give you:

- **`summary`**: two or three sentences written by AI about the call.
- **`messages`**: the engine's complete transcript. Lines can be missed live, for example
  if the browser closed early.
- **`recordingUrl`**: a temporary link to the audio, 16 kHz mono WAV for a browser call.
- **`toolCalls`**, **`events`**, **`durationSeconds`** and **`endedReason`**.

### Is this letter really from Alebex? Signatures

Your webhook address is public. Anyone could send it a fake report. So Alebex **signs** each
report.

Think of a wax seal. Alebex and your server share a secret (`whsec_...`). Alebex mixes the
secret with the exact bytes of the report and gets a fingerprint, called an **HMAC**. It
sends the fingerprint in a header. Your server does the same mixing and compares. Without
the secret, nobody can make a matching fingerprint, and changing even one byte of the
report changes the fingerprint completely.

```
 Alebex:       HMAC-SHA256( secret, "1790865252." + raw body )  ──► v1=5257a8...
 Your server:  HMAC-SHA256( secret, "1790865252." + raw body )  ──► 5257a8...  same? accept : reject
```

Two extra details:

- **`t` is the time it was signed** (seconds since 1970). Your server rejects anything more
  than 5 minutes off, so an old report cannot be recorded and sent again later. That trick
  is called a **replay**.
- **Use the raw bytes.** If you parse the JSON and turn it back into text, the spacing or
  the order of the keys might change, and the fingerprint would no longer match. So this one
  route reads the body as raw bytes (`express.raw`), and **no JSON reader may run before
  it**. That is why Step 7 kept `express.json` inside the tool router instead of adding it
  to the whole app.

### Registering the webhook

Alebex has to know your address. `src/webhook.js` registers it through the API on every
start (your ngrok address can change every time). The signing secret is shown **only once**,
in the response that creates it, so the code saves it to `.env` straight away. If the
secret is ever lost, the code asks for a new one ("rotates" it).

## Build it

### `src/signature.js`: check the seal

```js
// X-Alebex-Signature check, copied verbatim from AGENTS.md "Working example: Node".
// Used by the end-of-call webhook (Phase 2).
import crypto from "node:crypto";

export function signatureIsValid(header, rawBody, secret) {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest();
  const received = Buffer.from(parts.v1 ?? "", "hex");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}
```

Line by line:

- `header` looks like `t=1790865252,v1=5257a8...`. Splitting on `,` and then on `=` gives
  `[["t","1790865252"],["v1","5257a8..."]]`, and `Object.fromEntries` turns that into
  `{ t: "1790865252", v1: "5257a8..." }`.
- `t` must be a whole number within 300 seconds (5 minutes) of now.
- `` createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest() `` computes the
  fingerprint of `<t>.<raw body>`. Calling `update` twice is the same as hashing the joined
  text, without copying the body.
- `Buffer.from(parts.v1, "hex")` turns the received hex text into bytes.
- `timingSafeEqual` compares in constant time (see Step 7), after checking the lengths
  match.

### `src/webhook.js`: register the address

```js
// The end-of-call webhook endpoint, created or brought up to date on every boot
// (AGENTS.md "Manage webhooks"). The signing secret is shown once, on the response that creates
// it, and is stored in .env as ALEBEX_WEBHOOK_SECRET; if the endpoint exists but the secret is
// gone, it is rotated and the new one stored.
import { alebex } from "./alebex.js";
import { setEnv } from "./env.js";

export const WEBHOOK_NAME = "interpreter-end-of-call";
export const WEBHOOK_PATH = "/alebex/end-of-call";
export const WEBHOOK_FIELDS = ["agentId", "agentName", "callType", "startedAt", "endedAt", "durationSeconds", "endedReason", "transcript", "messages", "summary", "recordingUrl", "toolCalls", "events"];

// The API lists `id` with the fields; compare the rest as a set.
function sameFields(have) {
  const set = new Set((have ?? []).filter((f) => f !== "id"));
  return set.size === WEBHOOK_FIELDS.length && WEBHOOK_FIELDS.every((f) => set.has(f));
}

function storeSecret(secret) {
  if (typeof secret === "string" && secret) setEnv("ALEBEX_WEBHOOK_SECRET", secret);
}

// Returns { id, url, action: "created" | "patched" | "unchanged", secretStored }.
export async function ensureWebhook(baseUrl) {
  const url = `${String(baseUrl).replace(/\/+$/, "")}${WEBHOOK_PATH}`;
  const { items = [] } = await alebex("GET", "/public/webhooks");
  let hook = items.find((w) => w.name === WEBHOOK_NAME) ?? null;
  let action = "unchanged";

  if (!hook) {
    hook = await alebex("POST", "/public/webhooks", { name: WEBHOOK_NAME, url, agentIds: "all", fields: WEBHOOK_FIELDS, signing: true });
    storeSecret(hook.signingSecret);
    action = "created";
  } else {
    const patch = {};
    if (hook.url !== url) patch.url = url;
    if (hook.active === false) patch.active = true;
    if (hook.agentIds !== "all") patch.agentIds = "all";
    if (!sameFields(hook.fields)) patch.fields = WEBHOOK_FIELDS;
    if (!hook.signing) patch.signing = true;
    if (Object.keys(patch).length) {
      const updated = await alebex("PATCH", `/public/webhooks/${hook.id}`, patch);
      storeSecret(updated.signingSecret); // present only when this edit turned signing on for the first time
      hook = { ...hook, ...updated };
      action = "patched";
    }
    if (!process.env.ALEBEX_WEBHOOK_SECRET) {
      const rotated = await alebex("POST", `/public/webhooks/${hook.id}/rotate-secret`);
      storeSecret(rotated.signingSecret);
    }
  }
  return { id: hook.id, url, action, secretStored: Boolean(process.env.ALEBEX_WEBHOOK_SECRET) };
}
```

- **`WEBHOOK_FIELDS`** lists the report fields you want. A field you do not ask for is
  left out of the report.
- **`ensureWebhook` is idempotent**, like the agent setup in Step 3. It finds the endpoint
  by name:
  - **missing**: create it with `signing: true`, and store the `signingSecret` from the
    response;
  - **present**: build a `patch` with only what differs (address, active, which agents,
    fields, signing), and send it only if something changed.
- **`sameFields`** compares the field lists as **sets**, so the order does not matter. The
  API includes `id` in its list even though you never ask for it, so `id` is ignored.
- **The secret.** If `.env` has no `ALEBEX_WEBHOOK_SECRET`, perhaps because the endpoint was
  made on another machine, the only way to get one is to rotate: `rotate-secret` returns a
  new secret, and `storeSecret` saves it.
- `agentIds: "all"` means reports for every agent on the account, including agents created
  later.

### `src/webhookRoute.js`: receive the report

```js
// POST /alebex/end-of-call: the signed end-of-call report (AGENTS.md "The end-of-call webhook").
// express.raw keeps the exact bytes the signature covers; no JSON parser may run on this path
// before it. The session is found by the report's `id`, which is the call id. The record is
// merged and written before the 204 goes out; the recording (a presigned link valid for 60 min)
// is downloaded right after, to data/recordings/<sessionId>.wav.
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { signatureIsValid } from "./signature.js";
import { updateSession, findSessionByCallId, stripLangMark, RECORDINGS_DIR } from "./sessions.js";

export function webhookRouter({ log = console } = {}) {
  const router = express.Router();

  router.post("/end-of-call", express.raw({ type: "application/json", limit: "2mb" }), (req, res) => {
    const secret = process.env.ALEBEX_WEBHOOK_SECRET;
    if (!secret || !Buffer.isBuffer(req.body) || !signatureIsValid(req.get("x-alebex-signature"), req.body, secret)) {
      log.warn("[webhook] end-of-call report rejected: bad or missing signature");
      return res.sendStatus(401);
    }
    let report;
    try {
      report = JSON.parse(req.body.toString("utf8"));
    } catch {
      log.warn("[webhook] end-of-call report body is not JSON");
      return res.sendStatus(204);
    }
    const session = report?.id ? findSessionByCallId(String(report.id)) : null;
    if (!session) {
      log.warn(`[webhook] no session for call ${report?.id ?? "-"}`);
      return res.sendStatus(204);
    }

    const patch = {
      summary: typeof report.summary === "string" ? report.summary : session.summary ?? null,
      durationSeconds: typeof report.durationSeconds === "number" ? report.durationSeconds : session.durationSeconds ?? null,
      endedReason: report.endedReason ?? session.endedReason ?? null,
      endedAt: session.endedAt ?? report.endedAt ?? null,
      toolCalls: Array.isArray(report.toolCalls) ? report.toolCalls : session.toolCalls ?? [],
      report: {
        receivedAt: new Date().toISOString(),
        agentId: report.agentId ?? null,
        agentName: report.agentName ?? null,
        callType: report.callType ?? null,
        startedAt: report.startedAt ?? null,
        endedAt: report.endedAt ?? null,
        transcript: typeof report.transcript === "string" ? report.transcript : null,
        events: Array.isArray(report.events) ? report.events : [],
        recordingUrl: report.recordingUrl ? "(downloaded)" : null,
      },
    };
    // The engine's message list is the complete one; the lines captured live stay under liveMessages.
    if (Array.isArray(report.messages) && report.messages.length) {
      patch.liveMessages = session.liveMessages ?? session.messages ?? [];
      patch.messages = report.messages.map((m) => ({
        role: m.role === "agent" ? "agent" : "caller",
        text: stripLangMark(m.text),
        secondsFromStart: typeof m.secondsFromStart === "number" ? m.secondsFromStart : null,
        type: "report",
      }));
    }
    updateSession(session.id, patch);
    log.info(`[webhook] [session ${session.id}] report for call ${report.id}: ${patch.endedReason ?? "-"}, ${patch.durationSeconds ?? "?"} s, summary ${patch.summary ? "yes" : "no"}, recording ${report.recordingUrl ? "yes" : "none"}`);
    res.sendStatus(204);

    if (report.recordingUrl) downloadRecording(session.id, String(report.recordingUrl), log);
  });

  return router;
}

async function downloadRecording(sessionId, url, log) {
  const file = path.join(RECORDINGS_DIR, `${sessionId}.wav`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    updateSession(sessionId, { recordingPath: file });
    log.info(`[webhook] [session ${sessionId}] recording saved to ${file}`);
  } catch (err) {
    log.warn(`[webhook] [session ${sessionId}] recording download failed: ${err.message}`);
  }
}
```

- **`express.raw({ type: "application/json", limit: "2mb" })`** is set on this one route.
  It leaves the body as a `Buffer` of raw bytes. A transcript can be long, hence 2 MB.
- **No secret, no Buffer, or a bad signature: `401`.** Nothing else runs.
- **Not JSON, or no matching session: `204` anyway.** The report is genuine, it just is not
  one you can use (for example, a test call started from the Alebex console). Answering
  `2xx` stops Alebex from retrying.
- **The patch** copies the useful fields, always checking their type first
  (`typeof report.summary === "string"`). It keeps what the session already had when the
  report lacks something (`?? session.summary`). `endedAt` keeps the proxy's own time if it
  has one.
- **Two transcripts.** The engine's `messages` list is the complete one, so it becomes
  `messages`. The lines captured live are kept as `liveMessages` for comparison.
  `stripLangMark` removes the `[LANG:vi]` marks here too.
- **Reply first, then download.** Alebex waits at most 20 seconds for an answer, and
  retries after a timeout. Downloading a recording can take longer. So the route saves the
  report, answers `204`, and only then calls `downloadRecording`, which runs on its own.
- **`downloadRecording`** fetches the WAV (giving up after 60 seconds), writes it to
  `data/recordings/<session id>.wav`, and saves the path in the session. The link expires
  after 60 minutes, so it is fetched straight away.
- **A repeat is harmless.** A retried report carries the same `id`, and merging the same
  data twice gives the same session.

### Change `src/app.js`: mount the webhook, serve recordings

**1.** Add `RECORDINGS_DIR` to the `sessions.js` import:

```js
import { listSessions, getSession, RECORDINGS_DIR } from "./sessions.js";
```

**2.** Under the `toolRoutes.js` import, add:

```js
import { webhookRouter } from "./webhookRoute.js";
```

**3.** Give `createApp` a new option that says whether the webhook was registered:

```js
export function createApp({ log = console, webhookRegistered = false, serveStatic = true } = {}) {
```

**4.** Right after the `express.static` line for `public/`, serve the recordings:

```js
  app.use("/recordings", express.static(RECORDINGS_DIR));
```

**5.** Right after the `/voice-tools` line, mount the webhook:

```js
  app.use("/alebex", webhookRouter({ log }));     // express.raw on /alebex/end-of-call; no JSON parser before it
```

**6.** In `/api/config`, under `publicUrl: ...`, add:

```js
    webhookRegistered,
```

The four `app.use` lines now read, in order: the page files, `/recordings`,
`/voice-tools` (with its own JSON reader), and `/alebex` (with its own raw reader). No
JSON reader runs before the webhook.

`sessions.html` already shows a `<audio>` player for `/recordings/<id>.wav` when
`recordingPath` is set, and the summary when `summary` is set (Step 6).

### Change `local-server.js`: register on start

**1.** Under the `ngrok.js` import, add:

```js
import { ensureWebhook, WEBHOOK_NAME } from "./src/webhook.js";
```

**2.** Right after `const publicUrl = await ensurePublicUrl(PORT, console);`, add:

```js
let webhook = null;
if (publicUrl) {
  try {
    webhook = await ensureWebhook(publicUrl);
    console.log(`[server] webhook ${WEBHOOK_NAME} registered (${webhook.action}) -> ${webhook.url}${webhook.secretStored ? "" : " (no signing secret stored: reports will be rejected)"}`);
  } catch (err) {
    console.warn(`[server] webhook registration failed${err.code ? ` (${err.code})` : ""}: ${err.message}. End-of-call summaries and recordings are off; tools still work.`);
  }
}
```

**3.** Pass the result to `createApp`:

```js
const { app, glossaries } = createApp({ log: console, webhookRegistered: Boolean(webhook) });
```

Your `local-server.js` now matches the repo's. The full start-up order is:

```
 load .env ─► check settings ─► public address (ngrok) ─► register webhook ─► build app ─► listen
```

A failed registration is a warning, not a crash: tools and interpreting still work.

## Try it

1. **Restart the server.** You should see:

   ```
   [server] webhook interpreter-end-of-call registered (created) -> https://abc123.ngrok-free.app/alebex/end-of-call
   ```

   `.env` now contains `ALEBEX_WEBHOOK_SECRET=whsec_...`. On later starts the action is
   `patched` (new ngrok address) or `unchanged`.

2. **Test the seal yourself.** This throwaway script, `scripts/try-webhook.js`, signs a
   small fake report with your secret, sends it, then sends the same report with a made-up
   fingerprint:

   ```js
   // Throwaway test: send a signed, then a forged, end-of-call report to the local server.
   import "dotenv/config";
   import crypto from "node:crypto";

   const callId = process.argv[2]; // a callId from http://localhost:3000/api/sessions
   const secret = process.env.ALEBEX_WEBHOOK_SECRET;
   if (!callId || !secret) {
     console.error("usage: node scripts/try-webhook.js <callId>   (needs ALEBEX_WEBHOOK_SECRET in .env)");
     process.exit(1);
   }

   const body = JSON.stringify({ id: callId, summary: "Test summary from try-webhook.js.", durationSeconds: 42, endedReason: "customer-ended-call", recordingUrl: null });
   const t = Math.floor(Date.now() / 1000);
   const good = crypto.createHmac("sha256", secret).update(`${t}.`).update(body).digest("hex");

   for (const [label, v1] of [["signed", good], ["forged", "0".repeat(64)]]) {
     const res = await fetch("http://localhost:3000/alebex/end-of-call", {
       method: "POST",
       headers: { "Content-Type": "application/json", "X-Alebex-Signature": `t=${t},v1=${v1}` },
       body,
     });
     console.log(label, res.status);
   }
   ```

   Copy a `callId` from `http://localhost:3000/api/sessions` and run:

   ```bash
   node scripts/try-webhook.js public-9f3c...
   ```

   You should see `signed 204` and `forged 401`. Open that session on `sessions.html`: it
   now shows "Test summary from try-webhook.js.".

3. **For real.** Run a short session and end it. A few seconds later the server logs
   something like:

   ```
   [webhook] [session ...] report for call public-...: customer-ended-call, 48 s, summary yes, recording yes
   [webhook] [session ...] recording saved to .../data/recordings/....wav
   ```

   Open `sessions.html`: the session now has the Alebex summary, an audio player and the
   engine's transcript.

## Why it is written this way

- **Signed reports only.** The route rejects any report it cannot verify, so a stranger
  cannot change your session records.
- **Raw body on one route, JSON elsewhere.** Each router reads the body the way it needs.
  The order of the `app.use` lines is part of the security.
- **Answer fast, work later.** Webhook senders retry slow endpoints. Reply `204` as soon as
  the report is safe on disk, then do the slow download.
- **Registered on every start.** A free ngrok address changes each time, and the code keeps
  Alebex pointed at the current one.

## Recap

- A webhook is a `POST` that Alebex sends after each call.
- `signature.js` recomputes the HMAC of `t.` plus the raw body and compares in constant
  time, within a 5-minute window.
- `webhook.js` creates or updates the endpoint and stores its secret, which is shown only
  once.
- `webhookRoute.js` merges the report into the session, answers `204`, then downloads the
  recording.

Next: [Step 10: testing and deploying](10-testing-and-deploying.md).
