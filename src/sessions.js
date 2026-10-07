// JSON file store: one file per session under data/sessions/<id>.json.
// Small synchronous writes; fine for a hackathon on one machine.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";

// data/ in the repo locally. On Vercel the bundle is read-only, so the function's temp disk
// (ephemeral, per instance) holds sessions for the life of the instance.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : process.env.VERCEL ? path.join(os.tmpdir(), "alebex-data") : fileURLToPath(new URL("../data/", import.meta.url));
export const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
export const RECORDINGS_DIR = path.join(DATA_DIR, "recordings");
fs.mkdirSync(SESSIONS_DIR, { recursive: true });
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const fileFor = (id) => path.join(SESSIONS_DIR, `${id}.json`);
const safeId = (id) => /^[A-Za-z0-9_-]+$/.test(String(id));

function newId(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${stamp}-${crypto.randomBytes(2).toString("hex")}`;
}

function write(session) {
  fs.writeFileSync(fileFor(session.id), JSON.stringify(session, null, 2), "utf8");
  return session;
}

export function createSession(fields = {}) {
  const now = new Date();
  const intake = Boolean(fields.intake);
  return write({
    id: newId(now),
    language: fields.language ?? "",            // registry code: vi, zh
    intake,                                      // true: the intake form is filled at the end of the visit; false: not needed
    mode: intake ? "intake form" : "no intake form",
    createdAt: now.toISOString(),
    endedAt: null,
    endedReason: null,
    callId: null,
    context: fields.context ?? "",
    details: null,        // record_session_details: clinician_name, clinician_role, patient_name, preferred_address
    intakeRecord: null,   // record_intake: the English intake answers
    urgentFlags: [],      // flag_urgent_symptom, one entry per distinct flag
    messages: [],         // normalized {role, text, at, type} from transcript / conversation_message frames
    frames: [],           // the raw transcript / conversation_message frames, kept for inspection
    summary: null,        // from the end-of-call webhook
    durationSeconds: null,
    toolCalls: [],
    report: null,
    recordingPath: null,
  });
}

export function getSession(id) {
  if (!safeId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), "utf8"));
  } catch {
    return null;
  }
}

export function updateSession(id, patch) {
  const s = getSession(id);
  if (!s) return null;
  return write({ ...s, ...patch });
}

// The engine marks the language of some agent lines with a "[LANG:vi] " prefix in transcript text
// (speech is unaffected). It is stripped wherever text is stored or shown.
export const LANG_MARK_RE = /^\[LANG:[a-z]+\]\s*/i;
export const stripLangMark = (text) => String(text ?? "").replace(LANG_MARK_RE, "");

// Normalize a transcript line. Observed on the first live call (smoke test):
//   {"type":"conversation_message","role":"assistant","content":"...","timestamp":"2026-10-07T20:49:17.862766"}
// The `transcript` frame (what the engine heard) was not seen yet, so its fields are read defensively.
export function normalizeMessage(frame) {
  const text = frame.content ?? frame.text ?? frame.message ?? frame.transcript ?? "";
  let role = frame.role ?? frame.speaker ?? frame.source ?? (frame.type === "transcript" ? "caller" : "agent");
  role = String(role).toLowerCase();
  if (["user", "caller", "customer", "human"].includes(role)) role = "caller";
  if (["assistant", "agent", "ai", "bot"].includes(role)) role = "agent";
  const isFinal = frame.final ?? frame.is_final ?? frame.isFinal ?? (frame.partial === undefined ? true : !frame.partial);
  return { role, text: stripLangMark(text), final: Boolean(isFinal), type: frame.type, engineTime: frame.timestamp ?? null };
}

export function appendFrame(id, frame) {
  const s = getSession(id);
  if (!s) return null;
  (s.frames ??= []).push(frame);
  const m = normalizeMessage(frame);
  if (m.text && m.final) {
    (s.messages ??= []).push({ role: m.role, text: m.text, at: new Date().toISOString(), engineTime: m.engineTime, type: m.type });
  }
  return write(s);
}

export function findSessionByCallId(callId) {
  if (!callId) return null;
  return listSessions().map((s) => getSession(s.id)).find((s) => s && s.callId === callId) ?? null;
}

// Summaries, newest first. Tolerates files written by earlier builds.
export function listSessions() {
  return fs.readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => getSession(f.slice(0, -5)))
    .filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((s) => ({
      id: s.id,
      language: s.language ?? "",
      intake: Boolean(s.intake),
      mode: s.mode ?? "",
      createdAt: s.createdAt,
      endedAt: s.endedAt,
      endedReason: s.endedReason,
      callId: s.callId,
      patientName: s.details?.patient_name ?? "",
      clinicianName: s.details?.clinician_name ?? "",
      messageCount: s.messages?.length ?? 0,
      hasSummary: Boolean(s.summary),
      urgentCount: s.urgentFlags?.length ?? 0,
      hasIntake: Boolean(s.intakeRecord),
      hasRecording: Boolean(s.recordingPath),
      durationSeconds: s.durationSeconds ?? null,
    }));
}

// Delete every stored session and recording on this machine (or this hosted instance).
export function clearSessions() {
  let deleted = 0;
  for (const [dir, ext] of [[SESSIONS_DIR, ".json"], [RECORDINGS_DIR, ".wav"]]) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(ext)) continue;
      try { fs.unlinkSync(path.join(dir, name)); deleted++; } catch {}
    }
  }
  return deleted;
}
