import mongoose from "mongoose";

const requirementSchema = new mongoose.Schema(
  {
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    buyerName: { type: String, required: true },
    variety: { type: String, default: "Alphonso" },
    grade: { type: String, enum: ["A", "B", "C"], required: true },
    tons: { type: Number, min: 1, required: true },
    priceUsd: { type: Number, min: 0.1, required: true },
    floorUsd: Number,
    deliverBy: { type: Date, required: true },
    escalation: { enabled: { type: Boolean, default: false }, pct: { type: Number, default: 0 } },
    filled: { type: Number, default: 0 },
    interested: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Requirement = mongoose.models.Requirement || mongoose.model("Requirement", requirementSchema);
