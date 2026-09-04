import { useEffect, useMemo, useRef, useState } from "react";
import { addMonths, differenceInCalendarDays, eachDayOfInterval, endOfMonth, format, getDay, parseISO, startOfMonth } from "date-fns";
import {
  Area, AreaChart, CartesianGrid, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Activity, ArrowDown, ArrowRight, Award, BarChart3, BedDouble, Bell, CalendarDays,
  Check, ChevronDown, ChevronLeft, ChevronRight, CircleUserRound, Copy, Download,
  Droplets, Dumbbell, Footprints, Gauge, Home, Info, Moon, Plus, RefreshCcw,
  Save, Scale, Search, Sparkles, Sun, Target, TrendingDown, Trophy, Upload, Utensils, Users, Watch, Wifi, X, Zap,
} from "lucide-react";
import { z } from "zod";
import { FOOD_CATEGORIES, FOOD_PRESETS, FOOD_SOURCES, makeDemoLogs, MEAL_TYPES, MILESTONES, PHASES, PROFILES, WORKOUTS } from "./data.js";
import {
  adherenceSummary, bangkokGreeting, bangkokToday, challengeClock, coachingFrom, dailyScore as calculateDailyScore, filterLogs,
  numeric, percent, rollingWeight, weeklyReview, weightStats,
} from "./lib/metrics.js";
import {
  cleanLogInput, downloadFile, exportCsv, importCsv, initialStore, loadStore, saveStore, upsertProfileLog,
} from "./lib/store.js";
import {
  connectRealtime, createAppleHealthPairing, firebaseConfigured, observeFirebaseAuth, replaceRealtimeStore,
  revokeAppleHealthPairing, signInFirebase, signOutFirebase, writeRealtimeLog,
  writeRealtimePlan, writeRealtimePreferences, writeRealtimeWorkout,
} from "./lib/firebase.js";
import { notificationSupport, requestReminderPermission, startReminderScheduler } from "./lib/reminders.js";
import "./health.css";

const nav = [
  ["dashboard","Overview",Home], ["log","Quick log",Plus], ["progress","Progress",BarChart3],
  ["workout","Workout",Dumbbell], ["profile","Profile",CircleUserRound],
];

const number = numeric;
const pct = percent;
const fmt1 = (value) => numeric(value).toFixed(1);
const rolling = rollingWeight;
const statsFor = (logs, profile, anchorDate = bangkokToday()) => weightStats(logs, profile, anchorDate);
const dailyScore = calculateDailyScore;
const coaching = coachingFrom;

function IconButton({ children, label, onClick, className="", ...props }) {
  return <button className={`icon-btn ${className}`} aria-label={label} onClick={onClick} {...props}>{children}</button>;
}

function Brand() {
  return <div className="brand"><div className="brand-mark"><TrendingDown size={18}/></div><div><strong>recomp</strong><span>16 week protocol</span></div></div>;
}

function SessionGate({ status, user, onSignIn, onSignOut }) {
  const [message,setMessage]=useState("");
  const checking=status==="checking",signedOut=status==="signed-out",denied=status==="denied";
  const signIn=async()=>{setMessage("");try{await onSignIn()}catch(error){setMessage(error.code==="auth/popup-closed-by-user"?"ปิดหน้าต่างก่อนเข้าสู่ระบบสำเร็จ":error.message)}};
  return <div className="recomp-app session-gate"><section className="session-card"><Brand/><div className={`session-orb ${checking?"loading":""}`}>{checking?<i/>:<Wifi size={24}/>}</div><span>SECURE SESSION</span><h1>{checking?"กำลังยืนยันโปรไฟล์…":signedOut?"เข้าสู่ระบบเพื่อดูข้อมูลของคุณ":denied?"บัญชีนี้ยังไม่มีสิทธิ์":"เชื่อมต่อข้อมูลไม่สำเร็จ"}</h1><p>{checking?"เราจะยังไม่แสดงข้อมูลสุขภาพจนกว่าจะยืนยันบัญชีและโปรไฟล์เรียบร้อย":signedOut?"ข้อมูลจริงจะเปิดหลัง Firebase ยืนยันบัญชีสมาชิกเท่านั้น":denied?"บัญชีนี้ไม่ได้อยู่ใน Recomp challenge กรุณาใช้บัญชีสมาชิก":"ข้อมูลยังถูกซ่อนไว้เพื่อป้องกันการแสดงโปรไฟล์ผิดคน"}</p>{message&&<em>{message}</em>}<div className="session-actions">{signedOut&&<button className="primary-btn" onClick={signIn}>Continue with Google</button>}{(denied||status==="error")&&<><button className="primary-btn" onClick={()=>location.reload()}><RefreshCcw size={15}/> Try again</button>{user&&<button className="secondary-btn" onClick={onSignOut}>Sign out</button>}</>}</div></section></div>;
}

function Sidebar({ page, setPage, dark, setDark, clock, previewDemo }) {
  return <aside className="sidebar">
    <Brand/>
    <nav>{nav.map(([id,label,Icon]) => <button key={id} className={page===id?"active":""} onClick={()=>setPage(id)}><Icon size={19}/><span>{label}</span>{id==="log"&&<kbd>N</kbd>}</button>)}</nav>
    <div className="side-challenge">
      <div className="mini-icon"><Sparkles size={17}/></div><strong>Shared challenge</strong>
      <p>{previewDemo?"Demo preview is isolated from your real logs.":`Week ${clock.week} of 16 · Build the next consistent day together.`}</p>
      <button onClick={()=>setPage("compare")}>View comparison <ArrowRight size={14}/></button>
    </div>
    <button className="theme-row" onClick={()=>setDark(!dark)}>{dark?<Sun size={18}/>:<Moon size={18}/>} {dark?"Light mode":"Dark mode"}</button>
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
        <button onClick={()=>setOpen(!open)}><Avatar profile={profile}/><span><small>Viewing as</small><b>{profile.name}</b></span><ChevronDown size={16}/></button>
        {open&&<div className="profile-menu">{Object.values(PROFILES).map(p=><button key={p.id} onClick={()=>{setProfileId(p.id);setOpen(false)}}><Avatar profile={p}/><span>{p.name}<small>{p.id===profileId?"Active profile":"Switch profile"}</small></span>{p.id===profileId&&<Check size={16}/>}</button>)}</div>}
      </div>
    </div>
  </header>;
}

function Avatar({ profile, large=false }) { return <div className={`avatar ${large?"large":""}`} style={{"--avatar":profile.color}}>{profile.initials}</div>; }

function MobileNav({ page,setPage }) {
  return <nav className="mobile-nav">{nav.map(([id,label,Icon])=><button key={id} className={page===id?"active":""} onClick={()=>setPage(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>;
}

function PageTitle({ eyebrow, title, note, action }) {
  return <div className="page-title"><div><p>{eyebrow}</p><h1>{title}</h1>{note&&<span>{note}</span>}</div>{action}</div>;
}

function ProgressBar({ value, color="green" }) { return <div className="progress-track"><i className={color} style={{width:`${Math.min(100,value)}%`}}/></div>; }

function Ring({ value, children, color="#1f9d6a" }) {
  return <div className="ring" style={{"--ring":`${Math.min(100,value)*3.6}deg`,"--ring-color":color}}><div>{children}</div></div>;
}

function useAnimatedNumber(value, decimals=0) {
  const [display,setDisplay]=useState(value==null?null:(0).toFixed(decimals));
  useEffect(()=>{
    if(value==null){setDisplay(null);return}
    if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){setDisplay(Number(value).toFixed(decimals));return}
    let frame,start;
    const tick=now=>{start??=now;const progress=Math.min(1,(now-start)/900),eased=1-Math.pow(1-progress,3);setDisplay((Number(value)*eased).toFixed(decimals));if(progress<1)frame=requestAnimationFrame(tick)};
    frame=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(frame);
  },[value,decimals]);
  return display;
}

function PerformanceDial({ label, value, metricValue=value, decimals=0, note, color, scale="%" }) {
  const progress=value==null?0:Math.min(100,Math.max(0,value));
  const display=useAnimatedNumber(value==null?null:metricValue,decimals);
  return <div className={`performance-dial ${value==null?"empty":""}`} style={{"--score":`${progress*3.6}deg`,"--score-color":color}}>
    <div className="performance-ring"><div><b>{display??"—"}</b>{value!=null&&<small>{scale}</small>}</div></div>
    <div className="performance-copy"><span>{label}</span><b>{note}</b></div>
  </div>;
}

function WeightChart({ logs, compact=false }) {
  const data=rolling(logs);
  if(data.length<2)return <div className={`empty-chart ${compact?"compact":""}`}><Scale size={24}/><b>Starting point saved</b><span>กราฟแนวโน้มจะเริ่มแสดงเมื่อมีน้ำหนักอย่างน้อย 2 วัน</span></div>;
  return <ResponsiveContainer width="100%" height={compact?210:320}>
    <AreaChart data={data} margin={{top:10,right:8,bottom:0,left:compact?-24:-10}}>
      <defs><linearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#36ad7a" stopOpacity=".24"/><stop offset="1" stopColor="#36ad7a" stopOpacity="0"/></linearGradient></defs>
      <CartesianGrid strokeDasharray="3 7" vertical={false} stroke="var(--line)"/>
      <XAxis dataKey="label" tick={{fontSize:11,fill:"var(--muted)"}} axisLine={false} tickLine={false} interval={compact?3:1}/>
      <YAxis domain={["dataMin - 1","dataMax + 1"]} tick={{fontSize:11,fill:"var(--muted)"}} axisLine={false} tickLine={false}/>
      <Tooltip contentStyle={{borderRadius:14,border:"1px solid var(--line)",background:"var(--card)",fontSize:12}} formatter={(v,n)=>[`${v} kg`,n==="weight"?"Daily":"7-day avg"]}/>
      <Area type="monotone" dataKey="weight" stroke="#9ba5a0" strokeWidth={1.5} fill="url(#weightFill)" dot={{r:2,fill:"#9ba5a0"}}/>
      <Line type="monotone" dataKey="avg7" stroke="#159963" strokeWidth={3} dot={false}/>
    </AreaChart>
  </ResponsiveContainer>;
}

function Dashboard({ profile, logs, allLogs, workouts, healthWorkouts, setPage, clock, onApplyCalories, preferences }) {
  const s=weightStats(logs,profile,clock.date), coach=coaching(s), today=logs.find(log=>log.date===clock.date)||{};
  const review=weeklyReview(logs,profile,clock.date,workouts,healthWorkouts);
  const hasHistory=s.sampleCount>1, workoutToday=workouts.some(workout=>workout.date===clock.date);
  const hasReadiness=today.sleep!=null||today.energy!=null;
  const readiness=hasReadiness?Math.round((today.sleep!=null?pct(today.sleep,480):0)*.7+(today.energy!=null?pct(today.energy,5):0)*.3):null;
  const hasLoad=today.steps!=null||today.zone2Minutes!=null||today.workout||workoutToday;
  const load=hasLoad?Math.min(21,(pct(today.steps,profile.stepsTarget)/100)*12+(today.workout||workoutToday?5:0)+(pct(today.zone2Minutes,30)/100)*4):null;
  const sleepScore=today.sleep==null?null:Math.round(pct(today.sleep,480));
  const targets=[
    {icon:Utensils,label:"Calories",value:number(today.calories),target:profile.calorieTarget,unit:"kcal",color:"#5c7cdb"},
    {icon:Zap,label:"Protein",value:number(today.protein),target:profile.proteinMin,unit:"g",color:"#bd7a2d"},
    {icon:Droplets,label:"Water",value:number(today.water),target:profile.waterTarget,unit:"L",color:"#2e9eb8"},
    {icon:Footprints,label:"Steps",value:number(today.steps),target:profile.stepsTarget,unit:"",color:"#1f9d6a"},
    {icon:BedDouble,label:"Sleep",value:number(today.sleep),target:480,display:today.sleep?`${Math.floor(today.sleep/60)}h ${today.sleep%60}m`:"Not logged",targetDisplay:"8h",unit:"",color:"#8d67bb"},
    {icon:Dumbbell,label:"Workout",value:today.workout||workoutToday||today.restDay?1:0,target:1,display:today.workout||workoutToday?"Completed ✓":today.restDay?"Rest day ✓":"Not logged",targetDisplay:"Today",unit:"",color:"#d06558"},
  ];
  return <>
    <PageTitle eyebrow={bangkokGreeting()} title={`Ready when you are, ${profile.name}.`} note={`${clock.daysRemaining} days left · Phase ${clock.phase} — ${PHASES[clock.phase-1].title}`} action={<button className="primary-btn" onClick={()=>setPage("log")} aria-label="เปิด Quick Log"><Plus size={17}/> Quick log</button>}/>
    <section className="performance-snapshot card" aria-label="Today's performance snapshot">
      <div className="snapshot-head"><div><span>TODAY'S PERFORMANCE</span><h2>Your body at a glance</h2></div><button onClick={()=>setPage("log")}><Plus size={15}/> Add data</button></div>
      <div className="performance-dials">
        <PerformanceDial label="Readiness" value={readiness} note={hasReadiness?"Sleep + energy":"Log sleep & energy"} color={readiness==null?"#46504b":readiness>=67?"#16e58f":readiness>=34?"#ffd23f":"#ff5b52"}/>
        <PerformanceDial label="Day load" value={load==null?null:(load/21)*100} metricValue={load} decimals={1} note={hasLoad?"Steps + training":"No activity yet"} color="#21a9ff" scale="/21"/>
        <PerformanceDial label="Sleep" value={sleepScore} note={today.sleep!=null?`${Math.floor(today.sleep/60)}h ${today.sleep%60}m logged`:"Log last night"} color="#9d72ff"/>
      </div>
      <p className="snapshot-footnote"><Info size={13}/> Readiness และ Day Load เป็นคะแนนช่วยตัดสินใจจากข้อมูลที่บันทึกใน Recomp ไม่ใช่ค่าทางการแพทย์</p>
    </section>
    <section className="dashboard-grid">
      <div className="weight-hero card">
        <div className="card-head"><span><Scale size={17}/> WEIGHT PROGRESS</span><button onClick={()=>setPage("progress")}>View details <ArrowRight size={14}/></button></div>
        <div className="hero-main"><div><p>Current weight</p><h2>{fmt1(s.latest.weight)}<small> kg</small></h2><div className={`status ${coach.tone}`}><i/> {coach.label}</div></div><Ring value={s.progress}><b>{Math.round(s.progress)}%</b><small>to goal</small></Ring></div>
        <ProgressBar value={s.progress}/>
        <div className="weight-summary"><div><span>Starting</span><b>{profile.startWeight} kg</b></div><div><span>Total change</span><b className={s.lost>=0?"green-text":"danger-text"}>{s.lost>0&&<ArrowDown size={13}/>} {s.lost<0?"+":""}{fmt1(Math.abs(s.lost))} kg</b></div><div><span>Goal range</span><b>{profile.goalMin}–{profile.goalMax} kg</b></div></div>
      </div>
      <div className="consistency-card card"><div className="card-head"><span><Gauge size={17}/> CONSISTENCY</span><span>This week</span></div><div className="score-row"><Ring value={s.consistency} color="#1f9d6a"><b>{s.consistency}</b><small>/ 100</small></Ring><div><h3>{hasHistory?"Building momentum":"Ready to begin"}</h3><p>{hasHistory?"เก็บข้อมูลต่อเนื่องเพื่อดูแนวโน้ม":"เริ่มบันทึกเป้าหมายประจำวัน"}<br/>{hasHistory?`${logs.length} days logged`:"Starting point saved"}</p></div></div><div className="micro-bars">{[["Protein",pct(today.protein,profile.proteinMin)],["Steps",pct(today.steps,profile.stepsTarget)],["Sleep",pct(today.sleep,480)]].map(x=><div key={x[0]}><span>{x[0]}</span><ProgressBar value={x[1]}/><b>{Math.round(x[1])}%</b></div>)}</div></div>
    </section>

    <div className="section-heading"><div><p>TODAY · {format(parseISO(clock.date),"d MMM").toUpperCase()}</p><h2>Today's targets</h2></div><span>{targets.filter(item=>pct(item.value,item.target)>=80).length} of 6 looking good</span></div>
    <section className="target-grid">{targets.map(({icon:Icon,...x})=><div className="target-card card" style={{"--target-color":x.color}} key={x.label}><div className="target-icon" style={{color:x.color,background:`${x.color}18`}}><Icon size={19}/></div><div><span>{x.label}</span><b>{x.display||x.value.toLocaleString()} <small>/ {x.targetDisplay||x.target.toLocaleString()} {x.unit}</small></b><ProgressBar value={pct(x.value,x.target)} color="custom"/></div><strong>{Math.round(pct(x.value,x.target))}%</strong></div>)}</section>
    <section className="lower-grid">
      <div className="trend-card card"><div className="card-head"><div><span>WEIGHT TREND</span><h3>{hasHistory?"Building your trend":"Starting point recorded"}</h3></div><div className="chart-legend"><i/> Daily <i className="avg"/> 7-day avg</div></div><WeightChart logs={logs} compact/><div className="trend-stats"><div><span>{s.hasFullAverage?"7-day average":"Available average"}</span><b>{fmt1(s.avg7)} kg</b></div><div><span>Previous week</span><b>{s.previousAvg!=null?`${fmt1(s.previousAvg)} kg`:"—"}</b></div><div><span>Weekly change</span><b className="green-text">{s.weeklyLoss!=null?`${s.weeklyLoss>=0?"−":"+"}${fmt1(Math.abs(s.weeklyLoss))} kg`:"—"}</b></div></div></div>
      <div className="stack-column">
        <div className="insight-card card"><div className="insight-icon"><Sparkles size={18}/></div><div><span>COACHING INSIGHT</span><h3>{coach.label}</h3><p>{coach.text}</p><button onClick={()=>setPage("progress")}>ดูข้อมูลประกอบ <ArrowRight size={14}/></button></div></div>
        <WorkoutMini setPage={setPage} clock={clock} workouts={workouts} preferences={preferences}/>
      </div>
    </section>
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
const logSchema=z.object({weight:optionalNumber(30,300),calories:optionalNumber(0,10000),protein:optionalNumber(0,1000),fiber:optionalNumber(0,200),produceServings:optionalNumber(0,30),water:optionalNumber(0,20),steps:optionalNumber(0,200000),zone2Minutes:optionalNumber(0,1440),sleepHours:optionalNumber(0,24),sleepMinutes:optionalNumber(0,59)});

function LogPage({profile,logs,onSave,clock}) {
  const measured=field=>logs.filter(log=>log[field]!=null).at(-1)?.[field];
  const lastWeight=measured("weight")??profile.startWeight;
  const mealFields=["calories","protein","carbs","fat","fiber","produceServings"];
  const blankMeals=()=>Object.fromEntries(MEAL_TYPES.map(([key])=>[key,{calories:"",protein:"",carbs:"",fat:"",fiber:"",produceServings:"",items:[]}]))
  const makeForm=(date)=>{const existing=logs.find(log=>log.date===date)||{},meals=blankMeals();Object.entries(existing.meals||{}).forEach(([key,value])=>{meals[key]={...meals[key],...Object.fromEntries(mealFields.map(field=>[field,value[field]??""])),items:value.items||[]}});return {date,weight:existing.weight??"",calories:existing.calories??"",protein:existing.protein??"",carbs:existing.carbs??"",fat:existing.fat??"",fiber:existing.fiber??"",produceServings:existing.produceServings??"",water:existing.water??"",steps:existing.steps??"",zone2Minutes:existing.zone2Minutes??"",sleepHours:existing.sleep!=null?Math.floor(existing.sleep/60):"",sleepMinutes:existing.sleep!=null?existing.sleep%60:"",waist:existing.waist??"",bodyFat:existing.bodyFat??"",muscle:existing.muscle??"",visceral:existing.visceral??"",mood:existing.mood??"",hunger:existing.hunger??"",energy:existing.energy??"",notes:existing.notes??"",meals,workout:Boolean(existing.workout),restDay:Boolean(existing.restDay),sickDay:Boolean(existing.sickDay),vacationMode:Boolean(existing.vacationMode)}};
  const [form,setForm]=useState(()=>makeForm(clock.date)),[saved,setSaved]=useState(false),[error,setError]=useState(""),[activeMeal,setActiveMeal]=useState("breakfast");
  const set=(key,val)=>setForm(current=>({...current,[key]:val}));
  const totalsFromMeals=meals=>Object.fromEntries(mealFields.map(field=>{const total=Object.values(meals).reduce((sum,meal)=>sum+(Number(meal[field])||0),0);return [field,total?field==="calories"?Math.round(total):+total.toFixed(1):""]}));
  const updateMeal=(key,next)=>setForm(current=>{const meals={...current.meals,[key]:next};return {...current,meals,...totalsFromMeals(meals)}});
  const addPreset=preset=>{const meal=form.meals[activeMeal],entry={...preset,entryId:`${preset.id}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`};updateMeal(activeMeal,{...meal,...Object.fromEntries(mealFields.map(field=>[field,+((Number(meal[field])||0)+(Number(preset[field])||0)).toFixed(field==="calories"?0:1)])),items:[...(meal.items||[]),entry]})};
  const copyPrevious=()=>{const previous=[...logs].filter(log=>log.date<form.date&&log.meals).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);if(!previous)return;const meals=blankMeals();Object.entries(previous.meals).forEach(([key,value])=>{meals[key]={...meals[key],...value,items:[...(value.items||[])]}});setForm(current=>({...current,meals,...totalsFromMeals(meals)}))};
  const jump=(id)=>document.getElementById(id)?.scrollIntoView({behavior:"smooth",block:"start"});
  const changeDate=(date)=>setForm(makeForm(date));
  const submit=(event)=>{event.preventDefault();const checked=logSchema.safeParse(form);if(!checked.success){setError("ตรวจตัวเลขอีกครั้ง มีค่าที่อยู่นอกช่วงที่รองรับ");return}const didSave=onSave(cleanLogInput(form));setError("");if(didSave!==false){setSaved(true);setTimeout(()=>setSaved(false),2200)}};
  const summary=[
    ["Weight",form.weight!==""?`${form.weight} kg`:"Not added"],
    ["Nutrition",form.calories!==""?`${form.calories} kcal`:"Not added"],
    ["Activity",form.steps!==""?`${Number(form.steps).toLocaleString()} steps`:"Not added"],
    ["Recovery",form.sleepHours!==""||form.sleepMinutes!==""?`${form.sleepHours||0}h ${form.sleepMinutes||0}m`:"Not added"],
  ];
  return <>
    <PageTitle eyebrow="DAILY CHECK-IN" title="Quick log" note="กรอกเฉพาะสิ่งที่มีจริง · ช่องว่างจะไม่ถูกบันทึก" action={<div className="save-state">{saved&&<><Check size={16}/> Saved locally</>}</div>}/>
    <div className="quick-actions">{[[Scale,"Weight","weight-section"],[Utensils,"Meal","nutrition-section"],[Droplets,"Water","activity-section"],[Dumbbell,"Workout","activity-section"],[Footprints,"Steps","activity-section"]].map(([Icon,label,id])=><button type="button" key={label} onClick={()=>{if(label==="Workout")set("workout",!form.workout);jump(id)}}><Icon size={16}/>{label}{label==="Workout"&&form.workout&&<Check size={14}/>}</button>)}</div>
    <form id="daily-log-form" className="log-layout" onSubmit={submit}>
      <div className="log-main">
        <div id="weight-section" className="log-card card featured-input"><div className="log-card-title"><div className="field-icon green"><Scale size={19}/></div><div><span>WEIGHT</span><h3>Morning weigh-in</h3></div><label className="date-chip"><input type="date" value={form.date} min="2026-08-30" max={clock.date} onChange={e=>changeDate(e.target.value)} aria-label="วันที่บันทึก"/></label></div><div className="big-input"><button type="button" aria-label="ลดน้ำหนัก 0.1 กิโลกรัม" onClick={()=>set("weight",+((form.weight===""?lastWeight:number(form.weight))-.1).toFixed(1))}>−</button><label><input aria-label="น้ำหนัก" type="number" inputMode="decimal" min="30" max="300" step="0.1" value={form.weight} placeholder={String(lastWeight)} onChange={e=>set("weight",e.target.value)}/><span>kg</span></label><button type="button" aria-label="เพิ่มน้ำหนัก 0.1 กิโลกรัม" onClick={()=>set("weight",+((form.weight===""?lastWeight:number(form.weight))+.1).toFixed(1))}>+</button></div><div className="yesterday"><span>Last measured <b>{lastWeight} kg</b> <small>(placeholder only)</small></span><span>{form.date===clock.date?"Today":format(parseISO(form.date),"d MMM yyyy")}</span></div></div>
        <div id="nutrition-section"><LogSection icon={Utensils} title="Nutrition" note={`เหลือ ${Math.max(0,profile.calorieTarget-number(form.calories)).toLocaleString()} kcal · Protein อีก ${Math.max(0,profile.proteinMin-number(form.protein))} g`}>
          <MealLogger meals={form.meals} activeMeal={activeMeal} setActiveMeal={setActiveMeal} onChange={updateMeal} onPreset={addPreset} onCopyPrevious={copyPrevious}/>
          <Field label="Calories รวม" unit="kcal" value={form.calories} onChange={v=>set("calories",v)} placeholder={`เป้าหมาย ${profile.calorieTarget}`}/><Field label="Protein รวม" unit="g" value={form.protein} onChange={v=>set("protein",v)} placeholder={`เป้าหมาย ${profile.proteinMin}`}/><Field label="Carbs" unit="g" value={form.carbs} onChange={v=>set("carbs",v)} placeholder="ไม่บังคับ"/><Field label="Fat" unit="g" value={form.fat} onChange={v=>set("fat",v)} placeholder="ไม่บังคับ"/><Field label="Fiber" unit="g" value={form.fiber} onChange={v=>set("fiber",v)} placeholder="ไม่บังคับ"/><Field label="ผักและผลไม้" unit="servings" value={form.produceServings} onChange={v=>set("produceServings",v)} placeholder="ไม่บังคับ"/>
        </LogSection></div>
        <div id="activity-section"><LogSection icon={Activity} title="Daily activity" note="Movement, hydration & recovery">
          <Field label="Water" unit="L" value={form.water} onChange={v=>set("water",v)} step="0.1" placeholder={`เป้าหมาย ${profile.waterTarget}`}/><Field label="Steps" unit="steps" value={form.steps} onChange={v=>set("steps",v)} placeholder={`เป้าหมาย ${profile.stepsTarget}`}/><Field label="Zone 2" unit="min" value={form.zone2Minutes} onChange={v=>set("zone2Minutes",v)} placeholder="นาทีที่ทำจริง"/><Field label="Sleep hours" unit="hr" value={form.sleepHours} onChange={v=>set("sleepHours",v)} placeholder="เช่น 7"/><Field label="Minutes" unit="min" value={form.sleepMinutes} onChange={v=>set("sleepMinutes",v)} placeholder="เช่น 30"/>
          <div className="activity-toggles"><Toggle active={form.workout} onClick={()=>{set("workout",!form.workout);if(!form.workout)set("restDay",false)}} icon={Dumbbell}>Workout done</Toggle><Toggle active={form.restDay} onClick={()=>{set("restDay",!form.restDay);if(!form.restDay)set("workout",false)}} icon={BedDouble}>Rest day</Toggle><Toggle active={form.sickDay} onClick={()=>set("sickDay",!form.sickDay)} icon={Activity}>Sick day</Toggle><Toggle active={form.vacationMode} onClick={()=>set("vacationMode",!form.vacationMode)} icon={Sun}>Vacation</Toggle></div>
        </LogSection></div>
        <LogSection icon={Gauge} title="Body composition" note="Optional · กรอกเฉพาะวันที่วัดจริง">
          <Field label="Waist" unit="cm" value={form.waist} onChange={v=>set("waist",v)} step="0.1" placeholder={measured("waist")?`ล่าสุด ${measured("waist")}`:"ไม่บังคับ"}/><Field label="Body fat" unit="%" value={form.bodyFat} onChange={v=>set("bodyFat",v)} step="0.1" placeholder={measured("bodyFat")?`ล่าสุด ${measured("bodyFat")}`:"ไม่บังคับ"}/><Field label="Muscle" unit="kg" value={form.muscle} onChange={v=>set("muscle",v)} step="0.01" placeholder={measured("muscle")?`ล่าสุด ${measured("muscle")}`:"ไม่บังคับ"}/><Field label="Visceral fat" unit="" value={form.visceral} onChange={v=>set("visceral",v)} placeholder={measured("visceral")?`ล่าสุด ${measured("visceral")}`:"ไม่บังคับ"}/>
        </LogSection>
        <div className="log-card card"><div className="log-card-title"><div className="field-icon lilac"><Sparkles size={19}/></div><div><span>HOW YOU FEEL</span><h3>Check in with yourself</h3></div></div><div className="feel-row"><Score label="Hunger" value={form.hunger} onChange={v=>set("hunger",v)}/><Score label="Energy" value={form.energy} onChange={v=>set("energy",v)}/></div><div className="mood-row"><span>Mood</span>{[["good","Good"],["calm","Calm"],["tired","Tired"],["stressed","Stressed"]].map(([value,label])=><button type="button" className={form.mood===value?"active":""} onClick={()=>set("mood",form.mood===value?"":value)} key={value}>{label}</button>)}</div><label className="notes"><span>Notes <small>Optional</small></span><textarea value={form.notes} onChange={e=>set("notes",e.target.value)} placeholder="Training felt strong, dinner out, rest day…"/></label></div>
      </div>
      <aside className="log-side"><div className="card log-summary"><span>LOG · {format(parseISO(form.date),"d MMM")}</span><h3>{logs.some(log=>log.date===form.date)?"Update entry":"New entry"}</h3><div>{summary.map(([label,value])=><p key={label}><i className={value==="Not added"?"empty":""}>{value!=="Not added"&&<Check size={12}/>}</i><span>{label}<small>{value}</small></span></p>)}</div>{error&&<p className="form-error">{error}</p>}<button className="primary-btn full" type="submit">Save daily log <Save size={17}/></button><small>บันทึกในเครื่องทันที และ Sync เมื่อเชื่อมบัญชี</small></div></aside>
    </form>
    <div className="mobile-save"><div><b>{format(parseISO(form.date),"d MMM")}</b><span>{saved?"Saved":"Unsaved changes"}</span></div><button type="submit" form="daily-log-form" className="primary-btn">Save <Save size={17}/></button></div>
  </>;
}

function LogSection({icon:Icon,title,note,children}) { return <div className="log-card card"><div className="log-card-title"><div className="field-icon blue"><Icon size={19}/></div><div><span>DAILY LOG</span><h3>{title}</h3><p>{note}</p></div></div><div className="field-grid">{children}</div></div>; }
function MealLogger({meals,activeMeal,setActiveMeal,onChange,onPreset,onCopyPrevious}) {
  const [category,setCategory]=useState("popular"),[query,setQuery]=useState("");
  const meal=meals[activeMeal],needle=query.trim().toLocaleLowerCase("th-TH");
  const visible=FOOD_PRESETS.filter(item=>(needle?`${item.name} ${item.serving}`.toLocaleLowerCase("th-TH").includes(needle):category==="all"||category==="popular"&&item.popular||item.category===category));
  const removeItem=(entry,index)=>{if(typeof entry==="string")return;const next={...meal,items:meal.items.filter((_,itemIndex)=>itemIndex!==index)};["calories","protein","carbs","fat","fiber","produceServings"].forEach(field=>{const value=Math.max(0,(Number(next[field])||0)-(Number(entry[field])||0));next[field]=value?+(value.toFixed(field==="calories"?0:1)):""});onChange(activeMeal,next)};
  return <div className="meal-logger">
    <div className="meal-toolbar"><div><b>แยกตามมื้อ</b><span>ยอดรวมสารอาหารคำนวณให้อัตโนมัติ</span></div><button type="button" onClick={onCopyPrevious}>คัดลอกจากวันก่อน</button></div>
    <div className="meal-tabs">{MEAL_TYPES.map(([key,label])=><button type="button" className={activeMeal===key?"active":""} onClick={()=>setActiveMeal(key)} key={key}>{label}</button>)}</div>
    <div className="meal-entry"><Field label="Calories" unit="kcal" value={meal.calories} onChange={value=>onChange(activeMeal,{...meal,calories:value})} placeholder="0"/><Field label="Protein" unit="g" value={meal.protein} onChange={value=>onChange(activeMeal,{...meal,protein:value})} placeholder="0"/><Field label="Carbs" unit="g" value={meal.carbs} onChange={value=>onChange(activeMeal,{...meal,carbs:value})} placeholder="0"/><Field label="Fat" unit="g" value={meal.fat} onChange={value=>onChange(activeMeal,{...meal,fat:value})} placeholder="0"/><Field label="Fiber" unit="g" value={meal.fiber} onChange={value=>onChange(activeMeal,{...meal,fiber:value})} placeholder="0"/></div>
    <div className="food-library-head"><div><b>Food library</b><span>{FOOD_PRESETS.length} รายการ · แตะเพื่อเพิ่ม 1 serving</span></div><label><Search size={15}/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="ค้นหาอาหาร…" aria-label="ค้นหาอาหาร"/>{query&&<button type="button" onClick={()=>setQuery("")} aria-label="ล้างคำค้น"><X size={14}/></button>}</label></div>
    <div className="food-categories">{FOOD_CATEGORIES.map(([key,label])=><button type="button" className={!needle&&category===key?"active":""} onClick={()=>{setCategory(key);setQuery("")}} key={key}>{label}</button>)}</div>
    <div className="food-presets">{visible.map(item=><button type="button" onClick={()=>onPreset(item)} key={item.id} title={FOOD_SOURCES[item.source].name}><Plus size={14}/><span>{item.approximate&&"≈ "}{item.name}</span><em>{item.serving}</em><small>{item.calories} kcal · P {item.protein} · C {item.carbs} · F {item.fat} · ใยอาหาร {item.fiber}g</small><i>{FOOD_SOURCES[item.source].short}</i></button>)}</div>
    {!visible.length&&<div className="food-empty">ไม่พบอาหาร ลองค้นหาด้วยชื่ออื่นหรือเลือกหมวดทั้งหมด</div>}
    {meal.items?.length>0&&<div className="meal-items"><b>เพิ่มในมื้อนี้</b>{meal.items.map((entry,index)=><span key={typeof entry==="string"?`${entry}-${index}`:entry.entryId}><span>{typeof entry==="string"?entry:`${entry.name} · ${entry.serving}`}</span>{typeof entry!=="string"&&<button type="button" onClick={()=>removeItem(entry,index)} aria-label={`ลบ ${entry.name}`}><X size={13}/></button>}</span>)}</div>}
    <p className="food-sources">ค่าถูกปัดเพื่อให้บันทึกง่าย อาหารปรุงสำเร็จที่มี ≈ เปลี่ยนตามสูตร น้ำมัน ซอส และขนาดจริง · แหล่งข้อมูล: {Object.values(FOOD_SOURCES).map((source,index)=><span key={source.short}>{index>0&&" · "}<a href={source.url} target="_blank" rel="noreferrer">{source.short}</a></span>)}</p>
  </div>;
}
function Field({label,unit,value,onChange,placeholder,step="1"}) { return <label className="field"><span>{label}</span><div><input type="number" inputMode="decimal" step={step} value={value} onChange={e=>onChange(e.target.value)} placeholder={String(placeholder||"")}/><em>{unit}</em></div></label>; }
function Toggle({active,onClick,icon:Icon,children}) { return <button type="button" className={`log-toggle ${active?"active":""}`} aria-pressed={active} onClick={onClick}><Icon size={16}/>{children}{active&&<Check size={14}/>}</button>; }
function Score({label,value,onChange}) { return <div className="score-field"><span>{label}<b>{value?`${value}/5`:"Not rated"}</b></span><div>{[1,2,3,4,5].map(n=><button type="button" className={value===n?"active":""} aria-pressed={value===n} key={n} onClick={()=>onChange(value===n?"":n)}>{n}</button>)}</div></div>; }

function ProgressPage({profile,logs,workouts,healthWorkouts,clock,onApplyCalories}) {
  const [range,setRange]=useState("30 days"), [metric,setMetric]=useState("weight"), [selected,setSelected]=useState(null);
  const visible=filterLogs(logs,range,clock.date), s=weightStats(logs,profile,clock.date), review=weeklyReview(logs,profile,clock.date,workouts,healthWorkouts);
  const waistLogs=logs.filter(log=>log.waist!=null), waistDelta=waistLogs.length>1?waistLogs[0].waist-waistLogs.at(-1).waist:null;
  const composition=visible.filter(log=>metric==="weight"?(log.waist!=null||log.bodyFat!=null):log.muscle!=null).map(log=>({...log,label:format(parseISO(log.date),"d MMM")}));
  return <><PageTitle eyebrow="YOUR DATA" title="Progress" note="ดูแนวโน้ม ไม่ตัดสินจากตัวเลขวันเดียว" action={<button className="secondary-btn" onClick={()=>downloadFile(`${profile.id}-progress.csv`,exportCsv({[profile.id]:logs}),"text/csv;charset=utf-8")}><Download size={16}/> Export CSV</button>}/>
    <div className="range-tabs">{["7 days","30 days","8 weeks","16 weeks"].map(x=><button className={range===x?"active":""} onClick={()=>setRange(x)} key={x}>{x}</button>)}</div>
    <section className="progress-kpis">{[["Current",`${fmt1(s.latest.weight)} kg`,format(parseISO(s.latest.date),"d MMM yyyy")],["7-day average",s.hasFullAverage?`${fmt1(s.avg7)} kg`:"—",s.weeklyLoss==null?"ต้องมีข้อมูลครบ 14 วัน":`${s.weeklyLoss>=0?"−":"+"}${fmt1(Math.abs(s.weeklyLoss))} kg this week`],["Total change",`${s.lost<0?"+":""}${fmt1(Math.abs(s.lost))} kg`,`${Math.round(s.progress)}% to goal`],["Waist change",waistDelta==null?"—":`${waistDelta>=0?"−":"+"}${fmt1(Math.abs(waistDelta))} cm`,waistDelta==null?"ต้องมีอย่างน้อย 2 ครั้ง":"จากค่าที่วัดจริง"]].map(([a,b,c])=><div className="card" key={a}><span>{a}</span><h3>{b}</h3><small>{c}</small></div>)}</section>
    <section className="card chart-panel"><div className="card-head"><div><span>ACTUAL TREND · {range.toUpperCase()}</span><h3>Weight trend</h3></div><div className="chart-legend"><i/> Daily <i className="avg"/> 7-day avg</div></div><WeightChart logs={visible}/><div className="chart-note"><Info size={15}/> ใช้ช่วง 7 วันตามปฏิทินและต้องมีอย่างน้อย 4 วันต่อสัปดาห์ วันที่ขาดจะไม่ถูกเลื่อนไปรวมจากสัปดาห์อื่น</div></section>
    <section className="progress-split"><div className="card metric-chart"><div className="card-head"><div><span>BODY COMPOSITION</span><h3>{metric==="weight"?"Waist & body fat":"Muscle mass"}</h3></div><select value={metric} onChange={e=>setMetric(e.target.value)} aria-label="เลือกตัวชี้วัด"><option value="weight">Waist / Body fat</option><option value="muscle">Muscle mass</option></select></div>{composition.length<2?<div className="empty-chart"><Gauge size={24}/><b>ยังไม่มีแนวโน้ม</b><span>ต้องมีการวัดจริงอย่างน้อย 2 ครั้งในช่วงที่เลือก</span></div>:<ResponsiveContainer width="100%" height={260}><LineChart data={composition}><CartesianGrid vertical={false} strokeDasharray="3 7" stroke="var(--line)"/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{fill:"var(--muted)",fontSize:11}}/><YAxis axisLine={false} tickLine={false} tick={{fill:"var(--muted)",fontSize:11}} domain={["dataMin - 1","dataMax + 1"]}/><Tooltip contentStyle={{background:"var(--card)",border:"1px solid var(--line)",borderRadius:12}}/>{metric==="weight"?<><Line connectNulls dataKey="waist" stroke="#5478d4" strokeWidth={2.5}/><Line connectNulls dataKey="bodyFat" stroke="#bd7a2d" strokeWidth={2.5}/></>:<Line connectNulls dataKey="muscle" stroke="#1f9d6a" strokeWidth={2.5}/>}</LineChart></ResponsiveContainer>}</div><MilestoneChart profile={profile}/></section>
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
  return <section className="calendar-card card"><div className="card-head"><div><span>DAILY CONSISTENCY</span><h3>{format(month,"MMMM yyyy")}</h3></div><div className="calendar-tools"><div className="calendar-key"><i className="good"/>Good <i className="partial"/>Partial <i className="low"/>Low</div><div className="calendar-nav"><IconButton label="เดือนก่อน" disabled={!canPrevious} onClick={()=>setMonth(value=>addMonths(value,-1))}><ChevronLeft size={17}/></IconButton><IconButton label="เดือนถัดไป" disabled={!canNext} onClick={()=>setMonth(value=>addMonths(value,1))}><ChevronRight size={17}/></IconButton></div></div></div><div className="calendar-grid">{["S","M","T","W","T","F","S"].map((x,i)=><b key={i}>{x}</b>)}{Array.from({length:first}).map((_,i)=><span key={`empty-${i}`}/>)}{days.map(day=>{const key=format(day,"yyyy-MM-dd"),log=byDate[key],score=log?dailyScore(log,profile):null;return <button type="button" disabled={!log} aria-label={`${format(day,"d MMMM")}${log?` คะแนน ${score}`:" ไม่มีข้อมูล"}`} onClick={()=>log&&onSelect(log)} key={key} className={score==null?"":score>=80?"good":score>=55?"partial":"low"}><span>{format(day,"d")}</span>{score!=null&&<i/>}</button>})}</div></section>;
}

function DayDetail({log,profile,onClose}) { if(!log)return null; const items=[["Weight",log.weight==null?"—":`${log.weight} kg`],["Calories",log.calories==null?"—":`${log.calories.toLocaleString()} kcal`],["Protein",log.protein==null?"—":`${log.protein} g`],["Steps",log.steps==null?"—":log.steps.toLocaleString()],["Sleep",log.sleep==null?"—":`${Math.floor(log.sleep/60)}h ${log.sleep%60}m`],["Daily score",`${dailyScore(log,profile)} / 100`]]; return <Modal open title={format(parseISO(log.date),"d MMMM yyyy")} onClose={onClose}><div className="detail-grid">{items.map(([a,b])=><div key={a}><span>{a}</span><b>{b}</b></div>)}</div>{log.notes&&<p className="detail-note">{log.notes}</p>}</Modal>; }

function MilestoneChart({profile}) { return <div className="card metric-chart"><div className="card-head"><div><span>16-WEEK PATH</span><h3>Target milestones</h3></div><Target size={20}/></div><ResponsiveContainer width="100%" height={260}><AreaChart data={MILESTONES[profile.id]}><CartesianGrid vertical={false} strokeDasharray="3 7" stroke="var(--line)"/><XAxis dataKey="w" tickFormatter={v=>`W${v}`} axisLine={false} tickLine={false} tick={{fill:"var(--muted)",fontSize:11}}/><YAxis domain={["dataMin - 2","dataMax + 2"]} axisLine={false} tickLine={false} tick={{fill:"var(--muted)",fontSize:11}}/><Tooltip labelFormatter={v=>`Week ${v}`} formatter={v=>[`${v} kg`,`Target midpoint`]}/><Area dataKey="v" stroke="#1f9d6a" fill="url(#weightFill)" strokeWidth={3}/></AreaChart></ResponsiveContainer></div>; }

function WeeklyReview({profile,review}) { if(!review)return <section className="weekly-review card"><div className="review-top"><div className="trophy-icon"><Award size={23}/></div><div><span>GETTING STARTED</span><h2>Starting point saved, {profile.name}</h2><p>Weekly Review จะสรุปจาก 7 วันตามปฏิทิน ไม่ดึงรายการเก่ามาแทนวันที่ขาด</p></div></div></section>; return <section className="weekly-review card"><div className="review-top"><div className="trophy-icon"><Award size={23}/></div><div><span>CALENDAR 7 DAYS</span><h2>Your weekly review, {profile.name}</h2><p>{review.excludedDays?`ตัด Sick/Vacation ${review.excludedDays} วันออกจากการประเมิน adherence`:`สรุปจากข้อมูลจริงถึงวันนี้ โดยไม่เติมวันที่ขาดหาย`}</p></div></div><div className="review-stats">{[["Average weight",review.averageWeight==null?"—":`${fmt1(review.averageWeight)} kg (${review.weightSamples} days)`],["Avg calories",review.averageCalories==null?"—":`${Math.round(review.averageCalories).toLocaleString()} kcal`],["Protein goal",`${review.proteinOnTarget} / ${review.proteinDays} tracked`],["Avg steps",review.averageSteps==null?"—":Math.round(review.averageSteps).toLocaleString()],["Strength",`${review.workoutSessions} / 3 sessions`],["Active minutes",`${Math.round(review.exerciseMinutes||0)} / 150 min`],["Avg sleep",review.averageSleep==null?"—":`${Math.floor(review.averageSleep/60)}h ${Math.round(review.averageSleep%60)}m`]].map(([a,b])=><div key={a}><span>{a}</span><b>{b}</b></div>)}</div></section>; }

const sessionVolume=session=>(session?.exercises||[]).reduce((sum,exercise)=>sum+(exercise.sets||[]).reduce((total,set)=>total+(Number(set.weight)||0)*(Number(set.reps)||0),0),0);
const previousExercise=(workouts,name,date)=>[...workouts].filter(session=>session.date<date).sort((a,b)=>a.date.localeCompare(b.date)).flatMap(session=>session.exercises||[]).filter(exercise=>exercise.name===name&&exercise.sets?.some(set=>set.weight!=null||set.reps!=null)).at(-1);
const makeWorkoutDraft=(type,workouts=[],date)=>{const existing=workouts.find(session=>session.date===date&&session.type===type);return WORKOUTS[type].map(([name,scheme,suggestedWeight])=>{const saved=existing?.exercises?.find(exercise=>exercise.name===name),previous=previousExercise(workouts,name,date);return {name,scheme,suggestedWeight,done:Boolean(saved?.done),sets:Array.from({length:3},(_,index)=>({weight:saved?.sets?.[index]?.weight??"",reps:saved?.sets?.[index]?.reps??""})),rir:saved?.rir??"",previous}})};
const reachedUpper=exercise=>{const upper=Number(exercise.scheme.match(/(\d+)(?!.*\d)/)?.[1]||99),sets=exercise.sets.filter(set=>Number(set.reps)>0);return exercise.done&&sets.length>0&&sets.every(set=>Number(set.reps)>=upper)&&Number(exercise.rir)>=1};

function WorkoutPage({profile,workouts,healthWorkouts,onSave,clock,preferences,onPreferences}) {
  const initialType=workouts.filter(item=>item.date<clock.date).length%2===0?"A":"B";
  const [type,setType]=useState(initialType), [draft,setDraft]=useState(()=>makeWorkoutDraft(initialType,workouts,clock.date)), [saved,setSaved]=useState(false), [scheduleOpen,setScheduleOpen]=useState(false),[duration,setDuration]=useState(()=>workouts.find(item=>item.date===clock.date&&item.type===initialType)?.durationMinutes??""),[trendExercise,setTrendExercise]=useState("Chest Press");
  const changeType=next=>{setType(next);setDraft(makeWorkoutDraft(next,workouts,clock.date));setDuration(workouts.find(item=>item.date===clock.date&&item.type===next)?.durationMinutes??"");setSaved(false)};
  const update=(index,next)=>setDraft(current=>current.map((exercise,i)=>i===index?next:exercise));
  const completed=draft.filter(exercise=>exercise.done).length;
  const exerciseNames=[...new Set(Object.values(WORKOUTS).flat().map(item=>item[0]))],history=workouts.map(session=>{const exercise=session.exercises?.find(item=>item.name===trendExercise);if(!exercise)return null;const weights=exercise.sets?.map(set=>Number(set.weight)||0).filter(Boolean)||[];return weights.length?{date:session.date,label:format(parseISO(session.date),"d MMM"),value:Math.max(...weights),volume:(exercise.sets||[]).reduce((sum,set)=>sum+(Number(set.weight)||0)*(Number(set.reps)||0),0)}:null}).filter(Boolean);
  const upperReached=draft.filter(exercise=>exercise.done).length>0&&draft.filter(exercise=>exercise.done).every(reachedUpper),recentSessions=[...workouts].sort((a,b)=>a.date.localeCompare(b.date)).slice(-2),recoveryDrop=recentSessions.length===2&&sessionVolume(recentSessions[1])<sessionVolume(recentSessions[0])*.85;
  const save=()=>{if(!draft.some(exercise=>exercise.done||exercise.sets.some(set=>set.reps!==""||set.weight!=="")))return;const existing=workouts.find(item=>item.date===clock.date&&item.type===type),didSave=onSave({id:existing?.id||`${profile.id}-${clock.date}-${Date.now()}`,profileId:profile.id,date:clock.date,type,durationMinutes:duration===""?null:Number(duration),exercises:draft.map(({previous,...exercise})=>({...exercise,sets:exercise.sets.map(set=>({weight:set.weight===""?null:Number(set.weight),reps:set.reps===""?null:Number(set.reps)})),rir:exercise.rir===""?null:Number(exercise.rir)})),completedExercises:completed,createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()});if(didSave!==false)setSaved(true)};
  return <><PageTitle eyebrow="TRAINING" title="Workout tracker" note="Full body · 3 sessions per week" action={<button className="secondary-btn" onClick={()=>setScheduleOpen(true)}><CalendarDays size={16}/> Schedule</button>}/>
    <div className="workout-tabs"><button className={type==="A"?"active":""} onClick={()=>changeType("A")}><b>A</b><span>Workout A<small>Squat · Push · Pull</small></span></button><button className={type==="B"?"active":""} onClick={()=>changeType("B")}><b>B</b><span>Workout B<small>Hinge · Row · Press</small></span></button></div>
    <section className="workout-layout"><div><div className="workout-banner"><div><span>{format(parseISO(clock.date),"d MMM").toUpperCase()} · TODAY'S SESSION</span><h2>Full Body · Workout {type}</h2><p>6 exercises · 18 working sets · ช่องแต่ละท่าแสดงผลงานครั้งก่อน</p><label className="duration-input">ระยะเวลา <input type="number" min="0" max="300" value={duration} onChange={event=>setDuration(event.target.value)} placeholder="55"/> นาที</label></div><Ring value={completed/6*100}><b>{completed}</b><small>of 6</small></Ring></div><div className="exercise-list">{draft.map((exercise,i)=><Exercise key={exercise.name} index={i+1} exercise={exercise} onChange={next=>update(i,next)}/>)}</div><button className="primary-btn workout-save" type="button" onClick={save} disabled={!draft.some(exercise=>exercise.done||exercise.sets.some(set=>set.reps!==""||set.weight!==""))}>{saved?<Check size={17}/>:<Save size={17}/>} {saved?"Workout saved":"Save workout"}</button></div><aside><div className="card workout-tip"><Sparkles size={19}/><span>{recoveryDrop?"RECOVERY CHECK":"PROGRESSION TIP"}</span><h3>{recoveryDrop?"Volume ลดลงต่อเนื่อง":upperReached?"Ready to progress":"Own the rep range"}</h3><p>{recoveryDrop?"Training volume ล่าสุดลดเกิน 15% ตรวจการนอน ความหิว และอาการล้าก่อนเพิ่มน้ำหนัก":upperReached?"ท่าที่ถึง upper rep range และยังเหลือ RIR สามารถพิจารณาเพิ่มน้ำหนักครั้งหน้า":"เพิ่มน้ำหนักเฉพาะท่าที่ทำถึง upper rep range โดยยังเหลือ 1–2 RIR"}</p></div><div className="card strength-card"><span>STRENGTH TREND · ALL EXERCISES</span><select value={trendExercise} onChange={event=>setTrendExercise(event.target.value)}>{exerciseNames.map(name=><option key={name}>{name}</option>)}</select>{history.length<2?<div className="mini-empty">บันทึก {trendExercise} อย่างน้อย 2 ครั้งเพื่อดูแนวโน้ม</div>:<><b>{history[0].value} <small>→</small> {history.at(-1).value} kg</b><ResponsiveContainer width="100%" height={120}><LineChart data={history}><Line dataKey="value" stroke="#1f9d6a" strokeWidth={3}/><YAxis hide domain={["dataMin - 2","dataMax + 2"]}/><Tooltip/></LineChart></ResponsiveContainer><small>Volume ล่าสุด {Math.round(history.at(-1).volume).toLocaleString()} kg·reps</small></>}</div><div className="card apple-workout-card"><span>APPLE HEALTH</span><h3>Synced workouts</h3>{healthWorkouts.length?<div>{healthWorkouts.slice(-4).reverse().map(item=><p key={item.id}><Watch size={15}/><span><b>{String(item.activityType).replace(/([A-Z])/g," $1").replace(/^activity-/,"Workout ")}</b><small>{format(parseISO(item.startAt),"d MMM · HH:mm")} · {Math.round(item.durationMinutes||0)} min</small></span></p>)}</div>:<div className="mini-empty">เชื่อม HealthKit Companion เพื่อดึง workout จาก Apple Watch</div>}</div></aside></section>
    <ScheduleModal open={scheduleOpen} onClose={()=>setScheduleOpen(false)} preferences={preferences} onChange={onPreferences}/>
  </>;
}

function Exercise({index,exercise,onChange}) { const setValue=(setIndex,key,value)=>onChange({...exercise,sets:exercise.sets.map((set,i)=>i===setIndex?{...set,[key]:value}:set)}),previous=exercise.previous,ready=reachedUpper(exercise); return <div className={`exercise card ${exercise.done?"done":""}`}><button type="button" className="check-btn" aria-label={`${exercise.done?"ยกเลิก":"ทำเสร็จ"} ${exercise.name}`} onClick={()=>onChange({...exercise,done:!exercise.done})}>{exercise.done?<Check size={17}/>:index}</button><div className="exercise-name"><span>{exercise.scheme}</span><h3>{exercise.name}</h3><p>{previous?`ครั้งก่อน ${previous.sets.map(set=>`${set.weight||0}×${set.reps||0}`).join(" · ")} · RIR ${previous.rir??"—"}`:exercise.suggestedWeight?`Suggested start ${exercise.suggestedWeight} kg`:"Bodyweight · no preset logged"}</p>{ready&&<b className="progress-ready">พร้อมเพิ่มครั้งหน้า</b>}</div><div className="sets">{exercise.sets.map((set,i)=><label key={i}><span>SET {i+1}</span><div className="set-inputs"><input aria-label={`${exercise.name} set ${i+1} weight`} type="number" min="0" step="0.5" placeholder={String(previous?.sets?.[i]?.weight??"kg")} value={set.weight} onChange={event=>setValue(i,"weight",event.target.value)}/><input aria-label={`${exercise.name} set ${i+1} reps`} type="number" min="0" placeholder={String(previous?.sets?.[i]?.reps??"reps")} value={set.reps} onChange={event=>setValue(i,"reps",event.target.value)}/></div></label>)}<label><span>RIR</span><input aria-label={`${exercise.name} reps in reserve`} type="number" min="0" max="10" placeholder="—" value={exercise.rir} onChange={event=>onChange({...exercise,rir:event.target.value})}/><small>left</small></label></div></div>; }

function ScheduleModal({open,onClose,preferences,onChange}) { const names=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]; return <Modal open={open} title="Workout schedule" onClose={onClose}><p className="modal-copy">เลือกวันที่วางแผนฝึก การตั้งค่านี้บันทึกในเครื่องและใช้กับ reminder</p><div className="day-picker">{names.map((name,index)=><button type="button" className={preferences.workoutDays.includes(index)?"active":""} aria-pressed={preferences.workoutDays.includes(index)} key={name} onClick={()=>onChange({...preferences,workoutDays:preferences.workoutDays.includes(index)?preferences.workoutDays.filter(day=>day!==index):[...preferences.workoutDays,index].sort()})}>{name}</button>)}</div></Modal>; }

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

function ProfilePage({profile,store,setPage,onReset,onPreview,previewDemo,onImport,onSettings}) { const choose=(kind)=>{const input=document.createElement("input");input.type="file";input.accept=kind==="csv"?".csv,text/csv":".json,application/json";input.onchange=()=>input.files?.[0]&&onImport(input.files[0],kind);input.click()}; return <><PageTitle eyebrow="ACCOUNT & PLAN" title="Profile" note="Starting point และเป้าหมาย 16 สัปดาห์"/><section className="profile-layout"><div className="card profile-card"><Avatar profile={profile} large/><h2>{profile.name}</h2><p>Started 30 August 2026 · ข้อมูลเริ่มต้นจริง</p><div className="profile-numbers">{[["Start weight",`${profile.startWeight} kg`],["Main goal",`${profile.goalMin}–${profile.goalMax} kg`],["Body fat",`${profile.bodyFat}%`],["Muscle",`${profile.muscle} kg`],["BMR",`${profile.bmr} kcal`],["Visceral fat",profile.visceral]].map(([a,b])=><div key={a}><span>{a}</span><b>{b}</b></div>)}</div><div className="measurement-rhythm"><h3>Measurement rhythm</h3><p><b>ทุกวัน</b><span>Weight · Calories · Protein</span></p><p><b>อัตโนมัติ</b><span>Steps · Sleep · Exercise</span></p><p><b>ทุกสัปดาห์</b><span>Waist · Body composition</span></p><p><b>ทุก 4 สัปดาห์</b><span>Progress photo</span></p></div></div><div className="profile-stack"><div className="card settings-card"><h3>Daily targets</h3>{[["Calories",`${profile.calorieTarget.toLocaleString()} kcal`],["Protein",`${profile.proteinMin}–${profile.proteinMax} g`],["Water",`${profile.waterTarget} L`],["Steps",profile.stepsTarget.toLocaleString()],["Sleep","8 hours"],["Weekly exercise","150 active min · Strength × 3"]].map(([a,b])=><p key={a}><span>{a}</span><b>{b}</b></p>)}</div><div className="card settings-card"><h3>Data, sync & challenge</h3><button onClick={()=>setPage("compare")}><Users size={17}/> Zackdark vs Tony <ArrowRight size={15}/></button><button onClick={onSettings}><Wifi size={17}/> Sync & reminders <ArrowRight size={15}/></button><button onClick={()=>downloadFile("recomp-backup.json",JSON.stringify(store,null,2),"application/json")}><Download size={17}/> Export JSON backup <ArrowRight size={15}/></button><button onClick={()=>downloadFile("recomp-logs.csv",exportCsv(store.logs),"text/csv;charset=utf-8")}><Download size={17}/> Export CSV <ArrowRight size={15}/></button><button onClick={()=>choose("json")}><Upload size={17}/> Import JSON backup <ArrowRight size={15}/></button><button onClick={()=>choose("csv")}><Upload size={17}/> Import CSV <ArrowRight size={15}/></button><button className="danger-row" onClick={onReset}><RefreshCcw size={17}/> Reset to starting data <ArrowRight size={15}/></button><button onClick={onPreview}><Sparkles size={17}/> {previewDemo?"Exit demo preview":"Open isolated demo preview"} <ArrowRight size={15}/></button></div></div></section></> }

function Modal({open,title,onClose,children,footer}) { useEffect(()=>{if(!open)return;const close=event=>event.key==="Escape"&&onClose();window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close)},[open,onClose]); if(!open)return null; return <div className="modal-backdrop" role="presentation" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><section className="modal-card" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><h2>{title}</h2><IconButton label="ปิด" onClick={onClose}><X size={19}/></IconButton></div><div className="modal-body">{children}</div>{footer&&<div className="modal-footer">{footer}</div>}</section></div>; }

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
    {syncInfo.authorized&&<div className="settings-section"><span>APPLE HEALTH · BETA</span><div className={`sync-state ${integration?.lastSyncedAt?"online":""}`}><Watch size={18}/><div><b>{integration?.lastSyncedAt?"Apple Health connected":"พร้อมเชื่อม iPhone"}</b><p>{integration?.lastSyncedAt?`ซิงก์ล่าสุด ${new Date(integration.lastSyncedAt).toLocaleString("th-TH")}`:"อ่าน Steps, Sleep, Weight, Body Fat และ Workout ผ่าน HealthKit Companion"}</p></div></div><div className="modal-actions"><button className="primary-btn" onClick={createPairing}>{integration?.paired?"Generate new token":"Create pairing token"}</button>{integration?.paired&&<button className="secondary-btn" onClick={revokePairing}>Disconnect</button>}</div>{pairing&&<div className="pairing-box"><p>Token จะแสดงครั้งเดียว เก็บไว้ใน Keychain ของ iPhone และอย่าแชร์ให้ผู้อื่น</p>{[["PROFILE",pairing.profileId],["SYNC ENDPOINT",pairing.endpoint],["PAIRING TOKEN",pairing.token]].map(([label,value])=><label key={label}><span>{label}</span><div><code>{value}</code><button onClick={()=>copy(value)} aria-label={`คัดลอก ${label}`}><Copy size={15}/></button></div></label>)}</div>}</div>}
  </Modal>;
}

export default function HealthApp() {
  const validPages=[...nav.map(item=>item[0]),"compare"], pageFromHash=()=>validPages.includes(location.hash.slice(1))?location.hash.slice(1):"dashboard";
  const [page,setPageState]=useState(pageFromHash), [profileId,setProfileId]=useState("zackdark"), [dark,setDark]=useState(()=>localStorage.getItem("recomp-theme-v2")!=="light");
  const [store,setStore]=useState(loadStore), [previewDemo,setPreviewDemo]=useState(false), [settingsOpen,setSettingsOpen]=useState(false), [resetOpen,setResetOpen]=useState(false), [toast,setToast]=useState("");
  const storeRef=useRef(store), [authUser,setAuthUser]=useState(null);
  const [sessionStatus,setSessionStatus]=useState(firebaseConfigured?"checking":"ready");
  const [syncInfo,setSyncInfo]=useState({configured:firebaseConfigured,user:null,status:firebaseConfigured?"signed-out":"local",authorized:false,connected:false});
  const clock=challengeClock(bangkokToday());
  const demoStore=useMemo(()=>({...initialStore(),logs:{zackdark:makeDemoLogs("zackdark"),tony:makeDemoLogs("tony")}}),[]);
  const activeStore=previewDemo?demoStore:store, allLogs=activeStore.logs, baseProfile=PROFILES[profileId], profile={...baseProfile,calorieTarget:activeStore.plans?.[profileId]?.calorieTarget??baseProfile.calorieTarget,calorieHistory:activeStore.plans?.[profileId]?.history||[]}, logs=allLogs[profileId], workouts=activeStore.workouts[profileId]||[], healthWorkouts=activeStore.healthWorkouts?.[profileId]||[];
  const setPage=next=>{setPageState(next);if(location.hash!==`#${next}`)history.replaceState(null,"",`#${next}`)};
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
  const flash=message=>{setToast(message);setTimeout(()=>setToast(""),3000)};
  useEffect(()=>startReminderScheduler({getState:()=>{const current=storeRef.current,base=PROFILES[profileId];return {logs:current.logs[profileId]||[],profile:{...base,calorieTarget:current.plans?.[profileId]?.calorieTarget??base.calorieTarget},preferences:current.preferences}},onDue:title=>flash(title)}),[profileId,store.preferences]);
  const commit=next=>{storeRef.current=next;setStore(next);return next};
  const remoteError=error=>{setSyncInfo(current=>({...current,status:"error",connected:false,message:error.message}));flash(`Realtime sync ไม่สำเร็จ: ${error.message}`)};
  const saveLog=input=>{if(previewDemo){flash("ออกจาก Demo preview ก่อนบันทึกข้อมูลจริง");return false}const next=commit(upsertProfileLog(storeRef.current,profileId,input)),saved=next.logs[profileId].find(log=>log.date===input.date);if(syncInfo.authorized)writeRealtimeLog(profileId,saved).catch(remoteError);flash(`บันทึก ${format(parseISO(input.date),"d MMM")} แล้ว${syncInfo.authorized?" · syncing":" · ในเครื่อง"}`);return true};
  const saveWorkout=session=>{if(previewDemo){flash("ออกจาก Demo preview ก่อนบันทึก Workout");return false}const current=storeRef.current,withLog=upsertProfileLog(current,profileId,{...(current.logs[profileId].find(log=>log.date===session.date)||{}),date:session.date,workout:true}),next=commit({...withLog,workouts:{...withLog.workouts,[profileId]:[...(withLog.workouts[profileId]||[]).filter(item=>!(item.date===session.date&&item.type===session.type)),session]}}),savedLog=next.logs[profileId].find(log=>log.date===session.date);if(syncInfo.authorized)Promise.all([writeRealtimeLog(profileId,savedLog),writeRealtimeWorkout(profileId,session)]).catch(remoteError);flash(`บันทึก Workout แล้ว${syncInfo.authorized?" · syncing":" · ในเครื่อง"}`);return true};
  const updatePreferences=preferences=>{commit({...storeRef.current,preferences});if(syncInfo.authorized)writeRealtimePreferences(preferences).catch(remoteError)};
  const applyCalories=decision=>{if(previewDemo){flash("ออกจาก Demo preview ก่อนปรับเป้าหมาย");return false}const previous=storeRef.current.plans?.[profileId]||{calorieTarget:baseProfile.calorieTarget,history:[]},last=previous.history?.at(-1);if(last&&differenceInCalendarDays(parseISO(clock.date),parseISO(last.date))<7){flash("ปรับ Calories ได้ไม่เกินหนึ่งครั้งต่อ 7 วัน");return false}const target=profile.calorieTarget+decision.delta;if(!window.confirm(`ยืนยันเปลี่ยนเป้าหมาย Calories จาก ${profile.calorieTarget.toLocaleString()} เป็น ${target.toLocaleString()} kcal/วัน?`))return false;const plan={...previous,calorieTarget:target,history:[...(previous.history||[]),{from:profile.calorieTarget,to:target,date:clock.date,reason:decision.action,createdAt:new Date().toISOString()}]};commit({...storeRef.current,plans:{...storeRef.current.plans,[profileId]:plan}});if(syncInfo.authorized)writeRealtimePlan(profileId,plan).catch(remoteError);flash(`ปรับเป้าหมายเป็น ${target.toLocaleString()} kcal แล้ว`);return true};
  const importFile=async(file,kind)=>{try{const text=await file.text();let next;if(kind==="csv"){const rows=importCsv(text);next=rows.reduce((state,row)=>upsertProfileLog(state,row.profileId,row),storeRef.current);flash(`นำเข้า CSV ${rows.length} รายการแล้ว`)}else{const parsed=JSON.parse(text),imported=parsed.logs||parsed;if(!Array.isArray(imported.zackdark)||!Array.isArray(imported.tony))throw new Error("JSON backup ไม่มี logs ของทั้งสอง profile");next={...storeRef.current,...(parsed.logs?parsed:{}),logs:{zackdark:imported.zackdark,tony:imported.tony},preferences:{...storeRef.current.preferences,...(parsed.preferences||{}),reminderTimes:{...storeRef.current.preferences.reminderTimes,...(parsed.preferences?.reminderTimes||{})}},plans:{...storeRef.current.plans,...(parsed.plans||{})},workouts:{...storeRef.current.workouts,...(parsed.workouts||{})},healthWorkouts:{...storeRef.current.healthWorkouts,...(parsed.healthWorkouts||{})},integrations:{...storeRef.current.integrations,...(parsed.integrations||{})}};flash("นำเข้า JSON backup แล้ว")}commit(next);if(syncInfo.authorized)replaceRealtimeStore(next).catch(remoteError)}catch(error){flash(`นำเข้าไม่สำเร็จ: ${error.message}`)}};
  const confirmReset=()=>{const next=commit(initialStore());if(syncInfo.authorized)replaceRealtimeStore(next).catch(remoteError);setPreviewDemo(false);setResetOpen(false);flash("รีเซ็ตกลับเป็นข้อมูลเริ่มต้นจริงแล้ว")};
  const togglePreview=()=>{setPreviewDemo(value=>!value);setPage("dashboard")};
  if(sessionStatus!=="ready")return <SessionGate status={sessionStatus} user={authUser} onSignIn={signInFirebase} onSignOut={signOutFirebase}/>;
  let content=page==="dashboard"?<Dashboard profile={profile} logs={logs} allLogs={allLogs} workouts={workouts} healthWorkouts={healthWorkouts} setPage={setPage} clock={clock} onApplyCalories={applyCalories} preferences={store.preferences}/>:page==="log"?<LogPage key={profileId} profile={profile} logs={logs} onSave={saveLog} clock={clock}/>:page==="progress"?<ProgressPage key={profileId} profile={profile} logs={logs} workouts={workouts} healthWorkouts={healthWorkouts} clock={clock} onApplyCalories={applyCalories}/>:page==="workout"?<WorkoutPage key={profileId} profile={profile} workouts={workouts} healthWorkouts={healthWorkouts} onSave={saveWorkout} clock={clock} preferences={store.preferences} onPreferences={updatePreferences}/>:page==="compare"?<ComparePage allLogs={allLogs} allWorkouts={activeStore.workouts} clock={clock}/>:<ProfilePage profile={profile} store={store} setPage={setPage} onReset={()=>setResetOpen(true)} onPreview={togglePreview} previewDemo={previewDemo} onImport={importFile} onSettings={()=>setSettingsOpen(true)}/>;
  return <div className="recomp-app">
    <Sidebar page={page} setPage={setPage} dark={dark} setDark={setDark} clock={clock} previewDemo={previewDemo}/>
    <div className="app-column"><Topbar profileId={profileId} setProfileId={setProfileId} profile={profile} dark={dark} setDark={setDark} clock={clock} onNotifications={()=>setSettingsOpen(true)} syncOnline={syncInfo.status==="live"}/>{previewDemo&&<div className="preview-banner"><Sparkles size={16}/><span>Demo preview · ข้อมูลชุดนี้แยกจากข้อมูลจริงและจะไม่ถูกบันทึก</span><button onClick={togglePreview}>Exit preview</button></div>}<main><div className="page-enter" key={`${page}-${profileId}`}>{content}</div></main></div>
    <MobileNav page={page} setPage={setPage}/>{toast&&<div className="toast" role="status">{toast}</div>}
    <SettingsModal open={settingsOpen} onClose={()=>setSettingsOpen(false)} preferences={store.preferences} onPreferences={updatePreferences} syncInfo={syncInfo} integration={store.integrations?.appleHealth?.[syncInfo.member?.profileId]} onSignIn={signInFirebase} onSignOut={signOutFirebase} onCreatePairing={createAppleHealthPairing} onRevokePairing={revokeAppleHealthPairing}/>
    <Modal open={resetOpen} title="Reset all real data?" onClose={()=>setResetOpen(false)} footer={<><button className="secondary-btn" onClick={()=>setResetOpen(false)}>Cancel</button><button className="danger-btn" onClick={confirmReset}>Reset data</button></>}><p className="modal-copy">รายการบันทึกและ Workout จะกลับไปเหลือเฉพาะข้อมูลเริ่มต้นวันที่ 30 สิงหาคม 2026 หากเชื่อม Firebase อยู่ การรีเซ็ตจะมีผลกับอุปกรณ์ของสมาชิกทั้งสองคน กรุณา Export backup ก่อนหากต้องการเก็บข้อมูลไว้</p></Modal>
  </div>;
}
