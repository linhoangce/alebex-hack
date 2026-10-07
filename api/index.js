// Vercel entry point: one function serves the HTTP routes and the /ws/session WebSocket proxy
// (Vercel's WebSocket beta: export an http.Server with a ws server attached). No ngrok and no
// webhook registration here: PUBLIC_BASE_URL (or the project's production URL) is the public
// base, and the webhook is registered once from a developer machine. Static files in public/
// are served by Vercel's CDN. Sessions live on the function's temp disk.
import "dotenv/config";
import http from "node:http";
import { createApp, attachWebSockets, logStartupChecks } from "../src/app.js";

logStartupChecks(console);
const { app, glossaries } = createApp({
  log: console,
  webhookRegistered: Boolean(process.env.ALEBEX_WEBHOOK_SECRET),
  serveStatic: false,
});
const server = http.createServer(app);
attachWebSockets(server, { glossaries, log: console });

export default server;
