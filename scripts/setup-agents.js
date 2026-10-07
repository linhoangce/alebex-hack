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
