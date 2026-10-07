// The three custom-tool endpoints the engine POSTs to mid-call
// (AGENTS.md "What the engine sends your endpoint": {tool, arguments, call}).
// Mounted at /voice-tools with its own JSON parser. Every request carries
// `Authorization: Bearer TOOL_SECRET` and `X-Session-Id` (set per call in src/tools.js); the
// session falls back to body.call.id. Side effects are keyed on the session id, so a repeated
// call overwrites the same record. Each route saves to the session file, pushes a frame to the
// session's browser through src/registry.js and answers the engine with a tiny JSON body.
import crypto from "node:crypto";
import express from "express";
import { getSession, updateSession, findSessionByCallId } from "./sessions.js";
import { pushToSession } from "./registry.js";

const DETAIL_FIELDS = ["clinician_name", "clinician_role", "patient_name", "preferred_address"];
const INTAKE_TEXT_FIELDS = ["date_of_birth", "reason_for_visit", "onset_and_course", "allergies", "medications", "medical_history", "pregnancy", "other_notes", "urgent_detail"];
const CATEGORIES = new Set(["chest_pain", "breathing", "bleeding", "self_harm", "allergic_reaction", "stroke_signs", "other"]);
const SEVERITIES = new Set(["emergency", "urgent"]);

// One clean string from whatever the model sent; "" when absent.
function text(value, max = 1000) {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function bearerOk(header, secret) {
  if (!secret || typeof header !== "string") return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function toolRouter({ log = console } = {}) {
  const router = express.Router();
  router.use(express.json({ limit: "64kb" }));
  // A malformed body is a 400 the model can read, not Express's HTML page.
  router.use((err, req, res, next) => res.status(400).json({ error: `bad request body: ${err.message}` }));

  router.use((req, res, next) => {
    if (!bearerOk(req.get("authorization"), process.env.TOOL_SECRET)) {
      log.warn(`[tools] ${req.path}: bad tool credential`);
      return res.status(401).json({ error: "bad tool credential" });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const headerId = req.get("x-session-id");
    const session = (headerId && getSession(headerId)) || (body.call?.id ? findSessionByCallId(body.call.id) : null);
    if (!session) {
      log.warn(`[tools] ${body.tool ?? req.path}: no session for X-Session-Id "${headerId ?? ""}" / call ${body.call?.id ?? "-"}`);
      return res.status(404).json({ error: "unknown session" });
    }
    req.session = session;
    req.args = body.arguments && typeof body.arguments === "object" ? body.arguments : {};
    next();
  });

  // record_session_details -> session.details, frame session_details
  router.post("/session-details", (req, res) => {
    const details = Object.fromEntries(DETAIL_FIELDS.map((k) => [k, text(req.args[k], 200)]));
    details.recordedAt = new Date().toISOString();
    updateSession(req.session.id, { details });
    const pushed = pushToSession(req.session.id, { type: "session_details", details });
    log.info(`[tools] [session ${req.session.id}] record_session_details: clinician ${details.clinician_name || "-"} (${details.clinician_role || "-"}), patient ${details.patient_name || "-"} (${details.preferred_address || "-"})${pushed ? "" : " [browser not connected]"}`);
    res.json({ saved: true });
  });

  // record_intake -> session.intakeRecord, frame intake_recorded
  router.post("/record-intake", (req, res) => {
    const a = req.args;
    const intake = Object.fromEntries(INTAKE_TEXT_FIELDS.map((k) => [k, text(a[k])]));
    const score = Number(a.pain_score);
    intake.pain_score = a.pain_score !== undefined && a.pain_score !== null && a.pain_score !== "" && Number.isInteger(score) && score >= 0 && score <= 10 ? score : null;
    intake.urgent = a.urgent === true || a.urgent === "true";
    intake.recordedAt = new Date().toISOString();
    updateSession(req.session.id, { intakeRecord: intake });
    const pushed = pushToSession(req.session.id, { type: "intake_recorded", intake });
    log.info(`[tools] [session ${req.session.id}] record_intake${intake.urgent ? " (URGENT)" : ""}: ${intake.reason_for_visit || "-"}${pushed ? "" : " [browser not connected]"}`);
    res.json({ saved: true });
  });

  // flag_urgent_symptom -> session.urgentFlags (one entry per distinct flag), frame urgent_flag
  router.post("/flag-urgent", (req, res) => {
    const a = req.args;
    const flag = {
      symptom: text(a.symptom, 300),
      category: CATEGORIES.has(a.category) ? a.category : "other",
      severity: SEVERITIES.has(a.severity) ? a.severity : "urgent",
      at: new Date().toISOString(),
    };
    const flags = (req.session.urgentFlags ?? []).filter((f) => !(f.symptom === flag.symptom && f.category === flag.category && f.severity === flag.severity));
    flags.push(flag);
    updateSession(req.session.id, { urgentFlags: flags });
    pushToSession(req.session.id, { type: "urgent_flag", ...flag });
    log.warn(`[tools] [session ${req.session.id}] URGENT ${flag.category} (${flag.severity}): ${flag.symptom}`);
    res.json({ noted: true, note: "Recorded silently. Say nothing about this to the room." });
  });

  return router;
}
