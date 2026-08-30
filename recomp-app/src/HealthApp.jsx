import { useEffect, useMemo, useState } from "react";
import { addMonths, eachDayOfInterval, endOfMonth, format, getDay, parseISO, startOfMonth } from "date-fns";
import {
  Area, AreaChart, CartesianGrid, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Activity, ArrowDown, ArrowRight, Award, BarChart3, BedDouble, Bell, CalendarDays,
  Check, ChevronDown, ChevronLeft, ChevronRight, CircleUserRound, Download,
  Droplets, Dumbbell, Footprints, Gauge, Home, Info, Mail, Moon, Plus, RefreshCcw,
  Save, Scale, Sparkles, Sun, Target, TrendingDown, Trophy, Upload, Utensils, Users, Wifi, X, Zap,
} from "lucide-react";
import { z } from "zod";
import { makeDemoLogs, MILESTONES, PHASES, PROFILES, WORKOUTS } from "./data.js";
import {
  bangkokToday, challengeClock, coachingFrom, dailyScore as calculateDailyScore, filterLogs,
  mean, numeric, percent, rollingWeight, weeklyReview, weightStats,
} from "./lib/metrics.js";
import {
  cleanLogInput, downloadFile, exportCsv, importCsv, initialStore, loadStore, saveStore, upsertProfileLog,
} from "./lib/store.js";
import { getSyncSession, requestMagicLink, signOutSync, supabaseConfigured, syncProfileLogs } from "./lib/supabase.js";
import "./health.css";

const nav = [
  ["dashboard","Overview",Home], ["log","Quick log",Plus], ["progress","Progress",BarChart3],
  ["workout","Workout",Dumbbell], ["profile","Profile",CircleUserRound],
];

const number = numeric;
const average = (items, key) => mean(items, key) ?? 0;
const pct = percent;
const fmt1 = (value) => numeric(value).toFixed(1);
const rolling = rollingWeight;
const statsFor = (logs, profile) => weightStats(logs, profile, logs.at(-1)?.date || bangkokToday());
const dailyScore = calculateDailyScore;
const coaching = coachingFrom;

function IconButton({ children, label, onClick, className="", ...props }) {
  return <button className={`icon-btn ${className}`} aria-label={label} onClick={onClick} {...props}>{children}</button>;
}

function Brand() {
  return <div className="brand"><div className="brand-mark"><TrendingDown size={18}/></div><div><strong>recomp</strong><span>16 week protocol</span></div></div>;
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

function Dashboard({ profile, logs, allLogs, workouts, setPage, clock }) {
  const s=weightStats(logs,profile,clock.date), coach=coaching(s), today=logs.find(log=>log.date===clock.date)||{};
  const hasHistory=s.sampleCount>1, workoutToday=workouts.some(workout=>workout.date===clock.date);
  const targets=[
    {icon:Utensils,label:"Calories",value:number(today.calories),target:profile.calorieTarget,unit:"kcal",color:"#5c7cdb"},
    {icon:Zap,label:"Protein",value:number(today.protein),target:profile.proteinMin,unit:"g",color:"#bd7a2d"},
    {icon:Droplets,label:"Water",value:number(today.water),target:profile.waterTarget,unit:"L",color:"#2e9eb8"},
    {icon:Footprints,label:"Steps",value:number(today.steps),target:profile.stepsTarget,unit:"",color:"#1f9d6a"},
    {icon:BedDouble,label:"Sleep",value:number(today.sleep),target:480,display:today.sleep?`${Math.floor(today.sleep/60)}h ${today.sleep%60}m`:"Not logged",targetDisplay:"8h",unit:"",color:"#8d67bb"},
    {icon:Dumbbell,label:"Workout",value:today.workout||workoutToday||today.restDay?1:0,target:1,display:today.workout||workoutToday?"Completed ✓":today.restDay?"Rest day ✓":"Not logged",targetDisplay:"Today",unit:"",color:"#d06558"},
  ];
  return <>
    <PageTitle eyebrow="GOOD MORNING" title={`Ready when you are, ${profile.name}.`} note={`${clock.daysRemaining} days left · Phase ${clock.phase} — ${PHASES[clock.phase-1].title}`} action={<button className="primary-btn" onClick={()=>setPage("log")} aria-label="เปิด Quick Log"><Plus size={17}/> Quick log</button>}/>
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
        <WorkoutMini setPage={setPage} clock={clock}/>
      </div>
    </section>
    <ComparisonMini allLogs={allLogs} setPage={setPage}/>
    <Roadmap clock={clock}/>
  </>;
}

function WorkoutMini({setPage,clock}) { const next=format(parseISO(clock.date),"d MMM").toUpperCase().split(" "); return <div className="workout-mini card"><div className="date-block"><b>{next[0]}</b><span>{next[1]}</span></div><div><span>TODAY'S WORKOUT</span><h3>Full Body · Workout A</h3><p>6 exercises · ~55 min</p></div><button onClick={()=>setPage("workout")} aria-label="เปิด Workout"><ArrowRight size={18}/></button></div>; }

function ComparisonMini({allLogs,setPage}) {
  const rows=Object.values(PROFILES).map(p=>({p,s:statsFor(allLogs[p.id],p)}));
  const tied=rows[0].s.consistency===rows[1].s.consistency;
  return <section className="compare-mini card"><div className="card-head"><div><span><Users size={17}/> SHARED CHALLENGE</span><h3>Better together</h3></div><button onClick={()=>setPage("compare")}>Full comparison <ArrowRight size={14}/></button></div><div className="compare-rows">{rows.map(({p,s},i)=>{const change=(s.lost/p.startWeight)*100;return <div className="compare-person" key={p.id}><div className="rank">{tied?"—":i+1}</div><Avatar profile={p}/><div className="person-info"><b>{p.name}</b><span>{s.consistency}% consistency</span></div><div className="person-loss"><b>{change===0?"0.0":`${change>0?"−":"+"}${fmt1(Math.abs(change))}`}%</b><span>body weight</span></div><ProgressBar value={s.consistency}/></div>})}</div><p className="friendly"><Trophy size={15}/> ทั้งคู่กำลังสร้าง momentum ได้ดี — วัดจากความสม่ำเสมอ ไม่ใช่แค่ตัวเลขบนตาชั่ง</p></section>;
}

function Roadmap({clock}) { return <section><div className="section-heading"><div><p>THE BIG PICTURE</p><h2>16-week roadmap</h2></div><span>Phase {clock.phase} {clock.complete?"complete":"in progress"}</span></div><div className="phase-grid">{PHASES.map((p,i)=><div className={`phase-card ${i===clock.phase-1?"active":""}`} key={p.n}><div><span>{p.n}</span>{i===clock.phase-1&&<b>{clock.complete?"DONE":"NOW"}</b>}</div><small>{p.weeks}</small><h3>{p.title}</h3><p>{p.note}</p><em>{p.meta}</em></div>)}</div></section>; }

const optionalNumber=(min,max)=>z.preprocess(value=>value===""||value==null?undefined:Number(value),z.number().min(min).max(max).optional());
const logSchema=z.object({weight:optionalNumber(30,300),calories:optionalNumber(0,10000),protein:optionalNumber(0,1000),water:optionalNumber(0,20),steps:optionalNumber(0,200000),sleepHours:optionalNumber(0,24),sleepMinutes:optionalNumber(0,59)});

function LogPage({profile,logs,onSave,clock}) {
  const measured=field=>logs.filter(log=>log[field]!=null).at(-1)?.[field];
  const lastWeight=measured("weight")??profile.startWeight;
  const makeForm=(date)=>{const existing=logs.find(log=>log.date===date)||{};return {date,weight:existing.weight??"",calories:existing.calories??"",protein:existing.protein??"",carbs:existing.carbs??"",fat:existing.fat??"",water:existing.water??"",steps:existing.steps??"",sleepHours:existing.sleep!=null?Math.floor(existing.sleep/60):"",sleepMinutes:existing.sleep!=null?existing.sleep%60:"",waist:existing.waist??"",bodyFat:existing.bodyFat??"",muscle:existing.muscle??"",visceral:existing.visceral??"",mood:existing.mood??"",hunger:existing.hunger??"",energy:existing.energy??"",notes:existing.notes??"",workout:Boolean(existing.workout),restDay:Boolean(existing.restDay),sickDay:Boolean(existing.sickDay),vacationMode:Boolean(existing.vacationMode)}};
  const [form,setForm]=useState(()=>makeForm(clock.date)),[saved,setSaved]=useState(false),[error,setError]=useState("");
  const set=(key,val)=>setForm(current=>({...current,[key]:val}));
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
        <div id="nutrition-section"><LogSection icon={Utensils} title="Nutrition" note={`Target ${profile.calorieTarget.toLocaleString()} kcal · ${profile.proteinMin}–${profile.proteinMax} g protein`}>
          <Field label="Calories" unit="kcal" value={form.calories} onChange={v=>set("calories",v)} placeholder={`เป้าหมาย ${profile.calorieTarget}`}/><Field label="Protein" unit="g" value={form.protein} onChange={v=>set("protein",v)} placeholder={`เป้าหมาย ${profile.proteinMin}`}/><Field label="Carbs" unit="g" value={form.carbs} onChange={v=>set("carbs",v)} placeholder="ไม่บังคับ"/><Field label="Fat" unit="g" value={form.fat} onChange={v=>set("fat",v)} placeholder="ไม่บังคับ"/>
        </LogSection></div>
        <div id="activity-section"><LogSection icon={Activity} title="Daily activity" note="Movement, hydration & recovery">
          <Field label="Water" unit="L" value={form.water} onChange={v=>set("water",v)} step="0.1" placeholder={`เป้าหมาย ${profile.waterTarget}`}/><Field label="Steps" unit="steps" value={form.steps} onChange={v=>set("steps",v)} placeholder={`เป้าหมาย ${profile.stepsTarget}`}/><Field label="Sleep hours" unit="hr" value={form.sleepHours} onChange={v=>set("sleepHours",v)} placeholder="เช่น 7"/><Field label="Minutes" unit="min" value={form.sleepMinutes} onChange={v=>set("sleepMinutes",v)} placeholder="เช่น 30"/>
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
function Field({label,unit,value,onChange,placeholder,step="1"}) { return <label className="field"><span>{label}</span><div><input type="number" inputMode="decimal" step={step} value={value} onChange={e=>onChange(e.target.value)} placeholder={String(placeholder||"")}/><em>{unit}</em></div></label>; }
function Toggle({active,onClick,icon:Icon,children}) { return <button type="button" className={`log-toggle ${active?"active":""}`} aria-pressed={active} onClick={onClick}><Icon size={16}/>{children}{active&&<Check size={14}/>}</button>; }
function Score({label,value,onChange}) { return <div className="score-field"><span>{label}<b>{value?`${value}/5`:"Not rated"}</b></span><div>{[1,2,3,4,5].map(n=><button type="button" className={value===n?"active":""} aria-pressed={value===n} key={n} onClick={()=>onChange(value===n?"":n)}>{n}</button>)}</div></div>; }

function ProgressPage({profile,logs,clock}) {
  const [range,setRange]=useState("30 days"), [metric,setMetric]=useState("weight"), [selected,setSelected]=useState(null);
  const visible=filterLogs(logs,range), s=weightStats(logs,profile,clock.date), chart=rolling(visible), review=weeklyReview(logs,profile);
  const waistLogs=logs.filter(log=>log.waist!=null), waistDelta=waistLogs.length>1?waistLogs[0].waist-waistLogs.at(-1).waist:null;
  const composition=visible.filter(log=>metric==="weight"?(log.waist!=null||log.bodyFat!=null):log.muscle!=null).map(log=>({...log,label:format(parseISO(log.date),"d MMM")}));
  return <><PageTitle eyebrow="YOUR DATA" title="Progress" note="ดูแนวโน้ม ไม่ตัดสินจากตัวเลขวันเดียว" action={<button className="secondary-btn" onClick={()=>downloadFile(`${profile.id}-progress.csv`,exportCsv({[profile.id]:logs}),"text/csv;charset=utf-8")}><Download size={16}/> Export CSV</button>}/>
    <div className="range-tabs">{["7 days","30 days","8 weeks","16 weeks"].map(x=><button className={range===x?"active":""} onClick={()=>setRange(x)} key={x}>{x}</button>)}</div>
    <section className="progress-kpis">{[["Current",`${fmt1(s.latest.weight)} kg`,format(parseISO(s.latest.date),"d MMM yyyy")],["7-day average",s.hasFullAverage?`${fmt1(s.avg7)} kg`:"—",s.weeklyLoss==null?"ต้องมีข้อมูลครบ 14 วัน":`${s.weeklyLoss>=0?"−":"+"}${fmt1(Math.abs(s.weeklyLoss))} kg this week`],["Total change",`${s.lost<0?"+":""}${fmt1(Math.abs(s.lost))} kg`,`${Math.round(s.progress)}% to goal`],["Waist change",waistDelta==null?"—":`${waistDelta>=0?"−":"+"}${fmt1(Math.abs(waistDelta))} cm`,waistDelta==null?"ต้องมีอย่างน้อย 2 ครั้ง":"จากค่าที่วัดจริง"]].map(([a,b,c])=><div className="card" key={a}><span>{a}</span><h3>{b}</h3><small>{c}</small></div>)}</section>
    <section className="card chart-panel"><div className="card-head"><div><span>ACTUAL TREND · {range.toUpperCase()}</span><h3>Weight trend</h3></div><div className="chart-legend"><i/> Daily <i className="avg"/> 7-day avg</div></div><WeightChart logs={visible}/><div className="chart-note"><Info size={15}/> ค่าเฉลี่ย 7 วันจะแสดงเมื่อมีน้ำหนักครบ 7 ครั้ง และช่วยลดผลจากความผันผวนรายวัน</div></section>
    <section className="progress-split"><div className="card metric-chart"><div className="card-head"><div><span>BODY COMPOSITION</span><h3>{metric==="weight"?"Waist & body fat":"Muscle mass"}</h3></div><select value={metric} onChange={e=>setMetric(e.target.value)} aria-label="เลือกตัวชี้วัด"><option value="weight">Waist / Body fat</option><option value="muscle">Muscle mass</option></select></div>{composition.length<2?<div className="empty-chart"><Gauge size={24}/><b>ยังไม่มีแนวโน้ม</b><span>ต้องมีการวัดจริงอย่างน้อย 2 ครั้งในช่วงที่เลือก</span></div>:<ResponsiveContainer width="100%" height={260}><LineChart data={composition}><CartesianGrid vertical={false} strokeDasharray="3 7" stroke="var(--line)"/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{fill:"var(--muted)",fontSize:11}}/><YAxis axisLine={false} tickLine={false} tick={{fill:"var(--muted)",fontSize:11}} domain={["dataMin - 1","dataMax + 1"]}/><Tooltip contentStyle={{background:"var(--card)",border:"1px solid var(--line)",borderRadius:12}}/>{metric==="weight"?<><Line connectNulls dataKey="waist" stroke="#5478d4" strokeWidth={2.5}/><Line connectNulls dataKey="bodyFat" stroke="#bd7a2d" strokeWidth={2.5}/></>:<Line connectNulls dataKey="muscle" stroke="#1f9d6a" strokeWidth={2.5}/>}</LineChart></ResponsiveContainer>}</div><MilestoneChart profile={profile}/></section>
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

function WeeklyReview({profile,review}) { if(!review)return <section className="weekly-review card"><div className="review-top"><div className="trophy-icon"><Award size={23}/></div><div><span>GETTING STARTED</span><h2>Starting point saved, {profile.name}</h2><p>Weekly Review จะพร้อมเมื่อมีรายการครบ 7 วัน ระหว่างนี้บันทึกเท่าที่มีจริง ไม่ต้องกรอกทุกช่อง</p></div></div></section>; return <section className="weekly-review card"><div className="review-top"><div className="trophy-icon"><Award size={23}/></div><div><span>LAST 7 ENTRIES</span><h2>Your weekly review, {profile.name}</h2><p>สรุปจากข้อมูลที่บันทึกจริง โดยไม่เติมวันที่หรือกิจกรรมที่ขาดหาย</p></div></div><div className="review-stats">{[["Average weight",review.averageWeight==null?"—":`${fmt1(review.averageWeight)} kg`],["Avg calories",review.averageCalories==null?"—":`${Math.round(review.averageCalories).toLocaleString()} kcal`],["Protein goal",`${review.proteinDays} / 7 days`],["Avg steps",review.averageSteps==null?"—":Math.round(review.averageSteps).toLocaleString()],["Workouts",`${review.workouts} logged`],["Avg sleep",review.averageSleep==null?"—":`${Math.floor(review.averageSleep/60)}h ${Math.round(review.averageSleep%60)}m`]].map(([a,b])=><div key={a}><span>{a}</span><b>{b}</b></div>)}</div></section>; }

const makeWorkoutDraft=type=>WORKOUTS[type].map(([name,scheme,suggestedWeight])=>({name,scheme,suggestedWeight,done:false,sets:Array.from({length:3},()=>({weight:"",reps:""})),rir:""}));

function WorkoutPage({profile,workouts,onSave,clock,preferences,onPreferences}) {
  const [type,setType]=useState("A"), [draft,setDraft]=useState(()=>makeWorkoutDraft("A")), [saved,setSaved]=useState(false), [scheduleOpen,setScheduleOpen]=useState(false);
  const changeType=next=>{setType(next);setDraft(makeWorkoutDraft(next));setSaved(false)};
  const update=(index,next)=>setDraft(current=>current.map((exercise,i)=>i===index?next:exercise));
  const completed=draft.filter(exercise=>exercise.done).length;
  const history=workouts.flatMap(session=>session.exercises||[]).filter(exercise=>exercise.name==="Chest Press"&&exercise.sets?.some(set=>Number(set.weight)>0)).map((exercise,index)=>({index,value:Math.max(...exercise.sets.map(set=>Number(set.weight)||0))}));
  const upperReached=draft.some(exercise=>exercise.done&&exercise.sets.every(set=>Number(set.reps)>0))&&draft.filter(exercise=>exercise.done).every(exercise=>{const upper=Number(exercise.scheme.match(/(\d+)(?!.*\d)/)?.[1]||99);return exercise.sets.every(set=>Number(set.reps)>=upper)&&Number(exercise.rir)>=1});
  const save=()=>{if(!draft.some(exercise=>exercise.done||exercise.sets.some(set=>set.reps!==""||set.weight!=="")))return;const didSave=onSave({id:`${profile.id}-${clock.date}-${Date.now()}`,profileId:profile.id,date:clock.date,type,exercises:draft.map(exercise=>({...exercise,sets:exercise.sets.map(set=>({weight:set.weight===""?null:Number(set.weight),reps:set.reps===""?null:Number(set.reps)})),rir:exercise.rir===""?null:Number(exercise.rir)})),completedExercises:completed,createdAt:new Date().toISOString()});if(didSave!==false)setSaved(true)};
  return <><PageTitle eyebrow="TRAINING" title="Workout tracker" note="Full body · 3 sessions per week" action={<button className="secondary-btn" onClick={()=>setScheduleOpen(true)}><CalendarDays size={16}/> Schedule</button>}/>
    <div className="workout-tabs"><button className={type==="A"?"active":""} onClick={()=>changeType("A")}><b>A</b><span>Workout A<small>Squat · Push · Pull</small></span></button><button className={type==="B"?"active":""} onClick={()=>changeType("B")}><b>B</b><span>Workout B<small>Hinge · Row · Press</small></span></button></div>
    <section className="workout-layout"><div><div className="workout-banner"><div><span>{format(parseISO(clock.date),"d MMM").toUpperCase()} · TODAY'S SESSION</span><h2>Full Body · Workout {type}</h2><p>6 exercises · 18 working sets · บันทึกเฉพาะ set ที่ทำจริง</p></div><Ring value={completed/6*100}><b>{completed}</b><small>of 6</small></Ring></div><div className="exercise-list">{draft.map((exercise,i)=><Exercise key={exercise.name} index={i+1} exercise={exercise} onChange={next=>update(i,next)}/>)}</div><button className="primary-btn workout-save" type="button" onClick={save} disabled={!draft.some(exercise=>exercise.done||exercise.sets.some(set=>set.reps!==""||set.weight!==""))}>{saved?<Check size={17}/>:<Save size={17}/>} {saved?"Workout saved":"Save workout"}</button></div><aside><div className="card workout-tip"><Sparkles size={19}/><span>PROGRESSION TIP</span><h3>{upperReached?"Ready to progress":"Own the rep range"}</h3><p>{upperReached?"ทุก set ที่ทำถึง upper rep range และมี RIR เหลือ ครั้งหน้าค่อยพิจารณาเพิ่มน้ำหนัก 2.5 kg":"เมื่อทำถึง upper rep range ครบทุก set โดยเหลือ 1–2 RIR ระบบจึงจะแนะนำให้เพิ่มน้ำหนัก"}</p></div><div className="card strength-card"><span>STRENGTH TREND</span><h3>Chest Press</h3>{history.length<2?<div className="mini-empty">บันทึก Chest Press อย่างน้อย 2 ครั้งเพื่อดูแนวโน้ม</div>:<><b>{history[0].value} <small>→</small> {history.at(-1).value} kg</b><ResponsiveContainer width="100%" height={120}><LineChart data={history}><Line dataKey="value" stroke="#1f9d6a" strokeWidth={3}/><YAxis hide domain={["dataMin - 2","dataMax + 2"]}/></LineChart></ResponsiveContainer></>}</div></aside></section>
    <ScheduleModal open={scheduleOpen} onClose={()=>setScheduleOpen(false)} preferences={preferences} onChange={onPreferences}/>
  </>;
}

function Exercise({index,exercise,onChange}) { const setValue=(setIndex,key,value)=>onChange({...exercise,sets:exercise.sets.map((set,i)=>i===setIndex?{...set,[key]:value}:set)}); return <div className={`exercise card ${exercise.done?"done":""}`}><button type="button" className="check-btn" aria-label={`${exercise.done?"ยกเลิก":"ทำเสร็จ"} ${exercise.name}`} onClick={()=>onChange({...exercise,done:!exercise.done})}>{exercise.done?<Check size={17}/>:index}</button><div className="exercise-name"><span>{exercise.scheme}</span><h3>{exercise.name}</h3><p>{exercise.suggestedWeight?`Suggested start ${exercise.suggestedWeight} kg`:"Bodyweight · no preset logged"}</p></div><div className="sets">{exercise.sets.map((set,i)=><label key={i}><span>SET {i+1}</span><div className="set-inputs"><input aria-label={`${exercise.name} set ${i+1} weight`} type="number" min="0" step="0.5" placeholder="kg" value={set.weight} onChange={event=>setValue(i,"weight",event.target.value)}/><input aria-label={`${exercise.name} set ${i+1} reps`} type="number" min="0" placeholder="reps" value={set.reps} onChange={event=>setValue(i,"reps",event.target.value)}/></div></label>)}<label><span>RIR</span><input aria-label={`${exercise.name} reps in reserve`} type="number" min="0" max="10" placeholder="—" value={exercise.rir} onChange={event=>onChange({...exercise,rir:event.target.value})}/><small>left</small></label></div></div>; }

function ScheduleModal({open,onClose,preferences,onChange}) { const names=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]; return <Modal open={open} title="Workout schedule" onClose={onClose}><p className="modal-copy">เลือกวันที่วางแผนฝึก การตั้งค่านี้บันทึกในเครื่องและใช้กับ reminder</p><div className="day-picker">{names.map((name,index)=><button type="button" className={preferences.workoutDays.includes(index)?"active":""} aria-pressed={preferences.workoutDays.includes(index)} key={name} onClick={()=>onChange({...preferences,workoutDays:preferences.workoutDays.includes(index)?preferences.workoutDays.filter(day=>day!==index):[...preferences.workoutDays,index].sort()})}>{name}</button>)}</div></Modal>; }

function ComparePage({allLogs,allWorkouts,clock}) {
  const rows=Object.values(PROFILES).map(p=>({p,s:statsFor(allLogs[p.id],p),logs:allLogs[p.id]}));
  const baseline=rows.every(row=>row.logs.length<=1);
  const tied=rows[0].s.consistency===rows[1].s.consistency;
  const waistChange=row=>{const values=row.logs.filter(log=>log.waist!=null);return values.length>1?values[0].waist-values.at(-1).waist:null};
  return <><PageTitle eyebrow="SHARED CHALLENGE" title="Better together" note="Friendly competition ที่ให้คะแนนจาก consistency และ % การเปลี่ยนแปลง" action={<div className="week-nav">Week {clock.week} of 16</div>}/>
    <div className="leader-card"><div><Trophy size={25}/><span>WEEK {clock.week} · {baseline?"STARTING POINT":"REAL DATA"}</span><h2>{baseline?"Challenge starts here":"Both moving forward"}</h2><p>{baseline?"ทั้งคู่เริ่มต้นจากข้อมูลจริง คะแนน consistency จะเพิ่มเมื่อเริ่มบันทึกกิจวัตร":"วัดความสม่ำเสมออย่างเป็นธรรม โดยไม่ตัดสินจากน้ำหนักตัวอย่างเดียว"}</p></div><div className="podium">{rows.map(({p,s},i)=><div key={p.id}><span>{tied?"TIED":`#${i+1}`}</span><Avatar profile={p} large/><b>{p.name}</b><strong>{s.consistency}%</strong><small>consistency</small></div>)}</div></div>
    <section className="compare-table card"><div className="compare-head"><span>METRIC</span>{rows.map(({p})=><div key={p.id}><Avatar profile={p}/><b>{p.name}</b></div>)}</div>{[
      ["Body weight lost",r=>`${fmt1((r.s.lost/r.p.startWeight)*100)}%`,"ใช้ % เพื่อเทียบอย่างยุติธรรม"],
      ["Weight lost",r=>`${fmt1(r.s.lost)} kg`,"จากน้ำหนักเริ่มต้น"],
      ["Waist change",r=>{const value=waistChange(r);return value==null?"—":`${value>=0?"−":"+"}${fmt1(Math.abs(value))} cm`},"จากค่าที่วัดจริง"],
      ["Protein compliance",r=>r.logs.some(log=>log.protein!=null)?`${Math.round(pct(average(r.logs.slice(-7),"protein"),r.p.proteinMin))}%`:"—","ค่าเฉลี่ยรายการล่าสุด"],
      ["Steps compliance",r=>r.logs.some(log=>log.steps!=null)?`${Math.round(pct(average(r.logs.slice(-7),"steps"),r.p.stepsTarget))}%`:"—","ค่าเฉลี่ยรายการล่าสุด"],
      ["Workout sessions",r=>String(new Set([...(allWorkouts[r.p.id]||[]).map(item=>item.date),...r.logs.filter(log=>log.workout).map(log=>log.date)]).size),"จำนวนวันที่บันทึกจริง"],
    ].map(([label,get,note])=><div className="compare-line" key={label}><div><b>{label}</b><small>{note}</small></div>{rows.map(r=><strong key={r.p.id}>{get(r)}</strong>)}</div>)}</section>
    <section className="insight-wide"><Sparkles size={20}/><div><span>TEAM INSIGHT</span><h3>{baseline?"เริ่มจาก baseline ที่ชัดเจน":"Momentum กำลังมาถูกทาง"}</h3><p>{baseline?"Zackdark เริ่มที่ 87.8 kg และ Tony เริ่มที่ 95.5 kg — รอข้อมูลจริงก่อนสร้าง insight":"ทั้งคู่กำลังสร้างกิจวัตรที่สนับสนุนเป้าหมายระยะยาว"}</p></div></section>
  </>;
}

function ProfilePage({profile,store,setPage,onReset,onPreview,previewDemo,onImport,onSettings}) { const choose=(kind)=>{const input=document.createElement("input");input.type="file";input.accept=kind==="csv"?".csv,text/csv":".json,application/json";input.onchange=()=>input.files?.[0]&&onImport(input.files[0],kind);input.click()}; return <><PageTitle eyebrow="ACCOUNT & PLAN" title="Profile" note="Starting point และเป้าหมาย 16 สัปดาห์"/><section className="profile-layout"><div className="card profile-card"><Avatar profile={profile} large/><h2>{profile.name}</h2><p>Started 30 August 2026 · ข้อมูลเริ่มต้นจริง</p><div className="profile-numbers">{[["Start weight",`${profile.startWeight} kg`],["Main goal",`${profile.goalMin}–${profile.goalMax} kg`],["Body fat",`${profile.bodyFat}%`],["Muscle",`${profile.muscle} kg`],["BMR",`${profile.bmr} kcal`],["Visceral fat",profile.visceral]].map(([a,b])=><div key={a}><span>{a}</span><b>{b}</b></div>)}</div></div><div className="profile-stack"><div className="card settings-card"><h3>Daily targets</h3>{[["Calories",`${profile.calorieTarget.toLocaleString()} kcal`],["Protein",`${profile.proteinMin}–${profile.proteinMax} g`],["Water",`${profile.waterTarget} L`],["Steps",profile.stepsTarget.toLocaleString()],["Sleep","8 hours"]].map(([a,b])=><p key={a}><span>{a}</span><b>{b}</b></p>)}</div><div className="card settings-card"><h3>Data, sync & challenge</h3><button onClick={()=>setPage("compare")}><Users size={17}/> Zackdark vs Tony <ArrowRight size={15}/></button><button onClick={onSettings}><Wifi size={17}/> Sync & reminders <ArrowRight size={15}/></button><button onClick={()=>downloadFile("recomp-backup.json",JSON.stringify(store,null,2),"application/json")}><Download size={17}/> Export JSON backup <ArrowRight size={15}/></button><button onClick={()=>downloadFile("recomp-logs.csv",exportCsv(store.logs),"text/csv;charset=utf-8")}><Download size={17}/> Export CSV <ArrowRight size={15}/></button><button onClick={()=>choose("json")}><Upload size={17}/> Import JSON backup <ArrowRight size={15}/></button><button onClick={()=>choose("csv")}><Upload size={17}/> Import CSV <ArrowRight size={15}/></button><button className="danger-row" onClick={onReset}><RefreshCcw size={17}/> Reset to starting data <ArrowRight size={15}/></button><button onClick={onPreview}><Sparkles size={17}/> {previewDemo?"Exit demo preview":"Open isolated demo preview"} <ArrowRight size={15}/></button></div></div></section></> }

function Modal({open,title,onClose,children,footer}) { useEffect(()=>{if(!open)return;const close=event=>event.key==="Escape"&&onClose();window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close)},[open,onClose]); if(!open)return null; return <div className="modal-backdrop" role="presentation" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><section className="modal-card" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><h2>{title}</h2><IconButton label="ปิด" onClick={onClose}><X size={19}/></IconButton></div><div className="modal-body">{children}</div>{footer&&<div className="modal-footer">{footer}</div>}</section></div>; }

function SettingsModal({open,onClose,preferences,onPreferences,syncInfo,onRefreshSync,onMagicLink,onSignOut,onSync}) { const [email,setEmail]=useState(""),[message,setMessage]=useState(""); const toggle=key=>onPreferences({...preferences,[key]:!preferences[key]}); const send=async()=>{setMessage("กำลังส่ง…");try{await onMagicLink(email);setMessage("ส่งลิงก์เข้าสู่ระบบแล้ว กรุณาตรวจอีเมล")}catch(error){setMessage(error.message)}}; return <Modal open={open} title="Sync & reminders" onClose={onClose}><div className="settings-section"><span>REMINDERS</span><p className="modal-copy">ค่าที่เลือกจะเก็บไว้ในเครื่อง ปัจจุบันยังไม่มีระบบ push เบื้องหลัง จึงไม่อ้างว่าส่งเตือนเมื่อปิดแอป</p>{[["morningWeighIn","Morning weigh-in"],["proteinReminder","Protein reminder"],["workoutReminder","Workout reminder"],["weeklyReview","Weekly review"]].map(([key,label])=><button type="button" className="switch-row" onClick={()=>toggle(key)} key={key}><span>{label}</span><i className={preferences[key]?"on":""}><b/></i></button>)}</div><div className="settings-section"><span>DATA SYNC</span>{!syncInfo.configured?<div className="sync-state"><Wifi size={18}/><div><b>Local-only</b><p>ยังไม่ได้ตั้งค่า VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY บน Vercel ข้อมูลจริงยังอยู่ใน browser นี้เท่านั้น</p></div></div>:syncInfo.session?<><div className="sync-state online"><Wifi size={18}/><div><b>{syncInfo.session.user.email}</b><p>เชื่อมบัญชีแล้ว · Sync ทำเมื่อกดปุ่ม เพื่อให้ผู้ใช้ควบคุมข้อมูล</p></div></div><div className="modal-actions"><button className="primary-btn" onClick={async()=>setMessage(await onSync())}>Sync {profileLabel(syncInfo)}</button><button className="secondary-btn" onClick={onSignOut}>Sign out</button></div></>:<><p className="modal-copy">ใช้ magic link เพื่อเชื่อมกับ Supabase ที่ตั้งค่าไว้</p><label className="email-field"><Mail size={17}/><input type="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="you@example.com"/></label><button className="primary-btn full" onClick={send} disabled={!email.includes("@")}>Send magic link</button></>}<button className="text-btn" onClick={onRefreshSync}>Refresh connection</button>{message&&<p className="settings-message">{message}</p>}</div></Modal>; }
const profileLabel=syncInfo=>syncInfo.profileName||"current profile";

export default function HealthApp() {
  const validPages=[...nav.map(item=>item[0]),"compare"], pageFromHash=()=>validPages.includes(location.hash.slice(1))?location.hash.slice(1):"dashboard";
  const [page,setPageState]=useState(pageFromHash), [profileId,setProfileId]=useState("zackdark"), [dark,setDark]=useState(()=>localStorage.getItem("recomp-theme")==="dark");
  const [store,setStore]=useState(loadStore), [previewDemo,setPreviewDemo]=useState(false), [settingsOpen,setSettingsOpen]=useState(false), [resetOpen,setResetOpen]=useState(false), [toast,setToast]=useState("");
  const [syncInfo,setSyncInfo]=useState({configured:supabaseConfigured,session:null,status:""});
  const clock=challengeClock(bangkokToday());
  const demoStore=useMemo(()=>({...initialStore(),logs:{zackdark:makeDemoLogs("zackdark"),tony:makeDemoLogs("tony")}}),[]);
  const activeStore=previewDemo?demoStore:store, allLogs=activeStore.logs, profile=PROFILES[profileId], logs=allLogs[profileId], workouts=activeStore.workouts[profileId]||[];
  const setPage=next=>{setPageState(next);if(location.hash!==`#${next}`)history.replaceState(null,"",`#${next}`)};
  useEffect(()=>{document.documentElement.dataset.recompTheme=dark?"dark":"light";localStorage.setItem("recomp-theme",dark?"dark":"light")},[dark]);
  useEffect(()=>saveStore(store),[store]);
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
  const saveLog=input=>{if(previewDemo){flash("ออกจาก Demo preview ก่อนบันทึกข้อมูลจริง");return false}setStore(current=>upsertProfileLog(current,profileId,input));flash(`บันทึก ${format(parseISO(input.date),"d MMM")} แล้ว`);return true};
  const saveWorkout=session=>{if(previewDemo){flash("ออกจาก Demo preview ก่อนบันทึก Workout");return false}setStore(current=>{const withLog=upsertProfileLog(current,profileId,{...(current.logs[profileId].find(log=>log.date===session.date)||{}),date:session.date,workout:true});return {...withLog,workouts:{...withLog.workouts,[profileId]:[...(withLog.workouts[profileId]||[]).filter(item=>!(item.date===session.date&&item.type===session.type)),session]}}});flash("บันทึก Workout แล้ว");return true};
  const updatePreferences=preferences=>setStore(current=>({...current,preferences}));
  const refreshSync=async()=>{try{const result=await getSyncSession();setSyncInfo(current=>({...current,...result,profileName:profile.name}))}catch(error){setSyncInfo(current=>({...current,status:error.message}))}};
  const importFile=async(file,kind)=>{try{const text=await file.text();if(kind==="csv"){const rows=importCsv(text);setStore(current=>rows.reduce((next,row)=>upsertProfileLog(next,row.profileId,row),current));flash(`นำเข้า CSV ${rows.length} รายการแล้ว`)}else{const parsed=JSON.parse(text), imported=parsed.logs||parsed;if(!Array.isArray(imported.zackdark)||!Array.isArray(imported.tony))throw new Error("JSON backup ไม่มี logs ของทั้งสอง profile");setStore(current=>({...current,...(parsed.logs?parsed:{}),logs:{zackdark:imported.zackdark,tony:imported.tony},preferences:{...current.preferences,...(parsed.preferences||{})},workouts:{...current.workouts,...(parsed.workouts||{})}}));flash("นำเข้า JSON backup แล้ว")}}catch(error){flash(`นำเข้าไม่สำเร็จ: ${error.message}`)}};
  const confirmReset=()=>{setStore(initialStore());setPreviewDemo(false);setResetOpen(false);flash("รีเซ็ตกลับเป็นข้อมูลเริ่มต้นจริงแล้ว")};
  const togglePreview=()=>{setPreviewDemo(value=>!value);setPage("dashboard")};
  const syncNow=async()=>{try{const count=await syncProfileLogs(profile,store.logs[profileId],store.workouts[profileId]);return `Sync ${count.logs} logs และ ${count.workouts} workouts แล้ว`}catch(error){return `Sync ไม่สำเร็จ: ${error.message}`}};
  let content=page==="dashboard"?<Dashboard profile={profile} logs={logs} allLogs={allLogs} workouts={workouts} setPage={setPage} clock={clock}/>:page==="log"?<LogPage key={profileId} profile={profile} logs={logs} onSave={saveLog} clock={clock}/>:page==="progress"?<ProgressPage key={profileId} profile={profile} logs={logs} clock={clock}/>:page==="workout"?<WorkoutPage key={profileId} profile={profile} workouts={workouts} onSave={saveWorkout} clock={clock} preferences={store.preferences} onPreferences={updatePreferences}/>:page==="compare"?<ComparePage allLogs={allLogs} allWorkouts={activeStore.workouts} clock={clock}/>:<ProfilePage profile={profile} store={store} setPage={setPage} onReset={()=>setResetOpen(true)} onPreview={togglePreview} previewDemo={previewDemo} onImport={importFile} onSettings={()=>{setSettingsOpen(true);refreshSync()}}/>;
  return <div className="recomp-app"><Sidebar page={page} setPage={setPage} dark={dark} setDark={setDark} clock={clock} previewDemo={previewDemo}/><div className="app-column"><Topbar profileId={profileId} setProfileId={setProfileId} profile={profile} dark={dark} setDark={setDark} clock={clock} onNotifications={()=>{setSettingsOpen(true);refreshSync()}} syncOnline={Boolean(syncInfo.session)}/>{previewDemo&&<div className="preview-banner"><Sparkles size={16}/><span>Demo preview · ข้อมูลชุดนี้แยกจากข้อมูลจริงและจะไม่ถูกบันทึก</span><button onClick={togglePreview}>Exit preview</button></div>}<main>{content}</main></div><MobileNav page={page} setPage={setPage}/>{toast&&<div className="toast" role="status">{toast}</div>}<SettingsModal open={settingsOpen} onClose={()=>setSettingsOpen(false)} preferences={store.preferences} onPreferences={updatePreferences} syncInfo={{...syncInfo,profileName:profile.name}} onRefreshSync={refreshSync} onMagicLink={requestMagicLink} onSignOut={async()=>{await signOutSync();refreshSync()}} onSync={syncNow}/><Modal open={resetOpen} title="Reset all real data?" onClose={()=>setResetOpen(false)} footer={<><button className="secondary-btn" onClick={()=>setResetOpen(false)}>Cancel</button><button className="danger-btn" onClick={confirmReset}>Reset data</button></>}><p className="modal-copy">รายการบันทึกและ Workout ใน browser นี้จะกลับไปเหลือเฉพาะข้อมูลเริ่มต้นวันที่ 30 สิงหาคม 2026 กรุณา Export backup ก่อนหากต้องการเก็บข้อมูลไว้</p></Modal></div>;
}
