import mongoose from "mongoose";

const sig = new mongoose.Schema({ ts: String, prev: String, hash: String }, { _id: false });

const bondSchema = new mongoose.Schema(
  {
    requirement: { type: mongoose.Schema.Types.ObjectId, ref: "Requirement", required: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    buyerName: String,
    farmerName: String,
    grade: { type: String, enum: ["A", "B", "C"] },
    tons: { type: Number, min: 0.1 },
    priceUsd: Number,
    deliverBy: Date,
    escalation: { enabled: Boolean, pct: Number },
    status: { type: String, enum: ["draft", "buyer_signed", "farmer_signed", "active"], default: "draft" },
    sigs: { buyer: sig, farmer: sig },
  },
  { timestamps: true }
);

export const Bond = mongoose.models.Bond || mongoose.model("Bond", bondSchema);
