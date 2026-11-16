import { Router } from "express";
import { z } from "zod";
import { HttpError, wrap } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { User } from "../users/model.js";
import { Requirement } from "../requirements/model.js";
import { expectedYield, committedTons } from "../farmers/service.js";
import { Bond } from "./model.js";
import { makeSignature, verifyBond } from "./signing.js";
import { precheck } from "./precheck.js";
import { createFromBond } from "../contracts/service.js";

const shortId = (b) => String(b._id).slice(-6);
const otherParty = (b, role) => (role === "farmer" ? b.buyer : b.farmer);

export default function bondsModule({ notifier, ml, weather }) {
  const r = Router();
  r.use(requireAuth());

  // "Check before you sign" for a new commitment: ?requirementId=...&tons=...
  r.get("/precheck", requireAuth("farmer"), wrap(async (req, res) => {
    const { requirementId, tons } = z.object({ requirementId: z.string(), tons: z.coerce.number().positive() }).parse(req.query);
    const user = await User.findById(req.auth.id);
    if (!user?.farm) throw new HttpError(409, "Complete your farm profile first", "needs_onboarding");
    const reqt = await Requirement.findById(requirementId);
    if (!reqt) throw new HttpError(404, "Requirement not found");
    res.json(await precheck({ user, reqt, tons, ml, weather }));
  }));

  // Bonds I am a party to
  r.get("/", wrap(async (req, res) => {
    const key = req.auth.role === "farmer" ? "farmer" : "buyer";
    res.json(await Bond.find({ [key]: req.auth.id }).sort({ createdAt: -1 }));
  }));

  // Farmer drafts a bond against a requirement, limited by remaining need and own free capacity
  r.post("/", requireAuth("farmer"), wrap(async (req, res) => {
    const { requirementId, tons } = z.object({ requirementId: z.string(), tons: z.coerce.number().positive() }).parse(req.body);
    const farmer = await User.findById(req.auth.id);
    if (!farmer?.farm) throw new HttpError(409, "Complete your farm profile first", "needs_onboarding");
    const reqt = await Requirement.findById(requirementId);
    if (!reqt) throw new HttpError(404, "Requirement not found");
    const left = reqt.tons - reqt.filled;
    const free = Math.max(0, expectedYield(farmer.farm).gradeATons - (await committedTons(farmer._id)));
    if (tons > left) throw new HttpError(400, `Only ${left.toFixed(1)} t still needed`, "exceeds_need");
    if (tons > free) throw new HttpError(400, `Only ${free.toFixed(1)} t of your capacity is free`, "exceeds_capacity");
    const bond = await Bond.create({
      requirement: reqt._id, buyer: reqt.buyer, farmer: farmer._id, buyerName: reqt.buyerName,
      farmerName: `${farmer.name} · ${farmer.farm.village}`, grade: reqt.grade, tons, priceUsd: reqt.priceUsd,
      deliverBy: reqt.deliverBy, escalation: reqt.escalation,
    });
    await Requirement.updateOne({ _id: reqt._id }, { $inc: { interested: 1 } });
    // every commitment gets a formal digital agreement (draft) that both parties sign
    const agreement = await createFromBond(bond._id);
    await notifier.toUsers([reqt.buyer], "bond_new", { bondId: shortId(bond), farmer: bond.farmerName, tons, grade: bond.grade, agreementId: agreement.agreementId });
    notifier.changed("bonds", "requirements");
    res.status(201).json(bond);
  }));

  async function mine(req) {
    const bond = await Bond.findById(req.params.id);
    const isParty = bond && [String(bond.buyer), String(bond.farmer)].includes(req.auth.id);
    if (!isParty) throw new HttpError(404, "Agreement not found");
    return bond;
  }

  r.post("/:id/sign", wrap(async (req, res) => {
    const bond = await mine(req);
    const side = req.auth.role;
    if (bond.sigs?.[side]?.hash) throw new HttpError(409, "Already signed", "already_signed");
    bond.sigs = { ...(bond.sigs?.toObject?.() || {}), [side]: makeSignature(bond, side) };
    if (bond.sigs.buyer?.hash && bond.sigs.farmer?.hash) {
      bond.status = "active";
      await Requirement.updateOne({ _id: bond.requirement }, { $inc: { filled: bond.tons } });
    } else {
      bond.status = `${side}_signed`;
    }
    await bond.save();
    const data = { bondId: shortId(bond), buyer: bond.buyerName, farmer: bond.farmerName, tons: bond.tons, by: side };
    if (bond.status === "active") await notifier.toUsers([bond.buyer, bond.farmer], "bond_active", data);
    else await notifier.toUsers([otherParty(bond, side)], "bond_signed", data);
    notifier.changed("bonds", "requirements");
    res.json(bond);
  }));

  // "Check before you sign" for an existing draft agreement (farmer side)
  r.get("/:id/precheck", requireAuth("farmer"), wrap(async (req, res) => {
    const bond = await mine(req);
    const [user, reqt] = await Promise.all([User.findById(req.auth.id), Requirement.findById(bond.requirement)]);
    if (!reqt) throw new HttpError(404, "Requirement not found");
    // this bond's tons are already counted as committed, so add them back when checking capacity
    res.json(await precheck({ user, reqt, tons: bond.tons, ml, weather, excludeTons: bond.tons }));
  }));

  r.get("/:id/verify", wrap(async (req, res) => {
    res.json({ ok: verifyBond(await mine(req)) });
  }));

  // Decline / withdraw a bond that is not yet final and not yet signed by me
  r.delete("/:id", wrap(async (req, res) => {
    const bond = await mine(req);
    if (bond.status === "active" || bond.sigs?.[req.auth.role]?.hash) throw new HttpError(409, "Cannot decline a signed agreement", "locked");
    await bond.deleteOne();
    await notifier.toUsers([otherParty(bond, req.auth.role)], "bond_declined", { bondId: shortId(bond), buyer: bond.buyerName, farmer: bond.farmerName, by: req.auth.role });
    notifier.changed("bonds");
    res.json({ ok: true });
  }));

  return { path: "/bonds", router: r };
}
