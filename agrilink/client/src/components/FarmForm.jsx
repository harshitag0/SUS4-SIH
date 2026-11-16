import { useState } from "react";
import { useI18n } from "../i18n/index.jsx";

export const DISTRICTS = ["Sindhudurg", "Ratnagiri", "Raigad", "Palghar"];

/** Farm profile form used for onboarding and for editing the profile. */
export default function FarmForm({ initial, onSubmit, busy }) {
  const { t } = useI18n();
  const f = initial?.farm || {};
  const [v, setV] = useState({
    name: initial?.name || "", village: f.village || "", district: f.district || "Sindhudurg", acres: f.acres ?? "",
    trees: f.trees ?? "", age: f.age ?? "", irrigation: f.irrigation || "drip", fpo: f.fpo || "",
  });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    onSubmit({ name: v.name.trim(), farm: { village: v.village.trim(), district: v.district, acres: +v.acres, variety: "Alphonso", trees: +v.trees, age: +v.age, irrigation: v.irrigation, fpo: v.fpo.trim() } });
  };
  return (
    <form onSubmit={submit} autoComplete="off">
      <label>{t("name")}</label>
      <input value={v.name} onChange={set("name")} required />
      <div className="row">
        <div><label>{t("village")}</label><input value={v.village} onChange={set("village")} required /></div>
        <div><label>{t("district")}</label>
          <select value={v.district} onChange={set("district")}>{DISTRICTS.map((d) => <option key={d} value={d}>{t("d_" + d)}</option>)}</select></div>
      </div>
      <div className="row">
        <div><label>{t("acres")}</label><input type="number" step="0.5" min="0.5" value={v.acres} onChange={set("acres")} required /></div>
        <div><label>{t("variety")}</label><select value="Alphonso" onChange={() => {}}><option value="Alphonso">{t("v_alphonso")}</option></select></div>
      </div>
      <div className="row">
        <div><label>{t("trees")}</label><input type="number" min="1" value={v.trees} onChange={set("trees")} required /></div>
        <div><label>{t("age")}</label><input type="number" min="1" max="100" value={v.age} onChange={set("age")} required /></div>
      </div>
      <div className="row">
        <div><label>{t("irrigation")}</label>
          <select value={v.irrigation} onChange={set("irrigation")}>{["drip", "well", "rain"].map((i) => <option key={i} value={i}>{t("irr_" + i)}</option>)}</select></div>
        <div><label>{t("fpo")}</label><input value={v.fpo} onChange={set("fpo")} /></div>
      </div>
      <button className="btn big" type="submit" disabled={busy}>{t("save")}</button>
    </form>
  );
}
