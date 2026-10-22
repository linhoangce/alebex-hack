# Step 1: Project setup

**Goal:** create an empty Node.js project with the right settings and your secret keys in
place.

**Files you create:** `package.json`, `.gitignore`, `.env`

## The idea

A Node project is a folder with a `package.json` file. That file says three things: what the
project is called, which libraries it needs, and which commands it offers (`npm start`,
`npm run setup`, and so on).

Secrets such as API keys go in a separate file called `.env`. That file never goes into git.

## Build it

### 1. Check Node and make the folder

```bash
node --version          # must print v20 or higher
mkdir alebex-hack
cd alebex-hack
git init
npm init -y             # creates a starter package.json
mkdir src public prompts prompts/lang scripts api
```

### 2. Write `package.json`

Open `package.json` and replace its contents with this:

```json
{
  "name": "alebex-vi-en-interpreter",
  "version": "0.1.0",
  "private": true,
  "description": "Hospital interpreter voice agent on Alebex Voice: spoken opening, clinical intake and two-way interpreting on one shared device, with language packs (Vietnamese, Mandarin)",
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "start": "node local-server.js",
    "setup": "node scripts/setup-agents.js",
    "setup:webhook": "node scripts/setup-webhook.js",
    "smoke": "node scripts/smoke-call.js"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.21.2",
    "ws": "^8.18.0"
  }
}
```

What each part means:

| Field | What it does |
|---|---|
| `"private": true` | Stops you from publishing this to the npm registry by accident. |
| `"type": "module"` | Lets you use modern `import` / `export` in every `.js` file (explained below). |
| `"engines"` | Documents that Node 20 or newer is needed. |
| `"scripts"` | Short names for commands. `npm start` runs `node local-server.js`, and `npm run setup` runs `node scripts/setup-agents.js`. You write those files in later steps. |
| `"dependencies"` | The three libraries. `^4.21.2` means "version 4.21.2 or any newer 4.x". |

### 3. Install the three libraries

```bash
npm install
```

This reads `dependencies`, downloads the libraries into `node_modules/`, and writes
`package-lock.json`. The lock file records the exact versions installed, so everyone who
runs `npm install` later gets the same ones. Commit the lock file. Never commit
`node_modules/`.

- **express**: a small web server. It lets you write "when someone asks for `/api/config`,
  answer with this JSON".
- **ws**: WebSockets for Node. Your server uses it twice: to accept the browser's connection,
  and to open its own connection to the engine.
- **dotenv**: reads `.env` and puts each `KEY=value` line into `process.env.KEY`.

### 4. Write `.gitignore`

This file lists what git must never save:

```
.env
env.env
node_modules/
data/
.vercel/

.vercel
.env*
.env.local
.env*.local
```

This is the repo's file as it is. The second group repeats some patterns from the first,
which does no harm. `.env*` matches every file whose name starts with `.env`.

- `.env` and `env.env` hold your secrets.
- `node_modules/` can always be re-downloaded.
- `data/` will hold saved sessions and recordings. That is private patient conversation, so
  it stays out of git.
- `.vercel/` is created by the Vercel command-line tool in Step 10.

### 5. Get your Alebex keys

1. Sign in at `https://app.alebex.ai/dev` (the developer console).
2. Under **Voice API key**, press the **.env file** button. It downloads a file (this
   project calls it `env.env`) with your key and the two host addresses.
3. Copy it into your project as `.env`:

```bash
cp ~/Downloads/env.env .env
```

The important lines look like this (your key is different):

```
ALEBEX_API_KEY=wt_xxxxxxxxxxxxxxxxxxxxxxxx
ALEBEX_API_URL=https://api.alebex.ai/api/v1
ALEBEX_ENGINE_URL=https://api.voice.alebex.ai
```

- `ALEBEX_API_URL` is the "settings office" (agents, voices, webhooks).
- `ALEBEX_ENGINE_URL` is where calls happen.

### 6. Make a tool secret

In Step 7, the AI will call your server. Your server needs a way to know that a request
really comes from your AI and not from a stranger. You will use a long random password that
only your server and your AI's tool settings know. Make one now:

```bash
node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
```

Add the printed value to `.env`:

```
TOOL_SECRET=paste-the-48-characters-here
```

Your `.env` will get more lines later. Some you add yourself, and some the scripts write for
you (agent ids in Step 3, the webhook secret in Step 9). The
[cheat sheet](11-cheat-sheet.md#every-setting-in-env) lists them all.

## Three Node ideas you will see everywhere

### `import` and `export` (ES modules)

Because `package.json` says `"type": "module"`, every file can share code like this:

```js
// words.js
export function numberWords(n) { /* ... */ }

// context.js
import { numberWords } from "./words.js";
```

Two rules: write the `.js` ending in the path, and use `export` for anything another file
needs.

### The `node:` prefix

Libraries that ship with Node are imported with `node:` in front, for example
`import fs from "node:fs"` (files) or `import crypto from "node:crypto"` (random numbers,
hashing). The prefix makes it clear that this is built-in and not something from
`node_modules`.

### Finding files next to the current file

A server can be started from any folder. So when a file needs to read
`prompts/interpreter.template.md`, it cannot rely on the current folder. Instead it builds
the path from its own location:

```js
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
```

`import.meta.url` is the address of the current file, such as
`file:///home/you/alebex-hack/src/app.js`. `new URL("../", ...)` goes up one folder.
`fileURLToPath` turns that into a normal path. You will see this pattern in several files.

## Try it

Check that `.env` loads:

```bash
node -r dotenv/config -e "console.log(process.env.ALEBEX_API_KEY?.slice(0, 3))"
```

It should print `wt_`. If it prints `undefined`, `.env` is missing, or it is in the wrong
folder, or the line is spelled differently.

Then save your work:

```bash
git add package.json package-lock.json .gitignore
git commit -m "Project setup"
git status      # .env must NOT be listed
```

## Recap

- `package.json` names the project, its three libraries and its commands.
- `"type": "module"` turns on `import` / `export`.
- Secrets live in `.env`, which `.gitignore` keeps out of git.
- `TOOL_SECRET` is a password you made up. You will use it in Step 7.

Next: [Step 2: the agent's brain](02-agent-brain.md).
