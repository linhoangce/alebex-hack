# Step 0: The big picture

**Goal:** understand the parts of the app and how they talk to each other, before you write
any code.

## The five parts

Think of the app as five parts passing notes to each other.

```
 ┌──────────────┐        ┌──────────────┐        ┌───────────────────┐
 │ 1. Browser   │◄──────►│ 2. Your      │◄──────►│ 3. Alebex Voice   │
 │    page      │  Web-  │    server    │  Web-  │    Engine         │
 │ (in the room)│ Socket │ (Node.js)    │ Socket │ (hears, thinks,   │
 └──────────────┘        └──────▲───────┘        │  speaks)          │
                                │                └─────────┬─────────┘
                                │      HTTPS POST          │
                                └──────────────────────────┘
                                 tools + end-of-call report
                                 (needs 5. a public address)

 ┌──────────────┐
 │ 4. Alebex API│◄──── npm run setup (creates agents, registers the webhook)
 └──────────────┘
```

1. **The browser page** (`public/`). It runs in the exam room. It uses the microphone,
   plays the AI's voice on the speaker, and shows the transcript and cards.
2. **Your server** (`src/`, `local-server.js`). A small Node.js program in the middle. It
   holds the secret API key, passes audio both ways, receives messages from the AI, and
   saves each session to disk.
3. **The Alebex Voice Engine** (`https://api.voice.alebex.ai`). The AI. It turns speech
   into text, decides what to say using your prompt, and turns its answer back into speech,
   live, in about a second.
4. **The Alebex API** (`https://api.alebex.ai/api/v1`). The "settings office". You use it
   before any call to create your AI agents, list voices and register a webhook.
5. **A public address** (ngrok on your laptop, or Vercel when hosted). The engine lives on
   the internet. To call back into your server, it needs an `https://` address the whole
   internet can reach. `localhost` only works from your own computer.

## Why is there a server in the middle?

In theory the browser could talk to the engine directly. It does not, for one big reason:
**the API key**.

The key works like a credit card. Anyone who has it can start calls billed to your account,
and it never expires. Whoever uses a browser can read anything you send to it. So the key
stays on the server, and the server opens the connection to the engine on the browser's
behalf. A program that sits in the middle like this is called a **proxy**.

```
   Browser  ── "start a Vietnamese session" ──►  Server
                                                   │ adds the secret key,
                                                   │ the agent id, the glossary,
                                                   │ today's date, the tools
                                                   ▼
                                                 Engine
```

The server also adds things the browser should not get to choose: which agent to use, the
medical glossary, the tools, and the date and time.

## Key words you will meet

| Word | Meaning in plain words |
|---|---|
| **Agent** | One AI "personality" stored at Alebex: a prompt, a first message and voices. This app has one agent per patient language. |
| **Prompt** | The written instructions the AI follows on every turn: who it is, what it does, what it never does. |
| **Knowledge base** | Extra facts sent with a call. Here, a bilingual medical glossary. The engine looks up the parts that match what was just said. |
| **Context** | Facts about this one call, such as today's date. |
| **Tool** | A web address on your server that the AI can call during a conversation, for example "save the intake form". |
| **Live call event** | The opposite of a tool: your app tells the AI that something happened ("the clinician pressed End"). |
| **Webhook** | A web address on your server that Alebex calls once, after a call ends, to deliver a report. |
| **WebSocket** | A connection that stays open so both sides can send messages at any time. A normal web request is one question and one answer. A WebSocket is more like a phone line. |
| **Frame** | One message sent over a WebSocket. Here, a **text frame** is JSON such as `{"type":"mark"}`, and a **binary frame** is raw audio bytes. |
| **PCM16** | The simplest way to store sound: a long list of numbers, each between -32768 and 32767, that describe how the speaker moves over time. |
| **Sample rate** | How many of those numbers make one second of sound. The microphone audio we send has 16,000 per second (16 kHz). The AI's voice comes back with 24,000 per second. |

## One session, start to finish

This is what happens when the clinician presses **Start session**. Read it once now. Each
later step builds one part of it.

```
Browser                       Your server                      Alebex engine
   │                              │                                  │
   │── session_start {vi} ───────►│                                  │
   │                              │ creates a session file           │
   │◄────────── session_created ──│                                  │
   │                              │── opens a WebSocket (with key) ─►│
   │                              │── start_call {agent, glossary,   │
   │                              │    context, tools} ─────────────►│
   │                              │                                  │
   │◄──── audio (greeting) ───────│◄──────── audio (greeting) ───────│
   │◄──── mark ───────────────────│◄──────── mark ───────────────────│
   │ plays the greeting...        │                                  │
   │ ...when it has finished:     │                                  │
   │── mark (echo) ──────────────►│── mark ─────────────────────────►│
   │◄──── call_started ───────────│◄──────── call_started ───────────│
   │                              │                                  │
   │══ microphone audio (binary) ═►══ microphone audio ═════════════►│
   │◄─ transcript, audio, mark ───│◄─ transcript, audio, mark ───────│
   │        ... the visit goes on, sentence by sentence ...          │
   │                              │                                  │
   │                              │◄── POST /voice-tools/... (tool) ─│
   │◄── session_details (card) ───│── {"saved": true} ──────────────►│
   │                              │                                  │
   │── end_session ──────────────►│── call_event "visit.ending" ────►│
   │                              │◄── POST /voice-tools/record-intake
   │◄── intake_recorded (card) ───│                                  │
   │                              │── end_call ─────────────────────►│
   │◄──── call_ended ─────────────│◄──────── call_ended ─────────────│
   │                              │                                  │
   │                              │◄── POST /alebex/end-of-call ─────│
   │                              │    (summary, transcript,         │
   │                              │     recording link)              │
```

The diagram shows three kinds of traffic:

1. **Two WebSockets joined end to end.** One from the browser to your server, one from your
   server to the engine. The server copies audio and messages across. (Steps 4 and 5.)
2. **Tool calls.** The engine sends an HTTPS `POST` to your server during the call. Your
   server saves the data and pushes a card to the browser. (Step 7.)
3. **The webhook.** One `POST` after the call ends, with a summary and a recording.
   (Step 9.)

## How the code is organised

```
alebex-hack/
├── package.json          project name, scripts, three dependencies
├── local-server.js       the start file when running on your laptop (npm start)
├── api/index.js          the start file when running on Vercel
├── vercel.json           Vercel settings
├── src/                  the server
│   ├── app.js            the web app: routes and the WebSocket door
│   ├── proxy.js          the voice bridge (the heart of the server)
│   ├── languages.js      which languages exist and where their files are
│   ├── context.js        the per-call facts (date, language)
│   ├── words.js          numbers and dates as spoken words
│   ├── sessions.js       saves sessions as JSON files
│   ├── registry.js       "phone book" of live browser connections
│   ├── tools.js          describes the three tools to the AI
│   ├── toolRoutes.js     answers the AI's tool calls
│   ├── ngrok.js          finds or starts a public address
│   ├── webhook.js        registers the end-of-call webhook
│   ├── webhookRoute.js   receives the end-of-call report
│   ├── signature.js      checks that the report really came from Alebex
│   ├── alebex.js         small helper for the Alebex REST API
│   └── env.js            writes values into the .env file
├── public/               the browser page
│   ├── index.html        the live session page
│   ├── app.js            its JavaScript
│   ├── capture-worklet.js microphone → 16 kHz PCM16 frames
│   ├── sessions.html     the history page
│   └── styles.css        the look
├── prompts/              what the AI is told
│   ├── interpreter.template.md   the prompt, with blanks per language
│   └── lang/             one "language pack" per patient language
└── scripts/              one-off commands
    ├── setup-agents.js   creates or updates the agents (npm run setup)
    ├── setup-webhook.js  registers the webhook for a fixed URL
    └── smoke-call.js     an automated test call (npm run smoke)
```

The server has only **three dependencies**: `express` (the web server), `ws` (WebSockets)
and `dotenv` (reads the `.env` file). Everything else is built into Node.js. A short list
means less to learn and less that can break.

## Check yourself

Try to answer these before you go on:

1. Why does the browser not talk to the engine directly?
2. Which feature lets the AI call your app, and which lets your app tell the AI something?
   (Answer: tools, and live call events.)
3. Why does the engine need a public `https://` address for your server?

Next: [Step 1: project setup](01-setup.md).
