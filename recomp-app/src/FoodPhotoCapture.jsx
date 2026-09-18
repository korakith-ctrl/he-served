import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, LoaderCircle, Sparkles, Type, X } from "lucide-react";
import { estimateFoodPhoto, estimateFoodText } from "./lib/firebase.js";
import { FOOD_NUTRIENTS, foodPhotoError, prepareFoodPhoto, reviewedPhotoFoods } from "./lib/foodPhoto.js";
import "./food-photo.css";

const labels = { calories: "แคลอรี (kcal)", protein: "โปรตีน (g)", carbs: "คาร์บ (g)", fat: "ไขมัน (g)", fiber: "ใยอาหาร (g)", produceServings: "ผัก/ผลไม้ (ส่วน)" };

export default function FoodPhotoCapture({ mealLabel, onAdd, onConfirm }) {
  const [photo, setPhoto] = useState(null);
  const [stage, setStage] = useState("idle");
  const [result, setResult] = useState(null);
  const [foods, setFoods] = useState([]);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const camera = useRef(null), library = useRef(null), generation = useRef(0), consumed = useRef(false);
  const busy = stage === "preparing" || stage === "analyzing";
  useEffect(() => () => { generation.current += 1; }, []);

  function clear() {
    generation.current += 1;
    setPhoto(null); setResult(null); setFoods([]); setDescription(""); setError(""); setStage("idle");
  }
  async function selectPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const token = ++generation.current;
    setPhoto(null); setResult(null); setFoods([]); setError(""); setNotice(""); setStage("preparing");
    consumed.current = false;
    try {
      const prepared = await prepareFoodPhoto(file);
      if (token !== generation.current) return;
      setPhoto(prepared); setStage("ready");
    } catch (err) {
      if (token !== generation.current) return;
      setError(foodPhotoError(err)); setStage("idle");
    }
  }
  async function analyze() {
    if (!photo || busy) return;
    const token = ++generation.current;
    setStage("analyzing"); setError(""); setResult(null); setFoods([]); setNotice("");
    try {
      const data = await estimateFoodPhoto({ imageBase64: photo.imageBase64, mimeType: photo.mimeType });
      if (token !== generation.current) return;
      setResult(data);
      setFoods((data.foods || []).map(food => ({ ...food, quantity: 1 })));
      setStage("review");
    } catch (err) {
      if (token !== generation.current) return;
      setError(foodPhotoError(err)); setStage("ready");
    }
  }
  async function analyzeText() {
    if (busy || description.trim().length < 3) return;
    const token = ++generation.current;
    setPhoto(null); setStage("analyzing"); setError(""); setResult(null); setFoods([]); setNotice("");
    try {
      const data = await estimateFoodText(description.trim());
      if (token !== generation.current) return;
      setResult(data);
      setFoods((data.foods || []).map(food => ({ ...food, quantity: 1 })));
      setStage("review");
    } catch (err) {
      if (token !== generation.current) return;
      setError(foodPhotoError(err)); setStage("idle");
    }
  }
  const edit = (index, key, value) => { setError(""); setFoods(current => current.map((food, i) => i === index ? { ...food, [key]: value } : food)); };
  let reviewed = [], validationError = "";
  if (foods.length) {
    try { reviewed = reviewedPhotoFoods(foods); } catch (err) { validationError = err.message; }
  }
  const total = reviewed.reduce((sum, food) => sum + food.calories, 0);
  function add() {
    if (consumed.current || !reviewed.length || validationError) return;
    consumed.current = true;
    try {
      const didSave = onConfirm ? onConfirm(reviewed) : onAdd(reviewed);
      if (didSave === false) { consumed.current = false; return; }
      clear();
      setNotice(onConfirm ? `บันทึก${mealLabel}แล้ว ${total.toLocaleString()} kcal` : `เพิ่มใน${mealLabel}แล้ว ${total.toLocaleString()} kcal · กดบันทึกวันเพื่อเก็บข้อมูล`);
    } catch (err) { consumed.current = false; setError(foodPhotoError(err)); }
  }
  return <section className="food-photo" aria-label="ประเมินแคลอรีจากรูปหรือรายการอาหาร" aria-busy={busy}>
    <header><span className="food-photo-icon"><Camera size={20}/></span><div><b>ถ่ายอาหาร ประเมินแคลอรี</b><p>ดูปริมาณแล้วค่อยเพิ่มลง{mealLabel}</p></div></header>
    <div className="food-photo-buttons">
      <button type="button" onClick={() => camera.current?.click()} disabled={busy}><Camera size={17}/>ถ่ายรูปอาหาร</button>
      <button type="button" onClick={() => library.current?.click()} disabled={busy}><ImagePlus size={17}/>เลือกรูป</button>
    </div>
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={selectPhoto}/>
    <input ref={library} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" hidden onChange={selectPhoto}/>
    {!photo && stage !== "review" && <div className="food-photo-text">
      <label><Type size={17}/>พิมพ์อาหารที่กิน
        <textarea value={description} maxLength={600} rows={3} placeholder="เช่น กะเพราไก่ไข่ดาว 1 จาน" onChange={event => { setDescription(event.target.value); setError(""); }} />
      </label>
      <button type="button" className="primary-btn" disabled={busy || description.trim().length < 3} onClick={analyzeText}><Sparkles size={17}/>ประเมินจากข้อความ</button>
    </div>}
    {busy && <p className="food-photo-status" role="status"><LoaderCircle size={16} className="food-photo-spinner"/>{stage === "preparing" ? "กำลังเตรียมรูป…" : "กำลังประเมินอาหารและปริมาณ อาจใช้เวลาสักครู่…"}</p>}
    {photo && <div className="food-photo-preview"><img src={photo.preview} alt="รูปอาหารที่เลือกเพื่อประเมิน"/><button type="button" onClick={clear} aria-label="ยกเลิกรูปและผลประเมิน"><X size={17}/></button></div>}
    {photo && stage === "ready" && <><p className="food-photo-help">เมื่อกดประเมิน รูปนี้จะส่งให้ Google Gemini วิเคราะห์ผ่าน Cloud Function ผลเป็นค่าประมาณและยังไม่ถูกบันทึกในมื้ออาหาร</p><button type="button" className="primary-btn" onClick={analyze}><Sparkles size={17}/>ประเมินจากรูป</button></>}
    {result && <div className="food-photo-review">
      <p className="food-photo-help">{foods.length ? `ค่าประมาณจากภาพ · ความมั่นใจ${{ low: "ต่ำ", medium: "ปานกลาง", high: "สูง" }[result.confidence] || "ต่ำ"} · ตรวจชื่อ ปริมาณ และสารอาหารก่อนเพิ่ม` : "ยังไม่มีอาหารให้เพิ่ม ลองเลือกรูปใหม่ หรือใช้การกรอกเอง"}</p>
      {result.assumptions && <p className="food-photo-assumptions">{result.assumptions}</p>}
      {foods.map((food, index) => <article key={index} className="food-photo-item">
        <div className="food-photo-item-head"><label>ชื่ออาหาร<input value={food.name} maxLength={120} onChange={event => edit(index, "name", event.target.value)}/></label><button type="button" aria-label={`นำ ${food.name} ออกจากผลประเมิน`} onClick={() => setFoods(current => current.filter((_, i) => i !== index))}><X size={16}/></button></div>
        <label>ปริมาณที่เห็นในรูป<input value={food.serving} maxLength={160} onChange={event => edit(index, "serving", event.target.value)}/></label>
        <label>ทานจริงกี่เท่าของในรูป <small>เช่น ครึ่งจาน = 0.5</small><input type="number" inputMode="decimal" min="0.1" max="10" step="any" value={food.quantity} onChange={event => edit(index, "quantity", event.target.value)}/></label>
        <details><summary>แก้สารอาหารสำหรับปริมาณเต็มในรูป · ≈ {food.calories || 0} kcal</summary><div className="food-photo-nutrients">{FOOD_NUTRIENTS.map(key => <label key={key}>{labels[key]}<input type="number" inputMode="decimal" min="0" step="any" value={food[key]} onChange={event => edit(index, key, event.target.value)}/></label>)}</div></details>
      </article>)}
      {validationError && <p role="alert" className="food-photo-error">{validationError}</p>}
      {!!foods.length && <div className="food-photo-confirm"><span>ทานจริงรวม <b>≈ {validationError ? "—" : total.toLocaleString()} kcal</b></span><button type="button" className="primary-btn" disabled={!!validationError || !reviewed.length} onClick={add}>{onConfirm ? `ยืนยันและบันทึก${mealLabel}` : `เพิ่มลง${mealLabel}`}</button></div>}
      <p className="food-photo-help">น้ำมัน ซอส และขนาดอาหารอาจคลาดเคลื่อนจากรูปหรือข้อความ ปรับตัวเลขได้ตามฉลากหรือปริมาณที่ทราบ</p>
    </div>}
    {error && <p className="food-photo-error" role="alert">{error}</p>}
    {notice && <p className="food-photo-status" role="status">{notice}</p>}
  </section>;
}
