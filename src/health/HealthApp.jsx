import { useEffect, useMemo, useState } from "react";
import { eachDayOfInterval, endOfMonth, format, getDay, parseISO, startOfMonth } from "date-fns";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Activity, ArrowDown, ArrowRight, Award, BarChart3, BedDouble, Bell, CalendarDays,
  Check, ChevronDown, ChevronLeft, ChevronRight, CircleUserRound, ClipboardPlus, Download,
  Droplets, Dumbbell, Flame, Footprints, Gauge, Home, Info, Moon, Plus, RefreshCcw,
  Scale, Settings2, Sparkles, Sun, Target, TrendingDown, Trophy, Utensils, Users, X, Zap,
} from "lucide-react";
import { z } from "zod";
import { makeDemoLogs, MILESTONES, PHASES, PROFILES, WORKOUTS } from "./data.js";
import "./health.css";

const STORE = "recomp-health-demo-v1";
const nav = [
  ["dashboard","Overview",Home], ["log","Quick log",Plus], ["progress","Progress",BarChart3],
  ["workout","Workout",Dumbbell], ["profile","Profile",CircleUserRound],
];

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const average = (items, key) => items.length ? items.reduce((sum, x) => sum + number(x[key]), 0) / items.length : 0;
const pct = (value, target) => Math.min(100, Math.max(0, (number(value) / number(target, 1)) * 100));
const fmt1 = (v) => number(v).toFixed(1);

function rolling(logs) {
  return logs.map((item, i) => {
    const slice = logs.slice(Math.max(0, i - 6), i + 1).filter(x => x.weight);
    return { ...item, label:format(parseISO(item.date),"d MMM"), avg7:+average(slice,"weight").toFixed(2) };
  });
}

function statsFor(logs, profile) {
  const weighted = logs.filter(x => x.weight);
  const latest = weighted.at(-1) || { weight:profile.startWeight };
  const current7 = weighted.slice(-7);
  const previous7 = weighted.slice(-14,-7);
  const avg7 = average(current7,"weight") || profile.startWeight;
  const prev = average(previous7,"weight") || profile.startWeight;
  const weeklyLoss = prev - avg7;
  const lost = profile.startWeight - latest.weight;
  const progress = pct(lost, profile.startWeight - profile.goalMax);
  const consistency = Math.round(average(logs.slice(-7).map(x => ({ score:dailyScore(x,profile) })),"score"));
  return { latest, avg7, prev, weeklyLoss, lost, progress, consistency };
}

function dailyScore(log, p) {
  if (!log) return 0;
  const calorieOk = log.calories >= p.calorieTarget*.85 && log.calories <= p.calorieTarget*1.1;
  return Math.round((calorieOk?20:10) + Math.min(25,pct(log.protein,p.proteinMin)*.25) + Math.min(15,pct(log.steps,p.stepsTarget)*.15) + (log.workout?20:12) + Math.min(5,pct(log.water,p.waterTarget)*.05) + Math.min(15,pct(log.sleep,480)*.15));
}

function coaching(stats) {
  if (stats.weeklyLoss > 1) return { label:"Ahead", tone:"amber", text:"น้ำหนักลดค่อนข้างเร็ว ลองเช็ก recovery, food intake และ training performance" };
  if (stats.weeklyLoss >= .5) return { label:"On track", tone:"green", text:"กำลังดี ไม่ต้องปรับ Calories รักษาความสม่ำเสมอแบบนี้ต่อไป" };
  if (stats.weeklyLoss < .4) return { label:"Slightly behind", tone:"blue", text:"เช็ก Calories, Steps และ Weekend อีก 1 สัปดาห์ก่อนพิจารณาปรับ" };
  return { label:"On track", tone:"green", text:"ทิศทางดีและอยู่ในช่วงเป้าหมาย" };
}

function IconButton({ children, label, onClick, className="" }) {
  return <button className={`icon-btn ${className}`} aria-label={label} onClick={onClick}>{children}</button>;
}

function Brand() {
  return <div className="brand"><div className="brand-mark"><TrendingDown size={18}/></div><div><strong>recomp</strong><span>16 week protocol</span></div></div>;
}

function Sidebar({ page, setPage, dark, setDark }) {
  return <aside className="sidebar">
    <Brand/>
    <nav>{nav.map(([id,label,Icon]) => <button key={id} className={page===id?"active":""} onClick={()=>setPage(id)}><Icon size={19}/><span>{label}</span>{id==="log"&&<kbd>N</kbd>}</button>)}</nav>
    <div className="side-challenge">
      <div className="mini-icon"><Sparkles size={17}/></div><strong>Shared challenge</strong>
      <p>Week 2 is looking strong. Keep each other moving.</p>
      <button onClick={()=>setPage("compare")}>View comparison <ArrowRight size={14}/></button>
    </div>
    <button className="theme-row" onClick={()=>setDark(!dark)}>{dark?<Sun size={18}/>:<Moon size={18}/>} {dark?"Light mode":"Dark mode"}</button>
  </aside>;
}

function Topbar({ profileId, setProfileId, profile, dark, setDark }) {
  const [open,setOpen]=useState(false);
  return <header className="topbar">
    <div className="mobile-brand"><Brand/></div>
    <div className="page-kicker">16 WEEK RECOMPOSITION <span>•</span> WEEK 2 OF 16</div>
    <div className="top-actions">
      <IconButton label="สลับธีม" onClick={()=>setDark(!dark)} className="desktop-theme">{dark?<Sun size={18}/>:<Moon size={18}/>}</IconButton>
      <IconButton label="การแจ้งเตือน"><Bell size={18}/><i/></IconButton>
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

function Dashboard({ profile, logs, allLogs, setPage }) {
  const s=statsFor(logs,profile), coach=coaching(s), today=logs.at(-1);
  const daysLeft=112-logs.length;
  const targets=[
    {icon:Utensils,label:"Calories",value:today.calories,target:profile.calorieTarget,unit:"kcal",color:"#5c7cdb"},
    {icon:Zap,label:"Protein",value:today.protein,target:profile.proteinMin,unit:"g",color:"#bd7a2d"},
    {icon:Droplets,label:"Water",value:today.water,target:profile.waterTarget,unit:"L",color:"#2e9eb8"},
    {icon:Footprints,label:"Steps",value:today.steps,target:profile.stepsTarget,unit:"",color:"#1f9d6a"},
    {icon:BedDouble,label:"Sleep",value:today.sleep,target:480,display:`${Math.floor(today.sleep/60)}h ${today.sleep%60}m`,targetDisplay:"8h",unit:"",color:"#8d67bb"},
    {icon:Dumbbell,label:"Workout",value:today.workout?1:0,target:1,display:today.workout?"Workout A ✓":"Rest day",targetDisplay:"Planned",unit:"",color:"#d06558"},
  ];
  return <>
    <PageTitle eyebrow="GOOD MORNING" title={`Ready when you are, ${profile.name}.`} note={`${daysLeft} days left · Phase 1 — Build habit`} action={<button className="primary-btn" onClick={()=>setPage("log")}><Plus size={17}/> Quick log</button>}/>
    <section className="dashboard-grid">
      <div className="weight-hero card">
        <div className="card-head"><span><Scale size={17}/> WEIGHT PROGRESS</span><button onClick={()=>setPage("progress")}>View details <ArrowRight size={14}/></button></div>
        <div className="hero-main"><div><p>Current weight</p><h2>{fmt1(s.latest.weight)}<small> kg</small></h2><div className={`status ${coach.tone}`}><i/> {coach.label}</div></div><Ring value={s.progress}><b>{Math.round(s.progress)}%</b><small>to goal</small></Ring></div>
        <ProgressBar value={s.progress}/>
        <div className="weight-summary"><div><span>Starting</span><b>{profile.startWeight} kg</b></div><div><span>Total lost</span><b className="green-text"><ArrowDown size={13}/>{fmt1(s.lost)} kg</b></div><div><span>Goal range</span><b>{profile.goalMin}–{profile.goalMax} kg</b></div></div>
      </div>
      <div className="consistency-card card"><div className="card-head"><span><Gauge size={17}/> CONSISTENCY</span><span>This week</span></div><div className="score-row"><Ring value={s.consistency} color="#1f9d6a"><b>{s.consistency}</b><small>/ 100</small></Ring><div><h3>Strong week</h3><p>คุณทำเป้าหมายหลักได้ดี<br/>5 จาก 6 habits</p></div></div><div className="micro-bars">{[["Protein",93],["Steps",88],["Sleep",82]].map(x=><div key={x[0]}><span>{x[0]}</span><ProgressBar value={x[1]}/><b>{x[1]}%</b></div>)}</div></div>
    </section>

    <div className="section-heading"><div><p>TODAY · 12 SEP</p><h2>Today's targets</h2></div><span>4 of 6 looking good</span></div>
    <section className="target-grid">{targets.map(({icon:Icon,...x})=><div className="target-card card" style={{"--target-color":x.color}} key={x.label}><div className="target-icon" style={{color:x.color,background:`${x.color}18`}}><Icon size={19}/></div><div><span>{x.label}</span><b>{x.display||x.value.toLocaleString()} <small>/ {x.targetDisplay||x.target.toLocaleString()} {x.unit}</small></b><ProgressBar value={pct(x.value,x.target)} color="custom"/></div><strong>{Math.round(pct(x.value,x.target))}%</strong></div>)}</section>
    <section className="lower-grid">
      <div className="trend-card card"><div className="card-head"><div><span>WEIGHT TREND</span><h3>Steady progress</h3></div><div className="chart-legend"><i/> Daily <i className="avg"/> 7-day avg</div></div><WeightChart logs={logs} compact/><div className="trend-stats"><div><span>7-day average</span><b>{fmt1(s.avg7)} kg</b></div><div><span>Previous week</span><b>{fmt1(s.prev)} kg</b></div><div><span>Weekly change</span><b className="green-text">−{fmt1(s.weeklyLoss)} kg</b></div></div></div>
      <div className="stack-column">
        <div className="insight-card card"><div className="insight-icon"><Sparkles size={18}/></div><div><span>COACHING INSIGHT</span><h3>{coach.label}</h3><p>{coach.text}</p><button onClick={()=>setPage("progress")}>ดูข้อมูลประกอบ <ArrowRight size={14}/></button></div></div>
        <WorkoutMini setPage={setPage}/>
      </div>
    </section>
    <ComparisonMini allLogs={allLogs} setPage={setPage}/>
    <Roadmap/>
  </>;
}

function WorkoutMini({setPage}) { return <div className="workout-mini card"><div className="date-block"><b>14</b><span>SEP</span></div><div><span>NEXT WORKOUT</span><h3>Full Body · Workout A</h3><p>6 exercises · ~55 min</p></div><button onClick={()=>setPage("workout")}><ArrowRight size={18}/></button></div>; }

function ComparisonMini({allLogs,setPage}) {
  const rows=Object.values(PROFILES).map(p=>({p,s:statsFor(allLogs[p.id],p)}));
  return <section className="compare-mini card"><div className="card-head"><div><span><Users size={17}/> SHARED CHALLENGE</span><h3>Better together</h3></div><button onClick={()=>setPage("compare")}>Full comparison <ArrowRight size={14}/></button></div><div className="compare-rows">{rows.map(({p,s},i)=><div className="compare-person" key={p.id}><div className="rank">{i+1}</div><Avatar profile={p}/><div className="person-info"><b>{p.name}</b><span>{s.consistency}% consistency</span></div><div className="person-loss"><b>−{fmt1((s.lost/p.startWeight)*100)}%</b><span>body weight</span></div><ProgressBar value={s.consistency}/></div>)}</div><p className="friendly"><Trophy size={15}/> ทั้งคู่กำลังสร้าง momentum ได้ดี — วัดจากความสม่ำเสมอ ไม่ใช่แค่ตัวเลขบนตาชั่ง</p></section>;
}

function Roadmap() { return <section><div className="section-heading"><div><p>THE BIG PICTURE</p><h2>16-week roadmap</h2></div><span>Phase 1 in progress</span></div><div className="phase-grid">{PHASES.map((p,i)=><div className={`phase-card ${i===0?"active":""}`} key={p.n}><div><span>{p.n}</span>{i===0&&<b>NOW</b>}</div><small>{p.weeks}</small><h3>{p.title}</h3><p>{p.note}</p><em>{p.meta}</em></div>)}</div></section>; }

const logSchema=z.object({weight:z.coerce.number().min(30).max(300).optional(),calories:z.coerce.number().min(0).max(10000).optional(),protein:z.coerce.number().min(0).max(1000).optional()});

function LogPage({profile,logs,onSave}) {
  const last=logs.at(-1); const [saved,setSaved]=useState(false);
  const [form,setForm]=useState(()=>({date:"2026-09-13",weight:last.weight,calories:"",protein:"",carbs:"",fat:"",water:profile.waterTarget,steps:"",sleepHours:7,sleepMinutes:30,waist:last.waist,bodyFat:last.bodyFat,muscle:last.muscle,visceral:last.visceral,mood:"good",hunger:3,energy:4,notes:""}));
  const set=(key,val)=>setForm(f=>({...f,[key]:val}));
  const submit=(e)=>{e.preventDefault();const checked=logSchema.safeParse(form);if(!checked.success)return;onSave({...form,sleep:number(form.sleepHours)*60+number(form.sleepMinutes),workout:false});setSaved(true);setTimeout(()=>setSaved(false),2200)};
  return <>
    <PageTitle eyebrow="DAILY CHECK-IN" title="Quick log" note="เฉพาะสิ่งที่มีวันนี้ก็พอ · ใช้เวลาประมาณ 45 วินาที" action={<div className="save-state">{saved&&<><Check size={16}/> Saved offline</>}</div>}/>
    <div className="quick-actions">{[[Scale,"Weight"],[Utensils,"Meal"],[Droplets,"Water"],[Dumbbell,"Workout"],[Footprints,"Steps"]].map(([Icon,label])=><button type="button" key={label}><Icon size={16}/>{label}</button>)}</div>
    <form className="log-layout" onSubmit={submit}>
      <div className="log-main">
        <div className="log-card card featured-input"><div className="log-card-title"><div className="field-icon green"><Scale size={19}/></div><div><span>WEIGHT</span><h3>Morning weigh-in</h3></div><div className="date-chip"><CalendarDays size={14}/>{format(parseISO(form.date),"d MMM")}</div></div><div className="big-input"><button type="button" onClick={()=>set("weight",+(number(form.weight)-.1).toFixed(1))}>−</button><label><input type="number" inputMode="decimal" step="0.1" value={form.weight} onChange={e=>set("weight",e.target.value)}/><span>kg</span></label><button type="button" onClick={()=>set("weight",+(number(form.weight)+.1).toFixed(1))}>+</button></div><div className="yesterday"><span>Yesterday <b>{last.weight} kg</b></span><span className="green-text"><ArrowDown size={13}/> {Math.abs(number(form.weight)-last.weight).toFixed(1)} kg</span></div></div>
        <LogSection icon={Utensils} title="Nutrition" note={`Target ${profile.calorieTarget.toLocaleString()} kcal · ${profile.proteinMin}–${profile.proteinMax} g protein`}>
          <Field label="Calories" unit="kcal" value={form.calories} onChange={v=>set("calories",v)} placeholder={profile.calorieTarget}/><Field label="Protein" unit="g" value={form.protein} onChange={v=>set("protein",v)} placeholder={profile.proteinMin}/><Field label="Carbs" unit="g" value={form.carbs} onChange={v=>set("carbs",v)} placeholder="Optional"/><Field label="Fat" unit="g" value={form.fat} onChange={v=>set("fat",v)} placeholder="Optional"/>
        </LogSection>
        <LogSection icon={Activity} title="Daily activity" note="Movement, hydration & recovery">
          <Field label="Water" unit="L" value={form.water} onChange={v=>set("water",v)} step="0.1"/><Field label="Steps" unit="steps" value={form.steps} onChange={v=>set("steps",v)} placeholder={profile.stepsTarget}/><Field label="Sleep hours" unit="hr" value={form.sleepHours} onChange={v=>set("sleepHours",v)}/><Field label="Minutes" unit="min" value={form.sleepMinutes} onChange={v=>set("sleepMinutes",v)}/>
        </LogSection>
        <LogSection icon={Gauge} title="Body composition" note="Optional · add only when measured">
          <Field label="Waist" unit="cm" value={form.waist} onChange={v=>set("waist",v)} step="0.1"/><Field label="Body fat" unit="%" value={form.bodyFat} onChange={v=>set("bodyFat",v)} step="0.1"/><Field label="Muscle" unit="kg" value={form.muscle} onChange={v=>set("muscle",v)} step="0.01"/><Field label="Visceral fat" unit="" value={form.visceral} onChange={v=>set("visceral",v)}/>
        </LogSection>
        <div className="log-card card"><div className="log-card-title"><div className="field-icon lilac"><Sparkles size={19}/></div><div><span>HOW YOU FEEL</span><h3>Check in with yourself</h3></div></div><div className="feel-row"><Score label="Hunger" value={form.hunger} onChange={v=>set("hunger",v)}/><Score label="Energy" value={form.energy} onChange={v=>set("energy",v)}/></div><label className="notes"><span>Notes <small>Optional</small></span><textarea value={form.notes} onChange={e=>set("notes",e.target.value)} placeholder="Training felt strong, dinner out, rest day…"/></label></div>
      </div>
      <aside className="log-side"><div className="card log-summary"><span>TODAY'S LOG</span><h3>Almost there</h3><div>{[["Weight",form.weight&&`${form.weight} kg`],["Nutrition",form.calories?`${form.calories} kcal`:"Not added"],["Activity",form.steps?`${form.steps} steps`:"Not added"],["Recovery",`${form.sleepHours}h ${form.sleepMinutes}m`]].map(([a,b])=><p key={a}><i className={b==="Not added"?"empty":""}>{b!=="Not added"&&<Check size={12}/>}</i><span>{a}<small>{b}</small></span></p>)}</div><button className="primary-btn full" type="submit">Save daily log <Check size={17}/></button><small>ข้อมูลบันทึกในเครื่องได้แม้ออฟไลน์</small></div></aside>
    </form>
  </>;
}

function LogSection({icon:Icon,title,note,children}) { return <div className="log-card card"><div className="log-card-title"><div className="field-icon blue"><Icon size={19}/></div><div><span>DAILY LOG</span><h3>{title}</h3><p>{note}</p></div></div><div className="field-grid">{children}</div></div>; }
function Field({label,unit,value,onChange,placeholder,step="1"}) { return <label className="field"><span>{label}</span><div><input type="number" inputMode="decimal" step={step} value={value} onChange={e=>onChange(e.target.value)} placeholder={String(placeholder||"")}/><em>{unit}</em></div></label>; }
function Score({label,value,onChange}) { return <div className="score-field"><span>{label}<b>{value}/5</b></span><div>{[1,2,3,4,5].map(n=><button type="button" className={value===n?"active":""} key={n} onClick={()=>onChange(n)}>{n}</button>)}</div></div>; }

function ProgressPage({profile,logs}) {
  const [range,setRange]=useState("30 days"), [metric,setMetric]=useState("weight"); const s=statsFor(logs,profile); const chart=rolling(logs);
  return <><PageTitle eyebrow="YOUR DATA" title="Progress" note="ดูแนวโน้ม ไม่ตัดสินจากตัวเลขวันเดียว" action={<button className="secondary-btn"><Download size={16}/> Export</button>}/>
    <div className="range-tabs">{["7 days","30 days","8 weeks","16 weeks"].map(x=><button className={range===x?"active":""} onClick={()=>setRange(x)} key={x}>{x}</button>)}</div>
    <section className="progress-kpis">{[["Current",`${fmt1(s.latest.weight)} kg`,"ล่าสุด"],["7-day average",`${fmt1(s.avg7)} kg`,`−${fmt1(s.weeklyLoss)} this week`],["Total lost",`${fmt1(s.lost)} kg`,`${Math.round(s.progress)}% to goal`],["Waist change",`−${fmt1(logs[0].waist-logs.at(-1).waist)} cm`,"Positive progress"]].map(([a,b,c])=><div className="card" key={a}><span>{a}</span><h3>{b}</h3><small>{c}</small></div>)}</section>
    <section className="card chart-panel"><div className="card-head"><div><span>ACTUAL TREND</span><h3>Weight trend</h3></div><div className="chart-legend"><i/> Daily <i className="avg"/> 7-day avg</div></div><WeightChart logs={logs}/><div className="chart-note"><Info size={15}/> 7-day average ช่วยลดผลจากน้ำ โซเดียม และความผันผวนรายวัน</div></section>
    <section className="progress-split"><div className="card metric-chart"><div className="card-head"><div><span>BODY COMPOSITION</span><h3>{metric==="weight"?"Waist & body fat":"Muscle mass"}</h3></div><select value={metric} onChange={e=>setMetric(e.target.value)}><option value="weight">Waist / Body fat</option><option value="muscle">Muscle mass</option></select></div><ResponsiveContainer width="100%" height={260}><LineChart data={chart}><CartesianGrid vertical={false} strokeDasharray="3 7" stroke="var(--line)"/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{fill:"var(--muted)",fontSize:11}}/><YAxis axisLine={false} tickLine={false} tick={{fill:"var(--muted)",fontSize:11}} domain={["dataMin - 1","dataMax + 1"]}/><Tooltip contentStyle={{background:"var(--card)",border:"1px solid var(--line)",borderRadius:12}}/>{metric==="weight"?<><Line dataKey="waist" stroke="#5478d4" strokeWidth={2.5} dot={false}/><Line dataKey="bodyFat" stroke="#bd7a2d" strokeWidth={2.5} dot={false}/></>:<Line dataKey="muscle" stroke="#1f9d6a" strokeWidth={2.5} dot={false}/>}</LineChart></ResponsiveContainer></div><MilestoneChart profile={profile}/></section>
    <WeeklyReview profile={profile} logs={logs}/>
    <CalendarCard profile={profile} logs={logs}/>
  </>;
}

function CalendarCard({profile,logs}) {
  const month=new Date(2026,8,1), days=eachDayOfInterval({start:startOfMonth(month),end:endOfMonth(month)}), first=getDay(days[0]);
  const byDate=Object.fromEntries(logs.map(x=>[x.date,x]));
  return <section className="calendar-card card"><div className="card-head"><div><span>DAILY CONSISTENCY</span><h3>September 2026</h3></div><div className="calendar-key"><i className="good"/>Good <i className="partial"/>Partial <i className="low"/>Low</div></div><div className="calendar-grid">{["S","M","T","W","T","F","S"].map((x,i)=><b key={i}>{x}</b>)}{Array.from({length:first}).map((_,i)=><span key={`empty-${i}`}/>)}{days.map(day=>{const key=format(day,"yyyy-MM-dd"),log=byDate[key],score=log?dailyScore(log,profile):null;return <button key={key} className={score==null?"":score>=80?"good":score>=55?"partial":"low"}><span>{format(day,"d")}</span>{score!=null&&<i/>}</button>})}</div></section>;
}

function MilestoneChart({profile}) { return <div className="card metric-chart"><div className="card-head"><div><span>16-WEEK PATH</span><h3>Target milestones</h3></div><Target size={20}/></div><ResponsiveContainer width="100%" height={260}><AreaChart data={MILESTONES[profile.id]}><CartesianGrid vertical={false} strokeDasharray="3 7" stroke="var(--line)"/><XAxis dataKey="w" tickFormatter={v=>`W${v}`} axisLine={false} tickLine={false} tick={{fill:"var(--muted)",fontSize:11}}/><YAxis domain={["dataMin - 2","dataMax + 2"]} axisLine={false} tickLine={false} tick={{fill:"var(--muted)",fontSize:11}}/><Tooltip labelFormatter={v=>`Week ${v}`} formatter={v=>[`${v} kg`,`Target midpoint`]}/><Area dataKey="v" stroke="#1f9d6a" fill="url(#weightFill)" strokeWidth={3}/></AreaChart></ResponsiveContainer></div>; }

function WeeklyReview({profile,logs}) { const x=logs.slice(-7), prev=logs.slice(-14,-7); const loss=average(prev,"weight")-average(x,"weight"); return <section className="weekly-review card"><div className="review-top"><div className="trophy-icon"><Award size={23}/></div><div><span>WEEK 2 REVIEW</span><h2>A consistent week, {profile.name}</h2><p>น้ำหนักเฉลี่ยลด {fmt1(loss)} kg พร้อมรักษา training consistency ได้ดี แนะนำให้คง Calories เดิม</p></div><button className="secondary-btn">Open review <ArrowRight size={15}/></button></div><div className="review-stats">{[["Average weight",`${fmt1(average(x,"weight"))} kg`],["Avg calories",`${Math.round(average(x,"calories")).toLocaleString()} kcal`],["Protein goal","6 / 7 days"],["Avg steps",Math.round(average(x,"steps")).toLocaleString()],["Workouts","3 / 3"],["Avg sleep",`${Math.floor(average(x,"sleep")/60)}h ${Math.round(average(x,"sleep")%60)}m`]].map(([a,b])=><div key={a}><span>{a}</span><b>{b}</b></div>)}</div></section>; }

function WorkoutPage() {
  const [type,setType]=useState("A"), [completed,setCompleted]=useState([]);
  return <><PageTitle eyebrow="TRAINING" title="Workout tracker" note="Full body · 3 sessions per week" action={<button className="secondary-btn"><CalendarDays size={16}/> Schedule</button>}/>
    <div className="workout-tabs"><button className={type==="A"?"active":""} onClick={()=>setType("A")}><b>A</b><span>Workout A<small>Squat · Push · Pull</small></span></button><button className={type==="B"?"active":""} onClick={()=>setType("B")}><b>B</b><span>Workout B<small>Hinge · Row · Press</small></span></button></div>
    <section className="workout-layout"><div><div className="workout-banner"><div><span>TODAY'S SESSION</span><h2>Full Body · Workout {type}</h2><p>6 exercises · 18 working sets · ~55 min</p></div><Ring value={completed.length/6*100}><b>{completed.length}</b><small>of 6</small></Ring></div><div className="exercise-list">{WORKOUTS[type].map(([name,scheme,weight],i)=><Exercise key={name} index={i+1} name={name} scheme={scheme} weight={weight} done={completed.includes(i)} toggle={()=>setCompleted(c=>c.includes(i)?c.filter(x=>x!==i):[...c,i])}/>)}</div></div><aside><div className="card workout-tip"><Sparkles size={19}/><span>PROGRESSION TIP</span><h3>Own the rep range</h3><p>ถ้าทำถึง upper rep range ครบทุก set โดยเหลือ 1–2 RIR ครั้งหน้าลองเพิ่มน้ำหนัก 2.5 kg</p></div><div className="card strength-card"><span>STRENGTH TREND</span><h3>Chest Press</h3><b>40 <small>→</small> 50 kg</b><ResponsiveContainer width="100%" height={120}><LineChart data={[40,42.5,42.5,45,47.5,50].map((v,i)=>({i,v}))}><Line dataKey="v" stroke="#1f9d6a" strokeWidth={3} dot={false}/><YAxis hide domain={[35,55]}/></LineChart></ResponsiveContainer></div></aside></section>
  </>;
}

function Exercise({index,name,scheme,weight,done,toggle}) { const [reps,setReps]=useState([12,12,12]); return <div className={`exercise card ${done?"done":""}`}><button className="check-btn" onClick={toggle}>{done?<Check size={17}/>:index}</button><div className="exercise-name"><span>{scheme}</span><h3>{name}</h3><p>{weight?`${weight} kg working weight`:"Bodyweight"}</p></div><div className="sets">{reps.map((r,i)=><label key={i}><span>SET {i+1}</span><input type="number" value={r} onChange={e=>setReps(x=>x.map((a,n)=>n===i?e.target.value:a))}/><small>reps</small></label>)}<label><span>RIR</span><input type="number" defaultValue="2"/><small>left</small></label></div><button className="exercise-more"><Settings2 size={17}/></button></div>; }

function ComparePage({allLogs}) {
  const rows=Object.values(PROFILES).map(p=>({p,s:statsFor(allLogs[p.id],p),logs:allLogs[p.id]}));
  return <><PageTitle eyebrow="SHARED CHALLENGE" title="Better together" note="Friendly competition ที่ให้คะแนนจาก consistency และ % การเปลี่ยนแปลง" action={<div className="week-nav"><ChevronLeft size={16}/> Week 2 <ChevronRight size={16}/></div>}/>
    <div className="leader-card"><div><Trophy size={25}/><span>WEEK 2 LEADERBOARD</span><h2>Both moving forward</h2><p>คะแนนห่างกันเพียง 2% — สัปดาห์ที่สม่ำเสมอสำหรับทั้งคู่</p></div><div className="podium">{rows.map(({p,s},i)=><div key={p.id} className={i===1?"winner":""}><span>#{i+1}</span><Avatar profile={p} large/><b>{p.name}</b><strong>{s.consistency}%</strong><small>consistency</small></div>)}</div></div>
    <section className="compare-table card"><div className="compare-head"><span>METRIC</span>{rows.map(({p})=><div key={p.id}><Avatar profile={p}/><b>{p.name}</b></div>)}</div>{[
      ["Body weight lost",r=>`${fmt1((r.s.lost/r.p.startWeight)*100)}%`,"ใช้ % เพื่อเทียบอย่างยุติธรรม"],
      ["Weight lost",r=>`${fmt1(r.s.lost)} kg`,"จากน้ำหนักเริ่มต้น"],
      ["Waist change",r=>`−${fmt1(r.logs[0].waist-r.logs.at(-1).waist)} cm`,"Positive body composition"],
      ["Protein compliance",r=>`${Math.round(pct(average(r.logs.slice(-7),"protein"),r.p.proteinMin))}%`,"ค่าเฉลี่ย 7 วัน"],
      ["Steps compliance",r=>`${Math.round(pct(average(r.logs.slice(-7),"steps"),r.p.stepsTarget))}%`,"ค่าเฉลี่ย 7 วัน"],
      ["Workout compliance",()=>"100%","3 จาก 3 sessions"],
    ].map(([label,get,note])=><div className="compare-line" key={label}><div><b>{label}</b><small>{note}</small></div>{rows.map(r=><strong key={r.p.id}>{get(r)}</strong>)}</div>)}</section>
    <section className="insight-wide"><Sparkles size={20}/><div><span>TEAM INSIGHT</span><h3>Momentum กำลังมาถูกทาง</h3><p>Zackdark ทำ Protein ได้สม่ำเสมอ ส่วน Tony มี Steps consistency เด่น ทั้งคู่รักษา strength training ได้ครบ</p></div></section>
  </>;
}

function ProfilePage({profile,allLogs,setPage,reset}) { return <><PageTitle eyebrow="ACCOUNT & PLAN" title="Profile" note="Starting point และเป้าหมาย 16 สัปดาห์"/><section className="profile-layout"><div className="card profile-card"><Avatar profile={profile} large/><h2>{profile.name}</h2><p>Started 30 August 2026</p><div className="profile-numbers">{[["Start weight",`${profile.startWeight} kg`],["Main goal",`${profile.goalMin}–${profile.goalMax} kg`],["Body fat",`${profile.bodyFat}%`],["Muscle",`${profile.muscle} kg`],["BMR",`${profile.bmr} kcal`],["Visceral fat",profile.visceral]].map(([a,b])=><div key={a}><span>{a}</span><b>{b}</b></div>)}</div></div><div className="profile-stack"><div className="card settings-card"><h3>Daily targets</h3>{[["Calories",`${profile.calorieTarget.toLocaleString()} kcal`],["Protein",`${profile.proteinMin}–${profile.proteinMax} g`],["Water",`${profile.waterTarget} L`],["Steps",profile.stepsTarget.toLocaleString()],["Sleep","8 hours"]].map(([a,b])=><p key={a}><span>{a}</span><b>{b}</b></p>)}</div><div className="card settings-card"><h3>Data & challenge</h3><button onClick={()=>setPage("compare")}><Users size={17}/> Zackdark vs Tony <ArrowRight size={15}/></button><button onClick={()=>exportData(allLogs)}><Download size={17}/> Export JSON <ArrowRight size={15}/></button><button onClick={reset}><RefreshCcw size={17}/> Reset demo data <ArrowRight size={15}/></button></div></div></section></> }

function exportData(data) { const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));a.download="recomp-backup.json";a.click();URL.revokeObjectURL(a.href); }

export default function HealthApp() {
  const [page,setPage]=useState("dashboard"), [profileId,setProfileId]=useState("zackdark"), [dark,setDark]=useState(()=>localStorage.getItem("recomp-theme")==="dark");
  const [allLogs,setAllLogs]=useState(()=>{try{return JSON.parse(localStorage.getItem(STORE))||{zackdark:makeDemoLogs("zackdark"),tony:makeDemoLogs("tony")}}catch{return {zackdark:makeDemoLogs("zackdark"),tony:makeDemoLogs("tony")}}});
  const profile=PROFILES[profileId], logs=allLogs[profileId];
  useEffect(()=>{document.documentElement.dataset.recompTheme=dark?"dark":"light";localStorage.setItem("recomp-theme",dark?"dark":"light")},[dark]);
  useEffect(()=>localStorage.setItem(STORE,JSON.stringify(allLogs)),[allLogs]);
  useEffect(()=>{
    document.title="Recomp · 16 Week Protocol";
    document.querySelector('link[rel="manifest"]')?.setAttribute("href","/recomp-manifest.webmanifest");
    document.querySelector('link[rel="icon"]')?.setAttribute("href","/recomp/icon.svg");
    document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href","/recomp/icon.svg");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content",dark?"#0f1512":"#f4f6f3");
    if("serviceWorker" in navigator) navigator.serviceWorker.register("/recomp-sw.js",{scope:"/recomp"}).catch(()=>{});
  },[dark]);
  const saveLog=(form)=>setAllLogs(prev=>({...prev,[profileId]:[...prev[profileId].filter(x=>x.date!==form.date),{...form,id:`${profileId}-${form.date}`,profileId,weight:number(form.weight)||undefined,calories:number(form.calories)||undefined,protein:number(form.protein)||undefined,carbs:number(form.carbs)||undefined,fat:number(form.fat)||undefined,water:number(form.water)||undefined,steps:number(form.steps)||undefined,waist:number(form.waist)||undefined,bodyFat:number(form.bodyFat)||undefined,muscle:number(form.muscle)||undefined,visceral:number(form.visceral)||undefined}].sort((a,b)=>a.date.localeCompare(b.date))}));
  const reset=()=>setAllLogs({zackdark:makeDemoLogs("zackdark"),tony:makeDemoLogs("tony")});
  let content=page==="dashboard"?<Dashboard profile={profile} logs={logs} allLogs={allLogs} setPage={setPage}/>:page==="log"?<LogPage profile={profile} logs={logs} onSave={saveLog}/>:page==="progress"?<ProgressPage profile={profile} logs={logs}/>:page==="workout"?<WorkoutPage/>:page==="compare"?<ComparePage allLogs={allLogs}/>:<ProfilePage profile={profile} allLogs={allLogs} setPage={setPage} reset={reset}/>;
  return <div className="recomp-app"><Sidebar page={page} setPage={setPage} dark={dark} setDark={setDark}/><div className="app-column"><Topbar profileId={profileId} setProfileId={setProfileId} profile={profile} dark={dark} setDark={setDark}/><main>{content}</main></div><MobileNav page={page} setPage={setPage}/></div>;
}
