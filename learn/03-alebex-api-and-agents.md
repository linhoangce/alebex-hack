# Step 3: Talk to the Alebex API

**Goal:** write a script that turns your prompt files into real AI agents at Alebex, one per
language, and saves their ids in `.env`.

**Files you create:** `src/alebex.js`, `src/env.js`, `src/languages.js`,
`scripts/setup-agents.js`

## The idea

The Alebex API is the "settings office". You send it normal web requests (REST), each with
your key in an `Authorization` header:

| Request | Does |
|---|---|
| `GET /public/agents` | List your agents (a page at a time) |
| `POST /public/agents` | Create an agent |
| `PATCH /public/agents/{id}` | Change some fields of an agent |
| `GET /public/agents/{id}` | Read one agent with every setting |
| `GET /public/voices` | List the voices you can use |

The setup script is **idempotent**: running it twice gives the same result as running it
once. It finds each agent **by name**. If the agent exists, the script updates it. If not,
the script creates it. So whenever you change the prompt, you just run `npm run setup`
again.

```
 npm run setup
      │
      ▼
 for each enabled language (vi, zh):
      │ 1. build the prompt: template + language pack
      │ 2. find the voices by name (English + patient's language)
      │ 3. is there an agent called "Vietnamese English hospital interpreter"?
      │        yes ──► PATCH it        no ──► POST a new one
      │ 4. write its id into .env  (ALEBEX_AGENT_ID_VI=...)
      ▼
 done: the server (Step 4) reads the ids from .env
```

## Build it

### `src/alebex.js`: a tiny API helper

Every request to Alebex needs the same headers and the same error handling. Write that once:

```js
// REST helper for the Alebex API host (agents, voices, tools, webhooks).
// Pattern from AGENTS.md "Example: Node"; errors carry the API's error.code.

export class AlebexError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = "AlebexError";
    this.code = code;
    this.status = status;
  }
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.ALEBEX_API_KEY}`,
    "Content-Type": "application/json",
  };
}

export async function alebex(method, path, body) {
  const API = process.env.ALEBEX_API_URL;
  if (!API || !process.env.ALEBEX_API_KEY) {
    throw new Error("ALEBEX_API_URL and ALEBEX_API_KEY must be set in .env");
  }
  const res = await fetch(`${API}${path}`, { method, headers: headers(), body: body && JSON.stringify(body) });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json.error ?? {};
    throw new AlebexError(err.message ?? `${res.status} ${res.statusText}`, err.code ?? "UNKNOWN", res.status);
  }
  return json;
}

// Every agent summary, following nextCursor.
export async function listAgents() {
  const items = [];
  let cursor = null;
  do {
    const page = await alebex("GET", "/public/agents?limit=100" + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""));
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

export async function findAgentByName(name) {
  const agents = await listAgents();
  return agents.find((a) => a.name === name) ?? null;
}

let voiceCache = null;
export async function listVoices() {
  if (!voiceCache) voiceCache = await alebex("GET", "/public/voices");
  return voiceCache;
}

// "Natalie" matches by name; "Justin:zh" also requires the catalog language (some names exist in
// en and zh). With a plain name, `preferLang` picks that catalog language when several match.
export async function findVoiceByName(name, preferLang) {
  const voices = await listVoices();
  const [rawName, lang] = String(name).split(":");
  const wanted = rawName.trim().toLowerCase();
  const wantedLang = (lang ?? "").trim().toLowerCase();
  const matches = voices.filter((v) => v.name.trim().toLowerCase() === wanted && (!wantedLang || v.language === wantedLang));
  return (preferLang && matches.find((v) => v.language === preferLang)) ?? matches[0] ?? null;
}
```

Part by part:

- **`AlebexError`** is an `Error` with two extra fields: `code` (such as
  `VALIDATION_FAILED`) and `status` (such as `400`). Code that calls the helper can then react
  to a specific problem, which the setup script does below.
- **`alebex(method, path, body)`** is the one function that talks to the API. It uses
  `fetch`, which is built into Node 20.
  - `body && JSON.stringify(body)`: send a JSON body only when there is one.
  - `204` means "done, nothing to send back", so there is no JSON to read.
  - `res.json().catch(() => ({}))`: if the answer is not JSON, carry on with an empty object
    instead of crashing.
  - `!res.ok` means a status of 400 or more. The API puts details in `error.message` and
    `error.code`.
- **`listAgents`** follows **pagination**. The API returns at most 100 agents per page, plus
  a `nextCursor` that says "ask again with this to get the next page". The `do ... while`
  loop keeps asking until there is no cursor left.
- **`listVoices`** keeps the answer in `voiceCache`, because the voice list rarely changes.
- **`findVoiceByName`** lets you write `"Natalie"` or `"Justin:zh"`. Some names exist in
  more than one language, and the `:zh` part picks the right one.

### `src/env.js`: write a value into `.env`

The setup script must save the new agent ids. This helper changes one `KEY=value` line in
`.env`, or adds it if it is missing:

```js
// Read-modify-write of one KEY=value line in .env, shared by the setup scripts and the server
// (the webhook signing secret is shown once, at boot, and must be stored then).
// Also sets process.env so the running process sees the value at once.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const ENV_PATH = fileURLToPath(new URL("../.env", import.meta.url));

// Replace the KEY= line if present, append otherwise. The replacer is a function so a value
// containing "$" is written literally.
export function setEnv(key, value) {
  process.env[key] = String(value);
  const line = `${key}=${value}`;
  try {
    let text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
    const re = new RegExp(`^${key}=.*$`, "m");
    text = re.test(text) ? text.replace(re, () => line) : `${text.replace(/\n*$/, "\n")}${line}\n`;
    fs.writeFileSync(ENV_PATH, text, "utf8");
  } catch (err) {
    console.warn(`[env] could not write ${key} to .env (${err.code ?? err.message}); set it in the host environment`);
  }
}
```

- `process.env[key] = ...` first, so code running in the same process sees the new value
  straight away.
- The regular expression `^KEY=.*$` with the `m` (multi-line) flag matches one whole line
  that starts with `KEY=`.
- `text.replace(re, () => line)` passes a **function** instead of a string. With a string,
  JavaScript treats `$&` and `$1` inside the value as special patterns. A secret can contain
  `$`, and the function form writes it exactly as it is.
- `text.replace(/\n*$/, "\n")` makes sure the file ends with exactly one newline before a new
  line is added.
- On Vercel (Step 10) the disk is read-only, so writing fails. The `catch` turns that into a
  warning instead of a crash.

### `src/languages.js`: the list of languages

One place that knows every patient language, and where its files and settings live:

```js
// The language registry: one entry per patient language the interpreter can be set up for.
// A language pack is three files under prompts/lang/:
//   <code>.address.md   the "forms of address" section spliced into prompts/interpreter.template.md
//   <code>.first.txt    the agent's first message (bilingual, ending with the English question)
//   <code>.glossary.md  the knowledge base sent with every call in that language
// `tag` is the Alebex voice language tag (AGENTS.md "Manage agents"); `agentEnv` holds the agent id
// written by npm run setup; `voiceEnv` names the catalog voice for the patient's language.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LANG_DIR = fileURLToPath(new URL("../prompts/lang/", import.meta.url));
const PACK_FILES = ["address.md", "first.txt", "glossary.md"];

const REGISTRY = [
  { code: "vi", name: "Vietnamese", tag: "vi", agentEnv: "ALEBEX_AGENT_ID_VI", voiceEnv: "ALEBEX_VI_VOICE_NAME", defaultVoice: "Wayne" },
  { code: "zh", name: "Mandarin", tag: "zh", agentEnv: "ALEBEX_AGENT_ID_ZH", voiceEnv: "ALEBEX_ZH_VOICE_NAME", defaultVoice: "Shan Shan" },
  // Cantonese is experimental and off by default: the API has no Cantonese tag (zh is the only
  // Chinese one) and no catalog voice is described as Cantonese, so a speaker has to be found by
  // listening to the zh voices (their sampleUrl in GET /public/voices). It switches on only when
  // ALEBEX_YUE_VOICE_NAME names a voice and prompts/lang/yue.address.md, yue.first.txt and
  // yue.glossary.md exist.
  { code: "yue", name: "Cantonese", tag: "zh", agentEnv: "ALEBEX_AGENT_ID_YUE", voiceEnv: "ALEBEX_YUE_VOICE_NAME", defaultVoice: "", experimental: true },
];

export const packPath = (code, file) => path.join(LANG_DIR, `${code}.${file}`);
const packExists = (code) => PACK_FILES.every((f) => fs.existsSync(packPath(code, f)));

export function isEnabled(lang) {
  if (lang.experimental && !process.env[lang.voiceEnv]) return false;
  return packExists(lang.code);
}

export const allLanguages = () => REGISTRY.slice();
export const enabledLanguages = () => REGISTRY.filter(isEnabled);
export const getLanguage = (code) => enabledLanguages().find((l) => l.code === code) ?? null;
export const voiceNameFor = (lang) => process.env[lang.voiceEnv] || lang.defaultVoice;
export const agentIdFor = (lang) => process.env[lang.agentEnv] || "";

export function readPack(code, file) {
  return fs.readFileSync(packPath(code, file), "utf8").replace(/\r\n/g, "\n").trim();
}

// { vi: "<glossary text>", zh: "..." } for every enabled language, read once at boot.
export function loadGlossaries() {
  return Object.fromEntries(enabledLanguages().map((l) => [l.code, readPack(l.code, "glossary.md")]));
}
```

- **`REGISTRY`** is a plain array, one object per language:
  - `code`: a short id used in file names and messages (`vi`).
  - `name`: the English name, which fills `__LANGUAGE__` in the prompt.
  - `tag`: the language tag Alebex uses for voices. Cantonese has to use `zh`, because the
    API has no Cantonese tag.
  - `agentEnv`: the name of the `.env` line that stores this language's agent id.
  - `voiceEnv` and `defaultVoice`: which voice to use, which you can change in `.env`.
- **A language is "enabled"** only when all three pack files exist. Adding a language later
  means adding one registry line and three files. Cantonese also needs a voice name, because
  nobody has picked a Cantonese-sounding voice yet.
- **`agentIdFor` reads `process.env` each time it is called**, not once at start-up. Values
  that `setEnv` writes are then seen straight away.
- **`readPack`** turns Windows line endings (`\r\n`) into `\n` and trims spaces at the ends,
  so a file saved on Windows gives the same prompt as one saved on a Mac.

### `scripts/setup-agents.js`: create or update the agents

```js
// Idempotent create-or-PATCH of one Alebex agent per enabled language, matched by name
// ("<Language> English hospital interpreter"). Re-run after every prompt or pack edit.
// Each prompt is prompts/interpreter.template.md with __LANGUAGE__ and __FORMS_OF_ADDRESS__ filled
// from the language pack (src/languages.js); the script fails loudly if any __TOKEN__ is left.
// Writes ALEBEX_AGENT_ID_<CODE> into .env.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { alebex, findAgentByName, findVoiceByName, listVoices, AlebexError } from "../src/alebex.js";
import { setEnv } from "../src/env.js";
import { allLanguages, enabledLanguages, voiceNameFor, readPack } from "../src/languages.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEMPLATE_PATH = path.join(ROOT, "prompts", "interpreter.template.md");
const EN_NAME = process.env.ALEBEX_EN_VOICE_NAME || "Natalie";
const TOKEN_RE = /__[A-Z_]+__/g;

export const agentNameFor = (lang) => `${lang.name} English hospital interpreter`;

function buildPrompt(lang) {
  const template = fs.readFileSync(TEMPLATE_PATH, "utf8").replace(/\r\n/g, "\n").trim();
  const prompt = template
    .replaceAll("__FORMS_OF_ADDRESS__", readPack(lang.code, "address.md"))
    .replaceAll("__LANGUAGE__", lang.name);
  const left = [...new Set(prompt.match(TOKEN_RE) ?? [])];
  if (left.length) throw new Error(`the ${lang.name} prompt still contains ${left.join(", ")}; fill them in the template or the pack`);
  return prompt;
}

async function voiceByName(name, preferLang) {
  const v = await findVoiceByName(name, preferLang);
  if (v) return v;
  const names = (await listVoices()).map((x) => `${x.name} (${x.language}${x.premium ? ", premium" : ""})`).join(", ");
  throw new Error(`Voice "${name}" is not in GET /public/voices. Available: ${names}`);
}

// Create by name, or PATCH the existing agent with every field except name.
async function upsert(config) {
  const existing = await findAgentByName(config.name);
  if (existing) {
    const { name, ...fields } = config;
    const agent = await alebex("PATCH", `/public/agents/${existing.id}`, fields);
    console.log(`PATCH "${name}" -> ${agent.id}`);
    return agent;
  }
  const agent = await alebex("POST", "/public/agents", config);
  console.log(`POST  "${config.name}" -> ${agent.id}`);
  return agent;
}

// If the API refuses the second voice entry (the patient-language tag), say so and retry with one en voice.
async function upsertWithVoiceFallback(config) {
  try {
    return await upsert(config);
  } catch (err) {
    const aboutSecondVoice = err instanceof AlebexError && err.code === "VALIDATION_FAILED" && /voices\[1\]/.test(err.message);
    if (!aboutSecondVoice || config.voices.length < 2) throw err;
    console.warn(`VALIDATION_FAILED on the second voice entry. API message: ${err.message}`);
    console.warn("Falling back to a single en voice; the engine's per-language voice marking is therefore unavailable.");
    return upsert({ ...config, voices: [config.voices[0]] });
  }
}

function printStored(agent) {
  const { id, name, brainTier, temperature, maxTokens, voices, behaviour, opening, toolIds, firstMessage, prompt } = agent;
  console.log(JSON.stringify({ id, name, brainTier, temperature, maxTokens, voices, behaviour, opening, toolIds, firstMessageChars: (firstMessage ?? "").length, promptChars: (prompt ?? "").length }, null, 2));
}

async function main() {
  const langs = enabledLanguages();
  if (!langs.length) throw new Error("no language pack is enabled: add prompts/lang/<code>.address.md, .first.txt and .glossary.md");
  const en = await voiceByName(EN_NAME, "en");
  console.log(`EN voice: ${en.name} (${en.language}) ${en.voiceId}`);

  for (const lang of langs) {
    const voiceName = voiceNameFor(lang);
    const voice = await voiceByName(voiceName, lang.tag);
    const note = voice.language === lang.tag ? "" : ` (not a ${lang.tag} catalog voice: ${lang.name} is synthesized through the multilingual TTS)`;
    console.log(`\n${lang.name} voice: ${voice.name} (catalog language ${voice.language}) ${voice.voiceId}${note}`);
    const agent = await upsertWithVoiceFallback({
      name: agentNameFor(lang),
      prompt: buildPrompt(lang),
      firstMessage: readPack(lang.code, "first.txt"),
      brainTier: "premium",
      temperature: 0.2,
      maxTokens: 1500,
      voices: [
        { voiceId: en.voiceId, language: "en" },
        { voiceId: voice.voiceId, language: lang.tag },
      ],
      // callEvents on: the End button raises the visit.ending live event (src/proxy.js); events are off by default.
      behaviour: { turnEnd: "conservative", allowEndCall: false, idlePrompt: false, callEvents: true, backgroundVolume: 0, callLimitMinutes: null },
      opening: { speaksFirst: true, strictFirstMessage: true, callerFirstWaitMs: 2500 },
      toolIds: [], // tools ride on each call's start_call frame (src/tools.js), not on the agent
    });
    setEnv(lang.agentEnv, agent.id);
    console.log(`Stored ${lang.name} agent (${lang.agentEnv}=${agent.id}):`);
    printStored(await alebex("GET", `/public/agents/${agent.id}`));
  }

  for (const lang of allLanguages().filter((l) => !langs.includes(l))) {
    const how = lang.experimental
      ? `set ${lang.voiceEnv} in .env and add prompts/lang/${lang.code}.address.md, .first.txt and .glossary.md`
      : `add prompts/lang/${lang.code}.address.md, .first.txt and .glossary.md`;
    console.log(`\n${lang.name} (${lang.code}) is off; to enable it, ${how}, then re-run npm run setup.`);
  }
  console.log("\nAgent ids written to .env");
}

main().catch((err) => {
  console.error(`setup failed${err.code ? ` (${err.code})` : ""}: ${err.message}`);
  process.exit(1);
});
```

How it works, from top to bottom:

- **`import "dotenv/config"`** must come first. It loads `.env` into `process.env` before
  any other code reads it.
- **`buildPrompt`** fills both blanks, then searches for any `__SOMETHING__` still left. If
  it finds one, it stops with a clear error instead of uploading a broken prompt. `new Set`
  removes duplicates from the list.
- **`voiceByName`** fails with a useful message: it lists every voice you *can* use.
- **`upsert`** ("update or insert") is the idempotent part.
  `const { name, ...fields } = config` splits off `name`, because a PATCH sends only the
  fields that change.
- **`upsertWithVoiceFallback`**: if the API refuses the second voice (the one for the
  patient's language), it tries again with only the English voice and warns you. The agent
  still works, just without a voice made for that language.
- **`printStored`** reads the agent back and prints the settings Alebex actually saved.
  Trust what the server stored, not what you think you sent.
- **`main().catch(...)`** prints one clean line on failure and exits with code `1`, so other
  tools can tell that the script failed.

#### Why these agent settings?

| Setting | Value | Why |
|---|---|---|
| `brainTier` | `"premium"` | The stronger model. Interpreting medical speech is hard. |
| `temperature` | `0.2` | Low means less randomness. An interpreter should be faithful, not creative. (The default is 0.7.) |
| `maxTokens` | `1500` | Room for a long interpretation when someone speaks for a while. |
| `voices` | English + patient's language | One voice per language. The engine marks each reply's language and picks the matching voice. You will see that mark as `[LANG:vi]` in transcripts in Step 5. |
| `behaviour.turnEnd` | `"conservative"` | Wait longer before replying. Patients pause to think, and a fast setting would cut them off. |
| `behaviour.allowEndCall` | `false` | The AI must never hang up a medical visit by itself. Only the End button ends it. |
| `behaviour.idlePrompt` | `false` | The idle nudge is in English, which is wrong for a Vietnamese speaker. |
| `behaviour.callEvents` | `true` | Needed for the `visit.ending` event in Step 8. Events are off by default. |
| `behaviour.backgroundVolume` | `0` | No fake office noise in a hospital room. |
| `behaviour.callLimitMinutes` | `null` | No time limit set on the agent. |
| `opening.speaksFirst` | `true` | The agent starts with its first message. (`strictFirstMessage` and `callerFirstWaitMs` only matter when this is `false`.) |
| `toolIds` | `[]` | No tools stored on the agent. Each call brings its own tools (Step 7), because every tool's address carries that call's session id. |

## Try it

```bash
npm run setup
```

You should see something like this:

```
EN voice: Natalie (en) 7c1...
Vietnamese voice: Wayne (catalog language ...) 9a3...
POST  "Vietnamese English hospital interpreter" -> 64f...
Stored Vietnamese agent (ALEBEX_AGENT_ID_VI=64f...):
{ "id": "64f...", "name": "Vietnamese English hospital interpreter", "brainTier": "premium", ... }
...
Agent ids written to .env
```

Then:

1. **Look in `.env`.** It now has `ALEBEX_AGENT_ID_VI=...` and `ALEBEX_AGENT_ID_ZH=...`.
2. **Run `npm run setup` again.** This time each line says `PATCH` instead of `POST`. That
   is idempotency at work.
3. **Talk to your agent.** In the developer console, open the Voice Agents page, find
   "Vietnamese English hospital interpreter" and start a test call. You will hear the first
   message. This test call does not send the glossary, the context or any tools, so the
   agent cannot fill cards yet, but it can already interpret.

Want to see every voice? This prints them as a table:

```bash
node -r dotenv/config --input-type=module -e "import { listVoices } from './src/alebex.js'; console.table((await listVoices()).map((v) => ({ name: v.name, language: v.language })))"
```

To try another voice, set `ALEBEX_VI_VOICE_NAME=...` in `.env` and run setup again.

## Why it is written this way

- **Match by name, not by id.** The first run has no id yet, and the name is stable. That
  makes the script safe to run any number of times.
- **One agent per language.** Each agent needs its own voices, first message and filled-in
  prompt. The server picks the right agent from the language the clinician chooses.
- **Fail loudly, early.** A leftover `__TOKEN__` or a misspelled voice name stops the script
  with a message that says how to fix it. A broken prompt would otherwise reach a patient.

## Recap

- `src/alebex.js` sends authorised requests and turns API errors into `AlebexError`.
- `src/env.js` saves values into `.env`.
- `src/languages.js` is the list of languages and their files.
- `npm run setup` builds each prompt and creates or updates one agent per language.

Next: [Step 4: the server and the voice bridge](04-server-and-voice-bridge.md).
