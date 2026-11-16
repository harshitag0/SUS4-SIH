import { createHash } from "node:crypto";

const sha = (s) => createHash("sha256").update(s).digest("hex");

/** Canonical terms: any change to these after signing breaks verification. */
export const termsOf = (b) =>
  JSON.stringify({
    id: String(b._id),
    buyer: b.buyerName,
    farmer: b.farmerName,
    grade: b.grade,
    tons: b.tons,
    price: b.priceUsd,
    date: new Date(b.deliverBy).toISOString().slice(0, 10),
    escal: !!b.escalation?.enabled,
    esc: b.escalation?.pct || 0,
  });

/** Each signature hashes the terms + side + time + the other side's hash (or GENESIS). */
export function makeSignature(bond, side, now = new Date()) {
  const other = side === "buyer" ? "farmer" : "buyer";
  const prev = bond.sigs?.[other]?.hash || "GENESIS";
  const ts = now.toISOString();
  return { ts, prev, hash: sha(termsOf(bond) + side + ts + prev) };
}

export function verifyBond(bond) {
  return ["buyer", "farmer"].every((s) => {
    const g = bond.sigs?.[s];
    return !g?.hash || sha(termsOf(bond) + s + g.ts + g.prev) === g.hash;
  });
}
