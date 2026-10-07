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
