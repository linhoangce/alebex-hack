// POST /alebex/end-of-call: the signed end-of-call report (AGENTS.md "The end-of-call webhook").
// express.raw keeps the exact bytes the signature covers; no JSON parser may run on this path
// before it. The session is found by the report's `id`, which is the call id. The record is
// merged and written before the 204 goes out; the recording (a presigned link valid for 60 min)
// is downloaded right after, to data/recordings/<sessionId>.wav.
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { signatureIsValid } from "./signature.js";
import { updateSession, findSessionByCallId, stripLangMark, RECORDINGS_DIR } from "./sessions.js";

export function webhookRouter({ log = console } = {}) {
  const router = express.Router();

  router.post("/end-of-call", express.raw({ type: "application/json", limit: "2mb" }), (req, res) => {
    const secret = process.env.ALEBEX_WEBHOOK_SECRET;
    if (!secret || !Buffer.isBuffer(req.body) || !signatureIsValid(req.get("x-alebex-signature"), req.body, secret)) {
      log.warn("[webhook] end-of-call report rejected: bad or missing signature");
      return res.sendStatus(401);
    }
    let report;
    try {
      report = JSON.parse(req.body.toString("utf8"));
    } catch {
      log.warn("[webhook] end-of-call report body is not JSON");
      return res.sendStatus(204);
    }
    const session = report?.id ? findSessionByCallId(String(report.id)) : null;
    if (!session) {
      log.warn(`[webhook] no session for call ${report?.id ?? "-"}`);
      return res.sendStatus(204);
    }

    const patch = {
      summary: typeof report.summary === "string" ? report.summary : session.summary ?? null,
      durationSeconds: typeof report.durationSeconds === "number" ? report.durationSeconds : session.durationSeconds ?? null,
      endedReason: report.endedReason ?? session.endedReason ?? null,
      endedAt: session.endedAt ?? report.endedAt ?? null,
      toolCalls: Array.isArray(report.toolCalls) ? report.toolCalls : session.toolCalls ?? [],
      report: {
        receivedAt: new Date().toISOString(),
        agentId: report.agentId ?? null,
        agentName: report.agentName ?? null,
        callType: report.callType ?? null,
        startedAt: report.startedAt ?? null,
        endedAt: report.endedAt ?? null,
        transcript: typeof report.transcript === "string" ? report.transcript : null,
        events: Array.isArray(report.events) ? report.events : [],
        recordingUrl: report.recordingUrl ? "(downloaded)" : null,
      },
    };
    // The engine's message list is the complete one; the lines captured live stay under liveMessages.
    if (Array.isArray(report.messages) && report.messages.length) {
      patch.liveMessages = session.liveMessages ?? session.messages ?? [];
      patch.messages = report.messages.map((m) => ({
        role: m.role === "agent" ? "agent" : "caller",
        text: stripLangMark(m.text),
        secondsFromStart: typeof m.secondsFromStart === "number" ? m.secondsFromStart : null,
        type: "report",
      }));
    }
    updateSession(session.id, patch);
    log.info(`[webhook] [session ${session.id}] report for call ${report.id}: ${patch.endedReason ?? "-"}, ${patch.durationSeconds ?? "?"} s, summary ${patch.summary ? "yes" : "no"}, recording ${report.recordingUrl ? "yes" : "none"}`);
    res.sendStatus(204);

    if (report.recordingUrl) downloadRecording(session.id, String(report.recordingUrl), log);
  });

  return router;
}

async function downloadRecording(sessionId, url, log) {
  const file = path.join(RECORDINGS_DIR, `${sessionId}.wav`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    updateSession(sessionId, { recordingPath: file });
    log.info(`[webhook] [session ${sessionId}] recording saved to ${file}`);
  } catch (err) {
    log.warn(`[webhook] [session ${sessionId}] recording download failed: ${err.message}`);
  }
}
