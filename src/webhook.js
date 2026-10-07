// The end-of-call webhook endpoint, created or brought up to date on every boot
// (AGENTS.md "Manage webhooks"). The signing secret is shown once, on the response that creates
// it, and is stored in .env as ALEBEX_WEBHOOK_SECRET; if the endpoint exists but the secret is
// gone, it is rotated and the new one stored.
import { alebex } from "./alebex.js";
import { setEnv } from "./env.js";

export const WEBHOOK_NAME = "interpreter-end-of-call";
export const WEBHOOK_PATH = "/alebex/end-of-call";
export const WEBHOOK_FIELDS = ["agentId", "agentName", "callType", "startedAt", "endedAt", "durationSeconds", "endedReason", "transcript", "messages", "summary", "recordingUrl", "toolCalls", "events"];

// The API lists `id` with the fields; compare the rest as a set.
function sameFields(have) {
  const set = new Set((have ?? []).filter((f) => f !== "id"));
  return set.size === WEBHOOK_FIELDS.length && WEBHOOK_FIELDS.every((f) => set.has(f));
}

function storeSecret(secret) {
  if (typeof secret === "string" && secret) setEnv("ALEBEX_WEBHOOK_SECRET", secret);
}

// Returns { id, url, action: "created" | "patched" | "unchanged", secretStored }.
export async function ensureWebhook(baseUrl) {
  const url = `${String(baseUrl).replace(/\/+$/, "")}${WEBHOOK_PATH}`;
  const { items = [] } = await alebex("GET", "/public/webhooks");
  let hook = items.find((w) => w.name === WEBHOOK_NAME) ?? null;
  let action = "unchanged";

  if (!hook) {
    hook = await alebex("POST", "/public/webhooks", { name: WEBHOOK_NAME, url, agentIds: "all", fields: WEBHOOK_FIELDS, signing: true });
    storeSecret(hook.signingSecret);
    action = "created";
  } else {
    const patch = {};
    if (hook.url !== url) patch.url = url;
    if (hook.active === false) patch.active = true;
    if (hook.agentIds !== "all") patch.agentIds = "all";
    if (!sameFields(hook.fields)) patch.fields = WEBHOOK_FIELDS;
    if (!hook.signing) patch.signing = true;
    if (Object.keys(patch).length) {
      const updated = await alebex("PATCH", `/public/webhooks/${hook.id}`, patch);
      storeSecret(updated.signingSecret); // present only when this edit turned signing on for the first time
      hook = { ...hook, ...updated };
      action = "patched";
    }
    if (!process.env.ALEBEX_WEBHOOK_SECRET) {
      const rotated = await alebex("POST", `/public/webhooks/${hook.id}/rotate-secret`);
      storeSecret(rotated.signingSecret);
    }
  }
  return { id: hook.id, url, action, secretStored: Boolean(process.env.ALEBEX_WEBHOOK_SECRET) };
}
