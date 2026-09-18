import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addMonths, differenceInCalendarDays, eachDayOfInterval, endOfMonth, format, getDay, parseISO, startOfMonth, subDays } from "date-fns";
import {
  Area, AreaChart, CartesianGrid, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Activity, ArrowDown, ArrowRight, Award, BarChart3, BedDouble, Bell, CalendarDays, Camera,
  Check, ChevronDown, ChevronLeft, ChevronRight, CircleUserRound, Copy, Download, Edit3,
  Droplets, Dumbbell, Footprints, Gauge, Home, Info, Moon, Plus, RefreshCcw,
  Save, Scale, Search, Sparkles, Sun, Target, TrendingDown, Trophy, Upload, Utensils, Users, Watch, Wifi, X, Zap,
} from "lucide-react";
import { z } from "zod";
import FoodPhotoCapture from "./FoodPhotoCapture.jsx";
import DailyTextCapture from "./DailyTextCapture.jsx";
import { addPhotoFoodsToMeal } from "./lib/foodPhoto.js";
import { applyDailyTextEstimate, waterEntryValue } from "./lib/dailyText.js";
import { formatSleepDuration, sleepDurationParts } from "./lib/format.js";
import { FOOD_CATEGORIES, FOOD_PRESETS, FOOD_SOURCES, makeDemoLogs, MEAL_TYPES, MILESTONES, PHASES, PROFILES, WORKOUTS } from "./data.js";
import {
  adherenceSummary, bangkokGreeting, bangkokToday, calorieTargetStatus, challengeClock, dailyScore as calculateDailyScore, filterLogs,
  numeric, percent, rollingWeight, weeklyReview, weightStats,
} from "./lib/metrics.js";
import {
  cleanLogInput, downloadFile, exportCsv, importCsv, initialStore, loadStore, restoreProfileLog, saveStore, upsertProfileLog,
} from "./lib/store.js";
import {
  connectRealtime, createAppleHealthPairing, createRecompNativePairing, deleteRealtimeLog, firebaseConfigured, observeFirebaseAuth, replaceRealtimeStore,
  revokeAppleHealthPairing, revokeRecompNativePairing, signInFirebase, signOutFirebase, writeRealtimeLog,
  writeRealtimePlan, writeRealtimePreferences, writeRealtimeWorkout,
} from "./lib/firebase.js";
import { notificationSupport, requestReminderPermission, startReminderScheduler } from "./lib/reminders.js";
import "./health.css";
import "./journal.css";

const nav = [
  ["dashboard","วันนี้",Home], ["log","บันทึก",Plus], ["progress","ความคืบหน้า",BarChart3],
  ["workout","ออกกำลัง",Dumbbell], ["profile","โปรไฟล์",CircleUserRound],
];

const number = numeric;
const pct = percent;
const fmt1 = (value) => numeric(value).toFixed(1);
const rolling = rollingWeight;
const statsFor = (logs, profile, anchorDate = bangkokToday()) => weightStats(logs, profile, anchorDate);
const dailyScore = calculateDailyScore;

function IconButton({ children, label, onClick, className="", ...props }) {
  return <button className={`icon-btn ${className}`} aria-label={label} onClick={onClick} {...props}>{children}</button>;
}

function Brand() {
  return <div className="brand"><div className="brand-mark" aria-hidden="true"><svg viewBox="0 0 28 28" fill="none"><path d="M7 21V7h7a6 6 0 0 1 0 12H7m7-6 7 8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg></div><div><strong>recomp<span className="brand-period">.</span></strong><span>A little, every day</span></div></div>;
}

function SessionGate({ status, user, onSignIn, onSignOut }) {
  const [message,setMessage]=useState("");
  const checking=status==="checking",signedOut=status==="signed-out",denied=status==="denied";
  const signIn=async()=>{setMessage("");try{await onSignIn()}catch(error){setMessage(error.code==="auth/popup-closed-by-user"?"ปิดหน้าต่างก่อนเข้าสู่ระบบสำเร็จ":error.message)}};
  return <div className="recomp-app session-gate"><section className="session-card"><Brand/><div className={`session-orb ${checking?"loading":""}`}>{checking?<i/>:<Wifi size={24}/>}</div><span>เซสชันปลอดภัย</span><h1>{checking?"กำลังยืนยันโปรไฟล์…":signedOut?"เข้าสู่ระบบเพื่อดูข้อมูลของคุณ":denied?"บัญชีนี้ยังไม่มีสิทธิ์":"เชื่อมต่อข้อมูลไม่สำเร็จ"}</h1><p>{checking?"เราจะยังไม่แสดงข้อมูลสุขภาพจนกว่าจะยืนยันบัญชีและโปรไฟล์เรียบร้อย":signedOut?"ข้อมูลจริงจะเปิดหลัง Firebase ยืนยันบัญชีสมาชิกเท่านั้น":denied?"บัญชีนี้ไม่ได้อยู่ใน Recomp challenge กรุณาใช้บัญชีสมาชิก":"ข้อมูลยังถูกซ่อนไว้เพื่อป้องกันการแสดงโปรไฟล์ผิดคน"}</p>{message&&<em>{message}</em>}<div className="session-actions">{signedOut&&<button className="primary-btn" onClick={signIn}>เข้าสู่ระบบด้วย Google</button>}{(denied||status==="error")&&<><button className="primary-btn" onClick={()=>location.reload()}><RefreshCcw size={15}/> ลองอีกครั้ง</button>{user&&<button className="secondary-btn" onClick={onSignOut}>ออกจากระบบ</button>}</>}</div></section></div>;
}

function Sidebar({ page, setPage, dark, setDark, clock, previewDemo }) {
  return <aside className="sidebar">
    <Brand/>
    <nav aria-label="เมนูหลัก">{nav.map(([id,label,Icon]) => <button key={id} aria-current={page===id?"page":undefined} className={page===id?"active":""} onClick={()=>setPage(id)}><Icon size={19}/><span>{label}</span>{id==="log"&&<kbd aria-hidden="true">N</kbd>}</button>)}</nav>
    <div className="side-challenge">
      <div className="mini-icon"><Sparkles size={17}/></div><strong>ชาเลนจ์ของเรา</strong>
      <p>{previewDemo?"โหมดตัวอย่างแยกจากข้อมูลจริงของคุณ":`สัปดาห์ที่ ${clock.week} จาก 16 · ค่อย ๆ สร้างวันที่สม่ำเสมอไปด้วยกัน`}</p>
      <button onClick={()=>setPage("compare")}>ดูการเปรียบเทียบ <ArrowRight size={14}/></button>
    </div>
    <button className="theme-row" onClick={()=>setDark(!dark)}>{dark?<Sun size={18}/>:<Moon size={18}/>} {dark?"โหมดสว่าง":"โหมดมืด"}</button>
  </aside>;
}

function Topbar({ profileId, setProfileId, profile, dark, setDark, clock, onNotifications, syncOnline }) {
  const [open,setOpen]=useState(false);
  return <header className="topbar">
    <div className="mobile-brand"><Brand/></div>
    <div className="page-kicker">16 WEEK RECOMPOSITION <span>•</span> WEEK {clock.week} OF 16</div>
    <div className="top-actions">
      <IconButton label="สลับธีม" onClick={()=>setDark(!dark)} className="desktop-theme">{dark?<Sun size={18}/>:<Moon size={18}/>}</IconButton>
      <IconButton label="การแจ้งเตือนและการ Sync" onClick={onNotifications}><Bell size={18}/>{!syncOnline&&<i className="sync-dot"/>}</IconButton>
      <div className="profile-switch">
        <button onClick={()=>setOpen(!open)}><Avatar profile={profile}/><span><small>กำลังดูข้อมูลของ</small><b>{profile.name}</b></span><ChevronDown size={16}/></button>
        {open&&<div className="profile-menu">{Object.values(PROFILES).map(p=><button key={p.id} onClick={()=>{setProfileId(p.id);setOpen(false)}}><Avatar profile={p}/><span>{p.name}<small>{p.id===profileId?"โปรไฟล์ปัจจุบัน":"สลับโปรไฟล์"}</small></span>{p.id===profileId&&<Check size={16}/>}</button>)}</div>}
      </div>
    </div>
  </header>;
}

function Avatar({ profile, large=false }) { return <div className={`avatar ${large?"large":""}`} style={{"--avatar":profile.color}}>{profile.initials}</div>; }

function MobileNav({ page,setPage }) {
  return <nav className="mobile-nav" aria-label="เมนูหลัก" style={{"--nav-index":Math.max(0,nav.findIndex(([id])=>id===page)),"--nav-visible":nav.some(([id])=>id===page)?1:0}}>{nav.map(([id,label,Icon])=><button key={id} aria-current={page===id?"page":undefined} className={page===id?"active":""} onClick={()=>setPage(id)}><Icon size={20} strokeWidth={page===id?2:1.7}/><span>{label}</span></button>)}</nav>;
}

function PageTitle({ eyebrow, title, note, action }) {
  return <div className="page-title"><div><p>{eyebrow}</p><h1>{title}</h1>{note&&<span>{note}</span>}</div>{action}</div>;
}

function ProgressBar({ value, color="green" }) { return <div className="progress-track"><i className={color} style={{width:`${Math.min(100,value)}%`}}/></div>; }

function Ring({ value, children, color="#1f9d6a" }) {
  return <div className="ring" style={{"--ring":`${Math.min(100,value)*3.6}deg`,"--ring-color":color}}><div>{children}</div></div>;
}

function WeightChart({ logs, compact=false }) {
  const data=rolling(logs);
  if(data.length<2)return <div className={`empty-chart ${compact?"compact":""}`}><span className="chart-empty-mark" aria-hidden="true">·············</span><b>ทุกแนวโน้มเริ่มจากวันแรก</b><span>บันทึกน้ำหนักอีกวัน เพื่อเริ่มเห็นเส้นทางของคุณ</span></div>;
  return <ResponsiveContainer width="100%" height={compact?210:320}>
    <AreaChart data={data} margin={{top:10,right:8,bottom:0,left:compact?-24:-10}}>
      <defs><linearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#36ad7a" stopOpacity=".24"/><stop offset="1" stopColor="#36ad7a" stopOpacity="0"/></linearGradient></defs>
      <CartesianGrid strokeDasharray="3 7" vertical={false} stroke="var(--line)"/>
      <XAxis dataKey="label" tick={{fontSize:11,fill:"var(--muted)"}} axisLine={false} tickLine={false} interval={compact?3:1}/>
      <YAxis domain={["dataMin - 1","dataMax + 1"]} tick={{fontSize:11,fill:"var(--muted)"}} axisLine={false} tickLine={false}/>
      <Tooltip contentStyle={{borderRadius:14,border:"1px solid var(--line)",background:"var(--card)",fontSize:12}} formatter={(v,n)=>[`${v} kg`,n==="weight"?"Daily":"7-day avg"]}/>
      <Area type="monotone" dataKey="weight" stroke="var(--muted)" strokeWidth={1.5} fill="url(#weightFill)" dot={{r:2,fill:"var(--muted)"}} isAnimationActive={false}/>
      <Line type="monotone" dataKey="avg7" stroke="var(--green)" strokeWidth={2.5} dot={false} isAnimationActive={false}/>
    </AreaChart>
  </ResponsiveContainer>;
}

function DailyMealsTimeline({ today, setPage }) {
  const meals = MEAL_TYPES.map(([key, label]) => ({ key, label, meal: today?.meals?.[key] })).filter(({ meal }) => meal?.items?.length || Number(meal?.calories) > 0);
  return <section className="today-meals card" aria-label="รายการอาหารวันนี้">
    <div className="card-head"><div><span>วันนี้ · อาหาร</span><h2>ไทม์ไลน์มื้ออาหาร</h2></div><span className="today-meal-count">{meals.length ? `${meals.length} มื้อ` : "ยังไม่มีข้อมูล"}</span></div>
    {!meals.length ? <div className="today-meals-empty"><Utensils size={18}/><span>ยังไม่มีรายการอาหารวันนี้ · กด “เพิ่มมื้ออาหาร” ด้านบนเพื่อเริ่ม</span></div> : <div className="meal-timeline">{meals.map(({ key, label, meal }) => <article key={key}><div className="meal-timeline-dot"/><div className="meal-timeline-copy"><b>{label}</b><span>{meal.items?.length ? meal.items.map(item => typeof item === "string" ? item : item.name).join(" · ") : "กรอกยอดรวมมื้อนี้"}</span></div><strong>{Number(meal.calories || 0).toLocaleString()} <small>kcal</small></strong></article>)}</div>}
  </section>;
}

function SourceBadge({ source }) {
  if (!source) return null;
  return <span className={`source-badge ${source === "Apple Health" ? "apple" : "manual"}`}>{source}</span>;
}

function sourceFor(log, field) {
  if (log?.[field] == null) return null;
  return log.sources?.[field] === "appleHealth" ? "Apple Health" : "กรอกเอง";
}

function HealthSyncStatus({ integration }) {
  const lastSyncedAt = integration?.lastSyncedAt;
  const ageHours = lastSyncedAt ? (Date.now() - Date.parse(lastSyncedAt)) / 3600000 : Infinity;
  const stale = !integration?.paired || !Number.isFinite(ageHours) || ageHours > 24;
  const label = !integration?.paired ? "ยังไม่ได้เชื่อม Apple Health" : !lastSyncedAt ? "รอการซิงก์ครั้งแรก" : stale ? "ซิงก์ล่าสุดเกิน 24 ชม." : "Apple Health เชื่อมอยู่";
  return <div className={`health-sync-status ${stale ? "stale" : "live"}`} aria-label={label}>
    <span className="health-sync-dot" aria-hidden="true"/><div><b>{label}</b><small>{lastSyncedAt ? `ล่าสุด ${new Date(lastSyncedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}` : "เชื่อมต่อจากหน้าโปรไฟล์เพื่อดูข้อมูลสุขภาพ"}</small></div>
  </div>;
}

function NutritionHero({ today, profile, setPage }) {
  const caloriesKnown = today.calories != null;
  const proteinKnown = today.protein != null;
  const calories = caloriesKnown ? Number(today.calories) : null;
  const protein = proteinKnown ? Number(today.protein) : null;
  const caloriePercent = caloriesKnown && profile.calorieTarget > 0 ? Math.min(100, Math.round((calories / profile.calorieTarget) * 100)) : null;
  return <section className="dashboard-nutrition card" aria-label="โภชนาการวันนี้">
    <div className="dashboard-card-heading"><div><span>โภชนาการวันนี้</span><h2>กินแล้วเท่าไร</h2></div><SourceBadge source={sourceFor(today, "calories") || sourceFor(today, "protein")} /></div>
    <div className="nutrition-hero-grid">
      <div className="nutrition-calories"><small>พลังงานที่บันทึก</small><strong>{caloriesKnown ? calories.toLocaleString() : "—"}<em> kcal</em></strong><span>เป้าหมายส่วนตัว {profile.calorieTarget.toLocaleString()} kcal</span>{caloriePercent != null && <div className="nutrition-progress"><i style={{ width: `${caloriePercent}%` }}/></div>}</div>
      <div className="nutrition-protein"><small>โปรตีน</small><strong>{proteinKnown ? protein.toLocaleString() : "—"}<em> g</em></strong><span>เป้าหมาย {profile.proteinMin}–{profile.proteinMax} g</span></div>
    </div>
    <button type="button" className="primary-btn nutrition-cta" onClick={() => setPage("log")}><Plus size={17}/> เพิ่มมื้ออาหาร</button>
  </section>;
}

function nextDashboardAction(today, profile, integration) {
  const hasMealData = Object.values(today.meals || {}).some(meal => meal?.items?.length || ["calories", "protein", "carbs", "fat", "fiber", "produceServings"].some(field => Number(meal?.[field]) > 0));
  if (today.calories == null && !hasMealData) return { title: "เริ่มจากมื้อแรกของวันนี้", detail: "บันทึกอาหารมื้อแรกเพื่อให้เห็นพลังงานและโปรตีนตามจริง", page: "log", label: "บันทึกอาหาร" };
  if (today.protein == null || Number(today.protein) < profile.proteinMin) {
    const proteinText = today.protein == null ? "—" : `${Number(today.protein).toLocaleString()} g`;
    return { title: "มื้อต่อไปลองเพิ่มโปรตีน", detail: `วันนี้บันทึกแล้ว ${proteinText} · เป้าหมายอย่างน้อย ${profile.proteinMin} g`, page: "log", label: "เพิ่มโปรตีน" };
  }
  if (!integration?.paired || !integration.lastSyncedAt) return { title: "เชื่อม Apple Health เมื่อพร้อม", detail: "เพื่อดึงก้าว การนอน และกิจกรรมล่าสุดมาไว้ในหน้าเดียว", page: "profile", label: "เปิดโปรไฟล์" };
  const ageHours = (Date.now() - Date.parse(integration.lastSyncedAt)) / 3600000;
  if (!Number.isFinite(ageHours) || ageHours > 24) return { title: "ซิงก์ Apple Health อีกครั้ง", detail: "ข้อมูลกิจกรรมล่าสุดเกิน 24 ชั่วโมงแล้ว", page: "profile", label: "ดูการเชื่อมต่อ" };
  if (today.steps == null && today.exerciseMinutes == null) return { title: "เพิ่มกิจกรรมวันนี้", detail: "บันทึกก้าวหรือเวลาที่ออกกำลังเมื่อพร้อม", page: "workout", label: "เพิ่มกิจกรรม" };
  return { title: "วันนี้กำลังไปได้ดี", detail: "ข้อมูลที่บันทึกจะช่วยให้เห็นรูปแบบของคุณชัดขึ้น", page: "log", label: "ดูบันทึกวันนี้" };
}

function DashboardNextAction({ today, profile, integration, setPage }) {
  const action = nextDashboardAction(today, profile, integration);
  return <section className="dashboard-next-action" aria-label="ขั้นตอนถัดไป"><Sparkles size={18}/><div><span>ขั้นตอนถัดไป</span><b>{action.title}</b><p>{action.detail}</p></div><button type="button" className="secondary-btn" onClick={() => setPage(action.page)}>{action.label}<ArrowRight size={15}/></button></section>;
}

function AppleHealthPanel({ today, logs, healthWorkouts, profile, integration }) {
  const anchor = today.date;
  const start = format(subDays(parseISO(anchor), 6), "yyyy-MM-dd");
  const activityLogs = logs.filter(log => log.date >= start && log.date <= anchor);
  const exerciseSamples = activityLogs.filter(log => log.exerciseMinutes != null).length;
  const sevenDayMinutes = activityLogs.reduce((sum, log) => sum + (log.exerciseMinutes == null ? 0 : Number(log.exerciseMinutes)), 0);
  const stepsKnown = today.steps != null;
  const exerciseKnown = today.exerciseMinutes != null;
  const sleepKnown = today.sleep != null;
  const latestWorkout = [...(healthWorkouts || [])].filter(item => item.startAt && Number.isFinite(Date.parse(item.startAt))).sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))[0];
  const latestManualWorkout = [...(logs || [])].filter(log => log.workout && log.date <= anchor).sort((a, b) => b.date.localeCompare(a.date))[0];
  const syncAgeHours = integration?.lastSyncedAt ? (Date.now() - Date.parse(integration.lastSyncedAt)) / 3600000 : Infinity;
  const stale = !integration?.paired || !Number.isFinite(syncAgeHours) || syncAgeHours > 24;
  const workoutLabel = latestWorkout ? String(latestWorkout.activityType || "กิจกรรม").replace(/([A-Z])/g, " $1").replace(/^activity-/, "") : latestManualWorkout ? (latestManualWorkout.exerciseDescription || "กิจกรรมที่บันทึก") : null;
  const workoutTime = latestWorkout ? new Date(latestWorkout.startAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : latestManualWorkout ? format(parseISO(latestManualWorkout.date), "d MMM yyyy") : null;
  return <section className="apple-health-panel card" aria-label="กิจกรรมและการพักผ่อนวันนี้">
    <div className="dashboard-card-heading"><div><span>กิจกรรมและการพักผ่อน</span><h2>กิจกรรมวันนี้</h2></div><div className="health-panel-meta"><small className={stale ? "stale-text" : ""}>{!integration?.paired ? "Apple Health ยังไม่ได้เชื่อมต่อ" : integration?.lastSyncedAt ? (stale ? "Apple Health · ข้อมูลเกิน 24 ชม." : `Apple Health · อัปเดต ${new Date(integration.lastSyncedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`) : "Apple Health · ยังไม่มีเวลาซิงก์"}</small></div></div>
    <div className="health-metrics-grid">
      <div className="health-metric health-steps"><div><Footprints size={18}/><span>ก้าววันนี้</span></div><strong>{stepsKnown ? Number(today.steps).toLocaleString() : "—"}</strong><small>เป้าหมาย {profile.stepsTarget.toLocaleString()} ก้าว <SourceBadge source={sourceFor(today, "steps")}/></small></div>
      <div className="health-metric"><div><Activity size={18}/><span>ออกกำลังวันนี้</span></div><strong>{exerciseKnown ? Number(today.exerciseMinutes).toLocaleString() : "—"}<em>{exerciseKnown ? " นาที" : ""}</em></strong><small><SourceBadge source={sourceFor(today, "exerciseMinutes")}/> Apple exercise minutes เป็นค่าประมาณ</small></div>
      <div className="health-metric"><div><TrendingDown size={18}/><span>รวม 7 วัน</span></div><strong>{exerciseSamples ? sevenDayMinutes.toLocaleString() : "—"}<em>{exerciseSamples ? " / 150 นาที" : ""}</em></strong><small>อ้างอิงทั่วไปต่อสัปดาห์จาก CDC · นับ exercise minutes ครั้งเดียว</small></div>
      <div className="health-metric"><div><Moon size={18}/><span>การนอนเมื่อคืน</span></div><strong>{sleepKnown ? formatSleepDuration(today.sleep) : "—"}</strong><small><SourceBadge source={sourceFor(today, "sleep")}/>{sleepKnown ? "ข้อมูลตามที่ซิงก์ได้" : "ยังไม่มีข้อมูล"}</small></div>
    </div>
    <div className="health-workout-row"><div><b>กิจกรรมล่าสุด</b><span>{workoutLabel ? `${workoutLabel} · ${workoutTime}` : "ยังไม่มีรายการเวิร์กเอาต์"}</span></div><SourceBadge source={latestWorkout ? "Apple Health" : latestManualWorkout ? "กรอกเอง" : null}/></div>
  </section>;
}

function DashboardObservations({ today, logs }) {
  const values = logs.filter(log => log.restingHeartRate != null).sort((a, b) => a.date.localeCompare(b.date));
  const current = today.restingHeartRate;
  const previous = values.length > 1 ? values.at(-2).restingHeartRate : null;
  const activeEnergy = today.activeEnergy ?? today.activeEnergyKcal;
  return <details className="dashboard-observations"><summary><Gauge size={17}/><span><b>ข้อมูลสังเกตเพิ่มเติม</b><small>Active energy และ resting heart rate · ไม่มีการแปลผลทางการแพทย์</small></span><ChevronDown size={17}/></summary><div className="observation-grid"><div><span>Active energy วันนี้</span><b>{activeEnergy == null ? "—" : `${Number(activeEnergy).toLocaleString()} kcal`}</b><small>{activeEnergy == null ? "ยังไม่มีข้อมูล" : "ค่าที่อุปกรณ์บันทึก"}</small></div><div><span>Resting heart rate</span><b>{current == null ? "—" : `${Number(current).toLocaleString()} bpm`}</b><small>{current == null ? "ยังไม่มีข้อมูล" : `${sourceFor(today, "restingHeartRate") || "ข้อมูลอุปกรณ์"}${previous != null ? ` · ครั้งก่อน ${previous} bpm` : " · ต้องมีอย่างน้อย 2 ครั้งจึงเทียบได้"}`}</small></div></div></details>;
}

function Dashboard({ profile, logs, allLogs, workouts, healthWorkouts, setPage, clock, onApplyCalories, preferences, integration }) {
  const today = logs.find(log => log.date === clock.date) || { date: clock.date };
  const review = weeklyReview(logs, profile, clock.date, workouts, healthWorkouts);
  const weightLogs = logs.filter(log => log.weight != null && log.date <= clock.date && log.date >= format(subDays(parseISO(clock.date), 6), "yyyy-MM-dd"));
  const latestWeight = logs.filter(log => log.weight != null && log.date <= clock.date).at(-1);
  return <>
    <PageTitle eyebrow={`วันนี้ / ${format(parseISO(clock.date), "dd.MM.yyyy")}`} title={`วันนี้ของ ${profile.name}`} note={`สัปดาห์ที่ ${clock.week} จาก 16 · ข้อมูลสั้น ๆ ที่ใช้ตัดสินใจได้ทันที`} action={<HealthSyncStatus integration={integration}/>}/>
    <NutritionHero today={today} profile={profile} setPage={setPage}/>
    <DashboardNextAction today={today} profile={profile} integration={integration} setPage={setPage}/>
    <AppleHealthPanel today={today} logs={logs} healthWorkouts={healthWorkouts} profile={profile} integration={integration}/>
    <DailyMealsTimeline today={today} setPage={setPage}/>
    <section className="dashboard-weight-trend card"><div className="dashboard-card-heading"><div><span>แนวโน้ม 7 วัน</span><h2>{latestWeight ? `${fmt1(latestWeight.weight)} kg` : "ยังไม่มีข้อมูล"}</h2><small className="dashboard-subtle">{latestWeight ? `ชั่งล่าสุด ${format(parseISO(latestWeight.date), "d MMM yyyy")}` : "บันทึกน้ำหนักเพื่อเริ่มดูแนวโน้ม"}</small></div><button type="button" className="text-action" onClick={() => setPage("progress")}>ดูความคืบหน้า <ArrowRight size={14}/></button></div><WeightChart logs={weightLogs} compact/><p>เส้นนี้แสดงเฉพาะวันที่มีการชั่งจริงใน 7 วัน · ดูช่วงเวลาเพิ่มเติมได้ในความคืบหน้า</p></section>
    <DashboardObservations today={today} logs={logs}/>
    <WeeklyAction profile={profile} review={review} onApplyCalories={onApplyCalories}/>
    <ComparisonMini allLogs={allLogs} setPage={setPage}/>
    <Roadmap clock={clock}/>
  </>;
}

function WorkoutMini({setPage,clock,workouts,preferences}) { const next=format(parseISO(clock.date),"d MMM").toUpperCase().split(" "), planned=preferences.workoutDays.includes(getDay(parseISO(clock.date))), nextType=(workouts.filter(item=>item.date<clock.date).length%2===0?"A":"B"); return <div className="workout-mini card"><div className="date-block"><b>{next[0]}</b><span>{next[1]}</span></div><div><span>{planned?"TODAY'S WORKOUT":"RECOVERY DAY"}</span><h3>{planned?`Full Body · Workout ${nextType}`:"Steps · Mobility · Recovery"}</h3><p>{planned?"6 exercises · ~55 min":"รักษาการเคลื่อนไหวและการนอน"}</p></div><button onClick={()=>setPage(planned?"workout":"log")} aria-label={planned?"เปิด Workout":"เปิด Quick log"}><ArrowRight size={18}/></button></div>; }

function WeeklyAction({profile,review,onApplyCalories}) {
  const decision=review?.decision;
  const lastAdjustment=profile.calorieHistory?.at(-1),adjustedRecently=lastAdjustment&&differenceInCalendarDays(parseISO(review?.days?.at(-1)?.date||bangkokToday()),parseISO(lastAdjustment.date))<7;
  if(!review||!decision)return <section className="weekly-action card"><div><span>WEEKLY ACTION PLAN</span><h2>เริ่มเก็บข้อมูลสัปดาห์แรก</h2><p>ชั่งน้ำหนัก 4–7 วัน บันทึก Calories และ Protein อย่างน้อย 5 วัน แล้วระบบจะให้แผนหนึ่งอย่างที่ทำต่อได้ทันที</p></div></section>;
  return <section className={`weekly-action card ${decision.tone}`}><div className="weekly-action-icon"><Sparkles size={21}/></div><div><span>WEEKLY ACTION PLAN · CALENDAR 7 DAYS</span><h2>{decision.title}</h2><p>{decision.text}</p><div className="weekly-proof"><b>{review.weightSamples}/7</b><small>weigh-ins</small><b>{review.caloriesOnTarget}/{review.nutritionDays||0}</b><small>calorie days</small><b>{review.proteinOnTarget}/{review.proteinDays||0}</b><small>protein days</small><b>{review.workoutSessions}/3</b><small>strength</small><b>{Math.round(review.exerciseMinutes||0)}/150</b><small>active min</small></div></div>{decision.delta!==0&&<button className="primary-btn" disabled={adjustedRecently} onClick={()=>onApplyCalories(decision)}>{adjustedRecently?"ปรับแล้ว · รอ 7 วัน":`${decision.delta>0?"เพิ่ม":"ลด"}เป็น ${(profile.calorieTarget+decision.delta).toLocaleString()} kcal`}</button>}</section>;
}

function ComparisonMini({allLogs,setPage}) {
  const rows=Object.values(PROFILES).map(p=>({p,s:statsFor(allLogs[p.id],p)}));
  const tied=rows[0].s.consistency===rows[1].s.consistency;
  return <section className="compare-mini card"><div className="card-head"><div><span><Users size={17}/> SHARED CHALLENGE</span><h3>Better together</h3></div><button onClick={()=>setPage("compare")}>Full comparison <ArrowRight size={14}/></button></div><div className="compare-rows">{rows.map(({p,s},i)=>{const change=(s.lost/p.startWeight)*100;return <div className="compare-person" key={p.id}><div className="rank">{tied?"—":i+1}</div><Avatar profile={p}/><div className="person-info"><b>{p.name}</b><span>{s.consistency}% consistency</span></div><div className="person-loss"><b>{change===0?"0.0":`${change>0?"−":"+"}${fmt1(Math.abs(change))}`}%</b><span>body weight</span></div><ProgressBar value={s.consistency}/></div>})}</div><p className="friendly"><Trophy size={15}/> ทั้งคู่กำลังสร้าง momentum ได้ดี — วัดจากความสม่ำเสมอ ไม่ใช่แค่ตัวเลขบนตาชั่ง</p></section>;
}

function Roadmap({clock}) { return <section><div className="section-heading"><div><p>THE BIG PICTURE</p><h2>16-week roadmap</h2></div><span>Phase {clock.phase} {clock.complete?"complete":"in progress"}</span></div><div className="phase-grid">{PHASES.map((p,i)=><div className={`phase-card ${i===clock.phase-1?"active":""}`} key={p.n}><div><span>{p.n}</span>{i===clock.phase-1&&<b>{clock.complete?"DONE":"NOW"}</b>}</div><small>{p.weeks}</small><h3>{p.title}</h3><p>{p.note}</p><em>{p.meta}</em></div>)}</div></section>; }

const optionalNumber=(min,max)=>z.preprocess(value=>value===""||value==null?undefined:Number(value),z.number().min(min).max(max).optional());
const logSchema=z.object({weight:optionalNumber(30,300),calories:optionalNumber(0,10000),protein:optionalNumber(0,1000),fiber:optionalNumber(0,200),produceServings:optionalNumber(0,30),water:optionalNumber(0,20),steps:optionalNumber(0,200000),zone2Minutes:optionalNumber(0,1440),exerciseMinutes:optionalNumber(0,1440),sleepHours:optionalNumber(0,24),sleepMinutes:optionalNumber(0,59)});

function LogPage({profile,logs,onSave,clock,undoRevision=0}) {
  const measured=field=>logs.filter(log=>log[field]!=null).at(-1)?.[field];
  const lastWeight=measured("weight")??profile.startWeight;
  const mealFields=["calories","protein","carbs","fat","fiber","produceServings"];
  const blankMeals=()=>Object.fromEntries(MEAL_TYPES.map(([key])=>[key,{calories:"",protein:"",carbs:"",fat:"",fiber:"",produceServings:"",items:[]}]))
  const makeForm=(date)=>{const existing=logs.find(log=>log.date===date)||{},meals=blankMeals(),sleepParts=sleepDurationParts(existing.sleep);Object.entries(existing.meals||{}).forEach(([key,value])=>{meals[key]={...meals[key],...Object.fromEntries(mealFields.map(field=>[field,value[field]??""])),items:value.items||[]}});return {date,weight:existing.weight??"",calories:existing.calories??"",protein:existing.protein??"",carbs:existing.carbs??"",fat:existing.fat??"",fiber:existing.fiber??"",produceServings:existing.produceServings??"",water:existing.water??"",steps:existing.steps??"",zone2Minutes:existing.zone2Minutes??"",exerciseMinutes:existing.exerciseMinutes??"",exerciseDescription:existing.exerciseDescription??"",sleepHours:sleepParts?.hours??"",sleepMinutes:sleepParts?.minutes??"",waist:existing.waist??"",bodyFat:existing.bodyFat??"",muscle:existing.muscle??"",visceral:existing.visceral??"",mood:existing.mood??"",hunger:existing.hunger??"",energy:existing.energy??"",notes:existing.notes??"",meals,workout:Boolean(existing.workout),restDay:Boolean(existing.restDay),sickDay:Boolean(existing.sickDay),vacationMode:Boolean(existing.vacationMode)}};
  const [form,setForm]=useState(()=>makeForm(clock.date)),[saved,setSaved]=useState(false),[error,setError]=useState(""),[activeMeal,setActiveMeal]=useState("breakfast"),[manualOpen,setManualOpen]=useState(false);
  const [savedSnapshot,setSavedSnapshot]=useState(()=>JSON.stringify(makeForm(clock.date)));
  useEffect(()=>{if(!undoRevision)return;const next=makeForm(form.date);setForm(next);setSavedSnapshot(JSON.stringify(next));setSaved(true);setError("");setManualOpen(false)},[undoRevision]);
  const dirty=JSON.stringify(form)!==savedSnapshot;
  const saveLabel=dirty?"มีการแก้ไข · ยังไม่บันทึก":saved?"บันทึกแล้ว":"พร้อมบันทึกเมื่อคุณกรอกข้อมูล";
  const set=(key,val)=>setForm(current=>({...current,[key]:val}));
  const totalsFromMeals=meals=>Object.fromEntries(mealFields.map(field=>{const total=Object.values(meals).reduce((sum,meal)=>sum+(Number(meal[field])||0),0);return [field,total?field==="calories"?Math.round(total):+total.toFixed(1):""]}));
  const updateMeal=(key,next)=>setForm(current=>{const meals={...current.meals,[key]:next};return {...current,meals,...totalsFromMeals(meals)}});
  const addPreset=preset=>{const meal=form.meals[activeMeal],entry={...preset,entryId:`${preset.id}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`};updateMeal(activeMeal,{...meal,...Object.fromEntries(mealFields.map(field=>[field,+((Number(meal[field])||0)+(Number(preset[field])||0)).toFixed(field==="calories"?0:1)])),items:[...(meal.items||[]),entry]})};
  const copyPrevious=()=>{const previous=[...logs].filter(log=>log.date<form.date&&log.meals).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);if(!previous)return;const meals=blankMeals();Object.entries(previous.meals).forEach(([key,value])=>{meals[key]={...meals[key],...value,items:[...(value.items||[])]}});setForm(current=>({...current,meals,...totalsFromMeals(meals)}))};
  const applyDailyText=draft=>{setForm(applyDailyTextEstimate(form,draft));setSaved(false);setError("")};
  const confirmDailyText=draft=>{try { const next=applyDailyTextEstimate(form,draft); const didSave=onSave(cleanLogInput(next)); if(didSave!==false){setForm(next);setSavedSnapshot(JSON.stringify(next));setSaved(true);setError("");} return didSave; } catch(err) { setError(err.message || "ตรวจรายการอีกครั้ง"); throw err; }};
  const confirmPhotoEntries=(entries,mealKey=activeMeal)=>{try {const meals={...form.meals,[mealKey]:addPhotoFoodsToMeal(form.meals[mealKey],entries)},next={...form,meals,...totalsFromMeals(meals)},didSave=onSave(cleanLogInput(next));if(didSave!==false){setForm(next);setSavedSnapshot(JSON.stringify(next));setSaved(true);setError("");}return didSave}catch(err){setError(err.message||"ตรวจรายการอีกครั้ง");throw err}};
  const confirmLibrary=()=>{const didSave=onSave(cleanLogInput(form));if(didSave!==false){setSavedSnapshot(JSON.stringify(form));setSaved(true);setError("");}return didSave};
  const jump=(id)=>{setManualOpen(true);window.setTimeout(()=>document.getElementById(id)?.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth",block:"start"}),0)};
  const changeDate=(date)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>clock.date||date<"2026-08-30")return;const next=makeForm(date);setForm(next);setSavedSnapshot(JSON.stringify(next));setSaved(false);setError("")};
  const submit=(event)=>{event.preventDefault();const checked=logSchema.safeParse(form);if(!checked.success){setError("ตรวจตัวเลขอีกครั้ง มีค่าที่อยู่นอกช่วงที่รองรับ");return}const didSave=onSave(cleanLogInput(form));setError("");if(didSave!==false){setSaved(true);setSavedSnapshot(JSON.stringify(form))}};
  const summary=[
    ["น้ำหนัก",form.weight!==""?`${form.weight} kg`:"—"],
    ["อาหาร",form.calories!==""?`${form.calories} kcal`:"—"],
    ["กิจกรรม",form.steps!==""?`${Number(form.steps).toLocaleString()} ก้าว`:form.exerciseMinutes!==""?`${form.exerciseMinutes} นาที`:(form.workout?"ออกกำลังแล้ว":"—")],
    ["การพักฟื้น",form.sleepHours!==""||form.sleepMinutes!==""?`${form.sleepHours||0}ชม. ${form.sleepMinutes||0}นาที`:"—"],
  ];
  return <>
    <PageTitle eyebrow="DAILY CHECK-IN" title="บันทึกวันของคุณ" note="เลือกวันที่ด้านบน แล้วใช้วิธีที่สะดวกที่สุด" action={<div className="save-state" role="status">{!dirty&&saved&&<Check size={16}/>} {saveLabel}</div>}/>
    <section className="log-date-bar card"><div><CalendarDays size={19}/><span><b>วันที่บันทึก</b><small>ข้อมูลทั้งหมดด้านล่างจะบันทึกในวันนี้</small></span></div><label><span>เลือกวันที่</span><input type="date" value={form.date} min="2026-08-30" max={clock.date} onChange={e=>changeDate(e.target.value)} aria-label="วันที่บันทึก"/></label></section>
    <EntryHub key={`${form.date}-${undoRevision}`} date={form.date} activeMeal={activeMeal} setActiveMeal={setActiveMeal} meals={form.meals} onMealChange={updateMeal} onPreset={addPreset} onCopyPrevious={copyPrevious} onConfirmText={confirmDailyText} onConfirmPhoto={confirmPhotoEntries} onConfirmLibrary={confirmLibrary}/>
    <div className="log-overview" aria-label="ข้อมูลวันนี้">{[
      [Scale,"น้ำหนัก",form.weight!==""?`${form.weight} kg`:"—","weight-section"],
      [Utensils,"อาหาร",form.calories!==""?`${Number(form.calories).toLocaleString()} kcal`:"—","nutrition-section"],
      [Droplets,"น้ำดื่ม",form.water!==""?`${form.water} L`:"—","activity-section"],
      [Dumbbell,"กิจกรรม",form.exerciseMinutes!==""?`${form.exerciseMinutes} นาที`:form.workout?"ทำแล้ว":"—","activity-section"],
    ].map(([Icon,label,value,id])=><button type="button" className="log-overview-item" key={label} onClick={()=>jump(id)}><Icon size={18}/><span>{label}<b>{value}</b></span><ArrowRight size={15}/></button>)}</div>
    {error&&<p className="log-error-banner" role="alert">{error}</p>}
    <details className="manual-entry-disclosure" open={manualOpen} onToggle={event=>setManualOpen(event.currentTarget.open)}><summary><Edit3 size={18}/><span><b>กรอกหรือแก้ไขด้วยฟอร์มเต็ม</b><small>ใช้เมื่ออยากบันทึกน้ำหนัก การนอน ความรู้สึก หรือแก้รายละเอียดเอง</small></span><ChevronDown size={18}/></summary><form id="daily-log-form" className="log-layout" onSubmit={submit} onInvalidCapture={event=>{let parent=event.target.parentElement;while(parent){if(parent.tagName==="DETAILS")parent.open=true;parent=parent.parentElement}}}>
      <div className="log-main">
        <div id="weight-section" className="log-card card featured-input"><div className="log-card-title"><div className="field-icon green"><Scale size={19}/></div><div><span>WEIGHT</span><h3>ชั่งน้ำหนักตอนเช้า</h3></div></div><div className="big-input"><button type="button" aria-label="ลดน้ำหนัก 0.1 กิโลกรัม" onClick={()=>set("weight",+((form.weight===""?lastWeight:number(form.weight))-.1).toFixed(1))}>−</button><label><input aria-label="น้ำหนัก" type="number" inputMode="decimal" min="30" max="300" step="0.1" value={form.weight} placeholder={String(lastWeight)} onChange={e=>set("weight",e.target.value)}/><span>kg</span></label><button type="button" aria-label="เพิ่มน้ำหนัก 0.1 กิโลกรัม" onClick={()=>set("weight",+((form.weight===""?lastWeight:number(form.weight))+.1).toFixed(1))}>+</button></div><div className="yesterday"><span>ค่าครั้งล่าสุด <b>{lastWeight} kg</b> <small>(ใช้เป็นคำแนะนำเท่านั้น)</small></span><span>{form.date===clock.date?"วันนี้":format(parseISO(form.date),"d MMM yyyy")}</span></div></div>
        <div id="nutrition-section"><LogSection icon={Utensils} title="อาหารและสารอาหาร" note={`${calorieTargetStatus(form.calories,profile.calorieTarget).label} · โปรตีนอีก ${Math.max(0,profile.proteinMin-number(form.protein))} g`}>
          <MealLogger key={form.date} meals={form.meals} activeMeal={activeMeal} setActiveMeal={setActiveMeal} onChange={updateMeal} onPreset={addPreset} onCopyPrevious={copyPrevious}/>
          <details className="optional-fields nutrition-totals"><summary><Utensils size={17}/><span>ยอดรวมทั้งวัน · {form.calories===""?"ยังไม่มีข้อมูล":`${form.calories} kcal`}<small>ดูสารอาหารหรือกรอกยอดรวมเอง</small></span><ChevronDown size={17}/></summary><div className="field-grid">
          <Field label="พลังงานรวม" unit="kcal" value={form.calories} onChange={v=>set("calories",v)} placeholder={`เป้าหมาย ${profile.calorieTarget}`}/><Field label="โปรตีนรวม" unit="g" value={form.protein} onChange={v=>set("protein",v)} placeholder={`เป้าหมาย ${profile.proteinMin}`}/><Field label="คาร์บ" unit="g" value={form.carbs} onChange={v=>set("carbs",v)} placeholder="ไม่บังคับ"/><Field label="ไขมัน" unit="g" value={form.fat} onChange={v=>set("fat",v)} placeholder="ไม่บังคับ"/><Field label="ใยอาหาร" unit="g" value={form.fiber} onChange={v=>set("fiber",v)} placeholder="ไม่บังคับ"/><Field label="ผักและผลไม้" unit="servings" value={form.produceServings} onChange={v=>set("produceServings",v)} placeholder="ไม่บังคับ"/>
          </div></details>
        </LogSection></div>
        <div id="activity-section"><LogSection icon={Activity} title="กิจกรรมประจำวัน" note="การเคลื่อนไหว น้ำดื่ม และการพักฟื้น">
          <div className="water-shortcuts"><div><Droplets size={18}/><span>น้ำดื่มวันนี้ <b>{number(form.water).toLocaleString()} / {profile.waterTarget} L</b><small>ปุ่ม + คือเพิ่มจากยอดเดิม</small></span></div><div>{[.25,.5].map(amount=><button type="button" key={amount} onClick={()=>set("water",waterEntryValue(form.water,amount,"add"))}>+ {amount*1000} ml</button>)}</div></div>
          <Field label="ยอดรวมน้ำวันนี้" unit="L" value={form.water} onChange={v=>set("water",v)} step="0.1" placeholder={`เป้าหมาย ${profile.waterTarget}`}/><Field label="จำนวนก้าว" unit="ก้าว" value={form.steps} onChange={v=>set("steps",v)} placeholder={`เป้าหมาย ${profile.stepsTarget}`}/><Field label="Zone 2" unit="นาที" value={form.zone2Minutes} onChange={v=>set("zone2Minutes",v)} placeholder="นาทีที่ทำจริง"/><Field label="ออกกำลังกาย" unit="นาที" value={form.exerciseMinutes} onChange={v=>set("exerciseMinutes",v)} placeholder="นาทีที่ทำจริง"/><label className="activity-description">กิจกรรมที่ทำ<input value={form.exerciseDescription} maxLength={240} onChange={e=>set("exerciseDescription",e.target.value)} placeholder="เช่น เดินเร็ว 30 นาที"/></label><Field label="ชั่วโมงนอน" unit="ชม." value={form.sleepHours} onChange={v=>set("sleepHours",v)} placeholder="เช่น 7"/><Field label="นาที" unit="นาที" value={form.sleepMinutes} onChange={v=>set("sleepMinutes",v)} placeholder="เช่น 30"/>
          <div className="activity-toggles"><Toggle active={form.workout} onClick={()=>{set("workout",!form.workout);if(!form.workout)set("restDay",false)}} icon={Dumbbell}>ออกกำลังแล้ว</Toggle><Toggle active={form.restDay} onClick={()=>{set("restDay",!form.restDay);if(!form.restDay)set("workout",false)}} icon={BedDouble}>วันพัก</Toggle><Toggle active={form.sickDay} onClick={()=>set("sickDay",!form.sickDay)} icon={Activity}>ไม่สบาย</Toggle><Toggle active={form.vacationMode} onClick={()=>set("vacationMode",!form.vacationMode)} icon={Sun}>วันหยุด</Toggle></div>
        </LogSection></div>
        <details className="optional-fields card"><summary><Gauge size={18}/><span>สัดส่วนและองค์ประกอบร่างกาย<small>ไม่บังคับ · เปิดเฉพาะวันที่วัด</small></span><ChevronDown size={17}/></summary>
        <LogSection icon={Gauge} title="สัดส่วนและองค์ประกอบร่างกาย" note="ไม่บังคับ · กรอกเฉพาะวันที่วัดจริง">
          <Field label="รอบเอว" unit="cm" value={form.waist} onChange={v=>set("waist",v)} step="0.1" placeholder={measured("waist")?`ล่าสุด ${measured("waist")}`:"ไม่บังคับ"}/><Field label="ไขมันในร่างกาย" unit="%" value={form.bodyFat} onChange={v=>set("bodyFat",v)} step="0.1" placeholder={measured("bodyFat")?`ล่าสุด ${measured("bodyFat")}`:"ไม่บังคับ"}/><Field label="มวลกล้ามเนื้อ" unit="kg" value={form.muscle} onChange={v=>set("muscle",v)} step="0.01" placeholder={measured("muscle")?`ล่าสุด ${measured("muscle")}`:"ไม่บังคับ"}/><Field label="ไขมันช่องท้อง" unit="" value={form.visceral} onChange={v=>set("visceral",v)} placeholder={measured("visceral")?`ล่าสุด ${measured("visceral")}`:"ไม่บังคับ"}/>
        </LogSection>
        </details>
        <div className="log-card card"><div className="log-card-title"><div className="field-icon lilac"><Sparkles size={19}/></div><div><span>ความรู้สึกวันนี้</span><h3>เช็กอินกับตัวเอง</h3></div></div><div className="feel-row"><Score label="ความหิว" value={form.hunger} onChange={v=>set("hunger",v)}/><Score label="พลังงาน" value={form.energy} onChange={v=>set("energy",v)}/></div><div className="mood-row"><span>อารมณ์</span>{[["good","ดี"],["calm","สงบ"],["tired","เหนื่อย"],["stressed","เครียด"]].map(([value,label])=><button type="button" className={form.mood===value?"active":""} onClick={()=>set("mood",form.mood===value?"":value)} key={value}>{label}</button>)}</div><label className="notes"><span>บันทึกเพิ่มเติม <small>ไม่บังคับ</small></span><textarea value={form.notes} onChange={e=>set("notes",e.target.value)} placeholder="เช่น วันนี้ฝึกได้ดี กินข้าวนอกบ้าน หรือพัก…"/></label></div>
      </div>
      <aside className="log-side"><div className="card log-summary"><span>บันทึก · {format(parseISO(form.date),"d MMM")}</span><h3>{logs.some(log=>log.date===form.date)?"แก้ไขบันทึก":"บันทึกใหม่"}</h3><div>{summary.map(([label,value])=><p key={label}><i className={value==="Not added"?"empty":""}>{value!=="Not added"&&<Check size={12}/>}</i><span>{label}<small>{value}</small></span></p>)}</div>{error&&<p className="form-error">{error}</p>}<button className="primary-btn full" type="submit">บันทึกประจำวัน <Save size={17}/></button><small>บันทึกในเครื่องทันที และ Sync เมื่อเชื่อมบัญชี</small></div></aside>
    </form></details>
    {manualOpen&&<div className="mobile-save"><div><b>{form.date===clock.date?"วันนี้":format(parseISO(form.date),"d MMM")}</b><span role="status">{error||saveLabel}</span></div><button type="submit" form="daily-log-form" className="primary-btn">บันทึก <Save size={17}/></button></div>}
  </>;
}

function LogSection({icon:Icon,title,note,children}) { return <div className="log-card card"><div className="log-card-title"><div className="field-icon blue"><Icon size={19}/></div><div><span>DAILY LOG</span><h3>{title}</h3><p>{note}</p></div></div><div className="field-grid">{children}</div></div>; }
function EntryHub({date,activeMeal,setActiveMeal,meals,onMealChange,onPreset,onCopyPrevious,onConfirmText,onConfirmPhoto,onConfirmLibrary}) {
  const [mode,setMode]=useState("text");
  const mealLabel=MEAL_TYPES.find(([key])=>key===activeMeal)?.[1]||"มื้อนี้";
  return <section className="entry-hub card" aria-label="เลือกวิธีบันทึกอาหาร"><div className="entry-hub-head"><div><span>บันทึกแบบที่ถนัด</span><h2>เลือกวิธีเพิ่มข้อมูล</h2></div><small>เลือกหนึ่งวิธีเพื่อเริ่มบันทึก</small></div><div className="entry-methods" role="tablist" aria-label="วิธีบันทึก"><button type="button" role="tab" aria-selected={mode==="text"} className={mode==="text"?"active":""} onClick={()=>setMode("text")}><Edit3 size={17}/><span><b>พิมพ์ทั้งวัน</b><small>ให้ AI แยกมื้อ น้ำ และกิจกรรม</small></span></button><button type="button" role="tab" aria-selected={mode==="photo"} className={mode==="photo"?"active":""} onClick={()=>setMode("photo")}><Camera size={17}/><span><b>ถ่ายรูปอาหาร</b><small>ตรวจผลแล้วบันทึกทันที</small></span></button><button type="button" role="tab" aria-selected={mode==="library"} className={mode==="library"?"active":""} onClick={()=>setMode("library")}><Utensils size={17}/><span><b>คลังอาหาร</b><small>เลือกเมนูที่บันทึกบ่อย</small></span></button></div>{mode==="text"&&<DailyTextCapture date={date} onConfirm={onConfirmText}/>} {mode==="photo"&&<div className="entry-photo-mode"><div className="entry-meal-choice"><span>มื้อที่จะบันทึก</span>{MEAL_TYPES.map(([key,label])=><button type="button" className={activeMeal===key?"active":""} key={key} onClick={()=>setActiveMeal(key)}>{label}</button>)}</div><FoodPhotoCapture mealLabel={mealLabel} onConfirm={entries=>onConfirmPhoto(entries,activeMeal)}/></div>} {mode==="library"&&<MealLogger mode="library" meals={meals} activeMeal={activeMeal} setActiveMeal={setActiveMeal} onChange={onMealChange} onPreset={onPreset} onCopyPrevious={onCopyPrevious} onConfirm={onConfirmLibrary}/>}</section>;
}
function MealLogger({mode="all",meals,activeMeal,setActiveMeal,onChange,onPreset,onCopyPrevious,onConfirm}) {
  const [category,setCategory]=useState("popular"),[query,setQuery]=useState("");
  const meal=meals[activeMeal],needle=query.trim().toLocaleLowerCase("th-TH");
  const visible=FOOD_PRESETS.filter(item=>(needle?`${item.name} ${item.serving}`.toLocaleLowerCase("th-TH").includes(needle):category==="all"||category==="popular"&&item.popular||item.category===category));
  const removeItem=(entry,index)=>{if(typeof entry==="string")return;const next={...meal,items:meal.items.filter((_,itemIndex)=>itemIndex!==index)};["calories","protein","carbs","fat","fiber","produceServings"].forEach(field=>{const value=Math.max(0,(Number(next[field])||0)-(Number(entry[field])||0));next[field]=value?+(value.toFixed(field==="calories"?0:1)):""});onChange(activeMeal,next)};
  return <div className="meal-logger">
    <div className="meal-toolbar"><div><b>เลือกมื้ออาหาร</b><span>ยอดรวมสารอาหารคำนวณให้อัตโนมัติ</span></div><button type="button" onClick={onCopyPrevious}>คัดลอกจากวันก่อน</button></div>
    <div className="meal-tabs">{MEAL_TYPES.map(([key,label])=><button type="button" aria-pressed={activeMeal===key} className={activeMeal===key?"active":""} onClick={()=>setActiveMeal(key)} key={key}>{label}</button>)}</div>
    <div className="meal-at-glance"><span>มื้อนี้ <b>{number(meal.calories).toLocaleString()} <small>kcal</small></b></span><span>โปรตีน <b>{number(meal.protein)} <small>g</small></b></span><span>อาหาร <b>{meal.items?.length||0} <small>รายการ</small></b></span></div>
    {mode!=="library"&&(
      <FoodPhotoCapture key={activeMeal} mealLabel={MEAL_TYPES.find(([key])=>key===activeMeal)?.[1]||"มื้อนี้"} onAdd={entries=>onChange(activeMeal,addPhotoFoodsToMeal(meal,entries))}/>
    )}
    {mode!=="library"&&<details className="optional-fields"><summary><span>กรอกสารอาหารของมื้อนี้เอง<small>สำหรับอาหารที่ไม่มีในรายการ</small></span><ChevronDown size={17}/></summary>
    <div className="meal-entry"><Field label="พลังงาน" unit="kcal" value={meal.calories} onChange={value=>onChange(activeMeal,{...meal,calories:value})} placeholder="0"/><Field label="โปรตีน" unit="g" value={meal.protein} onChange={value=>onChange(activeMeal,{...meal,protein:value})} placeholder="0"/><Field label="คาร์บ" unit="g" value={meal.carbs} onChange={value=>onChange(activeMeal,{...meal,carbs:value})} placeholder="0"/><Field label="ไขมัน" unit="g" value={meal.fat} onChange={value=>onChange(activeMeal,{...meal,fat:value})} placeholder="0"/><Field label="ใยอาหาร" unit="g" value={meal.fiber} onChange={value=>onChange(activeMeal,{...meal,fiber:value})} placeholder="0"/></div>
    </details>}
    <div className="food-library-head"><div><b>คลังอาหาร</b><span>{FOOD_PRESETS.length} รายการ · แตะเพื่อเพิ่ม 1 หน่วย</span></div><label><Search size={15}/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="ค้นหาอาหาร…" aria-label="ค้นหาอาหาร"/>{query&&<button type="button" onClick={()=>setQuery("")} aria-label="ล้างคำค้น"><X size={14}/></button>}</label></div>
    <div className="food-categories">{FOOD_CATEGORIES.map(([key,label])=><button type="button" className={!needle&&category===key?"active":""} onClick={()=>{setCategory(key);setQuery("")}} key={key}>{label}</button>)}</div>
    <div className="food-presets">{visible.map(item=><button type="button" onClick={()=>onPreset(item)} key={item.id} title={FOOD_SOURCES[item.source].name}><Plus size={14}/><span>{item.approximate&&"≈ "}{item.name}</span><em>{item.serving}</em><small>{item.calories} kcal · P {item.protein} · C {item.carbs} · F {item.fat} · ใยอาหาร {item.fiber}g</small><i>{FOOD_SOURCES[item.source].short}</i></button>)}</div>
    {!visible.length&&<div className="food-empty">ไม่พบอาหาร ลองค้นหาด้วยชื่ออื่นหรือเลือกหมวดทั้งหมด</div>}
    {meal.items?.length>0&&<div className="meal-items"><b>เพิ่มในมื้อนี้</b>{meal.items.map((entry,index)=><span key={typeof entry==="string"?`${entry}-${index}`:entry.entryId}><span>{typeof entry==="string"?entry:`${entry.name} · ${entry.serving}`}</span>{typeof entry!=="string"&&<button type="button" onClick={()=>removeItem(entry,index)} aria-label={`ลบ ${entry.name}`}><X size={13}/></button>}</span>)}</div>}
    {mode==="library"&&<button type="button" className="primary-btn library-confirm" onClick={onConfirm} disabled={!Object.values(meals).some(item=>item.items?.length)}>ยืนยันและบันทึกอาหารวันนี้ <Save size={16}/></button>}
    <p className="food-sources">ค่าประมาณอาจเปลี่ยนตามสูตร น้ำมัน ซอส และขนาดจริง · แหล่งข้อมูล: {Object.values(FOOD_SOURCES).map((source,index)=><span key={source.short}>{index>0&&" · "}<a href={source.url} target="_blank" rel="noreferrer">{source.short}</a></span>)}</p>
  </div>;
}
function Field({label,unit,value,onChange,placeholder,step="any"}) { return <label className="field"><span>{label}</span><div><input type="number" inputMode="decimal" step={unit==="L"?"0.01":step} value={value} onChange={e=>onChange(e.target.value)} placeholder={String(placeholder||"")}/><em>{unit}</em></div></label>; }
function Toggle({active,onClick,icon:Icon,children}) { return <button type="button" className={`log-toggle ${active?"active":""}`} aria-pressed={active} onClick={onClick}><Icon size={16}/>{children}{active&&<Check size={14}/>}</button>; }
function Score({label,value,onChange}) { return <div className="score-field"><span>{label}<b>{value?`${value}/5`:"ยังไม่ได้ให้คะแนน"}</b></span><div>{[1,2,3,4,5].map(n=><button type="button" className={value===n?"active":""} aria-pressed={value===n} key={n} onClick={()=>onChange(value===n?"":n)}>{n}</button>)}</div></div>; }

function ProgressPage({profile,logs,workouts,healthWorkouts,clock,onApplyCalories}) {
  const [range,setRange]=useState("30 days"), [metric,setMetric]=useState("weight"), [selected,setSelected]=useState(null);
  const visible=filterLogs(logs,range,clock.date), s=weightStats(logs,profile,clock.date), review=weeklyReview(logs,profile,clock.date,workouts,healthWorkouts);
  const waistLogs=logs.filter(log=>log.waist!=null), waistDelta=waistLogs.length>1?waistLogs[0].waist-waistLogs.at(-1).waist:null;
  const composition=visible.filter(log=>metric==="weight"?(log.waist!=null||log.bodyFat!=null):log.muscle!=null).map(log=>({...log,label:format(parseISO(log.date),"d MMM")}));
  return <><PageTitle eyebrow="YOUR DATA" title="ความคืบหน้า" note="ดูแนวโน้ม 7 หรือ 30 วัน เพื่อเห็นการเปลี่ยนแปลงที่แท้จริง" action={<button className="secondary-btn" onClick={()=>downloadFile(`${profile.id}-progress.csv`,exportCsv({[profile.id]:logs}),"text/csv;charset=utf-8")}><Download size={16}/> ส่งออก CSV</button>}/>
    <div className="range-tabs">{[["7 days","7 วัน"],["30 days","30 วัน"],["8 weeks","8 สัปดาห์"],["16 weeks","16 สัปดาห์"]].map(([key,label])=><button className={range===key?"active":""} onClick={()=>setRange(key)} key={key}>{label}</button>)}</div>
    <section className="progress-kpis">{[["น้ำหนักล่าสุด",`${fmt1(s.latest.weight)} kg`,format(parseISO(s.latest.date),"d MMM yyyy")],["เฉลี่ย 7 วัน",s.hasFullAverage?`${fmt1(s.avg7)} kg`:"—",s.weeklyLoss==null?"ต้องมีข้อมูลครบ 14 วัน":`${s.weeklyLoss>=0?"−":"+"}${fmt1(Math.abs(s.weeklyLoss))} kg ในสัปดาห์นี้`],["เปลี่ยนจากเริ่มต้น",`${s.lost<0?"+":""}${fmt1(Math.abs(s.lost))} kg`,`${Math.round(s.progress)}% สู่เป้าหมาย`],["รอบเอวเปลี่ยน",waistDelta==null?"—":`${waistDelta>=0?"−":"+"}${fmt1(Math.abs(waistDelta))} cm`,waistDelta==null?"ต้องวัดอย่างน้อย 2 ครั้ง":"จากค่าที่วัดจริง"]].map(([a,b,c])=><div className="card" key={a}><span>{a}</span><h3>{b}</h3><small>{c}</small></div>)}</section>
    <section className="card chart-panel"><div className="card-head"><div><span>แนวโน้มจริง · {range.toUpperCase()}</span><h3>แนวโน้มน้ำหนัก</h3></div><div className="chart-legend"><i/> รายวัน <i className="avg"/> เฉลี่ย 7 วัน</div></div><WeightChart logs={visible}/><div className="chart-note"><Info size={15}/> ใช้ช่วง 7 วันตามปฏิทินและต้องมีอย่างน้อย 4 วันต่อสัปดาห์ วันที่ขาดจะไม่ถูกเลื่อนไปรวมจากสัปดาห์อื่น</div></section>
    <section className="progress-split"><div className="card metric-chart"><div className="card-head"><div><span>องค์ประกอบร่างกาย</span><h3>{metric==="weight"?"รอบเอวและไขมัน":"มวลกล้ามเนื้อ"}</h3></div><select value={metric} onChange={e=>setMetric(e.target.value)} aria-label="เลือกตัวชี้วัด"><option value="weight">รอบเอว / ไขมัน</option><option value="muscle">มวลกล้ามเนื้อ</option></select></div>{composition.length<2?<div className="empty-chart"><Gauge size={24}/><b>ยังไม่มีแนวโน้ม</b><span>ต้องมีการวัดจริงอย่างน้อย 2 ครั้งในช่วงที่เลือก</span></div>:<ResponsiveContainer width="100%" height={260}><LineChart data={composition}><CartesianGrid vertical={false} strokeDasharray="3 7" stroke="var(--line)"/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{fill:"var(--muted)",fontSize:11}}/><YAxis axisLine={false} tickLine={false} tick={{fill:"var(--muted)",fontSize:11}} domain={["dataMin - 1","dataMax + 1"]}/><Tooltip contentStyle={{background:"var(--card)",border:"1px solid var(--line)",borderRadius:12}}/>{metric==="weight"?<><Line isAnimationActive={false} connectNulls dataKey="waist" stroke="#5478d4" strokeWidth={2.5}/><Line isAnimationActive={false} connectNulls dataKey="bodyFat" stroke="#bd7a2d" strokeWidth={2.5}/></>:<Line isAnimationActive={false} connectNulls dataKey="muscle" stroke="#1f9d6a" strokeWidth={2.5}/>}</LineChart></ResponsiveContainer>}</div><MilestoneChart profile={profile}/></section>
    <WeeklyAction profile={profile} review={review} onApplyCalories={onApplyCalories}/>
    <WeeklyReview profile={profile} review={review}/>
    <CalendarCard profile={profile} logs={logs} clock={clock} onSelect={setSelected}/>
    <DayDetail log={selected} profile={profile} onClose={()=>setSelected(null)}/>
  </>;
}

function CalendarCard({profile,logs,clock,onSelect}) {
  const [month,setMonth]=useState(()=>startOfMonth(parseISO(clock.date))), days=eachDayOfInterval({start:startOfMonth(month),end:endOfMonth(month)}), first=getDay(days[0]);
  const byDate=Object.fromEntries(logs.map(x=>[x.date,x]));
  const canPrevious=format(month,"yyyy-MM")>"2026-08", canNext=format(month,"yyyy-MM")<format(parseISO(clock.date),"yyyy-MM");
  return <section className="calendar-card card"><div className="card-head"><div><span>ความสม่ำเสมอรายวัน</span><h3>{format(month,"MMMM yyyy")}</h3></div><div className="calendar-tools"><div className="calendar-key"><i className="good"/>ดี <i className="partial"/>บางส่วน <i className="low"/>น้อย</div><div className="calendar-nav"><IconButton label="เดือนก่อน" disabled={!canPrevious} onClick={()=>setMonth(value=>addMonths(value,-1))}><ChevronLeft size={17}/></IconButton><IconButton label="เดือนถัดไป" disabled={!canNext} onClick={()=>setMonth(value=>addMonths(value,1))}><ChevronRight size={17}/></IconButton></div></div></div><div className="calendar-grid">{["อา","จ","อ","พ","พฤ","ศ","ส"].map((x,i)=><b key={i}>{x}</b>)}{Array.from({length:first}).map((_,i)=><span key={`empty-${i}`}/>)}{days.map(day=>{const key=format(day,"yyyy-MM-dd"),log=byDate[key],score=log?dailyScore(log,profile):null;return <button type="button" disabled={!log} aria-label={`${format(day,"d MMMM")}${log?` คะแนน ${score}`:" ไม่มีข้อมูล"}`} onClick={()=>log&&onSelect(log)} key={key} className={score==null?"":score>=80?"good":score>=55?"partial":"low"}><span>{format(day,"d")}</span>{score!=null&&<i/>}</button>})}</div></section>;
}

function DayDetail({log,profile,onClose}) { if(!log)return null; const items=[["น้ำหนัก",log.weight==null?"—":`${log.weight} kg`],["พลังงาน",log.calories==null?"—":`${log.calories.toLocaleString()} kcal`],["โปรตีน",log.protein==null?"—":`${log.protein} g`],["น้ำดื่ม",log.water==null?"—":`${log.water} L`],["ออกกำลังกาย",log.exerciseMinutes==null?"—":`${log.exerciseMinutes} นาที`],["จำนวนก้าว",log.steps==null?"—":log.steps.toLocaleString()],["การนอน",formatSleepDuration(log.sleep)],["คะแนนวันนี้",`${dailyScore(log,profile)} / 100`]]; return <Modal open title={format(parseISO(log.date),"d MMMM yyyy")} onClose={onClose}><div className="detail-grid">{items.map(([a,b])=><div key={a}><span>{a}</span><b>{b}</b></div>)}</div>{log.exerciseDescription&&<p className="detail-note">กิจกรรม: {log.exerciseDescription}</p>}{log.notes&&<p className="detail-note">{log.notes}</p>}</Modal>; }

function MilestoneChart({profile}) { return <div className="card metric-chart"><div className="card-head"><div><span>16-WEEK PATH</span><h3>Target milestones</h3></div><Target size={20}/></div><ResponsiveContainer width="100%" height={260}><AreaChart data={MILESTONES[profile.id]}><CartesianGrid vertical={false} strokeDasharray="3 7" stroke="var(--line)"/><XAxis dataKey="w" tickFormatter={v=>`W${v}`} axisLine={false} tickLine={false} tick={{fill:"var(--muted)",fontSize:11}}/><YAxis domain={["dataMin - 2","dataMax + 2"]} axisLine={false} tickLine={false} tick={{fill:"var(--muted)",fontSize:11}}/><Tooltip labelFormatter={v=>`Week ${v}`} formatter={v=>[`${v} kg`,`Target midpoint`]}/><Area isAnimationActive={false} dataKey="v" stroke="#1f9d6a" fill="url(#weightFill)" strokeWidth={3}/></AreaChart></ResponsiveContainer></div>; }

function WeeklyReview({profile,review}) { if(!review)return <section className="weekly-review card"><div className="review-top"><div className="trophy-icon"><Award size={23}/></div><div><span>GETTING STARTED</span><h2>Starting point saved, {profile.name}</h2><p>Weekly Review จะสรุปจาก 7 วันตามปฏิทิน ไม่ดึงรายการเก่ามาแทนวันที่ขาด</p></div></div></section>; return <section className="weekly-review card"><div className="review-top"><div className="trophy-icon"><Award size={23}/></div><div><span>CALENDAR 7 DAYS</span><h2>Your weekly review, {profile.name}</h2><p>{review.excludedDays?`ตัด Sick/Vacation ${review.excludedDays} วันออกจากการประเมิน adherence`:`สรุปจากข้อมูลจริงถึงวันนี้ โดยไม่เติมวันที่ขาดหาย`}</p></div></div><div className="review-stats">{[["Average weight",review.averageWeight==null?"—":`${fmt1(review.averageWeight)} kg (${review.weightSamples} days)`],["Avg calories",review.averageCalories==null?"—":`${Math.round(review.averageCalories).toLocaleString()} kcal`],["Protein goal",`${review.proteinOnTarget} / ${review.proteinDays} tracked`],["Avg steps",review.averageSteps==null?"—":Math.round(review.averageSteps).toLocaleString()],["Strength",`${review.workoutSessions} / 3 sessions`],["Active minutes",`${Math.round(review.exerciseMinutes||0)} / 150 min`],["Avg sleep",formatSleepDuration(review.averageSleep)]].map(([a,b])=><div key={a}><span>{a}</span><b>{b}</b></div>)}</div></section>; }

const sessionVolume=session=>(session?.exercises||[]).reduce((sum,exercise)=>sum+(exercise.sets||[]).reduce((total,set)=>total+(Number(set.weight)||0)*(Number(set.reps)||0),0),0);
const previousExercise=(workouts,name,date)=>[...workouts].filter(session=>session.date<date).sort((a,b)=>a.date.localeCompare(b.date)).flatMap(session=>session.exercises||[]).filter(exercise=>exercise.name===name&&exercise.sets?.some(set=>set.weight!=null||set.reps!=null)).at(-1);
const makeWorkoutDraft=(type,workouts=[],date)=>{const existing=workouts.find(session=>session.date===date&&session.type===type);return WORKOUTS[type].map(([name,scheme,suggestedWeight])=>{const saved=existing?.exercises?.find(exercise=>exercise.name===name),previous=previousExercise(workouts,name,date);return {name,scheme,suggestedWeight,done:Boolean(saved?.done),sets:Array.from({length:3},(_,index)=>({weight:saved?.sets?.[index]?.weight??"",reps:saved?.sets?.[index]?.reps??""})),rir:saved?.rir??"",previous}})};
const reachedUpper=exercise=>{const upper=Number(exercise.scheme.match(/(\d+)(?!.*\d)/)?.[1]||99),sets=exercise.sets.filter(set=>Number(set.reps)>0);return exercise.done&&sets.length>0&&sets.every(set=>Number(set.reps)>=upper)&&Number(exercise.rir)>=1};

function QuickActivity({ onSave, date }) {
  const [kind, setKind] = useState("เดิน"), [minutes, setMinutes] = useState(""), [saved, setSaved] = useState(false);
  const save = () => { if (!Number(minutes) || Number(minutes) < 1) return; onSave({ date, exerciseMinutes: Number(minutes), exerciseDescription: kind }); setSaved(true); setMinutes(""); setTimeout(() => setSaved(false), 2500); };
  return <section className="quick-activity card" aria-label="บันทึกกิจกรรมเร็ว"><div><span>กิจกรรมวันนี้</span><h2>บันทึกการเคลื่อนไหวในไม่กี่วินาที</h2><p>เดิน วิ่ง ปั่น หรือกิจกรรมทั่วไปจะไม่เปิดฟอร์มเวทโดยอัตโนมัติ</p></div><div className="quick-activity-actions"><div className="activity-kind-list">{["เดิน","วิ่ง","ปั่นจักรยาน","กิจกรรมอื่น ๆ"].map(item => <button type="button" className={kind===item?"active":""} key={item} onClick={() => setKind(item)}>{item}</button>)}</div><label><span>นาที</span><input type="number" min="1" max="1440" inputMode="numeric" value={minutes} onChange={event => setMinutes(event.target.value)} placeholder="30"/></label><button type="button" className="primary-btn" onClick={save} disabled={!Number(minutes)}>{saved ? <><Check size={16}/> บันทึกแล้ว</> : <><Plus size={16}/> บันทึกกิจกรรม</>}</button></div></section>;
}

function WorkoutPage({profile,workouts,healthWorkouts,onSave,onQuickSave,clock,preferences,onPreferences}) {
  const initialType=workouts.filter(item=>item.date<clock.date).length%2===0?"A":"B";
  const [type,setType]=useState(initialType), [draft,setDraft]=useState(()=>makeWorkoutDraft(initialType,workouts,clock.date)), [saved,setSaved]=useState(false), [scheduleOpen,setScheduleOpen]=useState(false),[duration,setDuration]=useState(()=>workouts.find(item=>item.date===clock.date&&item.type===initialType)?.durationMinutes??""),[trendExercise,setTrendExercise]=useState("Chest Press");
  const changeType=next=>{setType(next);setDraft(makeWorkoutDraft(next,workouts,clock.date));setDuration(workouts.find(item=>item.date===clock.date&&item.type===next)?.durationMinutes??"");setSaved(false)};
  const update=(index,next)=>setDraft(current=>current.map((exercise,i)=>i===index?next:exercise));
  const completed=draft.filter(exercise=>exercise.done).length;
  const exerciseNames=[...new Set(Object.values(WORKOUTS).flat().map(item=>item[0]))],history=workouts.map(session=>{const exercise=session.exercises?.find(item=>item.name===trendExercise);if(!exercise)return null;const weights=exercise.sets?.map(set=>Number(set.weight)||0).filter(Boolean)||[];return weights.length?{date:session.date,label:format(parseISO(session.date),"d MMM"),value:Math.max(...weights),volume:(exercise.sets||[]).reduce((sum,set)=>sum+(Number(set.weight)||0)*(Number(set.reps)||0),0)}:null}).filter(Boolean);
  const upperReached=draft.filter(exercise=>exercise.done).length>0&&draft.filter(exercise=>exercise.done).every(reachedUpper),recentSessions=[...workouts].sort((a,b)=>a.date.localeCompare(b.date)).slice(-2),recoveryDrop=recentSessions.length===2&&sessionVolume(recentSessions[1])<sessionVolume(recentSessions[0])*.85;
  const save=()=>{if(!draft.some(exercise=>exercise.done||exercise.sets.some(set=>set.reps!==""||set.weight!=="")))return;const existing=workouts.find(item=>item.date===clock.date&&item.type===type),didSave=onSave({id:existing?.id||`${profile.id}-${clock.date}-${Date.now()}`,profileId:profile.id,date:clock.date,type,durationMinutes:duration===""?null:Number(duration),exercises:draft.map(({previous,...exercise})=>({...exercise,sets:exercise.sets.map(set=>({weight:set.weight===""?null:Number(set.weight),reps:set.reps===""?null:Number(set.reps)})),rir:exercise.rir===""?null:Number(exercise.rir)})),completedExercises:completed,createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()});if(didSave!==false)setSaved(true)};
  return <><PageTitle eyebrow="TRAINING" title="กิจกรรม" note="บันทึกการเคลื่อนไหวได้เร็ว แล้วเปิดโปรแกรมเวทเมื่อต้องการ" action={<button className="secondary-btn" onClick={()=>setScheduleOpen(true)}><CalendarDays size={16}/> ตาราง</button>}/>
    <QuickActivity date={clock.date} onSave={onQuickSave}/>
    <details className="strength-program"><summary><Dumbbell size={18}/><span><b>โปรแกรมเวท Full body</b><small>Workout A/B · 3 ครั้งต่อสัปดาห์ · เปิดเมื่อพร้อมฝึก</small></span><ChevronDown size={18}/></summary>
    <div className="workout-tabs"><button className={type==="A"?"active":""} onClick={()=>changeType("A")}><b>A</b><span>Workout A<small>Squat · Push · Pull</small></span></button><button className={type==="B"?"active":""} onClick={()=>changeType("B")}><b>B</b><span>Workout B<small>Hinge · Row · Press</small></span></button></div>
    <section className="workout-layout"><div><div className="workout-banner"><div><span>{format(parseISO(clock.date),"d MMM").toUpperCase()} · เซสชันวันนี้</span><h2>Full body · Workout {type}</h2><p>6 ท่า · 18 เซ็ต · แสดงผลงานครั้งก่อนเพื่อช่วยวางแผน</p><label className="duration-input">ระยะเวลา <input type="number" min="0" max="300" value={duration} onChange={event=>setDuration(event.target.value)} placeholder="55"/> นาที</label></div><Ring value={completed/6*100}><b>{completed}</b><small>จาก 6 ท่า</small></Ring></div><div className="exercise-list">{draft.map((exercise,i)=><Exercise key={exercise.name} index={i+1} exercise={exercise} onChange={next=>update(i,next)}/>)}</div><button className="primary-btn workout-save" type="button" onClick={save} disabled={!draft.some(exercise=>exercise.done||exercise.sets.some(set=>set.reps!==""||set.weight!==""))}>{saved?<Check size={17}/>:<Save size={17}/>} {saved?"บันทึกเวิร์กเอาต์แล้ว":"บันทึกเวิร์กเอาต์"}</button></div><aside><div className="card workout-tip"><Sparkles size={19}/><span>{recoveryDrop?"เช็กการฟื้นตัว":"เคล็ดลับการเพิ่มแรง"}</span><h3>{recoveryDrop?"ปริมาตรลดลงต่อเนื่อง":upperReached?"พร้อมเพิ่มน้ำหนัก":"รักษาช่วงจำนวนครั้ง"}</h3><p>{recoveryDrop?"ปริมาตรครั้งล่าสุดลดเกิน 15% ลองตรวจการนอน ความหิว และอาการล้าก่อนเพิ่มน้ำหนัก":upperReached?"ท่าที่ถึงช่วงจำนวนครั้งสูงสุดและยังเหลือ RIR สามารถพิจารณาเพิ่มน้ำหนักครั้งหน้า":"เพิ่มน้ำหนักเฉพาะท่าที่ทำถึงช่วงสูงสุด โดยยังเหลือ 1–2 RIR"}</p></div><div className="card strength-card"><span>แนวโน้มแรง · ทุกท่า</span><select value={trendExercise} onChange={event=>setTrendExercise(event.target.value)} aria-label="เลือกท่าที่ต้องการดูแนวโน้ม">{exerciseNames.map(name=><option key={name}>{name}</option>)}</select>{history.length<2?<div className="mini-empty">บันทึก {trendExercise} อย่างน้อย 2 ครั้งเพื่อดูแนวโน้ม</div>:<><b>{history[0].value} <small>→</small> {history.at(-1).value} kg</b><ResponsiveContainer width="100%" height={120}><LineChart data={history}><Line isAnimationActive={false} dataKey="value" stroke="#1f9d6a" strokeWidth={3}/><YAxis hide domain={["dataMin - 2","dataMax + 2"]}/><Tooltip/></LineChart></ResponsiveContainer><small>ปริมาตรล่าสุด {Math.round(history.at(-1).volume).toLocaleString()} kg·ครั้ง</small></>}</div><div className="card apple-workout-card"><span>APPLE HEALTH</span><h3>เวิร์กเอาต์ที่ซิงก์</h3>{healthWorkouts.length?<div>{healthWorkouts.slice(-4).reverse().map(item=><p key={item.id}><Watch size={15}/><span><b>{String(item.activityType).replace(/([A-Z])/g," $1").replace(/^activity-/,"Workout ")}</b><small>{format(parseISO(item.startAt),"d MMM · HH:mm")} · {Math.round(item.durationMinutes||0)} นาที</small></span></p>)}</div>:<div className="mini-empty">เชื่อม HealthKit Companion เพื่อดึงเวิร์กเอาต์จาก Apple Watch</div>}</div></aside></section>
    </details><ScheduleModal open={scheduleOpen} onClose={()=>setScheduleOpen(false)} preferences={preferences} onChange={onPreferences}/>
  </>;
}

function Exercise({index,exercise,onChange}) { const setValue=(setIndex,key,value)=>onChange({...exercise,sets:exercise.sets.map((set,i)=>i===setIndex?{...set,[key]:value}:set)}),previous=exercise.previous,ready=reachedUpper(exercise); return <div className={`exercise card ${exercise.done?"done":""}`}><button type="button" className="check-btn" aria-label={`${exercise.done?"ยกเลิก":"ทำเสร็จ"} ${exercise.name}`} onClick={()=>onChange({...exercise,done:!exercise.done})}>{exercise.done?<Check size={17}/>:index}</button><div className="exercise-name"><span>{exercise.scheme}</span><h3>{exercise.name}</h3><p>{previous?`ครั้งก่อน ${previous.sets.map(set=>`${set.weight||0}×${set.reps||0}`).join(" · ")} · RIR ${previous.rir??"—"}`:exercise.suggestedWeight?`Suggested start ${exercise.suggestedWeight} kg`:"Bodyweight · no preset logged"}</p>{ready&&<b className="progress-ready">พร้อมเพิ่มครั้งหน้า</b>}</div><div className="sets">{exercise.sets.map((set,i)=><label key={i}><span>SET {i+1}</span><div className="set-inputs"><input aria-label={`${exercise.name} set ${i+1} weight`} type="number" min="0" step="0.5" placeholder={String(previous?.sets?.[i]?.weight??"kg")} value={set.weight} onChange={event=>setValue(i,"weight",event.target.value)}/><input aria-label={`${exercise.name} set ${i+1} reps`} type="number" min="0" placeholder={String(previous?.sets?.[i]?.reps??"reps")} value={set.reps} onChange={event=>setValue(i,"reps",event.target.value)}/></div></label>)}<label><span>RIR</span><input aria-label={`${exercise.name} reps in reserve`} type="number" min="0" max="10" placeholder="—" value={exercise.rir} onChange={event=>onChange({...exercise,rir:event.target.value})}/><small>left</small></label></div></div>; }

function ScheduleModal({open,onClose,preferences,onChange}) { const names=["อา.","จ.","อ.","พ.","พฤ.","ศ.","ส."]; return <Modal open={open} title="ตารางเวิร์กเอาต์" onClose={onClose}><p className="modal-copy">เลือกวันที่วางแผนฝึก การตั้งค่านี้บันทึกในเครื่องและใช้กับการแจ้งเตือน</p><div className="day-picker">{names.map((name,index)=><button type="button" className={preferences.workoutDays.includes(index)?"active":""} aria-pressed={preferences.workoutDays.includes(index)} key={name} onClick={()=>onChange({...preferences,workoutDays:preferences.workoutDays.includes(index)?preferences.workoutDays.filter(day=>day!==index):[...preferences.workoutDays,index].sort()})}>{name}</button>)}</div></Modal>; }

function ComparePage({allLogs,allWorkouts,clock}) {
  const rows=Object.values(PROFILES).map(p=>({p,s:statsFor(allLogs[p.id],p,clock.date),logs:allLogs[p.id],a:adherenceSummary(allLogs[p.id],p,clock.date,allWorkouts[p.id]||[])}));
  const baseline=rows.every(row=>row.logs.length<=1);
  const tied=rows[0].s.consistency===rows[1].s.consistency;
  const waistChange=row=>{const values=row.logs.filter(log=>log.waist!=null);return values.length>1?values[0].waist-values.at(-1).waist:null};
  return <><PageTitle eyebrow="SHARED CHALLENGE" title="Better together" note="Friendly competition ที่ให้คะแนนจาก consistency และ % การเปลี่ยนแปลง" action={<div className="week-nav">Week {clock.week} of 16</div>}/>
    <div className="leader-card"><div><Trophy size={25}/><span>WEEK {clock.week} · {baseline?"STARTING POINT":"REAL DATA"}</span><h2>{baseline?"Challenge starts here":"Both moving forward"}</h2><p>{baseline?"ทั้งคู่เริ่มต้นจากข้อมูลจริง คะแนน consistency จะเพิ่มเมื่อเริ่มบันทึกกิจวัตร":"วัดความสม่ำเสมออย่างเป็นธรรม โดยไม่ตัดสินจากน้ำหนักตัวอย่างเดียว"}</p></div><div className="podium">{rows.map(({p,s},i)=><div key={p.id}><span>{tied?"TIED":`#${i+1}`}</span><Avatar profile={p} large/><b>{p.name}</b><strong>{s.consistency}%</strong><small>consistency</small></div>)}</div></div>
    <section className="compare-table card"><div className="compare-head"><span>METRIC</span>{rows.map(({p})=><div key={p.id}><Avatar profile={p}/><b>{p.name}</b></div>)}</div>{[
      ["Body weight lost",r=>`${fmt1((r.s.lost/r.p.startWeight)*100)}%`,"ใช้ % เพื่อเทียบอย่างยุติธรรม"],
      ["Weight lost",r=>`${fmt1(r.s.lost)} kg`,"จากน้ำหนักเริ่มต้น"],
      ["Waist change",r=>{const value=waistChange(r);return value==null?"—":`${value>=0?"−":"+"}${fmt1(Math.abs(value))} cm`},"จากค่าที่วัดจริง"],
      ["Protein compliance",r=>r.a.proteinAdherence==null?"—":`${Math.round(r.a.proteinAdherence*100)}%`,"7 วันตามปฏิทิน"],
      ["Steps compliance",r=>r.a.averageSteps==null?"—":`${Math.round(pct(r.a.averageSteps,r.p.stepsTarget))}%`,"7 วันตามปฏิทิน"],
      ["Workout sessions",r=>String(r.a.workoutSessions),"สัปดาห์ปัจจุบัน"],
    ].map(([label,get,note])=><div className="compare-line" key={label}><div><b>{label}</b><small>{note}</small></div>{rows.map(r=><strong key={r.p.id}>{get(r)}</strong>)}</div>)}</section>
    <section className="insight-wide"><Sparkles size={20}/><div><span>TEAM INSIGHT</span><h3>{baseline?"เริ่มจาก baseline ที่ชัดเจน":"Momentum กำลังมาถูกทาง"}</h3><p>{baseline?"Zackdark เริ่มที่ 87.8 kg และ Tony เริ่มที่ 95.5 kg — รอข้อมูลจริงก่อนสร้าง insight":"ทั้งคู่กำลังสร้างกิจวัตรที่สนับสนุนเป้าหมายระยะยาว"}</p></div></section>
  </>;
}

function ProfilePage({profile,store,setPage,onReset,onPreview,previewDemo,onImport,onSettings}) { const choose=(kind)=>{const input=document.createElement("input");input.type="file";input.accept=kind==="csv"?".csv,text/csv":".json,application/json";input.onchange=()=>input.files?.[0]&&onImport(input.files[0],kind);input.click()}; return <><PageTitle eyebrow="ACCOUNT & PLAN" title="โปรไฟล์" note="เป้าหมายและการตั้งค่าของคุณใน 16 สัปดาห์"/><section className="profile-layout"><div className="card profile-card"><Avatar profile={profile} large/><h2>{profile.name}</h2><p>เริ่มต้น 30 สิงหาคม 2026 · ข้อมูลจริงของคุณ</p><div className="profile-numbers">{[["น้ำหนักเริ่มต้น",`${profile.startWeight} kg`],["เป้าหมายหลัก",`${profile.goalMin}–${profile.goalMax} kg`],["ไขมันในร่างกาย",`${profile.bodyFat}%`],["มวลกล้ามเนื้อ",`${profile.muscle} kg`],["BMR",`${profile.bmr} kcal`],["ไขมันช่องท้อง",profile.visceral]].map(([a,b])=><div key={a}><span>{a}</span><b>{b}</b></div>)}</div><div className="measurement-rhythm"><h3>จังหวะการวัด</h3><p><b>ทุกวัน</b><span>น้ำหนัก · พลังงาน · โปรตีน</span></p><p><b>อัตโนมัติ</b><span>ก้าว · การนอน · กิจกรรม</span></p><p><b>ทุกสัปดาห์</b><span>รอบเอว · องค์ประกอบร่างกาย</span></p><p><b>ทุก 4 สัปดาห์</b><span>รูปความคืบหน้า</span></p></div></div><div className="profile-stack"><div className="card settings-card"><h3>เป้าหมายรายวัน</h3>{[["พลังงาน",`${profile.calorieTarget.toLocaleString()} kcal`],["โปรตีน",`${profile.proteinMin}–${profile.proteinMax} g`],["น้ำดื่ม",`${profile.waterTarget} L`],["จำนวนก้าว",profile.stepsTarget.toLocaleString()],["การนอน","8 ชั่วโมง"],["กิจกรรมต่อสัปดาห์","150 นาที · เวท 3 ครั้ง"]].map(([a,b])=><p key={a}><span>{a}</span><b>{b}</b></p>)}</div><div className="card settings-card"><h3>ข้อมูล การเชื่อมต่อ และชาเลนจ์</h3><button onClick={()=>setPage("compare")}><Users size={17}/> เปรียบเทียบ Zackdark กับ Tony <ArrowRight size={15}/></button><button onClick={onSettings}><Wifi size={17}/> Sync และการแจ้งเตือน <ArrowRight size={15}/></button><button onClick={()=>downloadFile("recomp-backup.json",JSON.stringify(store,null,2),"application/json")}><Download size={17}/> สำรองข้อมูล JSON <ArrowRight size={15}/></button><button onClick={()=>downloadFile("recomp-logs.csv",exportCsv(store.logs),"text/csv;charset=utf-8")}><Download size={17}/> ส่งออก CSV <ArrowRight size={15}/></button><button onClick={()=>choose("json")}><Upload size={17}/> นำเข้า JSON backup <ArrowRight size={15}/></button><button onClick={()=>choose("csv")}><Upload size={17}/> นำเข้า CSV <ArrowRight size={15}/></button><button className="danger-row" onClick={onReset}><RefreshCcw size={17}/> รีเซ็ตข้อมูลเริ่มต้น <ArrowRight size={15}/></button><button onClick={onPreview}><Sparkles size={17}/> {previewDemo?"ออกจากโหมดตัวอย่าง":"เปิดโหมดตัวอย่างแยกข้อมูลจริง"} <ArrowRight size={15}/></button></div></div></section></> }

function Modal({open,title,onClose,children,footer}) { useEffect(()=>{if(!open)return;const close=event=>event.key==="Escape"&&onClose();window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close)},[open,onClose]); if(!open)return null; return <div className="modal-backdrop" role="presentation" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><section className="modal-card" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><h2>{title}</h2><IconButton label="ปิด" onClick={onClose}><X size={19}/></IconButton></div><div className="modal-body">{children}</div>{footer&&<div className="modal-footer">{footer}</div>}</section></div>; }

function NativePairingSection() {
  const [pairing,setPairing]=useState(null),[message,setMessage]=useState("");
  const create=async()=>{setMessage("กำลังสร้าง token…");try{setPairing(await createRecompNativePairing());setMessage("สร้าง token แล้ว วางในแอป Recomp SwiftUI") }catch(error){setMessage(error.message)}};
  const revoke=async()=>{setMessage("กำลังยกเลิก…");try{await revokeRecompNativePairing();setPairing(null);setMessage("ยกเลิกการเชื่อมต่อแอป SwiftUI แล้ว")}catch(error){setMessage(error.message)}};
  return <div className="settings-section"><span>RECOMP SWIFTUI · BETA</span><p className="modal-copy">สร้างรหัสสำหรับแอป iPhone ใหม่ รหัสนี้แยกจาก Apple Health Companion และใช้กับโปรไฟล์ของคุณเท่านั้น</p><div className="modal-actions"><button className="primary-btn" onClick={create}>สร้าง token สำหรับ SwiftUI</button><button className="secondary-btn" onClick={revoke}>ยกเลิก token</button></div>{pairing&&<div className="pairing-box"><p>รหัสแสดงครั้งเดียว เก็บไว้ใน Keychain ของ iPhone</p>{[["PROFILE",pairing.profileId],["ENDPOINT",pairing.endpoint],["TOKEN",pairing.token]].map(([label,value])=><label key={label}><span>{label}</span><div><code>{value}</code><button onClick={()=>navigator.clipboard.writeText(value).then(()=>setMessage("คัดลอกแล้ว")).catch(()=>setMessage("คัดลอกไม่ได้ กรุณาเลือกข้อความเอง"))} aria-label={`คัดลอก ${label}`}><Copy size={15}/></button></div></label>)}</div>}{message&&<p className="settings-message">{message}</p>}</div>;
}

function SettingsModal({open,onClose,preferences,onPreferences,syncInfo,integration,onSignIn,onSignOut,onCreatePairing,onRevokePairing}) {
  const [message,setMessage]=useState(""), [pairing,setPairing]=useState(null),[permission,setPermission]=useState(()=>notificationSupport()?Notification.permission:"unsupported");
  const toggle=key=>onPreferences({...preferences,[key]:!preferences[key]});
  const setTime=(key,value)=>onPreferences({...preferences,reminderTimes:{...preferences.reminderTimes,[key]:value}});
  const enableNotifications=async()=>{const next=await requestReminderPermission();setPermission(next);setMessage(next==="granted"?"เปิด Browser notifications แล้ว":"ยังไม่ได้รับสิทธิ์แจ้งเตือน กรุณาอนุญาตจาก Settings ของเบราว์เซอร์")};
  const signIn=async()=>{setMessage("กำลังเชื่อมบัญชี…");try{await onSignIn();setMessage("")}catch(error){setMessage(error.code==="auth/popup-closed-by-user"?"ปิดหน้าต่างก่อนเข้าสู่ระบบสำเร็จ":error.message)}};
  const createPairing=async()=>{setMessage("กำลังสร้าง pairing token…");try{const next=await onCreatePairing();setPairing(next);setMessage("สร้าง token แล้ว กรุณาคัดลอกไปใส่ใน Recomp Health Companion")}catch(error){setMessage(error.message)}};
  const revokePairing=async()=>{setMessage("กำลังยกเลิกการเชื่อมต่อ…");try{await onRevokePairing();setPairing(null);setMessage("ยกเลิก Apple Health pairing แล้ว")}catch(error){setMessage(error.message)}};
  const copy=async value=>{try{await navigator.clipboard.writeText(value);setMessage("คัดลอกแล้ว")}catch{setMessage("คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกข้อความแล้วคัดลอก")}};
  const statusCopy=syncInfo.status==="live"?"Realtime sync ทำงานอยู่ การเปลี่ยนแปลงจะปรากฏบนอุปกรณ์ของสมาชิกทันที":syncInfo.status==="connecting"?"กำลังรวมข้อมูลในเครื่องกับ Realtime Database…":syncInfo.status==="offline"?"ออฟไลน์ชั่วคราว ข้อมูลจะเก็บในเครื่องและเชื่อมต่อใหม่อัตโนมัติ":syncInfo.message||"เชื่อม Firebase แล้ว";
  return <Modal open={open} title="Realtime sync & reminders" onClose={onClose}>
    <div className="settings-section"><span>REMINDERS</span><p className="modal-copy">แจ้งเตือนตามเวลา Asia/Bangkok ผ่าน PWA เมื่อแอปกำลังทำงาน และตรวจรายการที่ยังขาดก่อนเตือน ไม่ส่งเตือนซ้ำในวันเดียว</p>{permission!=="granted"&&<button className="primary-btn full" onClick={enableNotifications} disabled={permission==="unsupported"}>{permission==="unsupported"?"อุปกรณ์นี้ไม่รองรับ Browser notification":"Enable notifications"}</button>}<div className="reminder-list">{[["morningWeighIn","Morning weigh-in"],["proteinReminder","Protein reminder"],["workoutReminder","Workout reminder"],["weeklyReview","Weekly review"]].map(([key,label])=><div className="reminder-row" key={key}><button type="button" className="switch-row" onClick={()=>toggle(key)}><span>{label}</span><i className={preferences[key]?"on":""}><b/></i></button><input type="time" aria-label={`เวลา ${label}`} value={preferences.reminderTimes?.[key]||""} onChange={event=>setTime(key,event.target.value)} disabled={!preferences[key]}/></div>)}</div><small className="settings-fineprint">การแจ้งเตือนขณะปิดแอปสนิทต้องมี Web Push server เพิ่มเติม เบราว์เซอร์ไม่อนุญาตให้หน้าเว็บตั้ง local alarm เอง</small></div>
    <div className="settings-section"><span>FIREBASE REALTIME DATABASE</span>{!syncInfo.configured?<div className="sync-state"><Wifi size={18}/><div><b>Local fallback</b><p>ยังไม่ได้ตั้งค่า Firebase environment variables บน deployment นี้</p></div></div>:!syncInfo.user?<><div className="sync-state"><Wifi size={18}/><div><b>ยังไม่ได้เข้าสู่ระบบ</b><p>ใช้บัญชี Google เดียวกับแอปอื่น เฉพาะ ZackDark และ Tony Kora ที่เป็นสมาชิก challenge เท่านั้น</p></div></div><button className="primary-btn full google-sync" onClick={signIn}><b>G</b> Continue with Google</button></>:<><div className={`sync-state ${syncInfo.authorized?"online":""}`}><Wifi size={18}/><div><b>{syncInfo.user.displayName||syncInfo.user.email}</b><p>{statusCopy}</p></div></div><div className="modal-actions"><span className={`live-badge ${syncInfo.status}`}>{syncInfo.status==="live"?"LIVE":syncInfo.status.toUpperCase()}</span><button className="secondary-btn" onClick={onSignOut}>Sign out</button></div></>}{message&&<p className="settings-message">{message}</p>}</div>
    {syncInfo.authorized&&<div className="settings-section"><span>APPLE HEALTH · BETA</span><div className={`sync-state ${integration?.paired&&integration?.lastSyncedAt?"online":""}`}><Watch size={18}/><div><b>{!integration?.paired?"ยังไม่ได้เชื่อม Apple Health":integration?.lastSyncedAt?"Apple Health เชื่อมอยู่":"พร้อมเชื่อม iPhone"}</b><p>{!integration?.paired?(integration?.lastSyncedAt?`ยกเลิกการเชื่อมต่อแล้ว · ซิงก์ล่าสุด ${new Date(integration.lastSyncedAt).toLocaleString("th-TH")}`:"เชื่อมต่อเพื่ออ่านข้อมูลจาก HealthKit Companion"):integration?.lastSyncedAt?`ซิงก์ล่าสุด ${new Date(integration.lastSyncedAt).toLocaleString("th-TH")}`:"อ่าน Steps, Sleep, Weight, Body Fat และ Workout ผ่าน HealthKit Companion"}</p></div></div><div className="modal-actions"><button className="primary-btn" onClick={createPairing}>{integration?.paired?"สร้าง token ใหม่":"สร้าง token เชื่อมต่อ"}</button>{integration?.paired&&<button className="secondary-btn" onClick={revokePairing}>ยกเลิกการเชื่อมต่อ</button>}</div>{pairing&&<div className="pairing-box"><p>Token จะแสดงครั้งเดียว เก็บไว้ใน Keychain ของ iPhone และอย่าแชร์ให้ผู้อื่น</p>{[["PROFILE",pairing.profileId],["SYNC ENDPOINT",pairing.endpoint],["PAIRING TOKEN",pairing.token]].map(([label,value])=><label key={label}><span>{label}</span><div><code>{value}</code><button onClick={()=>copy(value)} aria-label={`คัดลอก ${label}`}><Copy size={15}/></button></div></label>)}</div>}</div>}
    {syncInfo.authorized&&<NativePairingSection/>}
  </Modal>;
}

export default function HealthApp() {
  const validPages=[...nav.map(item=>item[0]),"compare"], pageFromHash=()=>validPages.includes(location.hash.slice(1))?location.hash.slice(1):"dashboard";
  const [page,setPageState]=useState(pageFromHash), [profileId,setProfileId]=useState("zackdark"), [dark,setDark]=useState(()=>localStorage.getItem("recomp-theme-v2")!=="light");
  const [store,setStore]=useState(loadStore), [previewDemo,setPreviewDemo]=useState(false), [settingsOpen,setSettingsOpen]=useState(false), [resetOpen,setResetOpen]=useState(false), [toast,setToast]=useState(""), [undoState,setUndoState]=useState(null), [undoRevision,setUndoRevision]=useState(0);
  const storeRef=useRef(store), undoRef=useRef(null), toastTimer=useRef(null), [authUser,setAuthUser]=useState(null);
  const [sessionStatus,setSessionStatus]=useState(firebaseConfigured?"checking":"ready");
  const [syncInfo,setSyncInfo]=useState({configured:firebaseConfigured,user:null,status:firebaseConfigured?"signed-out":"local",authorized:false,connected:false});
  const clock=challengeClock(bangkokToday());
  const demoStore=useMemo(()=>({...initialStore(),logs:{zackdark:makeDemoLogs("zackdark"),tony:makeDemoLogs("tony")}}),[]);
  const activeStore=previewDemo?demoStore:store, allLogs=activeStore.logs, baseProfile=PROFILES[profileId], profile={...baseProfile,calorieTarget:activeStore.plans?.[profileId]?.calorieTarget??baseProfile.calorieTarget,calorieHistory:activeStore.plans?.[profileId]?.history||[]}, logs=allLogs[profileId], workouts=activeStore.workouts[profileId]||[], healthWorkouts=activeStore.healthWorkouts?.[profileId]||[], integration=activeStore.integrations?.appleHealth?.[profileId]||{};
  const pageScroll=useRef({});
  const setPage=next=>{pageScroll.current[page]=window.scrollY;setPageState(next);if(location.hash!==`#${next}`)history.replaceState(null,"",`#${next}`)};
  useLayoutEffect(()=>{window.scrollTo({top:pageScroll.current[page]||0,behavior:"instant"})},[page]);
  useEffect(()=>{document.documentElement.dataset.recompTheme=dark?"dark":"light";localStorage.setItem("recomp-theme-v2",dark?"dark":"light")},[dark]);
  useEffect(()=>{storeRef.current=store;saveStore(store)},[store]);
  useEffect(()=>observeFirebaseAuth(user=>{setAuthUser(user);setSessionStatus(firebaseConfigured?(user?"checking":"signed-out"):"ready");setSyncInfo(current=>({...current,user,status:user?"connecting":"signed-out",authorized:false,connected:false}))}),[]);
  useEffect(()=>{if(!authUser)return;let stop=()=>{},cancelled=false;connectRealtime(authUser,storeRef.current,{onStore:(next,member)=>{if(cancelled)return;if(!PROFILES[member?.profileId]){setSessionStatus("error");setSyncInfo(current=>({...current,status:"error",authorized:false,message:"Member profile ไม่ถูกต้อง"}));return}storeRef.current=next;setStore(next);setProfileId(member.profileId);setSessionStatus("ready")},onState:state=>{if(cancelled)return;setSyncInfo(current=>({...current,...state,user:authUser}));if(state.status==="denied")setSessionStatus("denied")}}).then(unsubscribe=>{if(cancelled)unsubscribe();else stop=unsubscribe}).catch(error=>{setSessionStatus("error");setSyncInfo(current=>({...current,status:"error",authorized:false,connected:false,message:error.message,user:authUser}))});return()=>{cancelled=true;stop()}},[authUser]);
  useEffect(()=>{const onHash=()=>setPageState(pageFromHash());window.addEventListener("hashchange",onHash);return()=>window.removeEventListener("hashchange",onHash)},[]);
  useEffect(()=>{const shortcut=event=>{if(event.key.toLowerCase()==="n"&&!event.metaKey&&!event.ctrlKey&&!/input|textarea|select/i.test(event.target.tagName))setPage("log")};window.addEventListener("keydown",shortcut);return()=>window.removeEventListener("keydown",shortcut)},[]);
  useEffect(()=>{
    document.title="Recomp · 16 Week Protocol";
    document.querySelector('link[rel="manifest"]')?.setAttribute("href","/manifest.webmanifest");
    document.querySelector('link[rel="icon"]')?.setAttribute("href","/icon.svg");
    document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href","/icon.svg");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content",dark?"#0f1512":"#f4f6f3");
    if("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(()=>{});
  },[dark]);
  const flash=message=>{setToast(message);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(""),3000)};
  useEffect(()=>startReminderScheduler({getState:()=>{const current=storeRef.current,base=PROFILES[profileId];return {logs:current.logs[profileId]||[],profile:{...base,calorieTarget:current.plans?.[profileId]?.calorieTarget??base.calorieTarget},preferences:current.preferences}},onDue:title=>flash(title)}),[profileId,store.preferences]);
  const commit=next=>{storeRef.current=next;setStore(next);return next};
  const remoteError=error=>{setSyncInfo(current=>({...current,status:"error",connected:false,message:error.message}));flash(`Realtime sync ไม่สำเร็จ: ${error.message}`)};
  const saveLog=input=>{if(previewDemo){flash("ออกจาก Demo preview ก่อนบันทึกข้อมูลจริง");return false}const current=storeRef.current,previous=current.logs[profileId]?.find(log=>log.date===input.date);const next=commit(upsertProfileLog(current,profileId,input)),saved=next.logs[profileId].find(log=>log.date===input.date);if(syncInfo.authorized)writeRealtimeLog(profileId,saved).catch(remoteError);const action={profileId,date:input.date,previous:previous?JSON.parse(JSON.stringify(previous)):null};undoRef.current=action;setUndoState(action);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>{setToast("");setUndoState(currentAction=>currentAction?.date===input.date?null:currentAction)},6000);setToast(`บันทึก ${format(parseISO(input.date),"d MMM")} แล้ว${syncInfo.authorized?" · syncing":" · ในเครื่อง"}`);return true};
  const saveQuickActivity=input=>{if(previewDemo){flash("ออกจาก Demo preview ก่อนบันทึกข้อมูลจริง");return false}const current=storeRef.current,existing=current.logs[profileId]?.find(log=>log.date===input.date)||{},next=commit(upsertProfileLog(current,profileId,{...existing,...input})),saved=next.logs[profileId].find(log=>log.date===input.date);if(syncInfo.authorized)writeRealtimeLog(profileId,saved).catch(remoteError);flash(`บันทึกกิจกรรม ${input.exerciseDescription} แล้ว`);return true};
  const undoLastSave=()=>{const action=undoRef.current;if(!action)return;const current=storeRef.current,restoredLogs=restoreProfileLog(current.logs[action.profileId],action.date,action.previous);commit({...current,logs:{...current.logs,[action.profileId]:restoredLogs}});if(syncInfo.authorized){const remote=action.previous?writeRealtimeLog(action.profileId,action.previous):deleteRealtimeLog(action.profileId,action.date);remote.catch(remoteError)}undoRef.current=null;setUndoState(null);setUndoRevision(value=>value+1);setToast("ยกเลิกการบันทึกแล้ว");if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(""),3000)};
  const saveWorkout=session=>{if(previewDemo){flash("ออกจาก Demo preview ก่อนบันทึก Workout");return false}const current=storeRef.current,withLog=upsertProfileLog(current,profileId,{...(current.logs[profileId].find(log=>log.date===session.date)||{}),date:session.date,workout:true}),next=commit({...withLog,workouts:{...withLog.workouts,[profileId]:[...(withLog.workouts[profileId]||[]).filter(item=>!(item.date===session.date&&item.type===session.type)),session]}}),savedLog=next.logs[profileId].find(log=>log.date===session.date);if(syncInfo.authorized)Promise.all([writeRealtimeLog(profileId,savedLog),writeRealtimeWorkout(profileId,session)]).catch(remoteError);flash(`บันทึก Workout แล้ว${syncInfo.authorized?" · syncing":" · ในเครื่อง"}`);return true};
  const updatePreferences=preferences=>{commit({...storeRef.current,preferences});if(syncInfo.authorized)writeRealtimePreferences(preferences).catch(remoteError)};
  const applyCalories=decision=>{if(previewDemo){flash("ออกจาก Demo preview ก่อนปรับเป้าหมาย");return false}const previous=storeRef.current.plans?.[profileId]||{calorieTarget:baseProfile.calorieTarget,history:[]},last=previous.history?.at(-1);if(last&&differenceInCalendarDays(parseISO(clock.date),parseISO(last.date))<7){flash("ปรับ Calories ได้ไม่เกินหนึ่งครั้งต่อ 7 วัน");return false}const target=profile.calorieTarget+decision.delta;if(!window.confirm(`ยืนยันเปลี่ยนเป้าหมาย Calories จาก ${profile.calorieTarget.toLocaleString()} เป็น ${target.toLocaleString()} kcal/วัน?`))return false;const plan={...previous,calorieTarget:target,history:[...(previous.history||[]),{from:profile.calorieTarget,to:target,date:clock.date,reason:decision.action,createdAt:new Date().toISOString()}]};commit({...storeRef.current,plans:{...storeRef.current.plans,[profileId]:plan}});if(syncInfo.authorized)writeRealtimePlan(profileId,plan).catch(remoteError);flash(`ปรับเป้าหมายเป็น ${target.toLocaleString()} kcal แล้ว`);return true};
  const importFile=async(file,kind)=>{try{const text=await file.text();let next;if(kind==="csv"){const rows=importCsv(text);next=rows.reduce((state,row)=>upsertProfileLog(state,row.profileId,row),storeRef.current);flash(`นำเข้า CSV ${rows.length} รายการแล้ว`)}else{const parsed=JSON.parse(text),imported=parsed.logs||parsed;if(!Array.isArray(imported.zackdark)||!Array.isArray(imported.tony))throw new Error("JSON backup ไม่มี logs ของทั้งสอง profile");next={...storeRef.current,...(parsed.logs?parsed:{}),logs:{zackdark:imported.zackdark,tony:imported.tony},preferences:{...storeRef.current.preferences,...(parsed.preferences||{}),reminderTimes:{...storeRef.current.preferences.reminderTimes,...(parsed.preferences?.reminderTimes||{})}},plans:{...storeRef.current.plans,...(parsed.plans||{})},workouts:{...storeRef.current.workouts,...(parsed.workouts||{})},healthWorkouts:{...storeRef.current.healthWorkouts,...(parsed.healthWorkouts||{})},integrations:{...storeRef.current.integrations,...(parsed.integrations||{})}};flash("นำเข้า JSON backup แล้ว")}commit(next);if(syncInfo.authorized)replaceRealtimeStore(next).catch(remoteError)}catch(error){flash(`นำเข้าไม่สำเร็จ: ${error.message}`)}};
  const confirmReset=()=>{const next=commit(initialStore());if(syncInfo.authorized)replaceRealtimeStore(next).catch(remoteError);setPreviewDemo(false);setResetOpen(false);flash("รีเซ็ตกลับเป็นข้อมูลเริ่มต้นจริงแล้ว")};
  const togglePreview=()=>{setPreviewDemo(value=>!value);setPage("dashboard")};
  if(sessionStatus!=="ready")return <SessionGate status={sessionStatus} user={authUser} onSignIn={signInFirebase} onSignOut={signOutFirebase}/>;
  let content=page==="dashboard"?<Dashboard profile={profile} logs={logs} allLogs={allLogs} workouts={workouts} healthWorkouts={healthWorkouts} setPage={setPage} clock={clock} onApplyCalories={applyCalories} preferences={store.preferences} integration={integration}/>:page==="log"?<LogPage key={profileId} profile={profile} logs={logs} onSave={saveLog} undoRevision={undoRevision} clock={clock}/>:page==="progress"?<ProgressPage key={profileId} profile={profile} logs={logs} workouts={workouts} healthWorkouts={healthWorkouts} clock={clock} onApplyCalories={applyCalories}/>:page==="workout"?<WorkoutPage key={profileId} profile={profile} workouts={workouts} healthWorkouts={healthWorkouts} onSave={saveWorkout} onQuickSave={saveQuickActivity} clock={clock} preferences={store.preferences} onPreferences={updatePreferences}/>:page==="compare"?<ComparePage allLogs={allLogs} allWorkouts={activeStore.workouts} clock={clock}/>:<ProfilePage profile={profile} store={store} setPage={setPage} onReset={()=>setResetOpen(true)} onPreview={togglePreview} previewDemo={previewDemo} onImport={importFile} onSettings={()=>setSettingsOpen(true)}/>;
  return <div className="recomp-app">
    <Sidebar page={page} setPage={setPage} dark={dark} setDark={setDark} clock={clock} previewDemo={previewDemo}/>
    <div className="app-column"><Topbar profileId={profileId} setProfileId={setProfileId} profile={profile} dark={dark} setDark={setDark} clock={clock} onNotifications={()=>setSettingsOpen(true)} syncOnline={syncInfo.status==="live"}/>{previewDemo&&<div className="preview-banner"><Sparkles size={16}/><span>Demo preview · ข้อมูลชุดนี้แยกจากข้อมูลจริงและจะไม่ถูกบันทึก</span><button onClick={togglePreview}>Exit preview</button></div>}<main><div className="page-enter" key={`${page}-${profileId}`}>{content}</div></main></div>
    <MobileNav page={page} setPage={setPage}/>{toast&&<div className="toast" role="status"><span>{toast}</span>{undoState&&<button type="button" onClick={undoLastSave}>เลิกทำ</button>}</div>}
    <SettingsModal open={settingsOpen} onClose={()=>setSettingsOpen(false)} preferences={store.preferences} onPreferences={updatePreferences} syncInfo={syncInfo} integration={integration} onSignIn={signInFirebase} onSignOut={signOutFirebase} onCreatePairing={createAppleHealthPairing} onRevokePairing={revokeAppleHealthPairing}/>
    <Modal open={resetOpen} title="Reset all real data?" onClose={()=>setResetOpen(false)} footer={<><button className="secondary-btn" onClick={()=>setResetOpen(false)}>Cancel</button><button className="danger-btn" onClick={confirmReset}>Reset data</button></>}><p className="modal-copy">รายการบันทึกและ Workout จะกลับไปเหลือเฉพาะข้อมูลเริ่มต้นวันที่ 30 สิงหาคม 2026 หากเชื่อม Firebase อยู่ การรีเซ็ตจะมีผลกับอุปกรณ์ของสมาชิกทั้งสองคน กรุณา Export backup ก่อนหากต้องการเก็บข้อมูลไว้</p></Modal>
  </div>;
}
