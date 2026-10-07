// Automated smoke test: one short call through the local proxy with a silent "microphone".
//   node scripts/smoke-call.js [vi|zh] [--no-intake]     (default vi; SMOKE_LANGUAGE also works)
// Sends the session_start shape the client uses ({language, intake}), saves the greeting audio to
// data/spike/greeting-<lang>.wav and every text frame to data/spike/frames-<lang>[-no-intake].jsonl.
// After call_started it POSTs a sample record_session_details call to the server's tool endpoint,
// in the engine's envelope ({tool, arguments, call}) with the bearer header and X-Session-Id, and
// asserts that the session_details frame is pushed back on this socket within 2 s: that proves the
// tool route, the session registry and the push-to-browser path.
// Then it ends the call the way the End button does, with end_session. With the intake form on
// (the default) the proxy raises the visit.ending live event, so event_status frames must arrive
// and none may be `rejected` (a `rejected` with reason not_enabled_for_call means the agent's
// behaviour.callEvents is still off: run npm run setup), and call_ended must follow within 30 s.
// With --no-intake the proxy sends end_call at once, so call_ended should arrive within about 2 s.
// Bills a few seconds of call time. Run with the server up:
//   npm run smoke            npm run smoke -- zh            npm run smoke -- vi --no-intake
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const ARGS = process.argv.slice(2);
const LANG = String(ARGS.find((a) => !a.startsWith("--")) || process.env.SMOKE_LANGUAGE || "vi").toLowerCase();
const INTAKE = !(ARGS.includes("--no-intake") || /^(0|false|no|off)$/i.test(process.env.SMOKE_INTAKE ?? ""));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = path.join(ROOT, "data", "spike");
fs.mkdirSync(OUT, { recursive: true });
const WAV_PATH = path.join(OUT, `greeting-${LANG}.wav`);
const FRAMES_PATH = path.join(OUT, `frames-${LANG}${INTAKE ? "" : "-no-intake"}.jsonl`);
fs.writeFileSync(FRAMES_PATH, "");

const HTTP = (process.env.SMOKE_HTTP_URL || "http://localhost:3000").replace(/\/+$/, "");
const URL_WS = process.env.SMOKE_WS_URL || `${HTTP.replace(/^http/, "ws")}/ws/session`;
const MAX_MS = 20000;          // end_session goes out by this point whatever happened
const AFTER_MARK_MS = 2000;    // grace after the greeting's mark, to catch its transcript frames
const PUSH_TIMEOUT_MS = 2000;  // how long the session_details frame may take after the tool POST
const END_TIMEOUT_MS = 30000;  // call_ended must follow end_session within this
const QUICK_END_MS = 2000;     // without the intake form, end_session is a plain end_call: expected close time

const SAMPLE_DETAILS = {
  vi: { clinician_name: "Sarah Chen", clinician_role: "physician", patient_name: "Nguyễn Thị Lan", preferred_address: "bà" },
  zh: { clinician_name: "Sarah Chen", clinician_role: "physician", patient_name: "Wang Lihua", preferred_address: "王女士" },
};

const zeroFrame = Buffer.alloc(640);
const audioChunks = [];
const types = new Set();
const errors = [];
const eventStatuses = []; // {status, reason, name, line, ms} in order of arrival; ms is after end_session
let sessionId = null;
let callId = null;
let sampleRate = 24000;
let firstMarkAt = null;
let firstTranscript = null;
let endSent = false;
let endSentAt = null;
let callEndedMs = null;    // end_session -> call_ended
let intakeFrameMs = null;  // end_session -> intake_recorded push, if the agent recorded the form
let finished = false;
let micTimer = null;
let toolStatus = null;   // HTTP status of the sample tool POST
let pushArrived = null;  // true when the session_details frame came back on this socket in time
let pushMs = null;
let resolvePush = null;
let pushPromise = null;
const t0 = Date.now();
const sinceEnd = () => (endSentAt ? Date.now() - endSentAt : null);

const ws = new WebSocket(URL_WS);

function writeWav(chunks, rate) {
  const data = Buffer.concat(chunks);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);        // fmt chunk size
  header.writeUInt16LE(1, 20);         // PCM
  header.writeUInt16LE(1, 22);         // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);  // byte rate
  header.writeUInt16LE(2, 32);         // block align
  header.writeUInt16LE(16, 34);        // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(WAV_PATH, Buffer.concat([header, data]));
  return data.length / 2 / rate;
}

// The engine's envelope for a record_session_details call, as src/toolRoutes.js receives it.
async function postSessionDetails() {
  const details = SAMPLE_DETAILS[LANG] ?? SAMPLE_DETAILS.vi;
  const body = {
    tool: "record_session_details",
    arguments: details,
    call: { id: callId, agentId: null, from: null, to: null, startedAt: new Date(t0).toISOString() },
  };
  pushPromise = new Promise((resolve) => {
    resolvePush = resolve;
    setTimeout(() => resolve(false), PUSH_TIMEOUT_MS);
  });
  const t = Date.now();
  try {
    const res = await fetch(`${HTTP}/voice-tools/session-details`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TOOL_SECRET ?? ""}`, "X-Session-Id": sessionId },
      body: JSON.stringify(body),
    });
    toolStatus = res.status;
    console.log(`tool POST /voice-tools/session-details -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  } catch (err) {
    toolStatus = `failed: ${err.message}`;
    console.log(`tool POST failed: ${err.message}`);
  }
  pushArrived = await pushPromise;
  if (pushArrived) pushMs = Date.now() - t;
  console.log(pushArrived ? `session_details frame arrived ${pushMs} ms after the POST` : `session_details frame did NOT arrive within ${PUSH_TIMEOUT_MS} ms`);
}

function finish(why) {
  if (finished) return;
  finished = true;
  clearInterval(micTimer);
  const seconds = writeWav(audioChunks, sampleRate);
  const invalidConfig = errors.some((e) => /invalid_config/.test(e));
  const rejected = eventStatuses.filter((e) => e.status === "rejected");
  const sequence = eventStatuses.map((e) => `${e.status}${e.reason ? `(${e.reason})` : ""}@${e.ms ?? "?"}ms`).join(" -> ") || "(none)";
  console.log("\n=== smoke test summary ===");
  console.log(`language: ${LANG}; intake form: ${INTAKE ? "on" : "off"}`);
  console.log(`finished: ${why} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`session id: ${sessionId}`);
  console.log(`call id: ${callId}`);
  console.log(`customTools accepted: ${invalidConfig ? "NO (invalid_config)" : callId ? "yes (call_started, no invalid_config)" : "unknown (no call_started)"}`);
  console.log(`tool POST status: ${toolStatus ?? "(not sent)"}; session_details push: ${pushArrived === true ? `arrived in ${pushMs} ms` : pushArrived === false ? "MISSING" : "(not tested)"}`);
  console.log(`event_status sequence (ms after end_session): ${sequence}`);
  console.log(`intake_recorded push: ${intakeFrameMs != null ? `${intakeFrameMs} ms after end_session` : "(none)"}`);
  console.log(`end_session -> call_ended: ${callEndedMs != null ? `${callEndedMs} ms` : "call_ended NOT received"}`);
  console.log(`audio frames collected: ${audioChunks.length} (${seconds.toFixed(1)} s at ${sampleRate} Hz)`);
  console.log(`frame types seen: ${[...types].join(", ")}`);
  console.log(`first transcript/conversation_message frame: ${firstTranscript ?? "(none received)"}`);
  console.log(`error frames: ${errors.length ? errors.join("\n") : "none"}`);
  if (rejected.some((e) => e.reason === "not_enabled_for_call")) console.log("visit.ending was rejected with not_enabled_for_call: the agent's behaviour.callEvents is off; run npm run setup and retry");
  const checks = [
    ["no error frames", errors.length === 0],
    ["session_details push arrived", pushArrived === true],
    [`call_ended within ${END_TIMEOUT_MS / 1000} s of end_session`, callEndedMs != null && callEndedMs <= END_TIMEOUT_MS],
    ["no event_status rejected", rejected.length === 0],
  ];
  if (INTAKE) checks.push(["event_status frames arrived (callEvents on)", eventStatuses.length > 0]);
  else checks.push(["no event_status without the intake form", eventStatuses.length === 0], [`closed within ${QUICK_END_MS} ms`, callEndedMs != null && callEndedMs <= QUICK_END_MS]);
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  console.log(`wrote ${WAV_PATH}`);
  console.log(`wrote ${FRAMES_PATH}`);
  try { ws.close(); } catch {}
  const ok = checks.every(([, v]) => v);
  setTimeout(() => process.exit(ok ? 0 : 1), 200);
}

// What the End button sends. The proxy turns it into the visit.ending event or a plain end_call.
async function endSession(why) {
  if (endSent) return;
  endSent = true;
  if (pushPromise) await pushPromise; // let the registry-push check finish first
  console.log(`sending end_session (${why}) at +${((Date.now() - t0) / 1000).toFixed(1)} s`);
  endSentAt = Date.now();
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "end_session" }));
  setTimeout(() => finish(`no call_ended within ${END_TIMEOUT_MS / 1000} s of end_session`), END_TIMEOUT_MS);
}

ws.on("open", () => {
  console.log(`connected to ${URL_WS}`);
  ws.send(JSON.stringify({ type: "session_start", language: LANG, intake: INTAKE }));
  micTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(zeroFrame); }, 20);
  setTimeout(() => endSession("time limit"), MAX_MS);
});

ws.on("message", (data, isBinary) => {
  if (isBinary) return;
  const text = data.toString("utf8");
  fs.appendFileSync(FRAMES_PATH, text + "\n");
  let frame;
  try { frame = JSON.parse(text); } catch { return; }
  types.add(frame.type);
  switch (frame.type) {
    case "session_created":
      sessionId = frame.session_id;
      console.log(`session ${sessionId} (${frame.language}, intake ${frame.intake}, tools ${frame.tools_enabled ? "on" : "off"})`);
      break;
    case "call_started":
      callId = frame.call_id;
      console.log(`call_started ${callId} at +${((Date.now() - t0) / 1000).toFixed(1)} s`);
      postSessionDetails();
      break;
    case "session_details":
      console.log(`session_details frame: ${text.slice(0, 300)}`);
      if (resolvePush) resolvePush(true);
      break;
    case "intake_recorded":
      intakeFrameMs = sinceEnd();
      console.log(`intake_recorded frame at +${intakeFrameMs ?? "?"} ms after end_session: ${text.slice(0, 300)}`);
      break;
    case "event_status": {
      const ms = sinceEnd();
      eventStatuses.push({ status: frame.status, reason: frame.reason ?? null, name: frame.name ?? null, line: frame.line ?? null, ms });
      console.log(`event_status ${frame.name ?? "?"}: ${frame.status}${frame.reason ? ` (${frame.reason})` : ""}${frame.line ? ` line=${JSON.stringify(frame.line)}` : ""} at +${ms ?? "?"} ms after end_session`);
      break;
    }
    case "audio":
      if (frame.sample_rate) sampleRate = frame.sample_rate;
      if (!firstMarkAt) audioChunks.push(Buffer.from(frame.data, "base64"));
      break;
    case "mark":
      ws.send(JSON.stringify(frame)); // nothing is playing here, so echo at once
      if (!firstMarkAt) {
        firstMarkAt = Date.now();
        console.log(`first mark at +${((firstMarkAt - t0) / 1000).toFixed(1)} s, ${audioChunks.length} audio frames`);
        setTimeout(() => endSession("greeting collected"), AFTER_MARK_MS);
      }
      break;
    case "transcript":
    case "conversation_message":
      if (!firstTranscript) firstTranscript = text;
      console.log(`${frame.type}: ${text.slice(0, 300)}`);
      break;
    case "error":
      errors.push(text);
      console.log(`error frame: ${text}`);
      break;
    case "call_ended":
      callEndedMs = sinceEnd();
      console.log(`call_ended at +${callEndedMs ?? "?"} ms after end_session: ${text}`);
      finish("call_ended");
      break;
    default:
      console.log(`${frame.type}: ${text.slice(0, 200)}`);
  }
});

ws.on("close", (code) => finish(`socket closed (${code})`));
ws.on("error", (err) => { console.error(`socket error: ${err.message}`); finish("socket error"); });
