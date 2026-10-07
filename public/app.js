// Browser client: mic -> PCM16 16 kHz mono 20 ms frames -> /ws/session -> server proxy -> Alebex.
// Playback follows AGENTS.md "Run a browser call": hold each mark until the audio before it has
// played out, stop everything on clear_audio. A half-duplex guard mutes the mic while the agent
// is speaking so the agent's own voice from the speakers is not heard as a barge-in.
// Nothing is typed: the agent collects the names by voice, the clinician leads the visit, and the
// intake form is filled at the end from what was said. The server pushes session_details,
// intake_recorded and urgent_flag frames here when the engine calls its tools. End sends
// end_session: the server raises the visit.ending event, waits for record_intake, then ends the call.

const $ = (id) => document.getElementById(id);
const ui = {
  form: $("session-form"), start: $("start"), end: $("end"), status: $("status"), phase: $("phase"),
  transcript: $("transcript"), halfDuplex: $("half-duplex"), callId: $("call-id"), notice: $("notice"),
  language: $("language"), fillIntake: $("fill-intake"),
  sessionCard: $("session-card"), cardClinician: $("card-clinician"), cardPatient: $("card-patient"), cardAddress: $("card-address"),
  intakeCard: $("intake-card"), intakeFields: $("intake-fields"), intakeUrgent: $("intake-urgent"),
  banner: $("urgent-banner"), bannerText: $("urgent-text"), bannerDismiss: $("urgent-dismiss"),
};

const VI_RE = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const CJK_RE = /[㐀-鿿]/;
const ZERO_FRAME = new ArrayBuffer(640);
let WS_PATH = "/ws/session";          // from /api/config: a hosted deployment may route the socket elsewhere
let MAX_SESSION_SECONDS = null;       // from /api/config: hosted sessions end at the function duration limit
const LANG_MARK_RE = /^\[LANG:[a-z]+\]\s*/i; // the engine's language mark on some transcript lines; speech is unaffected
const INTAKE_LABELS = {
  date_of_birth: "Date of birth", reason_for_visit: "Reason for visit", onset_and_course: "Onset and course",
  pain_score: "Pain score", allergies: "Allergies", medications: "Medications", medical_history: "Medical history",
  pregnancy: "Pregnancy", other_notes: "Other notes", urgent_detail: "Urgent detail",
};

let ws = null;
let ctx = null;
let stream = null;
let workletNode = null;
let pingTimer = null;
let endTimer = null;
let live = false;
let closeAudioWhenDrained = false;
let intakeFormOn = true;   // the checkbox at Start, echoed by session_created
let toolsOn = true;        // tools_enabled from session_created: the intake form can only land when tools are on
let endRequested = false;  // End pressed once: end_session sent; a second press sends end_call

// Playback state, per the AGENTS.md snippet.
const playing = new Set();
const heldMarks = [];
let playhead = 0;

function wsSend(data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
}
const sendHeldMarks = () => { while (heldMarks.length) wsSend(JSON.stringify(heldMarks.shift())); };

function play(frame) {
  if (!ctx) return;
  const bytes = Uint8Array.from(atob(frame.data), (c) => c.charCodeAt(0));
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  if (!pcm.length) return;
  const buf = ctx.createBuffer(1, pcm.length, frame.sample_rate || 24000); // the context resamples to its own rate
  buf.getChannelData(0).set(Float32Array.from(pcm, (s) => s / 32768));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  if (playhead <= ctx.currentTime) playhead = ctx.currentTime + 0.18; // first chunk, or drained
  src.start(playhead);
  playhead += buf.duration;
  playing.add(src);
  src.onended = () => {
    playing.delete(src);
    if (playing.size === 0) {
      sendHeldMarks();
      if (closeAudioWhenDrained) closeAudio();
    }
  };
}

function stopPlayback() {
  for (const s of playing) { try { s.stop(); } catch {} }
  playing.clear();
  playhead = 0;
  sendHeldMarks();
}

function setStatus(state, text) {
  ui.status.dataset.state = state;
  ui.status.textContent = text;
}

function setPhase(text) {
  ui.phase.hidden = !text;
  ui.phase.textContent = text || "";
}

function notice(text, kind) {
  ui.notice.className = `notice ${kind || "info"}`;
  ui.notice.textContent = text;
}

const langOf = (text) => (VI_RE.test(text) ? "vi" : CJK_RE.test(text) ? "zh" : "en");

// --- Cards: filled from server-pushed frames, cleared on Start ---
function clearCards() {
  ui.sessionCard.hidden = true;
  ui.intakeCard.hidden = true;
  ui.banner.hidden = true;
  ui.intakeFields.innerHTML = "";
  ui.intakeUrgent.hidden = true;
  for (const el of [ui.cardClinician, ui.cardPatient, ui.cardAddress]) el.textContent = "—";
}

function showDetails(d) {
  d = d || {};
  ui.cardClinician.textContent = [d.clinician_name, d.clinician_role].filter(Boolean).join(", ") || "not given";
  ui.cardPatient.textContent = d.patient_name || "not given";
  ui.cardAddress.textContent = d.preferred_address || "not given";
  ui.sessionCard.hidden = false;
}

function showIntake(i) {
  i = i || {};
  ui.intakeFields.innerHTML = "";
  for (const [key, label] of Object.entries(INTAKE_LABELS)) {
    const v = i[key];
    if (v === undefined || v === null || v === "") continue;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(v);
    ui.intakeFields.append(dt, dd);
  }
  if (!ui.intakeFields.children.length) {
    const dd = document.createElement("dd");
    dd.className = "muted";
    dd.textContent = "No answers were recorded.";
    ui.intakeFields.append(dd);
  }
  ui.intakeUrgent.hidden = !i.urgent;
  ui.intakeCard.hidden = false;
}

function showUrgent(f) {
  const category = String(f.category || "").replace(/_/g, " ");
  const detail = [category, f.severity].filter(Boolean).join(", ");
  ui.bannerText.textContent = `${f.symptom || "red-flag symptom"}${detail ? ` (${detail})` : ""}`;
  ui.banner.hidden = false;
}

// --- Server config: the language list and whether the tool path (cards) is on ---
async function loadConfig() {
  try {
    const cfg = await (await fetch("/api/config")).json();
    WS_PATH = cfg.wsPath || WS_PATH;
    MAX_SESSION_SECONDS = cfg.maxSessionSeconds ?? null;
    const langs = cfg.languages || [];
    ui.language.innerHTML = "";
    for (const l of langs) {
      const opt = document.createElement("option");
      opt.value = l.code;
      opt.textContent = l.name;
      ui.language.append(opt);
    }
    if (!langs.length) {
      ui.language.innerHTML = '<option value="">No language packs</option>';
      ui.start.disabled = true;
      notice("No language pack is set up on the server. Run npm run setup.", "error");
    } else if (!cfg.toolsEnabled) {
      notice("The server has no public URL (ngrok did not start): the cards, the urgent banner and the end-of-call summary are off this run. Interpreting still works.", "info");
    }
  } catch {
    notice("Could not load /api/config from the server.", "error");
  }
}

// --- Transcript rendering. Observed shape on the first live call:
//   {"type":"conversation_message","role":"assistant","content":"...","timestamp":"..."}
// The `transcript` frame (what the engine heard) is read defensively. ---
const pending = {}; // role -> bubble element for an in-progress (partial) line

function describe(frame) {
  const text = String(frame.content ?? frame.text ?? frame.message ?? frame.transcript ?? "").replace(LANG_MARK_RE, "");
  let role = String(frame.role ?? frame.speaker ?? frame.source ?? (frame.type === "transcript" ? "caller" : "agent")).toLowerCase();
  if (["user", "caller", "customer", "human"].includes(role)) role = "caller";
  if (["assistant", "agent", "ai", "bot"].includes(role)) role = "agent";
  const final = frame.final ?? frame.is_final ?? frame.isFinal ?? (frame.partial === undefined ? true : !frame.partial);
  return { role, text: String(text), final: Boolean(final) };
}

function renderMessage(frame) {
  const { role, text, final } = describe(frame);
  if (!text.trim()) return;
  const empty = ui.transcript.querySelector(".empty");
  if (empty) empty.remove();

  let el = pending[role];
  if (!el) {
    el = document.createElement("div");
    el.innerHTML = '<div class="head"><span class="who"></span><span class="lang"></span></div><p></p>';
    ui.transcript.appendChild(el);
  }
  const lang = langOf(text);
  el.className = `msg ${role}${final ? "" : " partial"}`;
  el.querySelector(".who").textContent = role === "agent" ? "Interpreter" : "Room";
  el.querySelector(".lang").textContent = lang.toUpperCase();
  el.querySelector(".lang").className = `lang ${lang}`;
  el.querySelector("p").textContent = text;
  pending[role] = final ? null : el;
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

// --- Session lifecycle ---
async function start(event) {
  event.preventDefault();
  const language = ui.language.value;
  const intake = ui.fillIntake.checked;
  if (!language) { notice("Pick the patient's language first.", "error"); return; }
  ui.start.disabled = true;
  ui.notice.className = "notice";
  ui.callId.textContent = "";
  ui.transcript.innerHTML = '<div class="empty">Connecting…</div>';
  clearCards();
  endRequested = false;
  ui.end.textContent = "End session";
  setPhase("");
  setStatus("connecting", "Connecting");
  try {
    ctx = new AudioContext(); // one context, default rate, created inside the click
    await ctx.audioWorklet.addModule("capture-worklet.js");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const source = ctx.createMediaStreamSource(stream);
    workletNode = new AudioWorkletNode(ctx, "pcm16-capture", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: { targetRate: 16000, frameSamples: 320 },
    });
    source.connect(workletNode);
    workletNode.connect(ctx.destination); // the worklet outputs silence; this keeps it processing
    workletNode.port.onmessage = (e) => {
      if (!live) return;
      const agentTalking = playing.size > 0 || heldMarks.length > 0;
      wsSend(ui.halfDuplex.checked && agentTalking ? ZERO_FRAME : e.data);
    };
    openSocket({ language, intake });
  } catch (err) {
    setStatus("ended", "Could not start");
    notice(`Microphone or audio setup failed: ${err.message}`, "error");
    cleanup();
  }
}

function openSocket({ language, intake }) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}${WS_PATH}`);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "session_start", language, intake }));
  };
  ws.onmessage = (e) => {
    if (typeof e.data !== "string") return;
    let frame;
    try { frame = JSON.parse(e.data); } catch { return; }
    handleFrame(frame);
  };
  ws.onclose = () => {
    if (ui.status.dataset.state !== "ended") {
      setStatus("ended", "Disconnected");
      if (MAX_SESSION_SECONDS && live) notice(`Hosted sessions end after ${Math.round(MAX_SESSION_SECONDS / 60)} minutes. Start a new session to continue.`, "info");
    }
    cleanup();
  };
  ws.onerror = () => notice("Connection to the server failed.", "error");
}

function handleFrame(frame) {
  switch (frame.type) {
    case "session_created":
      intakeFormOn = frame.intake === true;
      toolsOn = frame.tools_enabled !== false;
      ui.callId.textContent = `session ${frame.session_id}`;
      if (frame.tools_enabled === false) notice("This session runs without tools: no cards, banner or summary. Interpreting still works.", "info");
      break;
    case "call_started": {
      // Arrives after the greeting's audio and mark, so the greeting bubble may already be on screen.
      live = true;
      setStatus("live", "Live");
      setPhase("Opening");
      ui.end.disabled = false;
      ui.callId.textContent += ` · call ${frame.call_id}`;
      const empty = ui.transcript.querySelector(".empty");
      if (empty) empty.textContent = "Listening. Speak a few sentences at a time.";
      pingTimer = setInterval(() => wsSend(JSON.stringify({ type: "ping" })), 15000);
      break;
    }
    case "audio":
      play(frame);
      break;
    case "mark":
      heldMarks.push(frame);
      if (playing.size === 0) sendHeldMarks();
      break;
    case "clear_audio":
      stopPlayback();
      break;
    case "transcript":
    case "conversation_message":
      renderMessage(frame);
      break;
    case "session_details":
      showDetails(frame.details);
      setPhase("Interpreting");
      break;
    case "intake_recorded":
      showIntake(frame.intake);
      if (endRequested) notice("Intake form saved. The session closes in a moment.", "info");
      break;
    case "urgent_flag":
      showUrgent(frame);
      break;
    case "call_ended":
      setStatus("ended", `Ended${frame.reason ? `: ${frame.reason}` : ""}`);
      setPhase("Ended");
      cleanup();
      break;
    case "error":
      notice(`${frame.code}: ${frame.message}`, "error");
      break;
    case "pong":
      break;
    default:
      console.debug("frame", frame);
  }
}

// First press: end_session. The server raises the visit.ending event and ends the call once the
// intake form has been saved (or at once when there is nothing to save). A second press, or 25 s,
// sends the hard end_call.
function endSession() {
  if (endRequested) { hardEnd(); return; }
  endRequested = true;
  setStatus("connecting", "Ending");
  setPhase("Wrapping up");
  wsSend(JSON.stringify({ type: "end_session" }));
  if (intakeFormOn && toolsOn && ui.intakeCard.hidden) {
    notice("Saving intake notes… The session closes by itself; press End again to close it now.", "info");
    ui.end.textContent = "End now";
    endTimer = setTimeout(hardEnd, 25000);
  } else {
    ui.end.disabled = true;
    endTimer = setTimeout(() => { if (ws) ws.close(); }, 4000); // in case call_ended never comes
  }
}

function hardEnd() {
  ui.end.disabled = true;
  clearTimeout(endTimer);
  wsSend(JSON.stringify({ type: "end_call" }));
  endTimer = setTimeout(() => { if (ws) ws.close(); }, 4000); // in case call_ended never comes
}

function closeAudio() {
  closeAudioWhenDrained = false;
  if (ctx) { ctx.close().catch(() => {}); ctx = null; }
}

function cleanup() {
  live = false;
  clearInterval(pingTimer);
  clearTimeout(endTimer);
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (workletNode) { workletNode.port.onmessage = null; workletNode.disconnect(); workletNode = null; }
  heldMarks.length = 0;
  if (playing.size > 0) closeAudioWhenDrained = true; // let the last words play out
  else closeAudio();
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  ws = null;
  ui.start.disabled = false;
  ui.end.disabled = true;
  ui.end.textContent = "End session";
  endRequested = false;
}

ui.form.addEventListener("submit", start);
ui.end.addEventListener("click", endSession);
ui.bannerDismiss.addEventListener("click", () => { ui.banner.hidden = true; });
loadConfig();
