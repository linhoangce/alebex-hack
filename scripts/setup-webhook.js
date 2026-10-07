// Manual mode: register or update the end-of-call webhook for a fixed PUBLIC_BASE_URL without
// starting the server. npm start does the same on every boot (with the ngrok URL it started),
// so this is only for a public URL you manage yourself.
import "dotenv/config";
import { ensureWebhook, WEBHOOK_NAME } from "../src/webhook.js";

const base = (process.env.PUBLIC_BASE_URL ?? "").trim();
if (!/^https:\/\//.test(base)) {
  console.error("Set PUBLIC_BASE_URL (an https URL) in .env first, or just run npm start, which starts ngrok and registers the webhook itself.");
  process.exit(1);
}

ensureWebhook(base)
  .then((r) => console.log(`webhook ${WEBHOOK_NAME} ${r.action}: ${r.url} (id ${r.id}; signing secret ${r.secretStored ? "stored in .env" : "MISSING"})`))
  .catch((err) => {
    console.error(`setup:webhook failed${err.code ? ` (${err.code})` : ""}: ${err.message}`);
    process.exit(1);
  });
