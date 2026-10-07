// One browser session <-> one upstream Alebex call (AGENTS.md "Run a browser call").
// The API key never reaches the browser: this side opens the engine socket and sends start_call itself.
// session_start is {type, language, intake}: the agent id, glossary and context follow from the
// language registry, and the three custom tools ride on start_call when a public URL exists.
// End flow: the browser sends end_session. When the intake form is still to be recorded (intake on,
// no record_intake yet, tools on) the proxy raises the visit.ending live event (AGENTS.md "Live call
// events"), waits for the intake_recorded push, lets the spoken thanks finish, then sends end_call.
// Otherwise end_call goes up at once. A raw end_call from the browser is still the hard stop.
import WebSocket from "ws";
import { buildContext } from "./context.js";
import { createSession, getSession, updateSession, appendFrame, normalizeMessage } from "./sessions.js";
import { getLanguage, agentIdFor, enabledLanguages } from "./languages.js";
import { customToolsFor } from "./tools.js";
import { registerSession, unregisterSession, onSessionFrame } from "./registry.js";

const RELAY_UP = new Set(["mark", "ping"]); // browser text frames passed upstream verbatim; end_session and end_call are handled below
const RECORD = new Set(["transcript", "conversation_message"]);
const KNOWN = new Set(["call_started", "audio", "mark", "clear_audio", "transcript", "conversation_message", "call_ended", "error", "pong", "event_status"]);
const unknownSeen = new Set();

const VISIT_ENDING = "visit.ending";
const VISIT_ENDING_HINT = "The clinician has ended the visit. Call record_intake now with what the patient said during the visit, then say nothing more.";
const INTAKE_WAIT_MS = 20000;  // record_intake must land within this after the event, else end_call anyway
const THANKS_GRACE_MS = 4000;  // after intake_recorded, lets the spoken thanks finish before end_call

export function handleBrowserSocket(browser, { glossaries = {}, log = console } = {}) {
  let upstream = null;
  let session = null;
  let live = false; // call_started received: mic frames may flow
  let closed = false;
  let customTools = null;
  let intakeRecorded = false; // the intake_recorded push for this session was seen (tool route -> registry)
  let ending = null;          // { startedAt, timer, resolved } while end_session waits on record_intake
  let unsubscribe = null;

  const tag = () => `[session ${session?.id ?? "-"}]`;
  const toBrowser = (frame) => {
    if (browser.readyState === WebSocket.OPEN) browser.send(typeof frame === "string" ? frame : JSON.stringify(frame));
  };
  const sendUp = (frame) => {
    if (upstream?.readyState !== WebSocket.OPEN) return false;
    upstream.send(JSON.stringify(frame));
    return true;
  };

  function clearEnding() {
    if (!ending) return;
    clearTimeout(ending.timer);
    ending = null;
  }

  function shutdown(reason) {
    if (closed) return;
    closed = true;
    clearEnding();
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (session) {
      unregisterSession(session.id);
      if (!session.endedAt) {
        session = updateSession(session.id, { endedAt: new Date().toISOString(), endedReason: session.endedReason ?? reason }) ?? session;
      }
    }
    try { if (upstream && upstream.readyState <= WebSocket.OPEN) upstream.close(1000, "session over"); } catch {}
    try { if (browser.readyState <= WebSocket.OPEN) browser.close(1000, "session over"); } catch {}
    log.info(`${tag()} closed (${reason}); ${session?.messages?.length ?? 0} transcript lines saved`);
  }

  function endCall(why) {
    clearEnding();
    log.info(`${tag()} end_call (${why})`);
    if (!sendUp({ type: "end_call" })) shutdown(`end_call with no upstream (${why})`);
  }

  // The End button. When the session asked for the intake form and it has not landed yet, the agent
  // is told through the visit.ending event and the call ends once record_intake has been saved.
  function endSession() {
    if (ending) return; // already in progress; a second End press arrives as a raw end_call
    const stored = getSession(session.id);
    const recorded = intakeRecorded || Boolean(stored?.intakeRecord);
    const skip = !live ? "call not live" : !session.intake ? "no intake form for this visit" : recorded ? "intake already recorded" : !customTools ? "tools off" : null;
    if (skip) { endCall(`end_session: ${skip}`); return; }
    const sent = sendUp({
      type: "call_event",
      name: VISIT_ENDING,
      hint: VISIT_ENDING_HINT,
      speak: true,
      priority: "interrupt",
      idempotencyKey: `${session.id}-visit-ending`,
    });
    if (!sent) { endCall("end_session: upstream not open"); return; }
    ending = { startedAt: Date.now(), resolved: false, timer: null };
    ending.timer = setTimeout(() => endCall(`${VISIT_ENDING}: no record_intake within ${INTAKE_WAIT_MS / 1000} s`), INTAKE_WAIT_MS);
    log.info(`${tag()} end_session: sent ${VISIT_ENDING}, waiting up to ${INTAKE_WAIT_MS / 1000} s for record_intake`);
  }

  // intake_recorded was pushed to the browser (src/toolRoutes.js through src/registry.js).
  function onIntakeRecorded() {
    intakeRecorded = true;
    if (!ending || ending.resolved) return;
    const waited = Date.now() - ending.startedAt;
    ending.resolved = true;
    clearTimeout(ending.timer);
    ending.timer = setTimeout(() => endCall(`${VISIT_ENDING}: record_intake landed after ${waited} ms, thanks grace over`), THANKS_GRACE_MS);
    log.info(`${tag()} record_intake landed ${waited} ms after ${VISIT_ENDING}; end_call in ${THANKS_GRACE_MS / 1000} s`);
  }

  function onEventStatus(frame) {
    const detail = [frame.status, frame.reason, frame.line ? JSON.stringify(frame.line) : ""].filter(Boolean).join(" ");
    log.info(`${tag()} event_status ${frame.name ?? "?"}: ${detail}`);
    if (!ending || ending.resolved || (frame.name && frame.name !== VISIT_ENDING)) return;
    if (frame.status === "rejected" || frame.status === "dropped") {
      endCall(`${VISIT_ENDING} ${frame.status}${frame.reason ? ` (${frame.reason})` : ""}`);
    }
  }

  browser.on("message", (data, isBinary) => {
    if (isBinary) {
      if (live && upstream?.readyState === WebSocket.OPEN) upstream.send(data, { binary: true });
      return;
    }
    let frame;
    try { frame = JSON.parse(data.toString("utf8")); } catch { return; }
    if (!session) {
      if (frame.type === "session_start") startSession(frame);
      else toBrowser({ type: "error", code: "bad_message", message: "send session_start first" });
      return;
    }
    if (frame.type === "end_session") { endSession(); return; }
    if (frame.type === "end_call") { endCall("browser end_call"); return; }
    if (RELAY_UP.has(frame.type)) sendUp(frame);
    // start_call, call_event and anything else from the browser is dropped on purpose.
  });
  browser.on("close", () => shutdown("browser-closed"));
  browser.on("error", (err) => { log.warn(`${tag()} browser socket error: ${err.message}`); shutdown("browser-error"); });

  function startSession(frame) {
    const lang = getLanguage(String(frame.language ?? ""));
    if (!lang) {
      const codes = enabledLanguages().map((l) => l.code).join(", ") || "none";
      toBrowser({ type: "error", code: "invalid_config", message: `Unknown language "${frame.language ?? ""}". Available: ${codes}.` });
      browser.close(1008, "unknown language");
      return;
    }
    const agentId = agentIdFor(lang);
    if (!agentId) {
      toBrowser({ type: "error", code: "invalid_config", message: `No agent id for ${lang.name} (${lang.agentEnv} in .env). Run npm run setup.` });
      browser.close(1011, "no agent");
      return;
    }
    const intake = frame.intake === true || frame.intake === "true";
    const context = buildContext({ language: lang.name, intake });
    session = createSession({ language: lang.code, intake, context });
    registerSession(session.id, toBrowser);
    unsubscribe = onSessionFrame(session.id, (pushed) => { if (pushed?.type === "intake_recorded") onIntakeRecorded(); });
    customTools = customToolsFor(session.id);
    const glossary = glossaries[lang.code] ?? "";
    log.info(`${tag()} start (${lang.name}, ${session.mode}, tools ${customTools ? "on" : "off"}, glossary ${glossary.length} chars)\n${context}`);
    toBrowser({ type: "session_created", session_id: session.id, language: lang.code, intake, tools_enabled: Boolean(customTools) });

    const engine = `${process.env.ALEBEX_ENGINE_URL.replace(/^http/, "ws").replace(/\/+$/, "")}/public/ws/call`;
    upstream = new WebSocket(engine, [`alebex.token.${process.env.ALEBEX_API_KEY}`]);

    upstream.on("open", () => {
      const startCall = { type: "start_call", agent: { id: agentId } };
      if (glossary) startCall.knowledgeBase = glossary;
      if (context) startCall.context = context;
      if (customTools) startCall.customTools = customTools;
      upstream.send(JSON.stringify(startCall));
    });

    upstream.on("message", (data, isBinary) => {
      if (isBinary) { if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary: true }); return; }
      const text = data.toString("utf8");
      toBrowser(text); // every upstream text frame goes down verbatim
      let frame;
      try { frame = JSON.parse(text); } catch { return; }
      if (frame.type === "call_started") {
        live = true;
        session = updateSession(session.id, { callId: frame.call_id }) ?? session;
        log.info(`${tag()} call_started ${frame.call_id}`);
      } else if (RECORD.has(frame.type)) {
        session = appendFrame(session.id, frame) ?? session;
        const m = normalizeMessage(frame);
        if (m.text && m.final) log.info(`${tag()} ${m.role}: ${m.text}`);
      } else if (frame.type === "event_status") {
        onEventStatus(frame);
      } else if (frame.type === "call_ended") {
        session.endedReason = frame.reason ?? (frame.ended_by ? `ended by ${frame.ended_by}` : "call_ended");
        shutdown(session.endedReason);
      } else if (frame.type === "error") {
        log.warn(`${tag()} engine error ${frame.code}: ${frame.message}`);
      } else if (!KNOWN.has(frame.type) && !unknownSeen.has(frame.type)) {
        unknownSeen.add(frame.type);
        log.info(`${tag()} unknown upstream frame type "${frame.type}": ${text.slice(0, 400)}`);
      }
    });
    upstream.on("close", (code, reason) => shutdown(`upstream-closed ${code} ${reason?.toString() ?? ""}`.trim()));
    upstream.on("error", (err) => {
      log.warn(`${tag()} upstream socket error: ${err.message}`);
      toBrowser({ type: "error", code: "upstream_error", message: err.message });
      shutdown("upstream-error");
    });
  }
}
