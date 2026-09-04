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

export const FOOD_SOURCES = {
  thai: { short:"Thai FCD 2025", name:"Thai Food Composition Database 2025 · Institute of Nutrition, Mahidol University", url:"https://inmu.mahidol.ac.th/thaifcd/" },
  usda: { short:"USDA FDC", name:"USDA FoodData Central", url:"https://fdc.nal.usda.gov/" },
  label: { short:"ฉลากอาหาร", name:"ค่าจากฉลากโภชนาการมาตรฐาน โปรดตรวจยี่ห้อที่รับประทานจริง", url:"https://food.fda.moph.go.th/food-law/nutrition-label/" },
};

export const FOOD_CATEGORIES = [
  ["popular","แนะนำ"], ["all","ทั้งหมด"], ["thai","อาหารไทย"], ["protein","โปรตีน"],
  ["carbs","ข้าว–แป้ง"], ["produce","ผัก–ผลไม้"], ["dairy","นม/ทางเลือก"], ["snack","ของว่าง"], ["drink","เครื่องดื่ม"],
];

const food = (id, name, serving, category, calories, protein, carbs, fat, fiber, source, options={}) => ({
  id, name, serving, category, calories, protein, carbs, fat, fiber, source,
  produceServings: options.produceServings || 0, popular: Boolean(options.popular), approximate: Boolean(options.approximate),
});

// Values are rounded for practical logging. Mixed dishes vary by recipe, oil, sauce and portion size.
export const FOOD_PRESETS = [
  food("thai-basil-chicken","ข้าวกะเพราไก่ + ไข่ดาว","1 จาน (~400 g)","thai",650,32,75,24,3,"thai",{popular:true,approximate:true}),
  food("thai-chicken-rice","ข้าวมันไก่","1 จาน (~400 g)","thai",620,28,72,24,2,"thai",{popular:true,approximate:true}),
  food("thai-chicken-fried-rice","ข้าวผัดไก่","1 จาน (~350 g)","thai",560,24,75,18,3,"thai",{approximate:true}),
  food("thai-pad-thai-shrimp","ผัดไทยกุ้ง","1 จาน (~350 g)","thai",600,25,82,19,4,"thai",{popular:true,approximate:true}),
  food("thai-chicken-noodle-soup","ก๋วยเตี๋ยวไก่น้ำ","1 ชาม (~450 g)","thai",360,22,54,6,3,"thai",{approximate:true}),
  food("thai-seafood-suki","สุกี้น้ำทะเล","1 ชาม (~450 g)","thai",330,28,42,6,5,"thai",{popular:true,approximate:true}),
  food("thai-clear-tom-yum","ต้มยำกุ้งน้ำใส","1 ถ้วย (~250 g)","thai",120,16,9,3,2,"thai",{approximate:true}),
  food("thai-tofu-soup","แกงจืดเต้าหู้หมูสับ","1 ถ้วย (~300 g)","thai",180,17,8,9,2,"thai",{approximate:true}),
  food("thai-som-tam","ส้มตำไทย","1 จาน (~200 g)","thai",160,4,28,4,5,"thai",{produceServings:2,approximate:true}),
  food("thai-chicken-larb","ลาบไก่","1 จาน (~180 g)","thai",220,27,12,8,3,"thai",{popular:true,approximate:true}),
  food("thai-fish-rice-soup","ข้าวต้มปลา","1 ชาม (~450 g)","thai",300,23,48,3,2,"thai",{approximate:true}),
  food("thai-green-curry","แกงเขียวหวานไก่ (ไม่รวมข้าว)","1 ถ้วย (~250 g)","thai",360,22,18,23,4,"thai",{approximate:true}),

  food("protein-chicken-breast","อกไก่สุก ไม่ติดหนัง","100 g","protein",165,31,0,3.6,0,"usda",{popular:true}),
  food("protein-chicken-thigh","สะโพกไก่สุก ไม่ติดหนัง","100 g","protein",209,26,0,11,0,"usda"),
  food("protein-pork-tenderloin","สันในหมูสุก","100 g","protein",143,26,0,3.5,0,"usda",{popular:true}),
  food("protein-pork-loin","สันนอกหมูสุก เลาะมัน","100 g","protein",196,29,0,8,0,"usda"),
  food("protein-lean-beef","เนื้อวัวไม่ติดมันสุก","100 g","protein",217,26,0,12,0,"usda"),
  food("protein-salmon","ปลาแซลมอนสุก","100 g","protein",206,22,0,12,0,"usda",{popular:true}),
  food("protein-white-fish","ปลาเนื้อขาวสุก","100 g","protein",128,26,0,2.7,0,"usda"),
  food("protein-shrimp","กุ้งสุก","100 g","protein",99,24,0.2,0.3,0,"usda"),
  food("protein-tuna","ทูน่าในน้ำแร่ สะเด็ดน้ำ","100 g","protein",116,25.5,0,0.8,0,"usda",{popular:true}),
  food("protein-eggs","ไข่ไก่ต้ม","2 ฟองใหญ่","protein",144,12.6,0.7,9.6,0,"usda",{popular:true}),
  food("protein-tofu","เต้าหู้แข็ง","100 g","protein",144,17,2.8,8.7,2.3,"usda"),
  food("protein-tempeh","เทมเป้สุก","100 g","protein",195,20,7.6,11.4,3.8,"usda"),

  food("carb-white-rice","ข้าวสวยหุงสุก","150 g (~2 ทัพพี)","carbs",195,4,42,0.5,0.6,"thai",{popular:true}),
  food("carb-brown-rice","ข้าวกล้องหุงสุก","150 g (~2 ทัพพี)","carbs",185,4,39,1.5,2.4,"thai",{popular:true}),
  food("carb-sticky-rice","ข้าวเหนียวนึ่ง","100 g","carbs",169,3.5,37,0.3,1.3,"thai"),
  food("carb-oats","ข้าวโอ๊ตแห้ง","40 g","carbs",152,5.1,27,2.8,4,"usda",{popular:true}),
  food("carb-sweet-potato","มันหวานอบ","150 g","carbs",135,3,31,0.2,5,"usda"),
  food("carb-potato","มันฝรั่งต้ม","150 g","carbs",131,3,30,0.2,2.7,"usda"),
  food("carb-wholewheat-bread","ขนมปังโฮลวีต","2 แผ่น (~56 g)","carbs",140,7,24,2,4,"usda",{popular:true}),
  food("carb-rice-noodles","เส้นก๋วยเตี๋ยวสุก","150 g","carbs",164,3,36,0.3,1.5,"thai"),
  food("carb-quinoa","ควินัวหุงสุก","150 g","carbs",180,6.6,32,2.9,4.2,"usda"),
  food("carb-corn","ข้าวโพดหวานต้ม","100 g","carbs",96,3.4,21,1.5,2.4,"usda",{produceServings:1}),

  food("produce-banana","กล้วยหอม","1 ผลกลาง (~118 g)","produce",105,1.3,27,0.4,3.1,"usda",{produceServings:1,popular:true}),
  food("produce-apple","แอปเปิลพร้อมเปลือก","1 ผลกลาง (~182 g)","produce",95,0.5,25,0.3,4.4,"usda",{produceServings:1}),
  food("produce-orange","ส้ม","1 ผลกลาง (~131 g)","produce",62,1.2,15.4,0.2,3.1,"usda",{produceServings:1}),
  food("produce-guava","ฝรั่ง","1 ผลเล็ก (~150 g)","produce",102,3.9,21.5,1.4,8.1,"thai",{produceServings:1,popular:true}),
  food("produce-papaya","มะละกอสุก","1 ถ้วย (~145 g)","produce",62,0.7,16,0.4,2.5,"usda",{produceServings:1}),
  food("produce-watermelon","แตงโม","2 ถ้วย (~300 g)","produce",90,1.8,23,0.5,1.2,"usda",{produceServings:2}),
  food("produce-avocado","อะโวคาโด","1/2 ผล (~100 g)","produce",160,2,8.5,14.7,6.7,"usda",{produceServings:1}),
  food("produce-broccoli","บรอกโคลีสุก","150 g","produce",53,3.6,10.8,0.6,5,"usda",{produceServings:2,popular:true}),
  food("produce-spinach","ผักโขมสุก","100 g","produce",23,3,3.8,0.3,2.4,"usda",{produceServings:1}),
  food("produce-carrot","แครอตดิบ","100 g","produce",41,0.9,9.6,0.2,2.8,"usda",{produceServings:1}),
  food("produce-mixed-vegetables","ผักรวมต้ม ไม่ใส่น้ำมัน","150 g","produce",75,4,14,0.8,5,"usda",{produceServings:2,popular:true,approximate:true}),
  food("produce-edamame","ถั่วแระญี่ปุ่นสุก","100 g","produce",121,11.9,8.9,5.2,5.2,"usda",{produceServings:1}),

  food("dairy-greek-yogurt","กรีกโยเกิร์ต 0% รสธรรมชาติ","170 g","dairy",100,17,6,0,0,"usda",{popular:true}),
  food("dairy-yogurt","โยเกิร์ตรสธรรมชาติไขมันต่ำ","170 g","dairy",107,8.9,12,2.6,0,"usda"),
  food("dairy-milk","นมโคไขมันต่ำ","250 ml","dairy",107,8.5,12,2.5,0,"usda"),
  food("dairy-soy-milk","นมถั่วเหลืองไม่หวาน","250 ml","dairy",80,7,4,4,2,"label",{approximate:true}),
  food("dairy-cottage-cheese","คอตเทจชีสไขมันต่ำ","150 g","dairy",123,18.5,6.5,3.5,0,"usda"),
  food("dairy-mozzarella","มอซซาเรลลาชีส part-skim","30 g","dairy",85,7,1,6,0,"usda"),
  food("dairy-kefir","คีเฟอร์รสธรรมชาติ","250 ml","dairy",130,9,12,5,0,"label",{approximate:true}),

  food("snack-almonds","อัลมอนด์","30 g","snack",174,6.4,6.5,15,3.8,"usda",{popular:true}),
  food("snack-peanuts","ถั่วลิสงอบ","30 g","snack",176,7.7,6.5,14.8,2.5,"usda"),
  food("snack-peanut-butter","เนยถั่ว","1 ช้อนโต๊ะ (16 g)","snack",94,3.6,3.5,8,1,"usda"),
  food("snack-chia","เมล็ดเจีย","20 g","snack",97,3.3,8.4,6.1,6.9,"usda"),
  food("snack-hummus","ฮัมมุส","50 g","snack",83,4,7,4.8,3,"usda"),
  food("snack-rice-cakes","ข้าวพองแผ่น","2 แผ่น (~18 g)","snack",70,1.5,14.6,0.6,0.7,"usda"),
  food("snack-dark-chocolate","ดาร์กช็อกโกแลต 70–85%","20 g","snack",120,1.6,9.2,8.6,2.2,"usda"),
  food("snack-whey","เวย์โปรตีน","1 scoop (~30 g)","snack",120,24,3,2,0,"label",{popular:true,approximate:true}),

  food("drink-black-coffee","กาแฟดำ ไม่ใส่น้ำตาล","240 ml","drink",2,0.3,0,0,0,"usda"),
  food("drink-latte","ลาเต้นมไขมันต่ำ ไม่หวาน","300 ml","drink",130,9,14,4,0,"label",{approximate:true}),
  food("drink-coconut-water","น้ำมะพร้าวไม่เติมน้ำตาล","250 ml","drink",45,0.5,11,0,0,"usda",{approximate:true}),
  food("drink-orange-juice","น้ำส้ม 100%","250 ml","drink",112,1.7,26,0.5,0.5,"usda"),
];

export const MEAL_TYPES = [
  ["breakfast","มื้อเช้า"], ["lunch","มื้อกลางวัน"], ["dinner","มื้อเย็น"], ["snacks","ของว่าง/เครื่องดื่ม"],
];

export const PHASES = [
  {n:"01",weeks:"Week 1–4",title:"Build habit",note:"ตั้งจังหวะที่ทำได้จริง",meta:"8k steps · 3 strength · Protein daily"},
  {n:"02",weeks:"Week 5–8",title:"Fat loss",note:"รักษาแรงและความสม่ำเสมอ",meta:"9k steps · 3 strength · Zone 2 × 2"},
  {n:"03",weeks:"Week 9–12",title:"Push",note:"ปรับจากข้อมูล ไม่ใช่อารมณ์",meta:"9–10k steps · Progressive overload"},
  {n:"04",weeks:"Week 13–16",title:"Finish strong",note:"จบแบบรักษาต่อได้",meta:"Recovery first · Keep calories steady"},
];
