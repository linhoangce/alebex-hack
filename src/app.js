// Builds the Express app and the WebSocket upgrade handler. Shared by local-server.js (which
// also starts ngrok, registers the webhook and listens) and api/index.js (Vercel: exports the
// http.Server, no boot steps, static files served by Vercel's CDN).
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { handleBrowserSocket } from "./proxy.js";
import { listSessions, getSession, RECORDINGS_DIR } from "./sessions.js";
import { enabledLanguages, agentIdFor, loadGlossaries } from "./languages.js";
import { getPublicBaseUrl } from "./ngrok.js";
import { toolsAvailable } from "./tools.js";
import { toolRouter } from "./toolRoutes.js";
import { webhookRouter } from "./webhookRoute.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
// /ws/session is the real path; the other two are what a Vercel rewrite or a direct call may use.
const WS_PATHS = new Set(["/ws/session", "/api/index", "/api/ws"]);

export function logStartupChecks(log = console) {
  for (const key of ["ALEBEX_API_KEY", "ALEBEX_API_URL", "ALEBEX_ENGINE_URL", "TOOL_SECRET"]) {
    if (!process.env[key]) log.warn(`[server] ${key} is not set`);
  }
  const languages = enabledLanguages();
  if (!languages.length) log.warn("[server] no language pack found under prompts/lang; sessions cannot start");
  for (const lang of languages) {
    if (!agentIdFor(lang)) log.warn(`[server] ${lang.agentEnv} is not set; run npm run setup (${lang.name} sessions will not start)`);
  }
  return languages;
}

export function createApp({ log = console, webhookRegistered = false, serveStatic = true } = {}) {
  const languages = enabledLanguages();
  const glossaries = loadGlossaries();
  log.info(`[server] languages: ${languages.map((l) => `${l.name} (${l.code}, glossary ${glossaries[l.code].length} chars)`).join(", ") || "none"}`);

  const app = express();
  app.disable("x-powered-by");
  if (serveStatic) app.use(express.static(path.join(ROOT, "public")));
  app.use("/recordings", express.static(RECORDINGS_DIR));
  app.use("/voice-tools", toolRouter({ log }));  // its own express.json
  app.use("/alebex", webhookRouter({ log }));     // express.raw on /alebex/end-of-call; no JSON parser before it

  app.get("/api/config", (req, res) => res.json({
    languages: languages.map(({ code, name }) => ({ code, name })),
    toolsEnabled: toolsAvailable(),
    publicUrl: getPublicBaseUrl(),
    webhookRegistered,
    wsPath: process.env.WS_PATH || "/ws/session",
    maxSessionSeconds: Number(process.env.MAX_SESSION_SECONDS) || null,
    hosted: Boolean(process.env.VERCEL),
  }));
  app.get("/api/sessions", (req, res) => res.json(listSessions()));
  app.get("/api/sessions/:id", (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session not found" });
    res.json(session);
  });
  return { app, glossaries, languages };
}

export function attachWebSockets(server, { glossaries, log = console }) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (!WS_PATHS.has(pathname)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => handleBrowserSocket(ws, { glossaries, log }));
  });
  return wss;
}
