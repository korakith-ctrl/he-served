import { addDays, format } from "date-fns";

export const PROFILES = {
  zackdark: { id:"zackdark", name:"Zackdark", initials:"ZD", startWeight:87.8, bodyFat:29.1, bmi:30.4, muscle:59.05, visceral:11, bmr:1857, calorieTarget:2000, proteinMin:125, proteinMax:140, waterTarget:3, stepsTarget:9000, goalMin:75, goalMax:78, stretchGoal:72.8, color:"#1f9d6a" },
  tony: { id:"tony", name:"Tony", initials:"TN", startWeight:95.5, bodyFat:32.6, bmi:31.9, muscle:61.06, visceral:14, bmr:1871, calorieTarget:2100, proteinMin:135, proteinMax:150, waterTarget:3.5, stepsTarget:9000, goalMin:82, goalMax:85, stretchGoal:80.5, color:"#5478d4" },
};

const DEMO = {
  zackdark: [87.8,87.6,87.7,87.3,87.2,87,86.8,86.9,86.6,86.5,86.3,86.4,86.1,85.9],
  tony: [95.5,95.2,95.3,94.9,94.8,94.5,94.4,94.5,94.2,94,93.9,93.7,93.6,93.4],
};

export function makeInitialLogs(profileId) {
  const p = PROFILES[profileId];
  return [{
    id:`${profileId}-2026-08-30`, profileId, date:"2026-08-30", weight:p.startWeight,
    bodyFat:p.bodyFat, muscle:p.muscle, visceral:p.visceral, workout:false, notes:"Starting point",
  }];
}

export function makeDemoLogs(profileId) {
  const p = PROFILES[profileId];
  return DEMO[profileId].map((weight, i) => ({
    id:`${profileId}-${i}`, profileId, date:format(addDays(new Date(2026,7,30),i),"yyyy-MM-dd"), weight,
    calories:p.calorieTarget+[-80,45,-130,20,-40,90,-15][i%7], protein:p.proteinMin+[12,4,18,-8,10,15,6][i%7], carbs:205+(i%4)*8, fat:61+(i%3)*4,
    water:+(p.waterTarget-[0,.4,.1,0,.3,0,.2][i%7]).toFixed(1), steps:7800+(i%5)*620, sleep:405+(i%4)*15,
    waist:+((profileId==="zackdark"?101:108)-i*.12).toFixed(1), bodyFat:+(p.bodyFat-i*.055).toFixed(1), muscle:+(p.muscle+Math.sin(i)*.08).toFixed(2),
    visceral:p.visceral, hunger:2+(i%3), energy:3+(i%2), mood:i%4===0?"calm":"good", workout:[1,3,5,8,10,12].includes(i), notes:"",
  }));
}

export const MILESTONES = {
  zackdark:[{w:0,v:87.8},{w:2,v:86},{w:4,v:84.5},{w:6,v:83},{w:8,v:81.5},{w:10,v:80},{w:12,v:79.2},{w:14,v:77.8},{w:16,v:76.5}],
  tony:[{w:0,v:95.5},{w:2,v:93.5},{w:4,v:92},{w:6,v:90.3},{w:8,v:88.5},{w:10,v:87},{w:12,v:85.5},{w:14,v:84.2},{w:16,v:83.5}],
};

export const WORKOUTS = {
  A:[["Leg Press / Squat","3 × 8–12",80],["Chest Press","3 × 8–12",40],["Lat Pulldown","3 × 8–12",45],["Romanian Deadlift","3 × 8–12",50],["Shoulder Press","3 × 10–12",22.5],["Plank","3 × 30–60 sec",0]],
  B:[["Goblet Squat / Hack Squat","3 × 8–12",30],["Seated Cable Row","3 × 8–12",40],["Incline Dumbbell Press","3 × 8–12",16],["Leg Curl","3 × 10–15",35],["Lateral Raise","3 × 12–15",7.5],["Cable Crunch","3 × 10–15",30]],
};

export const PHASES = [
  {n:"01",weeks:"Week 1–4",title:"Build habit",note:"ตั้งจังหวะที่ทำได้จริง",meta:"8k steps · 3 strength · Protein daily"},
  {n:"02",weeks:"Week 5–8",title:"Fat loss",note:"รักษาแรงและความสม่ำเสมอ",meta:"9k steps · 3 strength · Zone 2 × 2"},
  {n:"03",weeks:"Week 9–12",title:"Push",note:"ปรับจากข้อมูล ไม่ใช่อารมณ์",meta:"9–10k steps · Progressive overload"},
  {n:"04",weeks:"Week 13–16",title:"Finish strong",note:"จบแบบรักษาต่อได้",meta:"Recovery first · Keep calories steady"},
];
