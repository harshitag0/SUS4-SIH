import { Agreement } from "../contracts/model.js";
import { m2Get } from "../certificates/m2.js";
import { m2Id } from "../module2/handoff.js";
import { Crop, StageAssessment } from "../stages/model.js";
import { alertsFor } from "../alerts/routes.js";
import { PLAYBOOK } from "./knowledge.js";

/**
 * Personalised recommendation engine for one farmer.
 * Gathers every source concurrently, compares the farmer's latest measured quality with the buyer's contracted grade,
 * and turns each detected gap into a recommendation from the playbook. A gap is only raised from real evidence
 * (a measurement, an inspection, the farmer's own record, a consultant decision or a live weather alert); the evidence
 * and its date are attached so the farmer and farmer doctor can see why. Nothing is diagnosed from missing data.
 */
const DAY = 86400000;
const ADD = (d, n) => new Date(new Date(d).getTime() + n * DAY);
const SPEC_FALLBACK = { grade_a: { max_defect_pct: 5, min_colour: 0.7, min_weight_g: 200 }, grade_b: { max_defect_pct: 15, min_colour: 0.5, min_weight_g: 170 } };
const safe = async (fn, fallback = null) => { try { return await fn(); } catch { return fallback; } };
const latest = (list, key, pred = () => true) => (list || []).filter(pred).sort((a, b) => new Date(b[key]) - new Date(a[key]))[0] || null;

export async function gather(user, { ml, weather }) {
  const fid = m2Id.farmer(String(user._id));
  const [crops, agreements, meta, clock, checks, reviews, visits, interventions, wx] = await Promise.all([
    Crop.find({ farmer: user._id, status: "active" }),
    Agreement.find({ farmer: user._id, "chain.status": "registered" }).select("agreementId terms"),
    safe(() => m2Get("/meta")),
    safe(() => m2Get("/system/clock")),
    safe(() => m2Get("/quality-checks", { farmer_id: fid }), []),
    safe(() => m2Get("/quality-reviews", { farmer_id: fid }), []),
    safe(() => m2Get("/doctor-visits", { farmer_id: fid }), []),
    safe(async () => (await m2Get("/interventions")).filter((i) => i.farmer_id === fid), []),
    user.farm && ml?.alerts ? safe(() => alertsFor(user, ml, weather)) : null,
  ]);
  const [assessments, m2Agreements] = await Promise.all([
    StageAssessment.find({ cropId: { $in: crops.map((c) => c.cropId) } }).sort({ version: -1 }),
    Promise.all(agreements.map((a) => safe(() => m2Get(`/agreements/${encodeURIComponent(a.agreementId)}`)))),
  ]);
  return { user, fid, crops, assessments, agreements: m2Agreements.filter(Boolean), spec: meta?.quality_spec || SPEC_FALLBACK,
    now: clock?.now ? new Date(clock.now) : new Date(), checks: checks || [], reviews: reviews || [], visits: visits || [],
    interventions: interventions || [], weather: wx, sources: { module2: !!meta, weather: !!wx } };
}

/** Detect gaps. Each gap: { code, key, evidence[], reason:{type, params}, notes[], cropId?, agreementId?, stage? } */
export function detect(g) {
  const gaps = [];
  const add = (gap) => { if (!gaps.some((x) => x.key === gap.key)) gaps.push(gap); };
  const myCommitment = (a) => (a.commitments || []).find((c) => c.farmer_id === g.fid);

  // 1. buyer specification vs latest measured quality (per contract)
  const specRows = [];
  const RANK = { A: 2, B: 1, REJECT: 0 };
  const lastDoctor = latest(g.visits.filter((v) => v.status === "COMPLETED" && v.finding), "completed_at");
  for (const a of g.agreements) {
    const cm = myCommitment(a);
    if (!cm) continue;
    const grade = a.required_grade || "A";
    const s = g.spec[`grade_${grade.toLowerCase()}`] || g.spec.grade_a;
    const chk = latest(g.checks.filter((c) => c.agreement_id === a.id && c.cv && c.cv.confidence >= (g.spec.min_cv_confidence || 0.6)), "analysed_at");
    const cv = chk?.cv;
    specRows.push({ agreementId: a.id, grade, buyer: a.buyer_name, measuredAt: chk?.analysed_at || null,
      rows: [
        { key: "blemish", label: "Blemishes (% of skin)", required: `≤ ${s.max_defect_pct}`, current: cv ? cv.defect_pct : null, ok: cv ? cv.defect_pct <= s.max_defect_pct : null, source: "AI photo check" },
        { key: "colour", label: "Colour score", required: `≥ ${s.min_colour}`, current: cv ? cv.colour_score : null, ok: cv ? cv.colour_score >= s.min_colour : null, source: "AI photo check" },
        { key: "flags", label: "Pest / disease flags", required: "none", current: cv ? (cv.flags || []).join(", ") || "none" : null, ok: cv ? !(cv.flags || []).length : null, source: "AI photo check" },
        { key: "review", label: "Quality review", required: "PASS", current: cm.quality_status || null, ok: cm.quality_status ? cm.quality_status === "PASS" : null, source: "Farmer doctor / review" },
        { key: "doctor", label: "Farmer-doctor grade", required: `≥ ${grade}`, current: lastDoctor?.finding?.grade || null,
          ok: lastDoctor?.finding?.grade ? (RANK[lastDoctor.finding.grade] ?? -1) >= (RANK[grade] ?? 2) : null, source: "Farmer-doctor inspection" },
        { key: "weight", label: "Fruit weight (g)", required: `≥ ${s.min_weight_g}`, current: null, ok: null, source: "Packhouse weighing (not measurable from photos)" },
      ] });
    if (cv && cv.defect_pct > s.max_defect_pct)
      add({ code: "blemish_high", key: `blemish:${a.id}`, agreementId: a.id, evidence: [{ source: "ai", label: "Blemishes", value: `${cv.defect_pct}%`, at: chk.analysed_at }],
        reason: { type: "measured_blemish", params: { value: cv.defect_pct, max: s.max_defect_pct, grade, date: day(chk.analysed_at) } } });
    if (cv && cv.colour_score < s.min_colour && g.assessments.some((x) => ["harvesting", "post_harvest", "grading_packaging"].includes(x.stage.key)))
      add({ code: "colour_low", key: `colour:${a.id}`, agreementId: a.id, evidence: [{ source: "ai", label: "Colour score", value: cv.colour_score, at: chk.analysed_at }],
        reason: { type: "measured_colour", params: { value: cv.colour_score, min: s.min_colour, grade, date: day(chk.analysed_at) } } });

    // harvest readiness: window opening soon but quality not cleared
    const start = a.harvest_window?.start ? new Date(a.harvest_window.start) : null;
    const daysTo = start ? Math.round((start - g.now) / DAY) : null;
    if (daysTo != null && daysTo >= -3 && daysTo <= 14 && cm.quality_status !== "PASS")
      add({ code: "harvest_readiness", key: `readiness:${a.id}`, agreementId: a.id, evidence: [{ source: "contract", label: "Harvest window opens", value: day(start) }, { source: "review", label: "Quality status", value: cm.quality_status || "not reviewed" }],
        reason: { type: "readiness", params: { days: Math.max(0, daysTo), status: cm.quality_status || "—" } } });
    if (cm.quality_status === "FAIL") {
      const iv = latest(g.interventions.filter((i) => ["OPEN", "IN_PROGRESS"].includes(i.status)), "created_at");
      add({ code: "quality_failed", key: `failed:${a.id}`, agreementId: a.id, evidence: [{ source: "review", label: "Quality review", value: "FAIL" }],
        reason: { type: "review_fail", params: {} }, notes: (iv?.recommendations || []).map((r) => ({ from: r.source === "farmer_doctor" ? "Farmer doctor" : "Guidance", text: r.text })) });
    }
  }

  // 2. flags from AI and farmer-doctor findings (most recent of each)
  const flagSources = [];
  const lastCv = latest(g.checks.filter((c) => c.cv), "analysed_at");
  for (const f of lastCv?.cv?.flags || []) flagSources.push({ flag: f, by: "ai", at: lastCv.analysed_at });
  const lastVisit = latest(g.visits.filter((v) => v.status === "COMPLETED" && v.finding), "completed_at");
  for (const f of lastVisit?.finding?.pest_signs || []) flagSources.push({ flag: f, by: "doctor", at: lastVisit.completed_at });
  const FLAG = { fruit_fly_signs: "fruit_fly", anthracnose: "anthracnose", sap_burn: "sap_burn" };
  for (const { flag, by, at } of flagSources) {
    if (!FLAG[flag]) continue;
    add({ code: FLAG[flag], key: `flag:${flag}`, evidence: [{ source: by, label: flag.replace(/_/g, " "), value: by === "doctor" ? "seen by farmer doctor" : "flagged by AI (to be confirmed)", at }],
      reason: { type: by === "doctor" ? "flag_doctor" : "flag_ai", params: { date: day(at) } },
      notes: by === "doctor" && lastVisit.finding.observations ? [{ from: "Farmer doctor", text: lastVisit.finding.observations }] : [] });
  }
  if (lastVisit?.finding?.recommendations?.length)
    for (const gp of gaps.filter((x) => x.key.startsWith("flag:") || x.code === "quality_failed"))
      gp.notes = [...(gp.notes || []), ...lastVisit.finding.recommendations.map((t) => ({ from: "Farmer doctor", text: t }))];

  // 3. photo evidence: repeated unusable photos / missed checks
  const retakes = g.checks.filter((c) => c.status === "RETAKE_REQUESTED").length;
  if (retakes) add({ code: "photo_quality", key: "photo_quality", evidence: [{ source: "ai", label: "Photo checks needing retake", value: retakes }], reason: { type: "retake", params: { n: retakes } } });
  const missed = g.checks.filter((c) => c.status === "MISSED" || (["DUE", "REMINDED"].includes(c.status) && new Date(c.deadline) < g.now)).length;
  if (missed) add({ code: "missed_checks", key: "missed_checks", evidence: [{ source: "module2", label: "Missed / overdue photo checks", value: missed }], reason: { type: "missed", params: { n: missed } } });

  // 4. stage records (farmer's own entries) and consultant decisions — latest version per crop + stage
  const seen = new Set();
  for (const a of g.assessments) {
    const k = `${a.cropId}:${a.stage.key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const e = a.entries || {}, base = { cropId: a.cropId, stage: a.stage };
    const own = (label, value) => [{ source: "farmer", label, value, at: a.createdAt }];
    if (a.status === "requires_correction")
      add({ ...base, code: "stage_correction", key: `correction:${k}`, evidence: [{ source: "consultant", label: a.stage.name, value: "requires correction", at: a.review?.at }],
        reason: { type: "consultant", params: { stage: a.stage.name } }, notes: a.review?.remarks ? [{ from: a.review.by || "Farmer doctor", text: a.review.remarks }] : [] });
    if (e.hopper_or_mildew === true) add({ ...base, code: "hopper_mildew", key: `hopper:${a.cropId}`, evidence: own("Hopper / mildew seen", "Yes"), reason: { type: "farmer_reported", params: { stage: a.stage.name } } });
    if (e.spray_log_kept === false) add({ ...base, code: "no_spray_log", key: `spraylog:${a.cropId}`, evidence: own("Spray record kept", "No"), reason: { type: "farmer_reported", params: { stage: a.stage.name } } });
    if (["Moderate", "Severe"].includes(e.pest_pressure)) add({ ...base, code: "pest_pressure", key: `pests:${a.cropId}`, evidence: own("Pest pressure", e.pest_pressure), reason: { type: "farmer_reported", params: { stage: a.stage.name } } });
    if (e.disease_signs === true) add({ ...base, code: "disease_signs", key: `disease:${a.cropId}`, evidence: own("Disease signs", "Yes"), reason: { type: "farmer_reported", params: { stage: a.stage.name } } });
    if (e.maturity_check === "None" || e.harvest_time === "Midday" || e.with_stalk === false)
      add({ ...base, code: "harvest_practice", key: `harvest:${a.cropId}`, reason: { type: "farmer_reported", params: { stage: a.stage.name } },
        evidence: [e.maturity_check === "None" && own("Maturity check", "None")[0], e.harvest_time === "Midday" && own("Harvest time", "Midday")[0], e.with_stalk === false && own("Harvested with stalk", "No")[0]].filter(Boolean) });
    if (e.desapped === false) add({ ...base, code: "sap_burn", key: "flag:sap_burn", evidence: own("De-sapped", "No"), reason: { type: "farmer_reported", params: { stage: a.stage.name } } });
    if (e.shade === false || (e.hours_to_collection != null && e.hours_to_collection > 12))
      add({ ...base, code: "post_harvest_delay", key: `delay:${a.cropId}`, reason: { type: "farmer_reported", params: { stage: a.stage.name } },
        evidence: [e.shade === false && own("Kept in shade", "No")[0], e.hours_to_collection > 12 && own("Hours to collection", e.hours_to_collection)[0]].filter(Boolean) });
    const fruitBlemish = a.report?.ai?.fruit?.defect_pct;
    if (a.status !== "approved" && fruitBlemish != null && fruitBlemish > 5 && !gaps.some((x) => x.code === "blemish_high"))
      add({ ...base, code: "blemish_high", key: `blemish:stage:${a.cropId}`, evidence: [{ source: "ai", label: `Blemishes (${a.stage.name})`, value: `${fruitBlemish}%`, at: a.createdAt }],
        reason: { type: "measured_blemish", params: { value: fruitBlemish, max: 5, grade: "A", date: day(a.createdAt) } } });
  }

  // 5. live weather alerts (only when the weather feed answered)
  for (const al of g.weather?.alerts || []) {
    const code = { rain: "weather_rain", storm: "weather_storm", hail: "weather_storm", heat: "weather_heat" }[al.code];
    if (code) add({ code, key: `weather:${code}`, evidence: [{ source: "weather", label: `${al.code} alert`, value: g.weather.weather?.source === "open-meteo" ? "live forecast" : g.weather.weather?.source }],
      reason: { type: "weather", params: { rain: g.weather.weather?.rain_mm_48h, wind: Math.round(g.weather.weather?.wind_kmh || 0), temp: Math.round(g.weather.weather?.temp_c || 0) } }, ephemeral: true });
  }
  return { gaps, specRows };
}

/** Turn gaps into dated recommendations. Follow-up uses a scheduled farmer-doctor visit when one exists. */
export function plan(g, gaps) {
  const nextVisit = latest(g.visits.filter((v) => v.status === "SCHEDULED" && new Date(v.due_at) >= g.now), "due_at");
  const sev = { high: 0, medium: 1, low: 2 };
  return gaps.map((gap) => {
    const p = PLAYBOOK[gap.code];
    const due = ADD(g.now, p.timelineDays);
    let followUp = ADD(due, p.followUpDays);
    let followUpBy = "photo check / farmer doctor";
    if (nextVisit && new Date(nextVisit.due_at) >= due && new Date(nextVisit.due_at) <= followUp) { followUp = new Date(nextVisit.due_at); followUpBy = "scheduled farmer-doctor visit"; }
    return { key: gap.key, code: gap.code, category: p.category, severity: p.severity, cropId: gap.cropId || null, agreementId: gap.agreementId || null,
      stage: gap.stage ? { key: gap.stage.key, name: gap.stage.name } : null, evidence: gap.evidence, reason: gap.reason, notes: gap.notes || [],
      timelineDays: p.timelineDays, dueDate: due, followUpDate: followUp, followUpBy, sources: p.sources, ephemeral: !!gap.ephemeral };
  }).sort((a, b) => sev[a.severity] - sev[b.severity] || a.dueDate - b.dueDate);
}

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
