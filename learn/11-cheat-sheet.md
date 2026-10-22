# Cheat sheet

Quick reference for everything the app sends and stores, plus troubleshooting, a fake engine
for free practice, and exercises.

- [Every message](#every-message)
- [Every route on your server](#every-route-on-your-server)
- [Every setting in `.env`](#every-setting-in-env)
- [Which step builds which file](#which-step-builds-which-file)
- [Troubleshooting](#troubleshooting)
- [Practice without paying: a fake engine](#practice-without-paying-a-fake-engine)
- [Exercises](#exercises)

## Every message

### Browser → your server (`/ws/session`)

| Frame | Example | What the server does |
|---|---|---|
| `session_start` | `{"type":"session_start","language":"vi","intake":true}` | Must come first. Creates the session and opens the engine socket. |
| binary | 640 bytes of PCM16, every 20 ms | Passed to the engine once the call is live. |
| `mark` | `{"type":"mark","name":"audio_end"}` | Passed on. The echo of a mark, sent after the audio has played. |
| `ping` | `{"type":"ping"}` | Passed on. The engine answers `pong`. |
| `end_session` | `{"type":"end_session"}` | First End press: the `visit.ending` flow (Step 8). |
| `end_call` | `{"type":"end_call"}` | Second End press: hang up now. |
| anything else | `start_call`, `call_event`, ... | Dropped on purpose. |

### Your server → browser

| Frame | Example | Sent when |
|---|---|---|
| `session_created` | `{"type":"session_created","session_id":"20261007-103012-a1f3","language":"vi","intake":true,"tools_enabled":true}` | The session starts. |
| every engine text frame | see the next table | Passed on unchanged. |
| `session_details` | `{"type":"session_details","details":{"clinician_name":"Sarah Chen",...}}` | The AI called `record_session_details`. |
| `urgent_flag` | `{"type":"urgent_flag","symptom":"chest pain","category":"chest_pain","severity":"emergency","at":"..."}` | The AI called `flag_urgent_symptom`. |
| `intake_recorded` | `{"type":"intake_recorded","intake":{"reason_for_visit":"...","pain_score":7,...}}` | The AI called `record_intake`. |
| `error` | `{"type":"error","code":"invalid_config","message":"..."}` | Codes from the server: `bad_message`, `invalid_config`, `upstream_error`. |

### Your server → engine (`wss://api.voice.alebex.ai/public/ws/call`)

| Frame | Example | Notes |
|---|---|---|
| `start_call` | `{"type":"start_call","agent":{"id":"..."},"knowledgeBase":"...","context":"...","customTools":[...]}` | First frame. The key travels in the `Sec-WebSocket-Protocol` header as `alebex.token.<key>`. |
| binary | microphone audio | Only after `call_started`. |
| `mark`, `ping` | | Passed on from the browser. |
| `call_event` | `{"type":"call_event","name":"visit.ending","hint":"...","speak":true,"priority":"interrupt","idempotencyKey":"..."}` | Sent by the server only, in the End flow. |
| `end_call` | `{"type":"end_call"}` | Hang up. |

### Engine → your server

| Frame | Example | Meaning |
|---|---|---|
| `call_started` | `{"type":"call_started","call_id":"public-9f3c..."}` | The call is live. Comes after the greeting's audio and mark. |
| `audio` | `{"type":"audio","data":"<base64>","format":"pcm16","sample_rate":24000}` | The AI speaking. |
| `mark` | `{"type":"mark","name":"audio_end"}` | End of one utterance. Echo it after it has played. |
| `clear_audio` | `{"type":"clear_audio"}` | Someone interrupted. Stop all playback now. |
| `conversation_message` | `{"type":"conversation_message","role":"assistant","content":"[LANG:vi] ...","timestamp":"..."}` | A transcript line. |
| `transcript` | | What was heard. Read defensively (its shape was not seen during the build). |
| `event_status` | `{"type":"event_status","eventId":"evt_...","status":"queued","name":"visit.ending"}` | What became of a `call_event`: `queued`, `noted`, `merged`, `duplicate`, `spoken`, `dropped`, `rejected`. |
| `call_ended` | `{"type":"call_ended","reason":"..."}` | The call is over. |
| `error` | `{"type":"error","code":"invalid_config","message":"..."}` | Some codes close the socket. See `AGENTS.md`. |
| `pong` | | The answer to `ping`. |

## Every route on your server

| Method and path | Who calls it | Protected by | Step |
|---|---|---|---|
| `GET /`, `/app.js`, `/sessions.html`, ... | the browser | nothing | 5 |
| `GET /api/config` | the page, on load | nothing | 4 |
| WebSocket `/ws/session` | the page | nothing (the server holds the key) | 4 |
| `GET /api/sessions` | `sessions.html` | nothing | 6 |
| `GET /api/sessions/:id` | `sessions.html` | `safeId` check on the id | 6 |
| `POST /voice-tools/session-details` | the engine | `Bearer TOOL_SECRET` | 7 |
| `POST /voice-tools/flag-urgent` | the engine | `Bearer TOOL_SECRET` | 7 |
| `POST /voice-tools/record-intake` | the engine | `Bearer TOOL_SECRET` | 7 |
| `POST /alebex/end-of-call` | Alebex | HMAC signature | 9 |
| `GET /recordings/<id>.wav` | `sessions.html` | nothing | 9 |
| `DELETE /api/sessions` | you, with `curl` | `Bearer TOOL_SECRET` | 10 |

## Every setting in `.env`

| Setting | Who sets it | Used by | Meaning |
|---|---|---|---|
| `ALEBEX_API_KEY` | you (console download) | everything | Your secret key. Never send it to the browser. |
| `ALEBEX_API_URL` | you (console download) | `src/alebex.js` | `https://api.alebex.ai/api/v1` |
| `ALEBEX_ENGINE_URL` | you (console download) | `src/proxy.js` | `https://api.voice.alebex.ai` |
| `TOOL_SECRET` | you (random) | tools, `DELETE /api/sessions` | The password on tool requests. |
| `ALEBEX_AGENT_ID_VI`, `ALEBEX_AGENT_ID_ZH` | `npm run setup` | `src/proxy.js` | Which agent to call for each language. |
| `ALEBEX_AGENT_ID_YUE` | `npm run setup` | `src/proxy.js` | Cantonese, only if enabled. |
| `ALEBEX_EN_VOICE_NAME` | you (optional) | `scripts/setup-agents.js` | English voice. Default `Natalie`. |
| `ALEBEX_VI_VOICE_NAME`, `ALEBEX_ZH_VOICE_NAME` | you (optional) | `scripts/setup-agents.js` | Patient-language voices. Defaults `Wayne` and `Shan Shan`. `Name:lang` also works. |
| `ALEBEX_YUE_VOICE_NAME` | you (optional) | `src/languages.js` | Setting it (plus the three `yue.*` files) turns Cantonese on. |
| `ALEBEX_WEBHOOK_SECRET` | the server on start, or `npm run setup:webhook` | `src/webhookRoute.js` | Checks the report's signature. Shown by Alebex only once. |
| `PUBLIC_BASE_URL` | you (optional) | `src/ngrok.js`, `scripts/setup-webhook.js` | Use this `https` address instead of starting ngrok. |
| `PORT` | you (optional) | `local-server.js` | Default `3000`. |
| `DATA_DIR` | you (optional) | `src/sessions.js` | Where sessions and recordings go. |
| `WS_PATH` | you (optional) | `/api/config` → the page | Where the page opens its WebSocket. Default `/ws/session`. |
| `MAX_SESSION_SECONDS` | you (optional, on Vercel) | `/api/config` → the page | Lets the page explain a session that hit the hosting time limit. |
| `VERCEL`, `VERCEL_PROJECT_PRODUCTION_URL` | Vercel | `src/sessions.js`, `src/ngrok.js` | Set by Vercel. Do not set them yourself. |
| `SMOKE_LANGUAGE`, `SMOKE_INTAKE`, `SMOKE_HTTP_URL`, `SMOKE_WS_URL` | you (optional) | `scripts/smoke-call.js` | Other ways to pass the smoke test's options. |

## Which step builds which file

| File | Step |
|---|---|
| `package.json`, `package-lock.json`, `.gitignore` | [1](01-setup.md) |
| `prompts/interpreter.template.md` | [2](02-agent-brain.md) |
| `prompts/lang/vi.address.md`, `vi.first.txt`, `vi.glossary.md` | [2](02-agent-brain.md) |
| `prompts/lang/zh.address.md`, `zh.first.txt`, `zh.glossary.md` | [2](02-agent-brain.md) |
| `src/alebex.js`, `src/env.js`, `src/languages.js`, `scripts/setup-agents.js` | [3](03-alebex-api-and-agents.md) |
| `src/words.js`, `src/context.js` | [4](04-server-and-voice-bridge.md) |
| `src/proxy.js` | [4](04-server-and-voice-bridge.md), [6](06-saving-sessions.md), [7](07-tools.md), [8](08-ending-a-visit.md) |
| `src/app.js` | [4](04-server-and-voice-bridge.md), [6](06-saving-sessions.md), [7](07-tools.md), [9](09-end-of-call-webhook.md), [10](10-testing-and-deploying.md) |
| `local-server.js` | [4](04-server-and-voice-bridge.md), [7](07-tools.md), [9](09-end-of-call-webhook.md) |
| `public/index.html`, `public/styles.css`, `public/capture-worklet.js` | [5](05-browser-audio.md) |
| `public/app.js` | [5](05-browser-audio.md), [7](07-tools.md), [8](08-ending-a-visit.md) |
| `src/sessions.js` | [6](06-saving-sessions.md), [10](10-testing-and-deploying.md) |
| `public/sessions.html` | [6](06-saving-sessions.md) |
| `src/ngrok.js`, `src/tools.js`, `src/registry.js`, `src/toolRoutes.js` | [7](07-tools.md) |
| `src/signature.js`, `src/webhook.js`, `src/webhookRoute.js` | [9](09-end-of-call-webhook.md) |
| `scripts/smoke-call.js`, `api/index.js`, `vercel.json`, `.vercelignore`, `scripts/setup-webhook.js` | [10](10-testing-and-deploying.md) |
| `README.md` | Write your own at the end: what it does, how it is built, how to run it. |
| `AGENTS.md`, `alebex-voice-prompting-best-practices.md` | Reference documents from Alebex. You read them; you do not write them. |

## Troubleshooting

| What you see | Likely cause | Fix |
|---|---|---|
| `[server] ALEBEX_AGENT_ID_VI is not set` | Agents not created yet | `npm run setup` |
| `setup failed: Voice "X" is not in GET /public/voices` | Voice name misspelled or not available | Pick a name from the list in the error, set it in `.env`, run setup again |
| Page says "No language pack is set up" | Pack files missing | Check that `prompts/lang/<code>.address.md`, `.first.txt` and `.glossary.md` all exist |
| "Microphone or audio setup failed" | Page not on `localhost` or `https`, or permission denied | Use `http://localhost:3000` or the ngrok/Vercel address, and allow the microphone |
| The AI stops itself mid-sentence on speakers | It hears its own voice | Use headphones, or tick "Mute mic while the interpreter speaks" |
| The AI never reacts to speech after the greeting | The greeting's `mark` was never echoed | Check the `mark` case and `play()`'s `onended` in `public/app.js` |
| `[server] tools off (no public URL or no TOOL_SECRET)` | ngrok missing or not signed in, or no `TOOL_SECRET` | `ngrok config check`, or set `PUBLIC_BASE_URL`; add `TOOL_SECRET` |
| `[tools] ...: bad tool credential` | Wrong or missing `Authorization` header | In your own `curl`, use `Bearer <TOOL_SECRET>` exactly |
| `[tools] ...: no session for X-Session-Id` | Wrong session id, or a different server instance | Copy the id from the page. On Vercel, see the limits in Step 10 |
| `event_status visit.ending: rejected not_enabled_for_call` | `callEvents` is off on the agent | `npm run setup` |
| `[webhook] end-of-call report rejected: bad or missing signature` | `ALEBEX_WEBHOOK_SECRET` missing or out of date | Remove the line from `.env` and restart: the server rotates and stores a new secret |
| No summary or recording ever arrives | The webhook points somewhere else (ngrok vs Vercel) | Restart locally, or run `npm run setup:webhook` for the hosted address |
| `error invalid_config` right after Start | The engine refused `start_call` (agent id or a tool) | Read the error's message, which names the problem |
| The WebSocket closes at once with no frames | Path not accepted by `WS_PATHS` | Check `WS_PATH` and the rewrites in `vercel.json` |
| Hosted sessions stop after five minutes | The function's time limit | Expected on Vercel. Start a new session |

## Practice without paying: a fake engine

Every real test call costs a little. For practising the plumbing (the proxy, the page, the
tool routes, the End flow) you can run a tiny fake engine on your own computer. It is not
part of the repo, and it was used to test every stage of this course.

It does not understand speech, and its "greeting" is half a second of silence. But it
follows the same message rules as the real engine: `start_call` → greeting audio, `mark`,
a transcript line, `call_started`; `ping` → `pong`; `call_event` → `event_status`;
`end_call` → `call_ended`.

Save it as `scripts/fake-engine.js`:

```js
// A stand-in for the Alebex engine, for practice without call time. Not part of the repo.
// It greets with half a second of silence, answers ping and call_event, and ends on end_call.
import { WebSocketServer } from "ws";

const PORT = 4001;
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws, req) => {
  console.log(`[fake] connection on ${req.url}, protocol ${req.headers["sec-websocket-protocol"]}`);
  let micBytes = 0;
  const send = (frame) => ws.send(JSON.stringify(frame));

  ws.on("message", (data, isBinary) => {
    if (isBinary) { micBytes += data.length; return; }
    const frame = JSON.parse(data.toString());
    console.log(`[fake] got ${frame.type}`);
    if (frame.type === "start_call") {
      console.log(`[fake] agent ${frame.agent?.id}, knowledge base ${(frame.knowledgeBase ?? "").length} chars, tools: ${(frame.customTools ?? []).map((t) => t.name).join(", ") || "none"}`);
      console.log(`[fake] context:\n${frame.context}`);
      send({ type: "audio", data: Buffer.alloc(24000).toString("base64"), format: "pcm16", sample_rate: 24000 }); // 0.5 s of silence
      send({ type: "mark", name: "audio_end" });
      send({ type: "conversation_message", role: "assistant", content: "[LANG:en] Hello. This is the fake engine. Clinician, your name and role, please?", timestamp: new Date().toISOString() });
      send({ type: "call_started", call_id: `public-fake-${Date.now()}` });
    } else if (frame.type === "call_event") {
      send({ type: "event_status", eventId: "evt_fake", status: "queued", name: frame.name });
    } else if (frame.type === "ping") {
      send({ type: "pong" });
    } else if (frame.type === "end_call") {
      console.log(`[fake] heard ${micBytes} bytes of microphone audio`);
      send({ type: "call_ended", reason: "customer-ended-call" });
      ws.close();
    }
  });
});

console.log(`[fake] engine listening on ws://localhost:${PORT}`);
```

Run it in one terminal:

```bash
node scripts/fake-engine.js
```

And start your server in another, pointed at it (macOS and Linux syntax):

```bash
ALEBEX_ENGINE_URL=http://localhost:4001 ALEBEX_API_URL=http://127.0.0.1:9 PUBLIC_BASE_URL=https://example.invalid npm start
```

What each setting does:

- `ALEBEX_ENGINE_URL` sends calls to the fake engine.
- `ALEBEX_API_URL` points at an address where nothing answers, so nothing real at Alebex is
  changed. The webhook registration just fails with a warning.
- `PUBLIC_BASE_URL` is a dummy `https` address, so tools count as "on". The fake engine
  never calls them. You play the engine yourself with `curl` (Step 7's "Try it").

Settings typed on the command line win over `.env`, because `dotenv` never overwrites a
setting that already exists. Your agent ids from `.env` still work, since the fake engine
accepts any id. (On Windows PowerShell, set each value first with
`$env:ALEBEX_ENGINE_URL="http://localhost:4001"` and so on, then run `npm start`.)

Now open `http://localhost:3000` and press Start. The status turns "Live", the fake greeting
shows in the transcript, and End closes the call. With the intake form ticked, End waits
20 seconds for a `record_intake` that never comes (unless you send it with `curl`), then
closes anyway. That is the safety net from Step 8 at work.

## Exercises

Ordered from easy to harder. Each one uses ideas from a specific step.

1. **Try another voice** (Step 3). List the voices, set `ALEBEX_VI_VOICE_NAME`, and run
   `npm run setup`. Hear the difference.
2. **Grow the glossary** (Step 2). Add a section, for example diabetes words. Keep it
   under about 800 characters and start it with a line that names the subject. The glossary
   is read when the server starts, so restart the server. No `npm run setup` is needed,
   because the glossary travels with each call.
3. **Unit-test `words.js`** (Step 4). Node has a built-in test runner. Create
   `test/words.test.js` with `import test from "node:test"` and
   `import assert from "node:assert/strict"`, then check that `yearWords(2007)` is
   `"two thousand and seven"` and that `numberWords(45)` is `"forty-five"`. Run
   `node --test`.
4. **Make the secret checks match** (Steps 7 and 10). `DELETE /api/sessions` compares the
   secret with `!==`, while the tool routes use `timingSafeEqual`. Move `bearerOk` into a
   small shared file and use it in both places.
5. **Teach the fake engine to interrupt** (Step 5). Have it send `clear_audio` one second
   after a long silent greeting, and check that the page stops playing and echoes the mark.
6. **Teach the fake engine to call a tool** (Step 7). `start_call` carries `customTools`,
   each with a `url` and `headers`. After `call_started`, make the fake engine `POST` to
   the `record_session_details` tool the way the real engine would (see "What the engine
   sends your endpoint" in `AGENTS.md`). Hint: the server only accepts an `https` public
   address (see `getPublicBaseUrl` and `base()`), so with the dummy `https://example.invalid`
   the tool `url` will not reach you. Have the fake engine swap the address part for
   `http://localhost:3000` before it posts, and keep the path and the headers.
7. **Add a guardrail** (Steps 2 and 4). Read "Guardrails" in `AGENTS.md`. Add a
   `guardrails` array to `start_call` in `proxy.js` for one topic the interpreter must never
   discuss. Keep it the same on every call, because the engine prepares each distinct array
   once.
8. **Add a fourth tool** (Step 7). For example `request_human_interpreter`, which shows a
   card asking staff to call language services. You will touch `tools.js` (the
   description), `toolRoutes.js` (a new route), the prompt's TOOLS section (then
   `npm run setup`), and `public/app.js` (a new frame type).
9. **Add a language** (Steps 2 and 3). Check that `GET /public/voices` has voices for it,
   add a line to `REGISTRY` in `src/languages.js`, write the three pack files, and run
   `npm run setup`. `langOf` in the page only knows Vietnamese and Chinese characters, so
   extend it too.
10. **Show the time left** (Step 5). When `/api/config` gives `maxSessionSeconds`, show a
    countdown on the page while a session is live.

Back to the [start of the course](README.md).
