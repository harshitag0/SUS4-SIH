import mongoose from "mongoose";

/**
 * Crop record (cropId) for one farmer and season, optionally linked to the procurement agreement whose lots (batches)
 * the fruit goes into. Stage assessments link farmer ↔ crop ↔ batch (Module 2 lot id, once the lot exists).
 */
const cropSchema = new mongoose.Schema({
  cropId: { type: String, unique: true, index: true },
  farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  m2FarmerId: String,
  fpo: { id: String, name: String },
  variety: String,
  season: Number,
  plot: String,
  trees: Number,
  district: String,
  agreementId: { type: String, index: true },
  status: { type: String, enum: ["active", "closed"], default: "active" },
}, { timestamps: true });

const photoSchema = new mongoose.Schema({ n: Number, key: String, sha256: String, size: Number, type: String }, { _id: false });

const assessmentSchema = new mongoose.Schema({
  assessmentId: { type: String, unique: true, index: true },
  cropId: { type: String, index: true },
  farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  m2FarmerId: String,
  fpoId: { type: String, index: true },
  batchId: { type: String, index: true },          // Module 2 lot id (batch), when the fruit is in a lot
  stage: { key: String, name: String, order: Number },
  version: { type: Number, default: 1 },
  previousId: String,
  entries: mongoose.Schema.Types.Mixed,
  photos: [photoSchema],
  report: mongoose.Schema.Types.Mixed,              // provisional AI + rules report; never an approval by itself
  status: { type: String, enum: ["pending_review", "approved", "rejected", "requires_correction"], default: "pending_review", index: true },
  review: { decision: String, remarks: String, confirmedNotAssessable: Boolean, by: String, byUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, at: Date },
  certificateId: String,
  certificateError: String,
  audit: [{ _id: false, at: Date, actorRole: String, actorName: String, action: String, details: mongoose.Schema.Types.Mixed, prevHash: String, hash: String }],
}, { timestamps: true });
assessmentSchema.index({ cropId: 1, "stage.key": 1, version: -1 });

export const Crop = mongoose.models.Crop || mongoose.model("Crop", cropSchema);
export const StageAssessment = mongoose.models.StageAssessment || mongoose.model("StageAssessment", assessmentSchema);
