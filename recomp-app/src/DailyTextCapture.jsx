import { useEffect, useRef, useState } from "react";
import { Check, Droplets, Dumbbell, LoaderCircle, Sparkles, X } from "lucide-react";
import { parseDailyLogText } from "./lib/firebase.js";
import { FOOD_NUTRIENTS, foodPhotoError } from "./lib/foodPhoto.js";
import { DAILY_MEALS } from "./lib/dailyText.js";
import { MEAL_TYPES } from "./data.js";
import "./daily-text.css";

const mealLabels = Object.fromEntries(MEAL_TYPES);
const nutrientLabels = { calories: "แคลอรี", protein: "โปรตีน", carbs: "คาร์บ", fat: "ไขมัน", fiber: "ใยอาหาร", produceServings: "ผัก/ผลไม้" };

export default function DailyTextCapture({ date, onApply, onConfirm }) {
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);

  async function analyze() {
    if (busy || description.trim().length < 10) return;
    const token = ++generation.current;
    setBusy(true); setError(""); setNotice(""); setDraft(null);
    try {
      const result = await parseDailyLogText(description.trim());
      if (token !== generation.current) return;
      setDraft({ ...result, foods: (result.foods || []).map(food => ({ ...food, quantity: 1 })) });
    } catch (err) {
      if (token !== generation.current) return;
      setError(err?.code === "functions/internal" ? "แยกบันทึกไม่สำเร็จ ลองพิมพ์รายละเอียดให้ชัดขึ้นแล้วประเมินใหม่" : foodPhotoError(err));
    } finally { if (token === generation.current) setBusy(false); }
  }

  const edit = (key, value) => { setDraft(current => ({ ...current, [key]: value })); setError(""); };
  const editFood = (index, key, value) => { setDraft(current => ({ ...current, foods: current.foods.map((food, i) => i === index ? { ...food, [key]: value } : food) })); setError(""); };
  function apply() {
    try {
      if (onConfirm) {
        const didSave = onConfirm(draft);
        if (didSave === false) return;
        setDraft(null); setDescription(""); setError("");
        setNotice("บันทึกข้อมูลวันนี้แล้ว · แก้ไขเพิ่มเติมได้ด้านล่าง");
        return;
      }
      onApply(draft);
      setDraft(null); setDescription(""); setError("");
      setNotice("เพิ่มลงฟอร์มแล้ว ตรวจยอดรวมก่อนกดบันทึกวัน");
    } catch (err) { setError(err.message || "ตรวจรายการอีกครั้ง"); }
  }

  return <section className="daily-text card" aria-label="พิมพ์บันทึกทั้งวัน" aria-busy={busy}>
    <div className="daily-text-head"><span><Sparkles size={19}/></span><div><b>พิมพ์ครั้งเดียว แยกให้ทั้งวัน</b><p>อาหารแต่ละมื้อ · น้ำดื่ม · ออกกำลังกาย</p></div></div>
    <label className="daily-text-input">เล่าให้ครบในข้อความเดียว
      <textarea value={description} maxLength={2000} rows={4} disabled={busy} onChange={event => { setDescription(event.target.value); setError(""); setNotice(""); }} placeholder="เช้าไข่ต้ม 2 ฟอง กลางวันกะเพราไก่ไข่ดาว เย็นสลัดไก่ ดื่มน้ำ 1.5 ลิตร เดินเร็ว 30 นาที"/>
    </label>
    <div className="daily-text-actions"><button type="button" className="primary-btn" disabled={busy || description.trim().length < 10} onClick={analyze}>{busy ? <LoaderCircle size={17} className="daily-text-spinner"/> : <Sparkles size={17}/>} {busy ? "กำลังแยกบันทึก…" : "ให้ AI แยกบันทึก"}</button><small>สำหรับวันที่ {date} · AI จะยังไม่บันทึกจนกว่าคุณจะยืนยัน</small></div>
    {draft && <div className="daily-text-review">
      <h3>ตรวจผลก่อนบันทึก</h3>
      {draft.assumptions && <p className="daily-text-assumptions">{draft.assumptions}</p>}
      {draft.foods.map((food, index) => <article className="daily-text-food" key={index}>
        <div className="daily-text-food-summary"><div><b>{food.name || `อาหาร ${index + 1}`}</b><small>{mealLabels[food.meal] || "เลือกมื้อ"} · {food.serving || "ไม่ระบุปริมาณ"}</small></div><strong>≈ {Number(food.calories || 0).toLocaleString()} kcal</strong><button type="button" onClick={() => edit("foods", draft.foods.filter((_, i) => i !== index))} aria-label={`ลบ ${food.name}`}><X size={16}/></button></div>
        <details><summary>แก้ไขรายการและสารอาหาร</summary><div className="daily-text-food-edit"><label>มื้อ<select value={food.meal} onChange={event => editFood(index, "meal", event.target.value)}><option value="unassigned">เลือกมื้อ</option>{DAILY_MEALS.map(key => <option key={key} value={key}>{mealLabels[key]}</option>)}</select></label><div className="daily-text-food-fields"><label>ชื่ออาหาร<input value={food.name} maxLength={120} onChange={event => editFood(index, "name", event.target.value)}/></label><label>ปริมาณ<input value={food.serving} maxLength={160} onChange={event => editFood(index, "serving", event.target.value)}/></label></div><div className="daily-text-food-fields"><label>ทานจริงกี่เท่า<input type="number" min="0.1" max="10" step="any" inputMode="decimal" value={food.quantity} onChange={event => editFood(index, "quantity", event.target.value)}/></label><label>แคลอรี (kcal)<input type="number" min="0" step="any" inputMode="decimal" value={food.calories} onChange={event => editFood(index, "calories", event.target.value)}/></label></div><div className="daily-text-nutrients">{FOOD_NUTRIENTS.filter(key => key !== "calories").map(key => <label key={key}>{nutrientLabels[key]}<input type="number" min="0" step="any" inputMode="decimal" value={food[key]} onChange={event => editFood(index, key, event.target.value)}/></label>)}</div></div></details>
      </article>)}
      <div className="daily-text-extras">
        <div className="daily-text-extra"><label className="daily-text-check"><input type="checkbox" checked={draft.waterMentioned} onChange={event => edit("waterMentioned", event.target.checked)}/><Droplets size={16}/> น้ำดื่มวันนี้</label>{draft.waterMentioned && <label>รวม (ลิตร)<input type="number" min="0" max="20" step="0.1" inputMode="decimal" value={draft.waterLiters} onChange={event => edit("waterLiters", event.target.value)}/></label>}</div>
        <div className="daily-text-extra"><label className="daily-text-check"><input type="checkbox" checked={draft.exerciseMentioned} onChange={event => edit("exerciseMentioned", event.target.checked)}/><Dumbbell size={16}/> ออกกำลังกาย</label>{draft.exerciseMentioned && <><label>กิจกรรม<input value={draft.exerciseDescription} maxLength={240} onChange={event => edit("exerciseDescription", event.target.value)}/></label><div className="daily-text-food-fields"><label>นาทีที่ทำ<input type="number" min="0" max="1440" inputMode="numeric" value={draft.exerciseMinutes} onChange={event => edit("exerciseMinutes", event.target.value)}/></label><label>Zone 2 (นาที)<input type="number" min="0" max="1440" inputMode="numeric" value={draft.zone2Minutes} onChange={event => edit("zone2Minutes", event.target.value)}/></label></div><label className="daily-text-check"><input type="checkbox" checked={draft.workoutDone} onChange={event => edit("workoutDone", event.target.checked)}/> บันทึกว่าออกกำลังแล้ว</label></>}</div>
        <div className="daily-text-extra"><label className="daily-text-check"><input type="checkbox" checked={draft.stepsMentioned} onChange={event => edit("stepsMentioned", event.target.checked)}/> จำนวนก้าว</label>{draft.stepsMentioned && <label>ก้าววันนี้<input type="number" min="0" max="200000" inputMode="numeric" value={draft.steps} onChange={event => edit("steps", event.target.value)}/></label>}</div>
      </div>
      <p className="daily-text-note">อาหารจะเพิ่มต่อจากรายการเดิมในแต่ละมื้อ ส่วนน้ำดื่มและกิจกรรมจะใช้เป็นยอดของวันที่เลือก</p>
      <button type="button" className="primary-btn daily-text-apply" onClick={apply}><Check size={17}/> {onConfirm ? "ยืนยันและบันทึกวันนี้" : "เพิ่มลงฟอร์ม"}</button>
    </div>}
    {error && <p className="daily-text-error" role="alert">{error}</p>}
    {notice && <p className="daily-text-notice" role="status">{notice}</p>}
  </section>;
}
