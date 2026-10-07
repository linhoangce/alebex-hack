// Local entry point (npm start): public https URL (PUBLIC_BASE_URL or ngrok) -> webhook
// registration -> HTTP + WebSocket server. The Vercel entry point is api/index.js.
import "dotenv/config";
import http from "node:http";
import { createApp, attachWebSockets, logStartupChecks } from "./src/app.js";
import { ensurePublicUrl } from "./src/ngrok.js";
import { ensureWebhook, WEBHOOK_NAME } from "./src/webhook.js";
import { toolsAvailable } from "./src/tools.js";

const PORT = Number(process.env.PORT || 3000);
logStartupChecks(console);

const publicUrl = await ensurePublicUrl(PORT, console);
let webhook = null;
if (publicUrl) {
  try {
    webhook = await ensureWebhook(publicUrl);
    console.log(`[server] webhook ${WEBHOOK_NAME} registered (${webhook.action}) -> ${webhook.url}${webhook.secretStored ? "" : " (no signing secret stored: reports will be rejected)"}`);
  } catch (err) {
    console.warn(`[server] webhook registration failed${err.code ? ` (${err.code})` : ""}: ${err.message}. End-of-call summaries and recordings are off; tools still work.`);
  }
}
console.log(toolsAvailable()
  ? `[server] tools on: the engine will POST to ${publicUrl}/voice-tools/*`
  : "[server] tools off (no public URL or no TOOL_SECRET): sessions run without cards, flags or summaries");

const { app, glossaries } = createApp({ log: console, webhookRegistered: Boolean(webhook) });
const server = http.createServer(app);
attachWebSockets(server, { glossaries, log: console });
server.listen(PORT, () => console.log(`Interpreter server listening on http://localhost:${PORT}`));
