# Hospital interpreter on Alebex Voice

Live demo: https://alebex-hack.vercel.app

A voice interpreter that sits between an English-speaking nurse or doctor and a patient who
speaks Vietnamese or Mandarin, on one shared device in the exam room. Built on the
[Alebex Voice API](https://app.alebex.ai/dev) for a hackathon.

## What it does

- Opens by voice: asks the clinician their name and role in English, then asks the patient
  their name and preferred form of address in their own language. No forms.
- Interprets both ways, first person, nothing added or left out. The clinician leads the
  visit; the agent never asks its own questions.
- Flags red-flag symptoms (chest pain, trouble breathing, bleeding, self-harm, anaphylaxis,
  stroke signs) with an on-screen banner while still interpreting them in full.
- Fills the intake form from the conversation when the clinician presses End, and shows it as
  a card in English. Past sessions, transcripts and the Alebex summary are on `sessions.html`.
- Language packs: Vietnamese and Mandarin today; a pack is a prompt section, a first message
  and a bilingual medical glossary under `prompts/lang/`.

## How it is built

- `api/index.js` (Vercel) and `local-server.js` (local) share `src/app.js`: an Express app plus
  a WebSocket proxy that streams the browser microphone to Alebex and the agent's voice back.
  The Alebex API key never reaches the browser.
- The agent's tools (`record_session_details`, `record_intake`, `flag_urgent_symptom`) POST
  to this server, which pushes cards to the clinician's screen over the same socket.
- `scripts/setup-agents.js` builds one Alebex agent per language from
  `prompts/interpreter.template.md` and the language pack.

## Run locally

```
npm install
cp env.env .env          # Alebex keys from the developer console; see the variable list in .env
npm run setup            # creates or updates the agents, writes their ids to .env
npm start                # starts ngrok, registers the end-of-call webhook, serves http://localhost:3000
```

## Deploy

`vercel deploy --prod` with the same variables set in the Vercel project. Hosted sessions use
Vercel's WebSocket beta and end at the function duration limit (five minutes on Hobby).
