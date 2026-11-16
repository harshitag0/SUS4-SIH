import { Bond } from "../bonds/model.js";

const GRADE_A_SHARE = 55; // % of Singapore demand/typical orchard output that is export Grade A (dummy)

/** Marketable fruit per tree by tree age (kg), consistent with the cost data (~1,400 kg/acre at 40 trees/acre).
 *  Assumption — replace with measured yields per FPO. */
export function kgPerTree(age) {
  return age < 5 ? 5 : age < 10 ? 20 : age < 20 ? 35 : 40;
}

/** Inputs the Python cost engine needs for this farm. */
export function costInputs(user, extra = {}) {
  const y = expectedYield(user.farm);
  const f = user.farm;
  const last = (user.costs || []).slice().sort((a, b) => b.year - a.year)[0];
  return {
    district: f.district, acres: f.acres, trees: f.trees, age: f.age, irrigation: f.irrigation,
    tons: y.tons, grade_a_tons: y.gradeATons,
    ...(last && { actual: { year: last.year, components: last.components } }),
    ...extra,
  };
}

export function expectedYield(farm) {
  const tons = +((farm.trees * kgPerTree(farm.age)) / 1000).toFixed(1);
  const share = (GRADE_A_SHARE + (farm.irrigation === "drip" ? 5 : farm.irrigation === "rain" ? -5 : 0)) / 100;
  return { tons, gradeATons: +(tons * share).toFixed(1) };
}

export async function committedTons(farmerId) {
  const rows = await Bond.aggregate([{ $match: { farmer: farmerId } }, { $group: { _id: null, t: { $sum: "$tons" } } }]);
  return +(rows[0]?.t || 0).toFixed(1);
}

export async function farmSummary(user, ml) {
  const y = expectedYield(user.farm);
  const committed = await committedTons(user._id);
  const price = await ml.price("A", user.farm.district);
  const w = price.harvest_window;
  return {
    expectedTons: y.tons,
    gradeATons: y.gradeATons,
    committedTons: committed,
    freeTons: Math.max(0, +(y.gradeATons - committed).toFixed(1)),
    window: { start: w.start, end: w.end },
    windowAvgPrice: w.avg_price,
    priceDropPct: w.drop_pct,
    earningInr: Math.round(y.gradeATons * 1000 * w.avg_price),
  };
}
