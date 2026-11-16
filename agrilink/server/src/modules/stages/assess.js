import { HttpError } from "../../lib/http.js";

/**
 * Stage assessment: validate the farmer's entries, run the existing AgriLink image analysis, build the report.
 * The report is PROVISIONAL until an authorised consultant decides. Nothing is invented: a check whose input is
 * missing, or whose photo measurement is unavailable, is reported as "not_assessed" and excluded from the score.
 */
const SCORE = { pass: 1, warn: 0.5, fail: 0 };

export function validateEntries(stage, raw = {}) {
  const out = {}, errors = [];
  for (const f of stage.fields) {
    let v = raw[f.key];
    if (v === "" || v === undefined || v === null) {
      if (f.required) errors.push(`${f.label} is required`);
      continue;
    }
    if (f.type === "number") {
      v = Number(v);
      if (!Number.isFinite(v)) { errors.push(`${f.label} must be a number`); continue; }
      if (f.min != null && v < f.min) errors.push(`${f.label} must be at least ${f.min}`);
      if (f.max != null && v > f.max) errors.push(`${f.label} must be at most ${f.max}`);
    } else if (f.type === "boolean") {
      if (typeof v === "string") v = v === "true";
      if (typeof v !== "boolean") { errors.push(`${f.label} must be yes or no`); continue; }
    } else if (f.type === "select") {
      if (!f.options.includes(v)) { errors.push(`${f.label}: choose one of ${f.options.join(", ")}`); continue; }
    } else if (f.type === "date") {
      if (Number.isNaN(Date.parse(v))) { errors.push(`${f.label} must be a date`); continue; }
      v = String(v).slice(0, 10);
    } else {
      v = String(v).trim().slice(0, 200);
    }
    out[f.key] = v;
  }
  if (errors.length) throw new HttpError(400, errors.join("; "), "invalid_entries");
  return out;
}

function judge(rule, value, entries) {
  if (rule.equals !== undefined) return value === rule.equals ? "pass" : null;
  if (rule.failIn || rule.warnIn) return rule.failIn?.includes(value) ? "fail" : rule.warnIn?.includes(value) ? "warn" : "pass";
  let max = rule.max;
  if (rule.maxBy) max = rule.maxBy[entries[rule.maxBy.field]];
  if (rule.failAbove != null && value > rule.failAbove) return "fail";
  if (rule.min != null && value < rule.min) return null;
  if (max != null && value > max) return null;
  return "pass";
}

function expected(rule, entries) {
  if (rule.equals !== undefined) return rule.equals === true ? "Yes" : rule.equals === false ? "No" : String(rule.equals);
  if (rule.failIn || rule.warnIn) return `Not ${[...(rule.failIn || []), ...(rule.warnIn || [])].join(" / ")}`;
  const max = rule.maxBy ? rule.maxBy[entries[rule.maxBy.field]] : rule.max;
  return [rule.min != null ? `≥ ${rule.min}` : null, max != null ? `≤ ${max}` : null].filter(Boolean).join(" and ");
}

const ISSUE = {
  too_dark: "Photo too dark", overexposed: "Photo over-exposed", blurry: "Photo blurry", low_resolution: "Photo resolution too low",
  not_an_image: "File is not an image", no_fruit_found: "No fruit found in photo", fruit_too_small: "Fruit too small in photo",
};

/**
 * vision = { available, error, photoQuality: {model, photos:[{usable, issues, vegetation_pct,...}]}, fruit: <ML /vision/analyze result> | null }
 */
export function buildReport(stage, entries, vision, photoMeta) {
  const checks = [], issues = [], remarks = [];
  const pq = vision.photoQuality?.photos || [];
  const usablePhotos = pq.filter((p) => p.usable);
  const photoMetric = (metric) => (usablePhotos.length ? usablePhotos.reduce((s, p) => s + (p[metric] || 0), 0) / usablePhotos.length : null);
  const fruit = vision.fruit && vision.fruit.photos_used > 0 && vision.fruit.confidence >= 0.6 ? vision.fruit : null;

  for (const c of stage.checks) {
    let value = null, why = null;
    if (c.source === "farmer") value = entries[c.field] ?? null;
    else if (c.source === "photo") { value = photoMetric(c.metric); if (value == null) why = "no usable photo"; }
    else if (c.source === "ai") {
      if (!vision.available) why = "AI image analysis unavailable";
      else if (!fruit) why = vision.fruit?.photos_used === 0 ? "no fruit detected in the photos" : "photos not clear enough for fruit measurement";
      else value = fruit[c.metric];
    }
    if (c.rule.maxBy && entries[c.rule.maxBy.field] === undefined) { value = null; why = `${c.rule.maxBy.field} not entered`; }
    let status = "not_assessed";
    if (value !== null && value !== undefined) {
      const j = judge(c.rule, value, entries);
      status = j || (c.severity === "fail" ? "fail" : "warn");
    } else if (!why) why = "not entered";
    checks.push({ key: c.key, label: c.label, source: c.source, value: typeof value === "number" ? Math.round(value * 100) / 100 : value,
      expected: expected(c.rule, entries), status, weight: c.weight || 1, note: status === "not_assessed" ? why : null });
    if (status === "fail" || status === "warn") issues.push({ code: c.key, label: c.label, severity: status === "fail" ? "high" : "medium", source: c.source });
  }

  pq.forEach((p, i) => (p.issues || []).forEach((code) => issues.push({ code: `photo_${code}`, label: `Photo ${i + 1}: ${ISSUE[code] || code}`, severity: "low", source: "photo" })));
  if (!vision.available) remarks.push(`AI image analysis was not available (${vision.error || "service unreachable"}); image-based checks were not assessed.`);
  if (vision.available && !usablePhotos.length) {
    issues.push({ code: "no_usable_photo", label: "No usable photo for assessment", severity: "high", source: "photo" });
    remarks.push("None of the photos passed the photo-quality check (light, sharpness). Retake them in daylight.");
  }
  if (stage.aiMode === "fruit" && vision.available) {
    if (fruit) {
      remarks.push(`Fruit measured on ${fruit.photos_used} photo(s): blemishes ${fruit.defect_pct}% of visible skin, colour score ${fruit.colour_score}, AI confidence ${fruit.confidence}.`);
      for (const n of (fruit.notes || []).filter((x) => /doctor-graded|Learned grader|anthracnose/i.test(x))) remarks.push(n);
      if ((fruit.flags || []).includes("anthracnose")) issues.push({ code: "possible_anthracnose", label: "Many dark lesions — possible anthracnose", severity: "high", source: "ai" });
    } else remarks.push("Fruit measurements were not taken: no clear fruit was found in the photos.");
  }
  if (stage.aiMode === "photo") remarks.push("For this stage the photos are checked for clarity only; AgriLink has no image model for this stage, so the consultant reviews them.");
  remarks.push(`Not verifiable from photos: ${stage.notAssessable.join("; ")}. The consultant confirms these on site or from records.`);

  const evaluated = checks.filter((c) => c.status !== "not_assessed");
  const totalW = evaluated.reduce((s, c) => s + c.weight, 0);
  const score = totalW ? Math.round((evaluated.reduce((s, c) => s + SCORE[c.status] * c.weight, 0) / totalW) * 100) : null;
  const hasFail = evaluated.some((c) => c.status === "fail") || issues.some((i) => i.severity === "high");
  const aiChecks = checks.filter((c) => c.source === "ai");
  const insufficient = !usablePhotos.length || (aiChecks.length && aiChecks.every((c) => c.status === "not_assessed")) || evaluated.length < Math.ceil(checks.length / 2);
  const provisionalCompliance = hasFail ? "issues_found" : insufficient ? "insufficient_evidence" : evaluated.some((c) => c.status === "warn") ? "minor_issues" : "likely_compliant";

  return {
    provisional: true,
    qualityScore: score,
    coverage: { evaluated: evaluated.length, total: checks.length },
    provisionalCompliance,
    issues, checks, remarks,
    imageEvidence: photoMeta.map((m, i) => ({ ...m, usable: pq[i]?.usable ?? null, issues: pq[i]?.issues || [],
      measurements: pq[i] ? { brightness: pq[i].brightness, sharpness: pq[i].sharpness, vegetation_pct: pq[i].vegetation_pct } : null,
      fruit: vision.fruit?.photos?.[i] ? { is_fruit: vision.fruit.photos[i].is_fruit, defect_pct: vision.fruit.photos[i].defect_pct, colour_score: vision.fruit.photos[i].colour_score } : null })),
    ai: { available: vision.available, error: vision.error || null, models: [vision.photoQuality?.model, vision.fruit?.model].filter(Boolean),
      fruit: fruit ? { defect_pct: fruit.defect_pct, colour_score: fruit.colour_score, confidence: fruit.confidence, grade_hint: fruit.grade_hint, flags: fruit.flags } : null },
    notAssessable: stage.notAssessable,
  };
}

/** Calls the existing ML vision service. Never throws: an outage becomes {available:false}. */
export function createVision(baseUrl) {
  async function post(path, photos) {
    const fd = new FormData();
    photos.forEach((p, i) => fd.append("files", new Blob([p.buf], { type: p.type || "image/jpeg" }), `photo${i}.jpg`));
    const res = await fetch(new URL(path, baseUrl), { method: "POST", body: fd, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`vision service ${res.status}`);
    return res.json();
  }
  return {
    async assess(stage, photos) {
      try {
        const [photoQuality, fruit] = await Promise.all([
          post("/vision/photo-quality", photos),
          stage.aiMode === "fruit" ? post("/vision/analyze", photos) : Promise.resolve(null),
        ]);
        if (fruit) delete fruit.features;
        return { available: true, photoQuality, fruit };
      } catch (e) {
        return { available: false, error: String(e.message).slice(0, 120), photoQuality: null, fruit: null };
      }
    },
  };
}
