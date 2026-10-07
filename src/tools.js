// customTools builders sent on every start_call (AGENTS.md "Custom tools"; plan Appendix E).
// The public base comes from src/ngrok.js at call time (a tunnel started at boot is picked up),
// never from the environment at import time. Each tool carries the bearer secret and the session
// id as headers so src/toolRoutes.js can route without a lookup. The engine adds `spoken_line`
// to every tool itself, so it is not declared here.
import { getPublicBaseUrl } from "./ngrok.js";

export const toolsAvailable = () => Boolean(getPublicBaseUrl() && process.env.TOOL_SECRET);

function base() {
  const url = (getPublicBaseUrl() ?? "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(url)) throw new Error("no public https base URL (ngrok) for tools");
  return url;
}

function headersFor(sessionId) {
  return { Authorization: `Bearer ${process.env.TOOL_SECRET}`, "X-Session-Id": String(sessionId) };
}

// Who is in the room, collected by voice in the opening (step two of the prompt).
export function recordSessionDetails(sessionId) {
  return {
    name: "record_session_details",
    description:
      "Save who is in the room, once the opening questions have been answered: the clinician's name and role, and the patient's name and the form of address they chose. Call it exactly once, right after the patient has given their name and preferred form of address, before interpreting begins. Do not call it again later.",
    url: `${base()}/voice-tools/session-details`,
    headers: headersFor(sessionId),
    timeoutMs: 5000,
    parameters: {
      type: "object",
      properties: {
        clinician_name: { type: "string", description: "As the clinician said it, in English" },
        clinician_role: { type: "string", description: "For example physician, nurse, nurse practitioner, resident, pharmacist, social worker" },
        patient_name: { type: "string", description: "The patient's name as they said it, in their own spelling where known" },
        preferred_address: { type: "string", description: "The form of address the patient chose, in their language" },
      },
      required: ["patient_name"],
    },
  };
}

// The intake form, filled in English from what the patient said during the visit, saved once when the visit is over.
export function recordIntake(sessionId) {
  return {
    name: "record_intake",
    description:
      "Save the intake form for the clinician, in English, from what the patient said during the visit. Call it exactly once, when the visit is over: when the clinician says so, or when the app's visit.ending event arrives. Never call it during the visit and never ask questions to fill it; leave uncovered fields out.",
    url: `${base()}/voice-tools/record-intake`,
    headers: headersFor(sessionId),
    timeoutMs: 5000,
    parameters: {
      type: "object",
      properties: {
        date_of_birth: { type: "string", description: "Year, month, day, as the patient said it" },
        reason_for_visit: { type: "string" },
        onset_and_course: { type: "string" },
        pain_score: { type: "integer", description: "Zero to ten; omit if not given" },
        allergies: { type: "string" },
        medications: { type: "string" },
        medical_history: { type: "string" },
        pregnancy: { type: "string", enum: ["yes", "no", "possibly", "not_applicable", "declined"] },
        other_notes: { type: "string" },
        urgent: { type: "boolean", description: "True if the patient reported a red-flag symptom" },
        urgent_detail: { type: "string" },
      },
      required: [],
    },
  };
}

// The interpreter silently flags a red-flag symptom reported by the patient, at any point.
export function flagUrgentSymptom(sessionId) {
  return {
    name: "flag_urgent_symptom",
    description:
      "Record that the PATIENT reported a red-flag symptom so the care team sees an alert on screen: chest pain, trouble breathing, heavy bleeding, thoughts of suicide or self-harm, signs of a severe allergic reaction, or stroke signs such as face drooping or sudden weakness. Call it the moment the patient says one of these, in addition to interpreting their words in full. Do not call it when the clinician asks about these symptoms as a question, when the patient denies them, or for mild or old symptoms.",
    url: `${base()}/voice-tools/flag-urgent`,
    headers: headersFor(sessionId),
    timeoutMs: 5000,
    parameters: {
      type: "object",
      properties: {
        symptom: { type: "string", description: "What the patient reported, in English, in their own words" },
        category: { type: "string", enum: ["chest_pain", "breathing", "bleeding", "self_harm", "allergic_reaction", "stroke_signs", "other"] },
        severity: { type: "string", enum: ["emergency", "urgent"] },
      },
      required: ["symptom", "category"],
    },
  };
}

// The array for one call's start_call frame, or null when there is no public URL or no secret.
export function customToolsFor(sessionId) {
  if (!toolsAvailable()) return null;
  return [recordSessionDetails(sessionId), recordIntake(sessionId), flagUrgentSymptom(sessionId)];
}
