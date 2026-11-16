import { createHash } from "node:crypto";

const digest = (e) => createHash("sha256")
  .update(JSON.stringify({ at: new Date(e.at).toISOString(), actorRole: e.actorRole, actorName: e.actorName, action: e.action, details: e.details ?? null, prevHash: e.prevHash }))
  .digest("hex");

/** Append a hash-chained audit entry (each entry commits to the previous one). */
export function appendAudit(agreement, { actorRole, actorName, action, details }) {
  const prevHash = agreement.audit.length ? agreement.audit[agreement.audit.length - 1].hash : "GENESIS";
  const entry = { at: new Date(), actorRole, actorName, action, details: details ?? null, prevHash };
  entry.hash = digest(entry);
  agreement.audit.push(entry);
  return entry;
}

/** Recompute the chain; any edited or removed entry breaks it. */
export function verifyAudit(audit) {
  let prev = "GENESIS";
  for (const [i, e] of audit.entries()) {
    if (e.prevHash !== prev || digest(e) !== e.hash) return { intact: false, brokenAt: i };
    prev = e.hash;
  }
  return { intact: true, entries: audit.length };
}
