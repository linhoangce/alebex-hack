# Build "An - Your Trusted Interpreter" from scratch

This folder is a course. It walks you through building this whole repository yourself, one
small step at a time. Every step says **what** you build, **why** it is built that way, and
**how to check** that it works before you move on.

You do not need to be an expert. If you know basic JavaScript (variables, functions,
`async`/`await`) and can run commands in a terminal, you can follow along.

## What you are going to build

A voice interpreter for a hospital exam room. A nurse or doctor speaks English. The patient
speaks Vietnamese or Mandarin. One laptop or tablet sits between them. The app listens,
and an AI voice says each sentence again in the other language.

```
   Clinician (English)                         Patient (Vietnamese or Mandarin)
          │  "Where does it hurt?"                        ▲
          ▼                                               │  "Đau ở đâu?"
   ┌───────────────────────────────────────────────────────────┐
   │  Browser page: microphone, speaker, live transcript,       │
   │  "who is in the room" card, intake form, urgent banner     │
   └───────────────────────────┬───────────────────────────────┘
                               │ audio + messages
                     ┌─────────▼──────────┐
                     │  Your Node server  │   keeps the API key secret,
                     │  (this repo)       │   saves every session
                     └─────────┬──────────┘
                               │ audio + messages
                     ┌─────────▼──────────┐
                     │ Alebex Voice Engine│   hears, thinks, speaks
                     └────────────────────┘
```

On top of interpreting, the app also:

- **Opens by voice.** It asks the clinician for their name and role, and asks the patient
  for their name and how they like to be addressed. Nobody types anything.
- **Flags danger.** If the patient says something like "chest pain", a red banner appears
  on screen.
- **Fills an intake form.** When the clinician presses End, the AI writes an English intake
  form from what the patient said, and it appears as a card.
- **Keeps a history.** Past sessions, transcripts, an AI summary and the audio recording
  are on a second page, `sessions.html`.

## The roadmap

Do the steps in order. Each one ends with a checkpoint you can run.

| Step | You build | Main files | Checkpoint |
|---|---|---|---|
| [0. The big picture](00-big-picture.md) | Nothing yet: you learn how the parts talk | none | You can explain the diagram above |
| [1. Project setup](01-setup.md) | An empty Node project, your keys | `package.json`, `.env`, `.gitignore` | `node -e` prints your key's first letters |
| [2. The agent's brain](02-agent-brain.md) | The prompt and the language packs | `prompts/` | Your prompt passes a read-aloud check |
| [3. Talk to the Alebex API](03-alebex-api-and-agents.md) | A script that creates the AI agents | `src/alebex.js`, `src/env.js`, `src/languages.js`, `scripts/setup-agents.js` | `npm run setup` creates agents; you talk to one in the Alebex console |
| [4. The server and the voice bridge](04-server-and-voice-bridge.md) | A web server that connects a browser to the engine | `src/words.js`, `src/context.js`, `src/proxy.js`, `src/app.js`, `local-server.js` | `/api/config` answers; a test script hears the greeting |
| [5. Sound in the browser](05-browser-audio.md) | The page: microphone, speaker, transcript | `public/index.html`, `public/styles.css`, `public/capture-worklet.js`, `public/app.js` | **Your first real conversation** |
| [6. Saving sessions](06-saving-sessions.md) | A small file database and a history page | `src/sessions.js`, `public/sessions.html` | Past sessions show up on `sessions.html` |
| [7. Tools: the AI calls your server](07-tools.md) | A public URL, three tools, live cards on screen | `src/ngrok.js`, `src/tools.js`, `src/registry.js`, `src/toolRoutes.js` | A `curl` makes a card appear; the agent fills the "In the room" card |
| [8. Ending a visit](08-ending-a-visit.md) | The End button flow that fills the intake form | `src/proxy.js`, `public/app.js` | Pressing End shows the intake card, then the call closes |
| [9. The end-of-call report](09-end-of-call-webhook.md) | A signed webhook: summary and recording | `src/signature.js`, `src/webhook.js`, `src/webhookRoute.js` | A signed test report is accepted, a forged one is rejected |
| [10. Testing and deploying](10-testing-and-deploying.md) | An automated smoke test, Vercel hosting, an admin clean-up route | `scripts/smoke-call.js`, `api/index.js`, `vercel.json` | `npm run smoke` passes; the app runs on a public URL |
| [Cheat sheet](11-cheat-sheet.md) | Message list, settings list, troubleshooting, practice ideas | none | |
| [Glossary appendix](appendix-glossaries.md) | The two medical glossaries in full, for Step 2 | `prompts/lang/*.glossary.md` | |

## How each step is laid out

Every step has the same parts:

1. **Goal.** One sentence.
2. **The idea.** The concept in plain words, with a diagram when it helps.
3. **Build it.** The code, file by file, with an explanation of every part.
4. **Try it.** A checkpoint you run to see it work.
5. **Why it is written this way.** The tricky choices, so you understand them, not just copy them.

Some files grow over several steps. `src/proxy.js`, for example, starts small in Step 4 and
gets more features in Steps 6, 7 and 8. When a step changes a file you already have, it
shows only what to add and says exactly where. By the end of Step 10, every file matches the
one in this repository.

The code in this course was tested in stages. Each in-between version of the server and
the page was run against a fake voice engine (you can build one too, see the
[cheat sheet](11-cheat-sheet.md#practice-without-paying-a-fake-engine)) and in a real browser.

## Before you start

You need:

- **Node.js 20 or newer.** Check with `node --version`. The code uses built-in `fetch`,
  `AbortSignal.timeout` and top-level `await`, which older versions lack.
- **Chrome or Edge.** The page uses an `AudioWorklet`, a modern browser audio feature.
- **Headphones** (recommended). They stop the AI from hearing its own voice. The app has a
  workaround for speakers too, explained in Step 5.
- **An Alebex account with developer access** (`https://app.alebex.ai/dev`). You get an
  API key there. Calls are billed for the minutes they run, so every test call costs a
  little.
- **A free ngrok account** (Step 7). It gives your laptop a public web address.
- **A Vercel account** (optional, Step 10). For hosting the app online.

Two reference documents ship in this repo. You do not need to read them first, but the
course points to them often:

- [`AGENTS.md`](../AGENTS.md): the Alebex Voice API contract. Every message type and
  endpoint the code uses is described there.
- [`alebex-voice-prompting-best-practices.md`](../alebex-voice-prompting-best-practices.md):
  how to write prompts for a voice agent.

## Tips for learning

- **Type the code, do not paste it.** Typing makes you read every line.
- **Run every checkpoint.** If a checkpoint fails, fix it before moving on. Later steps
  build on earlier ones.
- **Commit after each step** with `git commit`. Then you can always go back.
- **Read the server log.** Every important thing the server does prints one line that
  starts with a tag like `[session ...]`, `[tools]` or `[webhook]`. The log is how you see
  what is happening.

Start with [Step 0: the big picture](00-big-picture.md).
