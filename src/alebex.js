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
