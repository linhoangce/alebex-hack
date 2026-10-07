# Alebex Voice API: agents and calls integration guide

Create and edit Alebex voice agents and the HTTPS tools they may call mid-conversation,
run a browser call over a WebSocket or place an outbound phone call that one of them
conducts, give each call a knowledge base, guardrails and context about the caller, tell a
live call when something happens in your app, answer calls to numbers you imported, and
receive a report when the call ends. This file is the whole contract; you do not need any
other document or an SDK to integrate.

How to write what the agent says and knows (the prompt, the knowledge base, guardrails,
caller context and live events) is a separate guide:
`https://app.alebex.ai/alebex-voice-prompting-best-practices.md`. Read it before writing
or generating an agent's prompt.

## What you have

**An Alebex account with a developer console** at `https://app.alebex.ai/dev`, where
agents can be built (or built with **Manage agents** below), agent ids are copied, and
end-of-call webhook endpoints are added (or added with **Manage webhooks** below). The console's **.env file** button, under the Voice
API key, downloads your keys and the hosts below as `ALEBEX_*` variables.

**An API key**, fetched once with your normal Alebex login token:

```
POST https://api.alebex.ai/api/v1/voice-engine/api-key
Authorization: Bearer <your Alebex token>

200
{ "token": "wt_xxxxxxxxxxxxxxxxxxxxxxxx", "expiresAt": "", "expiresInSeconds": 0 }
```

There is one key per account; calling this again returns the existing key rather
than minting another. It **does not expire**. Keep it server-side: it authorizes
calls billed to your account and is not scoped to one agent. If it leaks, rotate it
(`POST .../voice-engine/api-key/rotate`) and read `previousTokenDeleted` on the
response:

```
200
{ "token": "wt_yyyyyyyyyyyyyyyyyyyyyyyy", "previousTokenDeleted": true }
```

`true` means the old key is gone at the engine and anything still using it stops
working that moment, your own deployed code included. `false` means the replacement
is real but the old key is **still live** and the leak is not closed; rotating again
will not remove it, so contact support.

**A Twilio account** with a phone number on it. Calls are dialed from your Twilio
account, so you pay Twilio for the carrier leg and Alebex bills the agent's minutes.

## Hosts

```
Alebex API, for the key, agents, tools, webhooks and voices:   https://api.alebex.ai/api/v1   (ALEBEX_API_URL)
Voice Engine, for calls:                                       https://api.voice.alebex.ai    (ALEBEX_ENGINE_URL)
```

Every request to either host carries the API key as a bearer token:

```
Authorization: Bearer wt_xxxxxxxxxxxxxxxxxxxxxxxx
```

## Manage agents

Agents can be built in the console or through these endpoints. Both make the same
agent: one made here opens and edits normally in the console, and the other way round.
They live on the Alebex API host and take the same API key as calls:

```
Authorization: Bearer <API key>
```

| Method and path | Does |
|---|---|
| `GET /api/v1/public/agents` | List agents, newest first. `?limit=` 1 to 100 (default 25), `?cursor=` the previous page's `nextCursor`. Returns `{ items, nextCursor }`; items are summaries without the prompt. |
| `GET /api/v1/public/agents/{agentId}` | One agent, every setting. |
| `POST /api/v1/public/agents` | Create an agent. `201` with the agent. |
| `PATCH /api/v1/public/agents/{agentId}` | Change only the fields you send. `200` with the whole agent. |
| `GET /api/v1/public/voices` | The voices an agent can use. |

### The agent

Only `name` and `prompt` are required on create; everything else has the console's
default. The response is the same shape for get, create and edit.

```json
{
  "name": "Admissions line",
  "prompt": "You answer questions about the evening MBA and book consultations...",
  "firstMessage": "Hi, this is Maya from Northfield. Is now a good time?",
  "firstMessageInbound": null,
  "brainTier": "premium",
  "temperature": 0.7,
  "maxTokens": 2500,
  "voices": [{ "voiceId": "<from GET /public/voices>", "language": "en" }],
  "behaviour": {
    "turnEnd": "fast",
    "allowEndCall": true,
    "idlePrompt": false,
    "callEvents": false,
    "backgroundVolume": 0.5,
    "callLimitMinutes": 15
  },
  "opening": { "speaksFirst": true, "strictFirstMessage": true, "callerFirstWaitMs": 2500 },
  "toolIds": ["<from GET /public/tools>"]
}
```

| Field | Rules | Default |
|---|---|---|
| `name` | 1 to 255 characters, unique in the account. Required on create. | |
| `prompt` | 1 to 50,000 characters. Required on create. | |
| `firstMessage` | Up to 2,000 characters. Cannot be null. | `"Hello! How can I help you today?"` |
| `firstMessageInbound` | Up to 2,000 characters, or null to use `firstMessage`. | `null` |
| `brainTier` | `"standard"` or `"premium"`. | `"premium"` |
| `temperature` | 0 to 2. | `0.7` |
| `maxTokens` | 100 to 5,000. | `2500` |
| `voices` | 1 to 5, one per language; the first is the default. Each: `voiceId` (required), `language` (ISO 639-1), `speed` (0.5 to the voice's `speedMax`), `stability`, `similarityBoost`, `style` (0 to 1). Unset tuning is `null`. | Maile, English |
| `behaviour.turnEnd` | `"risky"`, `"ultra_fast"`, `"fast"`, `"middle"`, `"conservative"`: how soon the agent answers once the caller stops. | `"fast"` |
| `behaviour.allowEndCall` | The agent may hang up. | `true` |
| `behaviour.idlePrompt` | Nudge a quiet caller. | `false` |
| `behaviour.callEvents` | Your app may send **Live call events** into this agent's calls. | `false` |
| `behaviour.backgroundVolume` | 0 to 1, office ambience. | `0.5` |
| `behaviour.callLimitMinutes` | 1 to 120, or null for no limit. | `null` |
| `opening.speaksFirst` | The agent speaks first. `false` gives the caller the first word on an outbound or browser call: the agent waits `callerFirstWaitMs`, then says `firstMessage` if they stay silent. An inbound call always opens with the agent. | `true` |
| `opening.strictFirstMessage` | Read only when `speaksFirst` is false and the caller speaks first. `true` replies with `firstMessage` word for word; `false` answers what they said, covering what `firstMessage` was meant to say in the agent's own words. | `true` |
| `opening.callerFirstWaitMs` | 500 to 10,000: wait for the caller before speaking, when `speaksFirst` is false. | `2500` |
| `toolIds` | Up to 8 ids from **Manage tools**, in order, each once. Every call this agent takes carries exactly these. `[]` detaches them all, apart from any parked in the console. | `[]` |

**Editing.** Send at least one field. `behaviour` and `opening` merge key by key;
`voices` and `toolIds` replace the whole list; `null` clears `firstMessageInbound` and
`behaviour.callLimitMinutes`. Unknown fields are refused, never ignored. The next call
uses the new settings; calls in progress keep the old ones.

**Voices.** `GET /public/voices` returns
`[{ voiceId, name, language, description, sampleUrl, premium, speedMax }]`. Cache it;
it changes rarely.

### Agent errors

These use the Alebex API's envelope, not the engine's:
`{ "success": false, "error": { "code": "AGENT_NAME_TAKEN", "message": "...", "status": 409 } }`.
Branch on `error.code`.

| Status | `code` | Meaning |
|---|---|---|
| `400` | `VALIDATION_FAILED` | A field is missing, out of range, or unknown. `message` names each one, e.g. `voices[1].voiceId`. |
| `400` | `INVALID_CURSOR` | List only: the cursor was not one it returned. Start again without it. |
| `401` | `API_KEY_MISSING`, `SESSION_UNKNOWN`, `SESSION_REVOKED` | No key, an unknown key (or your speech-to-text key, or a short-lived test-call token), or a rotated one. |
| `403` | `ACCOUNT_SUSPENDED` | The account is not active. |
| `404` | `AGENT_NOT_FOUND` | No agent with that id in your account. |
| `404` | `TOOL_NOT_FOUND` | One of `toolIds` is not a tool in your account. |
| `409` | `AGENT_NAME_TAKEN` | Another agent has that name. |
| `422` | `VOICE_NOT_FOUND` | A `voiceId` is not in the voice list. |
| `429` | `RATE_LIMITED` | Over 60 writes or 120 reads a minute on this key. Back off. |

### Example: Node

```js
const API = process.env.ALEBEX_API_URL;                     // https://api.alebex.ai/api/v1
const headers = {
  Authorization: `Bearer ${process.env.ALEBEX_API_KEY}`,
  "Content-Type": "application/json",
};

async function alebex(method, path, body) {
  const res = await fetch(`${API}${path}`, { method, headers, body: body && JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error.message), { code: json.error.code });
  return json;
}

const [voice] = await alebex("GET", "/public/voices");
const agent = await alebex("POST", "/public/agents", {
  name: "Admissions line",
  prompt: "You answer questions about the evening MBA and book consultations...",
  voices: [{ voiceId: voice.voiceId }],
});
await alebex("PATCH", `/public/agents/${agent.id}`, { behaviour: { callLimitMinutes: 10 } });
// agent.id is the agentId for POST /public/call/phone.
```

### Example: Python

```python
import os, requests

API = os.environ["ALEBEX_API_URL"]                           # https://api.alebex.ai/api/v1
session = requests.Session()
session.headers["Authorization"] = f"Bearer {os.environ['ALEBEX_API_KEY']}"

def alebex(method, path, body=None):
    res = session.request(method, API + path, json=body)
    if not res.ok:
        err = res.json()["error"]
        raise RuntimeError(f"{err['code']}: {err['message']}")
    return res.json()

voice = alebex("GET", "/public/voices")[0]
agent = alebex("POST", "/public/agents", {
    "name": "Admissions line",
    "prompt": "You answer questions about the evening MBA and book consultations...",
    "voices": [{"voiceId": voice["voiceId"]}],
})
alebex("PATCH", f"/public/agents/{agent['id']}", {"behaviour": {"callLimitMinutes": 10}})

# Every agent, page by page.
cursor = None
while True:
    page = alebex("GET", "/public/agents" + (f"?cursor={cursor}" if cursor else ""))
    for item in page["items"]:
        print(item["id"], item["name"])
    cursor = page["nextCursor"]
    if not cursor:
        break
```

## Manage tools

A tool can ride on each call (see **Custom tools**), or be stored once in your account
and attached to agents. One stored here opens and edits on the console's Tools page, and
the other way round. Same host and API key as agents.

| Method and path | Does |
|---|---|
| `GET /api/v1/public/tools` | Every tool, most recently changed first. Returns `{ items }`. There is no route for one tool: find it in this list by `id`. |
| `POST /api/v1/public/tools` | Create a tool. `201` with the tool. |
| `PATCH /api/v1/public/tools/{toolId}` | Change only the fields you send. `200` with the whole tool. |
| `DELETE /api/v1/public/tools/{toolId}` | Delete it and detach it from every agent. `204`. |

The body is the **tool object** from **Custom tools** without `timeoutMs`: `name`,
`description`, `url`, `parameters` (optional for a tool with no arguments) and `headers`.
The response adds `id`, `headerNames`, `agentIds` (the agents it is on), `createdAt` and
`updatedAt`. It never contains a header value.

**Attaching.** Put the tool's id in the agent's `toolIds` with `PATCH /public/agents/{agentId}`.
The list you send is the list the agent has: to attach, send the current list plus the id;
to detach, send it without. A tool parked on the agent in the console is not in `toolIds`
and stays parked whatever you send; listing its id switches it back on. A call placed with
its own `customTools` array uses that array and ignores the agent's tools.

**Editing.** `headers` merges by name: a string sets or replaces that header, `null` deletes
it. `parameters` replaces the whole schema. Rotate a leaked key with
`PATCH {"headers": {"Authorization": "Bearer <new>"}}`. The next call uses the change; calls in
progress keep the old version.

**Timeout.** A stored tool waits 8000 ms for your endpoint. Send the tool with the call if
it needs a different `timeoutMs`.

### Tool errors

Same envelope as agent errors. Key errors and `429` are as for agents.

| Status | `code` | Meaning |
|---|---|---|
| `400` | `VALIDATION_FAILED` | A field is missing or breaks a rule in **Custom tools**: a reserved name, a refused schema keyword, a private or non-https URL, more than 10 headers. `message` names it, e.g. `parameters.properties.sku.type`. |
| `404` | `TOOL_NOT_FOUND` | No tool with that id in your account. |
| `409` | `TOOL_NAME_TAKEN` | Another tool has that name. |

### Example: Node

Uses the `alebex` helper from **Manage agents**.

```js
const tool = await alebex("POST", "/public/tools", {
  name: "check_stock",
  description: "Check whether a product is in stock at a given store...",
  url: "https://partner.example.com/voice-tools/check-stock",
  headers: { Authorization: `Bearer ${process.env.TOOL_SECRET}` },
  parameters: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] },
});
const agent = await alebex("GET", `/public/agents/${agentId}`);
await alebex("PATCH", `/public/agents/${agentId}`, { toolIds: [...agent.toolIds, tool.id] });

// After a leak: one request, and the old value is gone.
await alebex("PATCH", `/public/tools/${tool.id}`, { headers: { Authorization: `Bearer ${newSecret}` } });
```

## Manage webhooks

A webhook endpoint is a URL of yours that receives a report when a call ends (see
**The end-of-call webhook**). An account can have up to 10. One made here opens and edits
on the console's Webhooks page, and the other way round. Same host and API key as agents.

| Method and path | Does |
|---|---|
| `GET /api/v1/public/webhooks` | Every endpoint, oldest first. Returns `{ items }`. There is no route for one endpoint: find it in this list by `id`. |
| `POST /api/v1/public/webhooks` | Create an endpoint. `201` with the endpoint, plus `signingSecret` when `signing` is `true`. |
| `PATCH /api/v1/public/webhooks/{webhookId}` | Change only the fields you send; send at least one. `200` with the whole endpoint. |
| `DELETE /api/v1/public/webhooks/{webhookId}` | Delete it and its secret. Calls are unaffected. `204`. |
| `POST /api/v1/public/webhooks/{webhookId}/rotate-secret` | Replace the signing secret and turn signing on. `201` with the endpoint and the new `signingSecret`. The old secret stops working at once. |

| Field | Rules | Default |
|---|---|---|
| `name` | 1 to 255 characters. Required on create. Not sent with reports. | |
| `url` | Absolute `https://` URL on a public host. Plain http, private, loopback and link-local addresses are refused. Required on create. | |
| `agentIds` | `"all"`, every agent including ones created later, or a list of agent ids from `GET /public/agents`. A list cannot be empty; to stop reports, set `active` to `false`. | `"all"` |
| `fields` | Field names from **The end-of-call webhook**. `id` is always added. Omitted on create, or `null` on edit, means the original thirteen. An unknown name is refused. | the original thirteen |
| `active` | `false` keeps the endpoint but sends it nothing. | `true` |
| `signing` | Sign every report with `X-Alebex-Signature`. Turning it off keeps the secret; turning it back on reuses it. | `false` |

The response is `{ id, name, url, active, agentIds, fields, signing, createdAt, updatedAt }`.
`fields` is the full list the endpoint receives, `id` included. A deleted agent drops out
of `agentIds`. `signingSecret` (`whsec_...`) appears only on the response that created
it: a create with `signing: true`, the first edit that turns signing on, and
`rotate-secret`. It is never shown again, so store it then. Unknown body fields are
refused, never ignored.

### Webhook errors

Same envelope as agent errors. Key errors and `429` (60 writes or 120 reads a minute) are
as for agents.

| Status | `code` | Meaning |
|---|---|---|
| `400` | `VALIDATION_FAILED` | A field is missing or breaks a rule: a non-https or private URL, an empty `agentIds`, an unknown field name, an empty edit. `message` names it. |
| `404` | `WEBHOOK_NOT_FOUND` | No endpoint with that id in your account. |
| `404` | `AGENT_NOT_FOUND` | One of `agentIds` is not an agent in your account. |
| `409` | `WEBHOOK_LIMIT` | The account already has 10 endpoints. Delete one to add another. |

### Example: Node

Uses the `alebex` helper from **Manage agents**.

```js
const hook = await alebex("POST", "/public/webhooks", {
  name: "CRM sync",
  url: "https://partner.example.com/alebex/end-of-call",
  agentIds: [agent.id],
  fields: ["agentId", "from", "to", "durationSeconds", "endedReason", "recordingUrl", "summary"],
  signing: true,
});
saveSecret(hook.signingSecret);                    // whsec_..., shown only now

// Cover every agent, including later ones, and go back to the original thirteen fields.
await alebex("PATCH", `/public/webhooks/${hook.id}`, { agentIds: "all", fields: null });

// After a leak: the old secret stops working the moment this answers.
const { signingSecret } = await alebex("POST", `/public/webhooks/${hook.id}/rotate-secret`);
```

## Place an outbound call

```
POST https://api.voice.alebex.ai/public/call/phone
Authorization: Bearer <API key>
Content-Type: application/json
```

```json
{
  "agentId": "<your agent id>",
  "to": "+15551234567",
  "twilio": {
    "accountSid": "AC...",
    "authToken": "...",
    "phoneNumber": "+15557654321"
  },
  "customTools": [ ],
  "knowledgeBase": "# Furniture Co\n## Delivery\nFree over $999 within 40 km ...",
  "guardrails": [ ],
  "context": "Jane Doe, sofa delivery booked for Oct 3."
}
```

| Field | Required | Meaning |
|---|---|---|
| `agentId` | yes | The agent to run, from the console. Must belong to your account. |
| `to` | yes | The number to call, E.164. |
| `twilio.accountSid` | yes | Your Twilio Account SID. |
| `twilio.authToken` | yes | Your Twilio auth token. Sent per call; the engine does not store it. |
| `twilio.phoneNumber` | yes | The caller ID. Must exist on that Twilio account or Twilio rejects the call. |
| `customTools` | no | Up to 8 HTTPS tools the agent may call during this call. See **Custom tools**. |
| `knowledgeBase` | no | Up to 100,000 characters of facts for this call. See **What a call knows**. |
| `guardrails` | no | Up to 25 topics to steer away from. See **What a call knows**. |
| `context` | no | Up to 4,000 characters about the person you are calling. See **What a call knows**. |

You send only *which agent* to run, plus what this call should know. The engine fetches
the prompt, voice, model and limits from your account, so nothing in your code can change
what the agent is.

```
201
{ "id": "public-3f9a1c2b7d4e", "providerCallId": "CA447c49d29c0aacfc15ebe0976874087c", "status": "queued" }
```

`id` is the call's id. The same value arrives as `id` in your end-of-call webhook and
as `call.id` in every tool request, so store it to match them up. `providerCallId` is
the Twilio call SID, for your Twilio records. `status` is the dial status as Twilio
reported it.

### Errors

Every error body is `{ "detail": "<text>" }`, except a body that fails validation, which
is a `422` whose `detail` is a list. There is no error code: branch on the status.

| Status | Meaning | What to do |
|---|---|---|
| `400` | A field was refused: a malformed `agentId`, a `to` that is not E.164, missing Twilio fields, or a custom tool, `knowledgeBase`, `guardrails` or `context` value. `detail` names it, e.g. `customTools[1].name`. | Fix the field; nothing was dialed. |
| `401` | No `Authorization` header, or not `Bearer <key>`. | Send the key. |
| `403` | `Invalid or inactive token`: the key is not live. | Fetch the current key; it may have been rotated. |
| `422` | The body failed validation, or `the number cannot be dialed (twilio <code>)`. | Check `to` and the caller ID. |
| `429` | `call allowance exhausted` (out of talk time or balance), or `too many calls in progress` (your concurrent-call limit). | Top up, or retry with a backoff. |
| `500` | `failed to start the call`: Twilio did not take the dial. | Check the Twilio credentials and caller ID, then retry. |
| `502` | `could not load the call payload`: your account refused the call. A trial account dialling a real number, the Communications Policy not accepted, an agent not found or not in your account, a suspended account, or a usage limit reached all land here. | Check the agent id, accept the policy or upgrade in the console, then retry. |
| `503` | `host at capacity`. | Retry with a backoff. |

## Run a browser call

One WebSocket carries one call's audio both ways. Open it from your server (or proxy
it): the key authorizes calls billed to your account and does not expire.

```
wss://api.voice.alebex.ai/public/ws/call
Sec-WebSocket-Protocol: alebex.token.<API key>     (preferred; ?token=<API key> also works)
```

Text frames are JSON with a `type`; binary frames are raw audio. Send `start_call` first:
`{"type": "start_call", "agent": {"id": "…"}}`, plus any of `customTools`,
`knowledgeBase`, `guardrails` and `context`. Wait for `{"type": "call_started", "call_id": "…"}`.

| You send | Format |
|---|---|
| binary | The caller's microphone: PCM16, 16 kHz, mono, little-endian, 20 ms frames (640 bytes), for the whole call. |
| `mark` | `{"type": "mark", "name": "audio_end"}`, echoed back. See the rule below. |
| `end_call` / `ping` | Hang up / keepalive (answered with `pong`). |

| We send | Meaning |
|---|---|
| `audio` | `{"type": "audio", "data": "<base64 PCM16>", "format": "pcm16", "sample_rate": 24000}`: the agent speaking. |
| `mark` | `{"type": "mark", "name": "audio_end"}`, after the last chunk of each utterance. |
| `clear_audio` | The caller cut in: stop all playback now. |
| `transcript`, `conversation_message` | What was heard and said. |
| `call_ended` | The call is over (`reason` and `ended_by: "ai"` when the agent hung up). |
| `error` | `code` and `message`. `invalid_request`, `invalid_config`, `unauthorized`, `payload_unavailable`, `internal_error`, `at_capacity` and `worker_busy` close the socket; `already_started`, `message_too_large` and `bad_message` leave it open. |

**The mark rule.** Hold each `mark` and echo it only after every audio chunk received
before it has finished playing out of the speaker, never when it arrives. The echo is how
the engine knows the caller heard the agent finish; an early echo makes it treat the agent
as silent while it is still talking, and the caller can no longer interrupt that reply.
Until the greeting's mark is echoed, the engine ignores the microphone.

**On `clear_audio`.** Stop every buffer already scheduled to play (not just a queue), then
echo any marks you are holding.

**Playback.** Start about 180 ms ahead of the current time on the first chunk, or after
playback has drained, then schedule chunks back to back; the lead absorbs a late chunk
without a gap.

```js
const ctx = new AudioContext({ sampleRate: 24000 });   // create inside the click that starts the call
const playing = new Set();
const heldMarks = [];
let playhead = 0;
const sendHeldMarks = () => { while (heldMarks.length) ws.send(JSON.stringify(heldMarks.shift())); };

function play(frame) {
  const bytes = Uint8Array.from(atob(frame.data), (c) => c.charCodeAt(0));
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  if (!pcm.length) return;
  const buf = ctx.createBuffer(1, pcm.length, frame.sample_rate || 24000);
  buf.getChannelData(0).set(Float32Array.from(pcm, (s) => s / 32768));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  if (playhead <= ctx.currentTime) playhead = ctx.currentTime + 0.18;   // first chunk, or drained
  src.start(playhead);
  playhead += buf.duration;
  playing.add(src);
  src.onended = () => { playing.delete(src); if (playing.size === 0) sendHeldMarks(); };
}

// Inside your existing onmessage, alongside call_started, transcript and the rest:
if (frame.type === "audio") play(frame);
if (frame.type === "mark") { heldMarks.push(frame); if (playing.size === 0) sendHeldMarks(); }
if (frame.type === "clear_audio") {
  for (const s of playing) { try { s.stop(); } catch {} }
  playing.clear();
  playhead = 0;
  sendHeldMarks();
}
```

Headphones give the agent the cleanest signal; on speakers, keep the browser's
`echoCancellation` on.

## Answer an inbound call

Two ways a call to your number reaches an agent.

**Import the number in the console** (most accounts): on the console's Phone Numbers page,
connect your Twilio account, import the number and assign an agent. Alebex answers it; no
code of yours runs. What such a call knows comes from **The call config webhook**.

**Route it from your own server**: point the number's Twilio voice webhook at your server,
and have it ask the engine for TwiML to hand back to Twilio.

```
POST https://api.voice.alebex.ai/public/call/inbound
Authorization: Bearer <API key>
Content-Type: application/json
```

```json
{
  "agentId": "<your agent id>",
  "callId": "CA447c49d29c0aacfc15ebe0976874087c",
  "from": "+15551234567",
  "to": "+15557654321",
  "twilio": { "accountSid": "AC...", "authToken": "..." },
  "customTools": [ ],
  "knowledgeBase": "...",
  "guardrails": [ ],
  "context": "Returning customer Jane Doe."
}
```

| Field | Required | Meaning |
|---|---|---|
| `agentId` | yes | The agent to answer with. |
| `callId` | yes | Twilio's `CallSid` from its webhook (`CA` plus 32 hex characters). |
| `from`, `to` | yes | The caller and your number, E.164, from Twilio's webhook. |
| `twilio.accountSid`, `twilio.authToken` | yes | Your Twilio credentials, per call; not stored. |
| `customTools`, `knowledgeBase`, `guardrails`, `context` | no | As on an outbound call. |

```
201
{ "id": "CA447c49d29c0aacfc15ebe0976874087c", "status": "ready", "twiml": "<?xml version=\"1.0\"?><Response><Connect><Stream ...></Response>" }
```

Return `twiml` to Twilio as `application/xml`. The `CallSid` is the call's only id: the
`id` of your end-of-call webhook and the `call.id` of every tool request. Errors are as
for an outbound call, except there is no `422` for an undialable number and a `500`
means the engine is misconfigured. On any refusal, answer Twilio with TwiML of your own
(a message or a `<Hangup/>`) so the caller is not left in silence.

## Custom tools

Tools are one of four things a call can carry; the other three are in **What a call knows**.

A tool is one of your HTTPS endpoints described well enough for the model to decide,
mid-conversation, that the caller's request needs it. When it does, the engine speaks
a holding line, POSTs to your URL with arguments extracted from what the caller said,
waits for your response and hands it straight back to the model to phrase for the
phone.

**Two ways a call gets its tools.** Attach stored tools to the agent (**Manage tools**)
and every call it takes carries them. Or send a `customTools` array with the call, and
that call carries exactly those: the agent's attached tools are set aside, never merged.
A tool sent with a call is not stored and is gone when the call ends, so a different URL
or header per call is simply a different request body: put a task id in the URL path or
a header and your side can route on it.

The same array rides on a browser call's `start_call` frame when your own code opens
the socket (see **Run a browser call**): `{"type": "start_call", "agent": {"id": "…"},
"customTools": [...]}`. A
bad entry there comes back as an `error` frame with code `invalid_config`, then the
socket closes with `1008`, the same close code as a bad token, so branch on the
frame's `code`. A page that opens the socket can read the tool `headers` and the API key
on the URL alike, so open the socket from your server, or proxy it, and put a
short-lived per-call token in `headers` rather than a live key. The test call on the
console's Voice Agents page sends the agent id alone, so it carries the agent's attached tools. The
rest of this guide stays with the outbound call.

### The tool object

```json
{
  "name": "check_stock",
  "description": "Check whether a product is in stock at a given store. Call this as soon as the caller asks about availability, sizes, or when something will be back. Do not call it for questions about an order already placed.",
  "url": "https://partner.example.com/voice-tools/check-stock",
  "headers": { "Authorization": "Bearer sk_live_9f3c2b..." },
  "timeoutMs": 8000,
  "parameters": {
    "type": "object",
    "properties": {
      "sku":     { "type": "string",  "description": "Product SKU the caller mentioned" },
      "qty":     { "type": "integer", "description": "How many units they want" },
      "size":    { "type": "string",  "enum": ["S", "M", "L"] },
      "storeId": { "type": "string",  "description": "Leave empty for any store" }
    },
    "required": ["sku"]
  }
}
```

| Field | Required | Rules |
|---|---|---|
| `name` | yes | Letters, digits, underscores and hyphens, 1 to 64 characters, starting with a letter. Unique within the call. Not one of the reserved names below. |
| `description` | yes | 1 to 1024 characters. The only text the model reads when deciding to call you. Write the trigger, not the implementation: name the caller situations that should fire it and the ones that should not. |
| `url` | yes | Absolute `https://` URL on a publicly resolvable host. Private, loopback and link-local addresses are refused. Redirects are not followed, so give the final address. |
| `parameters` | yes | JSON Schema for the arguments, root `type: "object"`. A tool with no arguments still declares `{"type": "object", "properties": {}}`. |
| `headers` | no | Up to 10 static string headers sent on every request. This is where your API key goes. `Host`, `Content-Type` and `Content-Length` are set by the engine and cannot be overridden. |
| `timeoutMs` | no | How long the engine waits for your endpoint. Default 8000, maximum 15000. |

### The schema subset

If you already define tools for an OpenAI or Anthropic model, paste that schema in
unchanged. Accepted keywords: `type` (`object`, `string`, `integer`, `number`,
`boolean`, `array`), `properties` (up to 20 per object, nested up to 3 levels deep),
`required` (must name properties that exist), `description`, `enum` (use it wherever
the set is closed), `items` (arrays of a single declared type).

Refused: `$ref`, `$defs`, `oneOf`, `anyOf`, `allOf`. Inline the definition or split
into separate tools. `spoken_line` is refused as a property name because the engine
adds it itself (see **Latency** below).

### Reserved names

`end_call`, `transfer_call`, `leave_voicemail`, `mark_call_screening`,
`unmark_call_screening`, `list_available_slots`, `book_appointment`,
`cancel_appointment`, `reschedule_appointment`, `get_appointments`, and anything
beginning `get_skill_`. A collision is refused, never renamed or dropped: a renamed
tool means your prompt refers to something that does not exist on the call, and a
dropped one means the agent promises a caller something it can no longer do.

### Limits

| Rule | Limit |
|---|---|
| Tools per call | 8 |
| Tool calls per conversation, across all custom tools | 20 |
| Response body | 8 KB. Larger is refused and reported to the model as a tool error naming the size. |
| URL | `https` only, public host only, no redirects |
| Headers | 10, strings only |
| Description | 1 to 1024 characters |

## What a call knows

Tools are one thing a call can carry. Three more tell the agent what to know on this
call. All three are optional, go in the same request (or the `start_call` frame), and
are validated before anything is dialed.

| Field | Type | Limit | Use it for |
|---|---|---|---|
| `knowledgeBase` | string | 100,000 characters | Facts the agent looks up: hours, policies, products, prices. |
| `guardrails` | array | 25 entries | Topics to steer away from, and what to say instead. |
| `context` | string | 4,000 characters | Who is on the line, for this call only. |

Agents that work for the same business share a knowledge base and guardrails by sending
the same values. Nothing is attached to the agent; each call carries its own.

### Knowledge base

The engine splits it into passages of about 800 characters and gives the agent the ones
that match each caller turn; under 100 characters it is used whole. Write sections that
stand alone. Put facts here and rules in `guardrails`: a rule in the knowledge base only
reaches the agent when a passage happens to match.

Identical text is indexed once per account and reused, so keep it stable. An index no call
has used for 5 hours is deleted; the next call that sends the text indexes it again.

### Guardrails

```json
{
  "topic": "Financing rates",
  "description": "Caller asks for an APR or a monthly payment amount",
  "response": "Our financing team can give you exact terms.",
  "enforce": false,
  "agentSensitivity": 0.66,
  "callerSensitivity": 0.33
}
```

| Field | Required | Meaning | Default |
|---|---|---|---|
| `topic` | yes | What to avoid, up to 200 characters. Unique in the array. | |
| `response` | yes | What the agent says instead, up to 1,000 characters. | |
| `description` | no | When it applies, up to 500 characters. Sharpens the live catch. | |
| `enforce` | no | `true` says `response` verbatim; `false` lets the agent rephrase it. | `false` |
| `agentSensitivity` | no | 0 to 1. How readily the agent's own reply is caught and replaced. | `0.5` |
| `callerSensitivity` | no | 0 to 1. How readily the caller raising the topic is caught. | `0` |

Every guardrail is in the agent's instructions for the whole call. A sensitivity above 0
also turns on live catching for that side. The live catch is prepared once per distinct
array, so send the same array each time and keep per-call details out of it.

### Caller context

Plain text about the person on this call: "Returning customer Jane Doe. Sofa delivery
booked for Oct 3." The agent reads it as information, not instructions, under "About
this caller". Send only what the agent needs; it appears in the call log.

### Errors

A bad value is a `400` whose `detail` names it, e.g. `guardrails[1].response is
required`, and nothing is dialed. On a socket it is an `error` frame with code
`invalid_config`.

## What the engine sends your endpoint

Always a POST, always this envelope. Your parameters arrive inside `arguments`
exactly as your schema declared them; everything about the call stays in `call`, so
a new field on the engine's side can never collide with one of yours.

```
POST /voice-tools/check-stock HTTP/1.1
Host: partner.example.com
Authorization: Bearer sk_live_9f3c2b...
Content-Type: application/json

{
  "tool": "check_stock",
  "arguments": { "sku": "A-1024", "qty": 2, "size": "M" },
  "call": {
    "id": "public-9f3c2b1a-4d77-4c19-9f0e-2b88a1c5d310",
    "agentId": "<your agent id>",
    "from": "+16045551234",
    "to": "+17785559876",
    "startedAt": "2026-09-14T18:20:11Z"
  }
}
```

- **`call.id` is the call's id.** It is the `id` `POST /public/call/phone` returned
  (the CallSid you sent, on an inbound call) and the end-of-call webhook's `id`, so it
  finds the record you stored at dial time. A task id in the tool's URL or a header, as
  both working examples use, does the same without a lookup.
- **Optional properties may be absent.** The model fills what the caller said and
  nothing more. Treat every non-required key as missing until proven otherwise.
- **One attempt, no retries, no redirects.** If the request fails, the model is told
  and adapts on the line.
- **Not idempotent by the engine.** The model can legitimately call the same tool
  twice in one turn. If your endpoint books, charges or sends, key it on `call.id`,
  which holds for the life of the call, plus your own arguments.
- **The wait is call time.** The caller stays on the line while your endpoint works,
  and those seconds are metered like any other. Aim to answer well under the timeout.

### What you send back

Any `2xx` with a JSON body. It is handed to the model verbatim: no fixed shape, no
field of ours to include. What you return is what the agent knows. A `text/plain`
body is accepted as the whole result.

```
200 OK
{ "inStock": true, "available": 6, "store": "Broadway & Main", "readyIn": "20 minutes" }

200 OK
{ "inStock": false, "reason": "SKU A-1024 is discontinued", "alternatives": ["A-1099", "A-1100"] }

400 Bad Request
{ "error": "That store is closed on Sundays" }
```

Write values a person could hear: `"readyIn": "20 minutes"` reaches the caller
intact; `"ready_ts": 1789458000` becomes whatever the model guesses it means. Keep it
under 2 KB.

### When it goes wrong

| Condition | What the model receives | What the caller hears |
|---|---|---|
| Timeout | An error naming your tool and the timeout | The agent apologizes and offers another route; the call continues |
| `4xx` / `5xx` | The status code and the first part of your body | Same. A readable `4xx` like `{"error": "That store is closed on Sundays"}` gives the agent something useful to say |
| Body over 8 KB | An error naming the size; none of the body | Same |
| Non-JSON body | The raw text | Whatever the model can make of it |
| Connection refused | An error naming your tool | The agent moves on |

A failing tool never drops a call and is never surfaced to the caller as a system
message.

### Latency

Every tool silently gains one extra argument, `spoken_line`, that the model fills
with a sentence to say out loud. It arrives at the head of the argument stream, so
the caller is already hearing "Let me check that for you" while your parameters are
still being written. It is stripped before the request reaches you and never appears
in `arguments`. A fast endpoint mostly buys a shorter pause rather than none at all,
and a slow one is survivable.

## Live call events

Custom tools let the agent call your app. Events are the other direction: your app tells
a live call that something happened (an order is ready, a driver is two minutes away),
and the agent says one short line about it without waiting for the caller to speak. If
the caller agrees to something, the agent uses its tools as usual.

**Off until you turn it on, per agent:** `PATCH /public/agents/{agentId}` with
`{"behaviour": {"callEvents": true}}`, or the *Live call events* switch on the agent in
the console. Calls with any other agent take no events.

### The event

```json
{
  "name": "order.ready",
  "payload": { "order_id": "A-1024", "pickup": "front counter" },
  "hint": "Tell the caller their order is ready for pickup.",
  "speak": true,
  "priority": "normal",
  "idempotencyKey": "order-A-1024-ready"
}
```

| Field | Required | Rules |
|---|---|---|
| `name` | yes | Lowercase letters, digits, `.`, `_` and `-`, starting with a letter, up to 64. A newer event with the same name replaces one still waiting. |
| `payload` | no | The facts the agent needs, an object. Up to 1024 bytes as JSON, nested at most 3 levels. The agent is told not to read ids or raw values aloud. |
| `hint` | no | What the agent should do with it, up to 300 characters. |
| `speak` | no, `true` | `false` adds the event to the agent's context without saying anything; the agent uses it when it comes up. |
| `priority` | no, `"normal"` | `"normal"` waits for a quiet moment. `"interrupt"` may cut the agent off (never the caller), once any reply already being generated has finished. |
| `idempotencyKey` | no | Up to 128 characters. A repeat answers `duplicate` with the first event's id and is not spoken twice. |

The whole event, as sent, is at most 2048 bytes; larger is refused before it is read.

### Send it on the call's socket

On a browser call (`/public/ws/call`), once `call_started` has arrived, send the event as
a frame with `"type": "call_event"`. The engine answers with `event_status` frames as it
moves along: `{"type": "event_status", "eventId": "evt_...", "status": "queued", "name": "order.ready"}`.

| `status` | Meaning |
|---|---|
| `queued` | Waiting for its moment. |
| `noted` | `speak: false`: added to the agent's context. |
| `merged` | Replaced by a newer event with the same name. |
| `duplicate` | A repeated `idempotencyKey`; `eventId` is the first one's. |
| `spoken` | Said. `line` is what the agent said. |
| `dropped` | Not said. `reason`: `caller_spoke`, `nothing_said`, `call_ending`, `call_limit`, `line_dropped`. |
| `rejected` | Refused. `reason`: `invalid_event` (with `field` and `message`), `payload_too_large`, `rate_limited`, `queue_full`, `not_enabled_for_call` (the agent has events off), `no_call`, `not_enabled`. |

A refusal is always an `event_status` frame, never an `error` frame: a bad event does not
end the call.

### Or send it over HTTP

From your backend, to a phone call or a browser call:

```
POST https://api.voice.alebex.ai/public/calls/{callId}/events
Authorization: Bearer <API key>
Content-Type: application/json
```

The body is the event, without `type`. `callId` is the call's id: the `id` an outbound
call returned (its Twilio `CallSid` works too), an inbound call's `CallSid`, or a browser
call's `call_id` from `call_started`. The call must belong to the same account, and a
phone call is reachable once it is answered.

```
202
{ "eventId": "evt_8Qm2kX1pZtA", "status": "queued", "name": "order.ready" }
```

| Status | Meaning |
|---|---|
| `202` | Accepted: `status` is `queued` or `noted`, with `replaced` listing the ids of any waiting events it took the place of. |
| `200` | `duplicate`: a repeated `idempotencyKey`, with the first event's id. |
| `401` / `403` | No key, or a key that is not valid: `{ "detail": "<text>" }`. |
| `404` | `call_not_found`: the call has ended, is not yours, or its agent has events off. The three look the same. |
| `409` | `call_not_accepting`: the last seconds of the call limit. |
| `413` | `payload_too_large`: the body is over 2048 bytes. |
| `422` | `invalid_event`: `field` names what to fix. |
| `429` | `rate_limited` or `queue_full`, with `Retry-After`. |
| `503` | `call_busy`: the call did not answer in time. Retry. |

`404`, `413`, `422` and `503` put `{ "code", "message" }` under `detail`; `409` and `429` put
`code` at the top level.

Over HTTP you get only what happened on arrival. Whether the event was then spoken is in
the end-of-call webhook's `events`.

### Limits

| Rule | Limit |
|---|---|
| Events per call | 6 a minute, 60 in total |
| Waiting at once | 3; a new one past that is `queue_full` |
| Between two spoken `normal` events | at least 20 seconds; an `interrupt` skips the gap |
| Kept in the agent's context | 8 KB of events per call; older ones are remembered by name only |

The caller always keeps the floor: nothing is said while they are talking, during the
opening greeting, or while a call screener is on the line.

## The end-of-call webhook

When a call ends, Alebex POSTs a report to every active webhook endpoint that covers the
call's agent. Add endpoints on the console's Webhooks page or with **Manage webhooks**.
Browser and phone calls report the same way.

**Endpoints and agents.** Up to 10 endpoints, each with its own URL, fields and signing
secret. `agentIds: "all"` covers every agent, including ones created later; a list covers
only those agents. A call that could not be tied to an agent reaches only `"all"`
endpoints. Every endpoint that covers the agent gets its own copy. The URL must be
`https` on a public host.

**Fields.** Each endpoint chooses its fields from the table below. `id` is always sent. A
field not chosen is absent, not `null`. An endpoint that never chose receives the
original thirteen: `id`, `callType`, `direction`, `from`, `to`, `startedAt`, `endedAt`,
`durationSeconds`, `endedReason`, `voicemailLeft`, `transcript`, `recordingUrl`, `events`. Field names
are fixed.

```
POST <your endpoint URL>
Content-Type: application/json
X-Alebex-Signature: t=1790865252,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd

{
  "id": "CA447c49d29c0aacfc15ebe0976874087c",
  "callType": "phone",
  "direction": "inbound",
  "from": "+15551234567",
  "to": "+15557654321",
  "startedAt": "2026-10-01T14:30:00.000Z",
  "endedAt": "2026-10-01T14:34:12.000Z",
  "durationSeconds": 252,
  "endedReason": "customer-ended-call",
  "voicemailLeft": false,
  "transcript": "Agent: Hi, this is Support. How can I help?\nYou: Can you check if SKU 992 is in stock?",
  "recordingUrl": "https://recordings.alebex.ai/.../mixed.wav?X-Amz-Expires=3600&...",
  "events": []
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Always sent. The `id` `POST /public/call/phone` returned for a call you placed, the CallSid you sent on an inbound call, the engine's `public-...` id on a browser call. Tool requests carry the same value as `call.id`. Match on this to recognize a repeat. |
| `agentId` | string or null | The agent that took the call. |
| `agentName` | string or null | That agent's name when the call ended. |
| `callType` | string | `phone` or `browser`. |
| `direction` | string or null | `inbound` or `outbound`. Null on a browser call. |
| `from`, `to` | string or null | E.164. Null on a browser call. |
| `providerCallId` | string or null | The Twilio call SID of a call you placed. Null when it would equal `id`: an inbound or browser call. |
| `apiKeyId` | string or null | The key that placed the call. |
| `startedAt`, `endedAt` | string | ISO-8601. |
| `durationSeconds` | number | Billable talk time; your invoice is computed from it. |
| `endedReason` | string | `customer-ended-call`, `assistant-ended-call`, `customer-did-not-answer`, `customer-busy`, `technical-error`, `call-canceled`. |
| `twilioFailure` | object or null | Twilio's status and error code for a call that never connected. |
| `voicemailLeft` | boolean | Always `false`. Developer calls do not leave voicemails yet. |
| `transcript` | string | Both sides, in order, prefixed `Agent:` and `You:`. |
| `messages` | object[] | The same conversation as `{ role, text, secondsFromStart }`, `role` being `agent` or `caller`. |
| `events` | array | Every live call event sent during the call, in order: `seq`, `eventId`, `name`, `priority`, its final `status` (and `reason`), `secondsFromStart`, and `spokenSecondsFromStart` when spoken. `payload` and `line` only when the transcript is kept. Empty when there were none. |
| `recordingUrl` | string or null | Presigned, valid for 60 minutes from when the report was sent. Download it on arrival. `null` (never missing) if the call was under half a second or the upload failed. Mono WAV, 8 kHz for a phone call, 16 kHz for a browser call. |
| `toolCalls` | object[] | Each tool run: `{ seq, name, secondsFromStart, durationMs, arguments, result }`. `result` is cut at 2,000 characters, with `resultTruncated` set. `cancelled` is true on an `end_call` whose hangup was called off because the caller kept talking. |
| `turnCount` | number or null | How many times the agent replied. |
| `turns` | object[] | Each reply's latency: `{ seq, secondsFromStart, sttMs, llmMs, ttsMs, totalMs }`. |
| `charge` | object or null | `{ amount, currency }`. Null when the call was not charged. |
| `brainTier` | string or null | `standard` or `premium`. |
| `summary` | string or null | Two or three sentences on what the caller wanted and how it ended, written by AI from the transcript. |

**Delivery.** One POST per endpoint per call. Answer `2xx` within 20 seconds. A timeout,
`429` or `5xx` is retried twice, 1 second and then 4 seconds later; any other `4xx` is not
retried. Every attempt is listed on the endpoint's page in the console. A retry carries
the same `id`, so treat a repeat as the same call.

**Signing.** With `signing` on, every report carries
`X-Alebex-Signature: t=<unix seconds>,v1=<hex>`, where `v1` is the HMAC-SHA256 of
`<t>.<raw body>` keyed with the endpoint's whole secret, `whsec_` prefix included. Each
attempt is signed afresh. To check it: read the raw body before parsing, recompute the
HMAC, compare it with `v1` in constant time, and reject a `t` more than 5 minutes from
your clock. The Node working example below does this. Without signing there is no
authentication header; verify the report against a call you started by its `id`.

## The call config webhook (optional)

Only for calls none of your code places: inbound calls to a Twilio number you imported
in the console, and test calls started from the console. A call you place yourself
carries its fields on the request and never triggers this. If you don't import numbers,
skip this section.

Set the URL on the console's **Webhooks** page, below your end-of-call endpoints. An
account has one, and it must be `https`. It is always signed; the console shows the
secret once.

```
POST <your call config URL>
Content-Type: application/json
X-Alebex-Signature: t=1790612345,v1=5f2b9c...

{ "event": "call.config", "source": "imported_number",
  "callId": "CA447c49d29c0aacfc15ebe0976874087c", "agentId": "<agent id>",
  "from": "+15551234567", "to": "+15557654321" }
```

`source` is `imported_number` or `console_test`. `callId`, `from` and `to` are `null` on
a console test.

**Verify first.** `v1` is the HMAC-SHA256 of `t + "." + raw body` under this
webhook's own secret, the one the console showed when you added it. The format is an
end-of-call report's, but the secret is not an end-of-call endpoint's. Reject a mismatch,
and a `t` more than 5 minutes old: your response is your knowledge base and your
caller's details.

**Answer within 3 seconds** with any of `knowledgeBase`, `guardrails` and `context`
(same limits as on a call), or `{}`. A caller is waiting. A timeout or an error never
drops the call; it starts without the fields. On an imported number the call log says
why; a console test call shows the reason on the Voice Agents page. An invalid field is
dropped on its own.

## Working example: Node

Places a call with one tool, serves the tool, and receives the report. Express 4+.

```js
import crypto from "node:crypto";
import express from "express";

const ALEBEX_API_KEY = process.env.ALEBEX_API_KEY;          // wt_...
const AGENT_ID       = process.env.ALEBEX_AGENT_ID;
const PUBLIC_BASE    = "https://partner.example.com";        // reachable by the engine
const WEBHOOK_SECRET = process.env.ALEBEX_WEBHOOK_SECRET;   // whsec_..., shown once when signing is turned on
const CALL_CONFIG_SECRET = process.env.ALEBEX_CALL_CONFIG_SECRET;  // whsec_..., the call config webhook's own

// What every call for this store knows. Built once: identical values are indexed once.
const STORE = {
  knowledgeBase: STORE_KB,                                   // your facts, as one string
  guardrails: [
    { topic: "Financing rates", response: "Our financing team can give you exact terms." },
  ],
};

const app = express();

app.use("/voice-tools", express.json({ limit: "64kb" }));
app.use("/alebex", express.raw({ type: "application/json", limit: "2mb" }));  // raw: the signature covers the exact bytes

// 0. Optional: your call config webhook, for numbers you imported. Checked with its own
//    secret: an end-of-call endpoint's secret fails every request here.
app.post("/alebex/call-config", (req, res) => {
  if (!signatureIsValid(req.get("x-alebex-signature"), req.body, CALL_CONFIG_SECRET)) return res.sendStatus(401);
  const { from } = JSON.parse(req.body.toString("utf8"));
  const customer = from && lookUpCustomer(from);             // your own code
  res.json({ ...STORE, ...(customer && { context: `Returning customer ${customer.name}. ${customer.summary}` }) });
});

// 1. Your tool endpoint. The engine POSTs here mid-call.

app.post("/voice-tools/check-stock", (req, res) => {
  if (req.get("authorization") !== `Bearer ${process.env.TOOL_SECRET}`) {
    return res.status(401).json({ error: "bad tool credential" });
  }
  const { arguments: args } = req.body;                // args.sku, args.qty?, args.size?
  const taskId = req.get("x-task-id");                 // yours, set at dial time; body.call.id is the id the call was placed under
  const stock = lookUpStock(args.sku, args.size);      // your own code
  // Key side effects on call.id + arguments: the model may call twice in one turn.
  res.json(stock
    ? { inStock: true, available: stock.count, readyIn: "20 minutes" }
    : { inStock: false, reason: `SKU ${args.sku} is not carried` });
});

// 2. Your end-of-call webhook. Add this URL as a webhook endpoint in the console, or with
//    POST /public/webhooks, with signing on.
function signatureIsValid(header, rawBody, secret) {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest();
  const received = Buffer.from(parts.v1 ?? "", "hex");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

app.post("/alebex/end-of-call", (req, res) => {
  if (!signatureIsValid(req.get("x-alebex-signature"), req.body, WEBHOOK_SECRET)) return res.sendStatus(401);
  const { id, endedReason, durationSeconds, transcript, recordingUrl } = JSON.parse(req.body.toString("utf8"));
  if (recordingUrl) fetchAndStore(recordingUrl);       // the link expires 60 minutes after sending
  saveCallOutcome(id, endedReason, durationSeconds, transcript);  // a repeated id is the same call
  res.sendStatus(204);
});

app.listen(8080);

// 3. Place a call. Runs server-side; the body carries your Twilio secret.
export async function callLead(to, taskId, context) {
  const res = await fetch("https://api.voice.alebex.ai/public/call/phone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ALEBEX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agentId: AGENT_ID,
      to,
      twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        phoneNumber: process.env.TWILIO_CALLER_ID,
      },
      customTools: [
        {
          name: "check_stock",
          description:
            "Check whether a product is in stock at a given store. Call this as soon as the caller " +
            "asks about availability, sizes, or when something will be back. Do not call it for " +
            "questions about an order already placed.",
          // A per-call URL or header: this call's task id, so your side can route on it.
          url: `${PUBLIC_BASE}/voice-tools/check-stock?task=${encodeURIComponent(taskId)}`,
          headers: { Authorization: `Bearer ${process.env.TOOL_SECRET}`, "X-Task-Id": taskId },
          timeoutMs: 8000,
          parameters: {
            type: "object",
            properties: {
              sku:  { type: "string",  description: "Product SKU the caller mentioned" },
              qty:  { type: "integer", description: "How many units they want" },
              size: { type: "string",  enum: ["S", "M", "L"] },
            },
            required: ["sku"],
          },
        },
      ],
      ...STORE,                                              // knowledgeBase and guardrails
      context,                                               // e.g. "Jane Doe, delivery booked for Oct 3"
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // 400: body.detail names the refused field. 429: back off and retry.
    throw new Error(`call refused: ${res.status} ${body.detail ?? body.message ?? ""}`);
  }
  const { id, status } = await res.json();
  rememberCall(id, taskId);                             // also the webhook's id and every tool request's call.id
  return { id, status };
}
```

## Working example: Python

Flask for the endpoints, `requests` for the call.

```python
import hmac, hashlib, json, os, time, requests
from urllib.parse import quote
from flask import Flask, request, jsonify

ALEBEX_API_KEY = os.environ["ALEBEX_API_KEY"]            # wt_...
AGENT_ID       = os.environ["ALEBEX_AGENT_ID"]
PUBLIC_BASE    = "https://partner.example.com"

# What every call for this store knows. Built once: identical values are indexed once.
STORE = {
    "knowledgeBase": STORE_KB,                           # your facts, as one string
    "guardrails": [{"topic": "Financing rates", "response": "Our financing team can give you exact terms."}],
}

app = Flask(__name__)

def signed_body(secret: str):
    """The raw body if X-Alebex-Signature checks out under this secret, else None."""
    parts = dict(p.split("=", 1) for p in request.headers.get("X-Alebex-Signature", "").split(",") if "=" in p)
    body = request.get_data()                            # the raw bytes the signature covers
    if not parts.get("t", "").isdigit():
        return None
    expected = hmac.new(secret.encode(), f"{parts['t']}.".encode() + body, hashlib.sha256).hexdigest()
    fresh = abs(time.time() - int(parts["t"])) <= 300
    return body if fresh and hmac.compare_digest(parts.get("v1", ""), expected) else None

@app.post("/alebex/call-config")                         # optional: numbers you imported
def call_config():
    body = signed_body(os.environ["ALEBEX_CALL_CONFIG_SECRET"])   # its own secret, not an endpoint's
    if body is None:
        return "", 401
    call = json.loads(body)
    config = dict(STORE)
    customer = call["from"] and look_up_customer(call["from"])   # your own code
    if customer:
        config["context"] = f"Returning customer {customer.name}. {customer.summary}"
    return jsonify(config)

@app.post("/voice-tools/check-stock")
def check_stock():
    if request.headers.get("Authorization") != f"Bearer {os.environ['TOOL_SECRET']}":
        return jsonify(error="bad tool credential"), 401
    body = request.get_json(force=True)
    args = body["arguments"]
    task_id = request.args.get("task")                       # yours, set at dial time; body["call"]["id"] is the id the call was placed under
    stock = look_up_stock(args["sku"], args.get("size"))    # your own code
    if stock is None:
        return jsonify(inStock=False, reason=f"SKU {args['sku']} is not carried")
    return jsonify(inStock=True, available=stock.count, readyIn="20 minutes")

@app.post("/alebex/end-of-call")
def end_of_call():
    body = signed_body(os.environ["ALEBEX_WEBHOOK_SECRET"])  # whsec_..., from creating the endpoint
    if body is None:
        return "", 401
    report = json.loads(body)
    if report.get("recordingUrl"):
        fetch_and_store(report["recordingUrl"])              # expires in 60 minutes
    save_call_outcome(report["id"], report["endedReason"], report["durationSeconds"], report["transcript"])
    return "", 204

def call_lead(to: str, task_id: str, context: str = "") -> dict:
    res = requests.post(
        "https://api.voice.alebex.ai/public/call/phone",
        headers={"Authorization": f"Bearer {ALEBEX_API_KEY}"},
        json={
            "agentId": AGENT_ID,
            "to": to,
            "twilio": {
                "accountSid": os.environ["TWILIO_ACCOUNT_SID"],
                "authToken": os.environ["TWILIO_AUTH_TOKEN"],
                "phoneNumber": os.environ["TWILIO_CALLER_ID"],
            },
            "customTools": [{
                "name": "check_stock",
                "description": ("Check whether a product is in stock at a given store. Call this as soon "
                                "as the caller asks about availability, sizes, or when something will be "
                                "back. Do not call it for questions about an order already placed."),
                "url": f"{PUBLIC_BASE}/voice-tools/check-stock?task={quote(task_id)}",
                "headers": {"Authorization": f"Bearer {os.environ['TOOL_SECRET']}", "X-Task-Id": task_id},
                "timeoutMs": 8000,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "sku":  {"type": "string",  "description": "Product SKU the caller mentioned"},
                        "qty":  {"type": "integer", "description": "How many units they want"},
                        "size": {"type": "string",  "enum": ["S", "M", "L"]},
                    },
                    "required": ["sku"],
                },
            }],
            **STORE,                                     # knowledgeBase and guardrails
            **({"context": context} if context else {}),
        },
        timeout=30,
    )
    if res.status_code == 400:
        raise ValueError(f"call refused: {res.json().get('detail')}")   # names the field
    res.raise_for_status()
    return res.json()                                        # {"id": "public-...", "providerCallId": "CA...", "status": "queued"}
```

## Checklist before you ship

- The API key and the Twilio auth token live on your server, never in a browser or a
  repository. The same goes for the downloaded `.env` file.
- Browser calls echo each `mark` only after the audio before it has finished playing,
  never on receipt, and on `clear_audio` stop every scheduled buffer, then echo held marks.
- The microphone goes out as PCM16, 16 kHz, mono, in 20 ms binary frames, for the
  whole call; agent audio is played at the frame's `sample_rate` (24000).
- The browser socket's key travels as the `alebex.token.<key>` subprotocol from your
  server or proxy, never from a page anyone can inspect.
- Agent writes branch on `error.code`; `VALIDATION_FAILED` names the field to fix.
- A rotation after a leak counts as done only when `previousTokenDeleted` came back
  `true`.
- Your tool URLs are `https://` on a public host and answer within your `timeoutMs`;
  the caller is listening while they run.
- Tool responses are small JSON with values a person could hear, and under 8 KB.
- Side-effecting tools are keyed on `call.id` plus arguments; the model may call twice.
- Tool requests reach your own records through `call.id`, the id the call was placed
  under, or a task id you put in the URL or a header at dial time.
- Tool names avoid the reserved list and are unique within the call.
- Tools are attached by sending the agent's whole `toolIds` list, and a call sent with
  `customTools` uses only those.
- A leaked tool key is rotated with `PATCH /public/tools/{toolId}` and its `headers`.
- Your webhook endpoints cover the right agents (`agentIds`) and ask only for the
  fields you parse.
- Your receiver checks `X-Alebex-Signature` against the raw body, in constant time, and
  rejects a `t` more than 5 minutes old.
- Your receiver answers `2xx` within 20 seconds, downloads `recordingUrl` on arrival,
  and treats a repeated `id` as the same call.
- `400` responses are read: `detail` says exactly which field was refused (a tool, the
  knowledge base, a guardrail or the context), and nothing was dialed.
- `429` and `503` are retried with a backoff, not in a tight loop.
- Agents for the same business send the same `knowledgeBase` and `guardrails`, built
  once, not per call.
- Facts are in `knowledgeBase`; anything the agent must never say is in `guardrails`.
- `context` holds only what this call needs, and no instructions.
- If you use the call config webhook, it verifies `X-Alebex-Signature` on the raw body,
  rejects stale timestamps, and answers within 3 seconds.
- The call config route checks the signature on the raw body with the call config
  webhook's own secret (`ALEBEX_CALL_CONFIG_SECRET`), not an end-of-call endpoint's.
- Live call events are switched on per agent (`behaviour.callEvents`), carry an
  `idempotencyKey` when your app may send the same one twice, and keep `payload` small:
  1024 bytes, a few facts the agent can say in a sentence.
