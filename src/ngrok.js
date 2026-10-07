// The public https base the engine needs for tool calls and the end-of-call webhook.
// Order: PUBLIC_BASE_URL when set (manual mode); else an ngrok tunnel already running on this
// machine (read from ngrok's local API); else `ngrok http <port>` is started as a child process
// that is killed when this process exits. Returns the https URL, or null after a clear warning,
// in which case the server runs degraded: no tools, no cards, no webhook; interpreting still works.
import { spawn } from "node:child_process";

const NGROK_API = "http://127.0.0.1:4040/api/tunnels";
const START_TIMEOUT_MS = 15000;
const POLL_MS = 500;

let publicUrl = null;
let child = null;

// The tunnel found at boot; else PUBLIC_BASE_URL; else the Vercel production host. Null when
// nothing public is known (tools and webhook off).
export function getPublicBaseUrl() {
  if (publicUrl) return publicUrl;
  const manual = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (/^https:\/\//.test(manual)) return manual;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}` : null;
}

// The https tunnel pointing at localhost:<port>, from the local ngrok API, or null.
async function existingTunnel(port) {
  try {
    const res = await fetch(NGROK_API, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const { tunnels = [] } = await res.json();
    const addrRe = new RegExp(`:${port}/?$`);
    const hit = tunnels.find((t) => t.proto === "https" && addrRe.test(t.config?.addr ?? ""));
    return hit?.public_url ?? null;
  } catch {
    return null;
  }
}

function stopChild() {
  if (!child) return;
  const c = child;
  child = null;
  try { c.kill(); } catch {}
}

// Spawn ngrok with JSON logs on stdout; its "started tunnel" line carries the public url.
function startNgrok(port, log) {
  let urlFromLog = null;
  child = spawn("ngrok", ["http", String(port), "--log=stdout", "--log-format=json"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const onLine = (line) => {
    let entry;
    try { entry = JSON.parse(line); } catch { return; }
    if (entry.url && /^https:/.test(entry.url) && /started tunnel/i.test(entry.msg ?? "")) urlFromLog = entry.url;
    if (["eror", "error", "crit"].includes(entry.lvl)) log.warn(`[ngrok] ${entry.err ?? entry.msg ?? line}`);
  };
  const drain = (stream) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      lines.forEach(onLine);
    });
  };
  drain(child.stdout);
  drain(child.stderr);
  child.on("error", (err) => { log.warn(`[ngrok] could not start ngrok: ${err.message}`); child = null; });
  child.on("exit", (code) => { if (child) { log.warn(`[ngrok] ngrok exited with code ${code}`); child = null; } });

  process.on("exit", stopChild);
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
    try { process.once(sig, () => { stopChild(); process.exit(0); }); } catch {}
  }
  return () => urlFromLog;
}

export async function ensurePublicUrl(port, log = console) {
  const manual = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (manual) {
    if (/^https:\/\//.test(manual)) {
      publicUrl = manual;
      log.info(`[public-url] using PUBLIC_BASE_URL ${publicUrl}`);
      return publicUrl;
    }
    log.warn(`[public-url] PUBLIC_BASE_URL must be an https URL; ignoring "${manual}"`);
  }

  const running = await existingTunnel(port);
  if (running) {
    publicUrl = running;
    log.info(`[public-url] reusing the running ngrok tunnel ${publicUrl}`);
    return publicUrl;
  }

  log.info(`[public-url] starting ngrok http ${port}`);
  const urlFromLog = startNgrok(port, log);
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (!child) break; // it died or never started
    const url = urlFromLog() ?? (await existingTunnel(port));
    if (url) {
      publicUrl = url;
      log.info(`[public-url] ngrok tunnel ${publicUrl} -> http://localhost:${port}`);
      return publicUrl;
    }
  }
  stopChild();
  log.warn("[public-url] no public URL: ngrok did not come up within 15 s. Check that ngrok is installed and `ngrok config check` passes, or set PUBLIC_BASE_URL. Running degraded: no tools, no cards, no end-of-call webhook; interpreting still works.");
  return null;
}
