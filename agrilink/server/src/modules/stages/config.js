import mongoose from "mongoose";

/**
 * Crop lifecycle stages (configurable). Each stage defines:
 *  - fields       what the farmer records (validated server-side)
 *  - checks       how the assessment is scored. Sources:
 *                   farmer : rule on a field the farmer entered (self-declared, shown as such)
 *                   ai     : measurement from AgriLink image analysis (only for stages where fruit is visible)
 *                   photo  : photo-level measurement (e.g. vegetation share) — never a plant-health verdict
 *  - aiMode       "fruit" (fruit grading + photo-quality gate) or "photo" (photo-quality gate only)
 *  - notAssessable  parameters a photo cannot verify for this stage; the consultant must confirm them on site/records
 * Operations (AgriLink admin desk) can enable/disable, rename, reorder and edit guidance (StageConfig overrides).
 * Thresholds are starting values for Alphonso; an agronomist should validate them before real use.
 */
export const DEFAULT_STAGES = [
  {
    key: "seed_selection", name: "Seed Selection", order: 1, aiMode: "photo", minPhotos: 1, requiresBatch: false,
    guidance: "Planting material: seed lot or grafted sapling with its label or nursery bill. For established orchards, record the original planting material.",
    fields: [
      { key: "source_type", label: "Planting material source", type: "select", options: ["Certified nursery", "Own seed / grafts", "Other"], required: true },
      { key: "supplier", label: "Nursery / supplier name", type: "text", required: true },
      { key: "variety_confirmed", label: "Variety label / bill confirms the variety", type: "boolean", required: true },
      { key: "success_pct", label: "Germination or graft success (%)", type: "number", min: 0, max: 100 },
    ],
    checks: [
      { key: "certified_source", label: "Planting material from a certified nursery", source: "farmer", field: "source_type", rule: { equals: "Certified nursery" }, severity: "warn" },
      { key: "variety_confirmed", label: "Variety confirmed by label or bill", source: "farmer", field: "variety_confirmed", rule: { equals: true }, severity: "fail" },
      { key: "success_rate", label: "Germination / graft success at least 80%", source: "farmer", field: "success_pct", rule: { min: 80 }, severity: "warn" },
    ],
    notAssessable: ["Genetic purity of the variety", "Seed viability", "Disease-free status of planting material"],
  },
  {
    key: "sowing_planting", name: "Sowing and Planting", order: 2, aiMode: "photo", minPhotos: 1, requiresBatch: false,
    guidance: "Photo of the planted pits or saplings showing spacing. Note the planting date and spacing.",
    fields: [
      { key: "planting_date", label: "Planting date", type: "date", required: true },
      { key: "spacing_m", label: "Spacing between plants (m)", type: "number", min: 1, max: 20, required: true },
      { key: "pits_with_manure", label: "Pits filled with manure / compost", type: "boolean", required: true },
      { key: "irrigation", label: "Irrigation", type: "select", options: ["Drip", "Well / hose", "Rain-fed"], required: true },
    ],
    checks: [
      { key: "spacing", label: "Spacing within 7–12 m (Alphonso)", source: "farmer", field: "spacing_m", rule: { min: 7, max: 12 }, severity: "warn" },
      { key: "pits", label: "Pits prepared with manure", source: "farmer", field: "pits_with_manure", rule: { equals: true }, severity: "warn" },
    ],
    notAssessable: ["Soil fertility and pH", "Planting depth", "Root health"],
  },
  {
    key: "crop_growth", name: "Crop Growth", order: 3, aiMode: "photo", minPhotos: 2, requiresBatch: false,
    guidance: "Whole-tree photo and a close photo of leaves in daylight.",
    fields: [
      { key: "last_nutrient_date", label: "Last fertiliser / manure application", type: "date" },
      { key: "pest_pressure", label: "Pest pressure observed", type: "select", options: ["None", "Low", "Moderate", "Severe"], required: true },
      { key: "disease_signs", label: "Disease signs seen (spots, wilting, mildew)", type: "boolean", required: true },
      { key: "irrigation_ok", label: "Irrigation on schedule", type: "boolean", required: true },
    ],
    checks: [
      { key: "pests", label: "No severe pest pressure", source: "farmer", field: "pest_pressure", rule: { failIn: ["Severe"], warnIn: ["Moderate"] }, severity: "fail" },
      { key: "disease", label: "No disease signs reported", source: "farmer", field: "disease_signs", rule: { equals: false }, severity: "warn" },
      { key: "irrigation", label: "Irrigation on schedule", source: "farmer", field: "irrigation_ok", rule: { equals: true }, severity: "warn" },
      { key: "plant_visible", label: "Plant foliage visible in the photos", source: "photo", metric: "vegetation_pct", rule: { min: 15 }, severity: "warn" },
    ],
    notAssessable: ["Nutrient status of leaves and soil", "Pesticide residues", "Internal pests (stem borer)"],
  },
  {
    key: "flowering_fruiting", name: "Flowering and Fruiting", order: 4, aiMode: "fruit", minPhotos: 2, requiresBatch: false,
    guidance: "Photo of flowering panicles and, once set, close photos of developing fruit.",
    fields: [
      { key: "flowering_pct", label: "Trees flowering (%)", type: "number", min: 0, max: 100, required: true },
      { key: "fruit_set", label: "Fruit set observed", type: "boolean", required: true },
      { key: "hopper_or_mildew", label: "Mango hopper or powdery mildew seen", type: "boolean", required: true },
      { key: "spray_log_kept", label: "Spray record kept (product, date, dose)", type: "boolean", required: true },
    ],
    checks: [
      { key: "hopper", label: "No hopper / powdery mildew reported", source: "farmer", field: "hopper_or_mildew", rule: { equals: false }, severity: "warn" },
      { key: "spray_log", label: "Spray record kept", source: "farmer", field: "spray_log_kept", rule: { equals: true }, severity: "warn" },
      { key: "fruit_blemish", label: "Developing fruit blemishes at most 10% of visible skin", source: "ai", metric: "defect_pct", rule: { max: 10, failAbove: 25 }, severity: "warn", weight: 2 },
    ],
    notAssessable: ["Pollination success", "Spray residue levels", "Internal fruit defects"],
  },
  {
    key: "harvesting", name: "Harvesting", order: 5, aiMode: "fruit", minPhotos: 3, requiresBatch: false,
    guidance: "Three close daylight photos of harvested fruit, as in the photo check.",
    fields: [
      { key: "harvest_date", label: "Harvest date", type: "date", required: true },
      { key: "maturity_check", label: "Maturity check used", type: "select", options: ["Shoulders developed", "Float / sinking test", "Days after fruit set", "None"], required: true },
      { key: "harvest_time", label: "Harvest time", type: "select", options: ["Early morning", "Midday", "Evening"], required: true },
      { key: "with_stalk", label: "Harvested with stalk (harvester with net)", type: "boolean", required: true },
      { key: "quantity_kg", label: "Quantity harvested (kg)", type: "number", min: 0, max: 100000 },
    ],
    checks: [
      { key: "maturity", label: "A maturity check was used", source: "farmer", field: "maturity_check", rule: { failIn: ["None"] }, severity: "fail" },
      { key: "time", label: "Harvested in cool hours", source: "farmer", field: "harvest_time", rule: { warnIn: ["Midday"] }, severity: "warn" },
      { key: "stalk", label: "Harvested with stalk", source: "farmer", field: "with_stalk", rule: { equals: true }, severity: "warn" },
      { key: "blemish", label: "Blemishes at most 5% of visible skin", source: "ai", metric: "defect_pct", rule: { max: 5, failAbove: 15 }, severity: "warn", weight: 2 },
      { key: "not_tree_ripened", label: "Skin colour not fully ripened on the tree", source: "ai", metric: "colour_score", rule: { max: 0.9 }, severity: "warn", weight: 1 },
    ],
    notAssessable: ["Internal quality (spongy tissue)", "Sugar content (TSS)", "Exact maturity in days"],
  },
  {
    key: "post_harvest", name: "Post-Harvest Handling", order: 6, aiMode: "fruit", minPhotos: 2, requiresBatch: false,
    guidance: "Photos of fruit in crates after de-sapping, kept in shade.",
    fields: [
      { key: "desapped", label: "Fruit de-sapped stem-down", type: "boolean", required: true },
      { key: "hot_water", label: "Hot-water treatment done", type: "boolean" },
      { key: "shade", label: "Kept in shade until collection", type: "boolean", required: true },
      { key: "hours_to_collection", label: "Hours from harvest to collection", type: "number", min: 0, max: 240, required: true },
    ],
    checks: [
      { key: "desap", label: "De-sapped", source: "farmer", field: "desapped", rule: { equals: true }, severity: "fail" },
      { key: "shade", label: "Kept in shade", source: "farmer", field: "shade", rule: { equals: true }, severity: "warn" },
      { key: "hours", label: "Collected within 12 hours", source: "farmer", field: "hours_to_collection", rule: { max: 12 }, severity: "warn" },
      { key: "blemish", label: "Sap burn / bruising at most 5% of visible skin", source: "ai", metric: "defect_pct", rule: { max: 5, failAbove: 15 }, severity: "warn", weight: 2 },
    ],
    notAssessable: ["Temperature history", "Internal bruising", "Pathogen load"],
  },
  {
    key: "grading_packaging", name: "Grading and Packaging", order: 7, aiMode: "fruit", minPhotos: 3, requiresBatch: true,
    guidance: "Photos of graded fruit in the packed carton and of the carton label. Choose the lot (batch) it belongs to.",
    fields: [
      { key: "declared_grade", label: "Declared grade", type: "select", options: ["A", "B"], required: true },
      { key: "carton_type", label: "Carton", type: "select", options: ["Ventilated corrugated", "Other"], required: true },
      { key: "fruit_per_carton", label: "Fruit per carton", type: "number", min: 1, max: 60 },
      { key: "labelled", label: "Cartons labelled (lot, grade, FPO)", type: "boolean", required: true },
    ],
    checks: [
      { key: "blemish_for_grade", label: "Blemishes within the declared grade (A ≤ 5%, B ≤ 15%)", source: "ai", metric: "defect_pct", rule: { maxBy: { field: "declared_grade", A: 5, B: 15 }, failAbove: 15 }, severity: "fail", weight: 2 },
      { key: "carton", label: "Ventilated cartons", source: "farmer", field: "carton_type", rule: { equals: "Ventilated corrugated" }, severity: "warn" },
      { key: "label", label: "Cartons labelled", source: "farmer", field: "labelled", rule: { equals: true }, severity: "warn" },
    ],
    notAssessable: ["Fruit weight (checked at packhouse weighing)", "Internal quality", "Phytosanitary status"],
  },
];

const configSchema = new mongoose.Schema({
  _id: { type: String, default: "stages" },
  overrides: [{ _id: false, key: String, name: String, enabled: Boolean, order: Number, guidance: String }],
  updatedBy: String,
}, { timestamps: true });
export const StageConfig = mongoose.models.StageConfig || mongoose.model("StageConfig", configSchema);

/** Effective stage list: defaults + saved overrides, sorted; disabled stages included with enabled=false. */
export async function loadStages() {
  const cfg = await StageConfig.findById("stages");
  const ov = new Map((cfg?.overrides || []).map((o) => [o.key, o]));
  return DEFAULT_STAGES.map((s) => {
    const o = ov.get(s.key) || {};
    return { ...s, name: o.name || s.name, order: o.order ?? s.order, guidance: o.guidance || s.guidance, enabled: o.enabled ?? true };
  }).sort((a, b) => a.order - b.order);
}

export async function stageByKey(key) {
  const s = (await loadStages()).find((x) => x.key === key);
  return s || null;
}
