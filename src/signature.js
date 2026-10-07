// X-Alebex-Signature check, copied verbatim from AGENTS.md "Working example: Node".
// Used by the end-of-call webhook (Phase 2).
import crypto from "node:crypto";

export function signatureIsValid(header, rawBody, secret) {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest();
  const received = Buffer.from(parts.v1 ?? "", "hex");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}
