// Builds the per-call `context` text (AGENTS.md "Caller context"; plan Appendix D).
// Facts only, no instructions, numbers in words. Names and roles are no longer typed in:
// the agent collects them by voice and saves them with record_session_details.
import { dateTimeWords } from "./words.js";

export function buildContext({ language = "", intake = false } = {}, now = new Date()) {
  const lines = ["Session details.", `Date and time: ${dateTimeWords(now)}.`];
  if (language) lines.push(`Patient's language: ${language}.`);
  lines.push(intake
    ? "Intake form: fill it at the end of the visit from what the patient says."
    : "Intake form: not needed for this visit.");
  return lines.join("\n").slice(0, 4000);
}
