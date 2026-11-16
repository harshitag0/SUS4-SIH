import { User } from "./modules/users/model.js";
import { Requirement } from "./modules/requirements/model.js";

const BUYERS = [
  { mobile: "6500000001", company: "FairPrice Fresh (Singapore)", grade: "A", tons: 20, priceUsd: 5.0, deliverBy: "2026-05-05", escalation: { enabled: true, pct: 8 }, filled: 6 },
  { mobile: "6500000002", company: "Mustafa Centre Imports", grade: "A", tons: 12, priceUsd: 6.2, deliverBy: "2026-05-12", escalation: { enabled: false, pct: 0 }, filled: 9 },
  { mobile: "6500000003", company: "Sheng Siong Wholesale", grade: "B", tons: 35, priceUsd: 3.4, deliverBy: "2026-04-28", escalation: { enabled: true, pct: 5 }, filled: 10 },
  { mobile: "6500000004", company: "Little India Traders", grade: "A", tons: 8, priceUsd: 4.1, deliverBy: "2026-05-20", escalation: { enabled: false, pct: 0 }, filled: 0 },
];

/** Idempotent: only seeds when there are no requirements yet. */
export async function seedIfEmpty() {
  if (await Requirement.countDocuments()) return false;
  for (const { mobile, company, ...r } of BUYERS) {
    const buyer = await User.findOneAndUpdate({ mobile }, { mobile, role: "buyer", company, name: company }, { upsert: true, new: true });
    await Requirement.create({ ...r, buyer: buyer._id, buyerName: company });
  }
  return true;
}
