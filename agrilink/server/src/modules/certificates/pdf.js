import PDFDocument from "pdfkit";
import QRCode from "qrcode";

/** AgriLink Quality Certificate (green brand) and its revocation notice. */
const GREEN = "#15803d", DARK = "#0f2419", GREY = "#5d7066", LINE = "#d9e7dd", TINT = "#f0fdf4";
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
const kg = (v) => `${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;

function collect(doc) {
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  return new Promise((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
}

export async function renderCertificatePdf(c, verifyUrl) {
  const qr = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 220, color: { dark: DARK, light: "#ffffff" } });
  const doc = new PDFDocument({ size: "A4", margins: { top: 50, bottom: 50, left: 50, right: 50 },
    info: { Title: `${c.certificateId} — AgriLink Quality Certificate`, Author: "AgriLink", Subject: `Quality certificate for lot ${c.lotId}` } });
  const done = collect(doc);
  const W = doc.page.width - 100;

  const footer = () => {
    const { x, y } = doc, bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor(GREY)
      .text(`${c.certificateId} · Lot ${c.lotId} · Verify at ${verifyUrl}`, 50, doc.page.height - 34, { width: W, align: "center", lineBreak: false });
    doc.page.margins.bottom = bottom;
    doc.x = x; doc.y = y;
  };
  doc.on("pageAdded", footer);
  footer();

  // header band
  doc.rect(0, 0, doc.page.width, 112).fill(GREEN);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9).text("AGRILINK", 50, 34, { characterSpacing: 2 });
  doc.font("Helvetica-Bold").fontSize(22).text("Quality Certificate", 50, 48);
  doc.font("Helvetica").fontSize(10).fillColor("#dcfce7").text(`Fresh ${c.product.variety} ${c.product.crop.toLowerCase()} · ${c.product.origin}`, 50, 76);
  doc.roundedRect(doc.page.width - 50 - 96, 22, 96, 96, 8).fill("#ffffff");
  doc.image(qr, doc.page.width - 50 - 90, 28, { width: 84 });

  // id strip
  doc.y = 130;
  const strip = (items) => {
    const colW = W / items.length, y = doc.y;
    doc.roundedRect(50, y, W, 44, 6).fill(TINT);
    items.forEach(([k, v], i) => {
      doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(k.toUpperCase(), 62 + i * colW, y + 9, { width: colW - 16, characterSpacing: 0.6 });
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(DARK).text(v, 62 + i * colW, y + 21, { width: colW - 16 });
    });
    doc.y = y + 56;
  };
  strip([["Certificate", c.certificateId], ["Issued", day(c.issuedAt)], ["Valid until", day(c.validUntil)], ["Certified grade", gradeLabel(c)]]);

  const h = (t) => { doc.moveDown(0.5); doc.font("Helvetica-Bold").fontSize(11).fillColor(GREEN).text(t, 50); doc.moveTo(50, doc.y + 2).lineTo(50 + W, doc.y + 2).strokeColor(LINE).stroke(); doc.moveDown(0.5); };
  const kv = (rows) => {
    for (const [k, v] of rows) {
      const y = doc.y;
      doc.font("Helvetica").fontSize(9).fillColor(GREY).text(k, 50, y, { width: 150 });
      doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK).text(String(v ?? "—"), 205, y, { width: W - 155 });
      doc.y = Math.max(doc.y, y + 14);
    }
  };

  h("1. Consignment");
  kv([
    ["Lot", c.lotId], ["Procurement agreement", c.agreementId], ["Buyer", c.buyer.name], ["FPO (collection point)", c.fpo.name],
    ["Collected", day(c.trace.collectedAt)], ["Quantity", kg(c.totalKg)],
    ["Grade mix", Object.entries(c.gradeMix || {}).map(([g, v]) => `Grade ${g}: ${kg(v)}`).join(" · ")],
    ["Contract requirement", `Grade ${c.requiredGrade} or better`],
  ]);

  h("2. Growers and grades");
  const cols = [["Grower", 150], ["Quantity", 70], ["Lot grade", 60], ["Farmer doctor", 110], ["AI photo check", W - 390]];
  let y = doc.y;
  doc.rect(50, y, W, 18).fill(TINT);
  let x = 56;
  for (const [t, w] of cols) { doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY).text(t.toUpperCase(), x, y + 5, { width: w - 6 }); x += w; }
  y += 22;
  for (const f of c.farmers) {
    const d = f.evidence?.doctor, p = f.evidence?.photos;
    const cells = [f.name, kg(f.kg), `Grade ${f.grade}`, d ? `Grade ${d.grade} · ${day(d.at)}` : "—",
      p ? `${p.grade ? `Grade ${p.grade}` : "—"} · blemish ${p.defectPct ?? "—"}% · colour ${p.colourScore ?? "—"}` : "—"];
    x = 56;
    // row height follows the tallest (wrapped) cell
    const rowH = Math.max(...cells.map((t, i) => doc.font(i === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).heightOfString(t, { width: cols[i][1] - 6 }))) + 8;
    cells.forEach((t, i) => { doc.font(i === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(DARK).text(t, x, y, { width: cols[i][1] - 6 }); x += cols[i][1]; });
    y += rowH;
    doc.moveTo(50, y - 4).lineTo(50 + W, y - 4).strokeColor(LINE).stroke();
  }
  doc.y = y + 4;

  h("3. Basis of certification");
  const lines = [
    "Each grower's fruit passed AgriLink's quality review for this contract before collection: a farmer doctor inspected the orchard, and photo checks were graded by AgriLink's image analysis (blemish %, colour, photo quality).",
    "Fruit below the contracted grade was separated at the collection point and is not part of this lot.",
    `Every step is recorded in the farm-operations trace log (${c.trace.events} events; chain ${c.trace.intact ? "intact" : "NOT intact"}; head ${String(c.trace.headHash || "").slice(0, 20)}…).`,
  ];
  for (const t of lines) doc.font("Helvetica").fontSize(9).fillColor(DARK).text(`•  ${t}`, 50, doc.y, { width: W, lineGap: 1.5 }).moveDown(0.2);

  h("4. Verification");
  doc.font("Helvetica").fontSize(9).fillColor(DARK).text(
    `Scan the QR code or open ${verifyUrl} to see the live status of this certificate (valid, expired or revoked). ` +
    "The SHA-256 fingerprint of this PDF is registered on the AgriLink blockchain registry under the certificate number; " +
    "uploading this file on the verification page proves it has not been changed.", 50, doc.y, { width: W, lineGap: 1.5 });

  doc.moveDown(1);
  doc.roundedRect(50, doc.y, W, 40, 6).strokeColor(LINE).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(
    "AgriLink platform quality certificate for a commercial consignment between the parties named above. It is not an APEDA, AGMARK or " +
    "Geographical Indication certificate and does not replace phytosanitary certification required for export.", 58, doc.y + 8, { width: W - 16, lineGap: 1 });

  doc.end();
  return done;
}

export async function renderRevocationPdf(c, reason, at, verifyUrl) {
  const doc = new PDFDocument({ size: "A4", margins: { top: 50, bottom: 50, left: 50, right: 50 },
    info: { Title: `${c.certificateId} — Revocation notice`, Author: "AgriLink" } });
  const done = collect(doc);
  const W = doc.page.width - 100;
  doc.rect(0, 0, doc.page.width, 90).fill("#b91c1c");
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(20).text("Certificate revoked", 50, 34);
  doc.font("Helvetica").fontSize(10).text(c.certificateId, 50, 60);
  doc.y = 120;
  const what = c.kind === "stage"
    ? `stage "${c.stage?.name}" of crop ${c.cropId} (${c.farmers?.[0]?.name || "grower"}, ${c.product.variety})`
    : `lot ${c.lotId} (${c.product.variety}, ${kg(c.totalKg)}, buyer ${c.buyer.name})`;
  doc.font("Helvetica").fontSize(10.5).fillColor(DARK).text(
    `AgriLink certificate ${c.certificateId} for ${what} was revoked on ${day(at)}.`, { width: W, lineGap: 2 });
  doc.moveDown(0.8).font("Helvetica-Bold").text("Reason").font("Helvetica").text(reason, { width: W });
  doc.moveDown(0.8).font("Helvetica").fontSize(9).fillColor(GREY).text(`Live status: ${verifyUrl}`, { width: W });
  doc.end();
  return done;
}

export function gradeLabel(c) {
  const grades = Object.keys(c.gradeMix || {});
  if (grades.length === 1) return `Grade ${grades[0]}`;
  return grades.length ? `Grade ${c.requiredGrade}+ (mixed)` : "—";
}

/** Crop-stage certificate: issued only after an authorised consultant approved the stage assessment. */
export async function renderStageCertificatePdf(c, verifyUrl) {
  const qr = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 220, color: { dark: DARK, light: "#ffffff" } });
  const doc = new PDFDocument({ size: "A4", margins: { top: 50, bottom: 50, left: 50, right: 50 },
    info: { Title: `${c.certificateId} — Stage Quality Certificate`, Author: "AgriLink", Subject: `${c.stage.name} — crop ${c.cropId}` } });
  const done = collect(doc);
  const W = doc.page.width - 100;
  const f = c.farmers[0] || {}, ev = f.evidence || {};
  const footer = () => {
    const { x, y } = doc, bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(`${c.certificateId} · Crop ${c.cropId} · Verify at ${verifyUrl}`, 50, doc.page.height - 34, { width: W, align: "center", lineBreak: false });
    doc.page.margins.bottom = bottom; doc.x = x; doc.y = y;
  };
  doc.on("pageAdded", footer);
  footer();

  doc.rect(0, 0, doc.page.width, 112).fill(GREEN);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9).text("AGRILINK", 50, 34, { characterSpacing: 2 });
  doc.font("Helvetica-Bold").fontSize(22).text("Stage Quality Certificate", 50, 48);
  doc.font("Helvetica").fontSize(10).fillColor("#dcfce7").text(`${c.stage.name} · ${c.product.variety} ${c.product.crop.toLowerCase()} · ${c.product.origin}`, 50, 76, { width: W - 120 });
  doc.roundedRect(doc.page.width - 50 - 96, 22, 96, 96, 8).fill("#ffffff");
  doc.image(qr, doc.page.width - 50 - 90, 28, { width: 84 });

  doc.y = 130;
  const strip = (items) => {
    const colW = W / items.length, y = doc.y;
    doc.roundedRect(50, y, W, 44, 6).fill(TINT);
    items.forEach(([k, v], i) => {
      doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(k.toUpperCase(), 62 + i * colW, y + 9, { width: colW - 16, characterSpacing: 0.6 });
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(DARK).text(v, 62 + i * colW, y + 21, { width: colW - 16 });
    });
    doc.y = y + 56;
  };
  strip([["Certificate", c.certificateId], ["Stage", c.stage.name], ["Approved", day(ev.approvedAt)], ["Quality score", ev.qualityScore == null ? "—" : `${ev.qualityScore} / 100`]]);

  const h = (t) => { doc.moveDown(0.5); doc.font("Helvetica-Bold").fontSize(11).fillColor(GREEN).text(t, 50); doc.moveTo(50, doc.y + 2).lineTo(50 + W, doc.y + 2).strokeColor(LINE).stroke(); doc.moveDown(0.5); };
  const kv = (rows) => {
    for (const [k, v] of rows) {
      const y = doc.y;
      doc.font("Helvetica").fontSize(9).fillColor(GREY).text(k, 50, y, { width: 150 });
      doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK).text(String(v ?? "—"), 205, y, { width: W - 155 });
      doc.y = Math.max(doc.y, y + 14);
    }
  };
  h("1. Grower and crop");
  kv([["Grower", f.name], ["FPO", c.fpo?.name], ["Crop record", c.cropId], ["Batch (lot)", c.batchId || "Not yet in a lot"],
    ["Procurement agreement", c.agreementId || "—"], ["Assessment", c.assessmentId]]);

  h("2. Assessment result");
  const cols = [["Check", 230], ["Source", 70], ["Recorded", 95], ["Result", W - 395]];
  let y = doc.y;
  doc.rect(50, y, W, 18).fill(TINT);
  let x = 56;
  for (const [t, w] of cols) { doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY).text(t.toUpperCase(), x, y + 5, { width: w - 6 }); x += w; }
  y += 22;
  const SRC = { farmer: "Farmer record", ai: "AI image", photo: "Photo" };
  const RES = { pass: "Pass", warn: "Attention", fail: "Fail", not_assessed: "Not assessed" };
  for (const ck of ev.checks || []) {
    const cells = [ck.label, SRC[ck.source] || ck.source, ck.value == null ? "—" : String(ck.value === true ? "Yes" : ck.value === false ? "No" : ck.value), RES[ck.status] || ck.status];
    const rowH = Math.max(...cells.map((t, i) => doc.font("Helvetica").fontSize(8.5).heightOfString(t, { width: cols[i][1] - 6 }))) + 8;
    if (y + rowH > doc.page.height - 70) { doc.addPage(); y = doc.y; }
    x = 56;
    cells.forEach((t, i) => { doc.font(i === 3 ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(i === 3 && ck.status === "fail" ? "#b91c1c" : DARK).text(t, x, y, { width: cols[i][1] - 6 }); x += cols[i][1]; });
    y += rowH;
    doc.moveTo(50, y - 4).lineTo(50 + W, y - 4).strokeColor(LINE).stroke();
  }
  doc.y = y + 4;
  doc.font("Helvetica").fontSize(8.5).fillColor(GREY).text(`Score covers ${ev.coverage?.evaluated ?? "—"} of ${ev.coverage?.total ?? "—"} checks; checks marked "not assessed" are excluded. Farmer records are self-declared.`, 50, doc.y, { width: W });

  h("3. Consultant approval");
  kv([["Approved by", ev.consultant], ["Date", day(ev.approvedAt)], ["Remarks", ev.remarks || "—"]]);
  doc.font("Helvetica").fontSize(9).fillColor(DARK).text(`Not verifiable from photos, confirmed by the consultant: ${(ev.notAssessable || []).join("; ")}.`, 50, doc.y + 2, { width: W, lineGap: 1.5 });

  h("4. Verification");
  doc.font("Helvetica").fontSize(9).fillColor(DARK).text(`Scan the QR code or open ${verifyUrl} for the live status. The SHA-256 fingerprint of this PDF is registered on the AgriLink blockchain registry under the certificate number.`, 50, doc.y, { width: W, lineGap: 1.5 });
  doc.moveDown(1);
  doc.roundedRect(50, doc.y, W, 40, 6).strokeColor(LINE).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(
    "Records that this crop stage was assessed and approved by an AgriLink farmer doctor. Photo analysis covers only what a photo can show; it is not an APEDA, AGMARK or GI certificate and does not replace phytosanitary certification.",
    58, doc.y + 8, { width: W - 16, lineGap: 1 });
  doc.end();
  return done;
}
