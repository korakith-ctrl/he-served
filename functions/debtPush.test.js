const {test} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const realLoad = Module._load;
Module._load = function(id,...args) {
  if (id === 'firebase-functions/v2/https') return {onCall:(_,fn)=>fn,HttpsError:class extends Error {constructor(code,message){super(message);this.code=code;}}};
  if (id === 'firebase-functions/v2/database') return {onValueCreated:(_,fn)=>fn};
  if (id === 'firebase-functions/v2/scheduler') return {onSchedule:(_,fn)=>fn};
  return realLoad.call(this,id,...args);
};
const create = require('./debtPush');
Module._load = realLoad;
function memory(seed) {
  const data = structuredClone(seed);
  const copy = value => value == null ? null : structuredClone(value);
  function read(path) { return path.split('/').filter(Boolean).reduce((v,k)=>v?.[k],data) ?? null; }
  function write(path,value) {const keys=path.split('/');const leaf=keys.pop();let parent=data;for(const k of keys) parent=parent[k] ||= {};if(value == null) delete parent[leaf];else parent[leaf]=copy(value);}
  const snapshot = value => ({val:()=>copy(value),exists:()=>value!=null});
  function ref(path, filters={}) {return {
    async get() {let v=read(path);if (filters.order && v) {let entries=Object.entries(v).sort((a,b)=>String(a[0]).localeCompare(b[0]));if(filters.order!=='key') entries.sort((a,b)=>a[1][filters.order]-b[1][filters.order]);entries=entries.filter(([k,x])=>(filters.end===undefined || x[filters.order]<=filters.end) && (!filters.start || k>filters.start));v=Object.fromEntries(entries.slice(0,filters.limit || Infinity));if(!Object.keys(v).length)v=null;}return snapshot(v);},
    async set(v){write(path,v);}, async remove(){write(path,null);}, async update(v){write(path,{...read(path),...v});},
    async transaction(fn){const next=fn(copy(read(path)));if(next===undefined)return {committed:false,snapshot:snapshot(read(path))};write(path,next);return {committed:true,snapshot:snapshot(next)};},
    orderByChild(order){return ref(path,{...filters,order});},orderByKey(){return ref(path,{...filters,order:'key'});},endAt(end){return ref(path,{...filters,end});},startAfter(start){return ref(path,{...filters,start});},limitToFirst(limit){return ref(path,{...filters,limit});},
  };}
  return {ref,data};
}
function setup(extra={}) {
  const uid='u', now=Date.now();
  const db=memory({debtPushPreferences:{u:{activity:true,reminders:false,quietStart:'00:00',quietEnd:'00:00'}},debtPushInstallations:{device:{uid,token:'token',label:'test'}},debtPushDeviceMembers:{u:{device:true}},debts:{d:{creditorUid:uid,debtorUid:'other',status:'active'}},debtNotifications:{u:{a:{debtId:'d',title:'private',body:'private amount',createdAt:new Date(now-120000).toISOString()},b:{debtId:'d',title:'second',body:'private',createdAt:new Date(now-120000).toISOString()}}},...extra});
  const messages=[];
  let fail=false;
  const api=create({db,admin:{messaging:()=>({send:async m=>{if(fail) throw Object.assign(new Error('temporary'),{code:'messaging/internal-error'});messages.push(m);return 'ok';}})},options:{region:'asia-southeast1'},requiredUser:r=>({uid:r.auth.uid}),rateLimit:async()=>{}});
  const queue=id=>api.queueDebtPush({params:{uid,id},data:{val:()=>db.data.debtNotifications.u[id]}});
  return {db,api,messages,queue,setFail:v=>fail=v};
}
test('burst emits one private-by-default push and retrying trigger does not resend', async()=>{
  const x=setup();await x.queue('a');await x.queue('b');await x.api.dispatchDebtPush();
  assert.equal(x.messages.length,1);assert.equal(x.messages[0].data.title,'เคลียร์กัน');assert.equal(x.messages[0].data.notificationId,'');assert.ok(!JSON.stringify(x.messages[0]).includes('private amount'));
  await x.queue('a');await x.api.dispatchDebtPush();assert.equal(x.messages.length,1);
  await x.queue('b');await x.api.dispatchDebtPush();assert.equal(x.messages.length,1);
});
test('read notifications, revoked membership and disabled activity never send',async()=>{
  for(const mode of ['read','membership','disabled']) {
    const x=setup();await x.queue('a');
    if(mode==='read')x.db.data.debtNotifications.u.a.readAt='now';
    if(mode==='membership')x.db.data.debts.d.creditorUid='someone-else';
    if(mode==='disabled')x.db.data.debtPushPreferences.u.activity=false;
    await x.api.dispatchDebtPush();assert.equal(x.messages.length,0,mode);
  }
});
test('temporary FCM failure retains queue and releases worker lease for retry',async()=>{
  const x=setup();await x.queue('a');x.setFail(true);await x.api.dispatchDebtPush();
  const jobs=Object.values(x.db.data.debtPushOutbox);assert.equal(jobs.length,1);assert.equal(jobs[0].attempts,1);assert.equal(x.db.data.debtPushWorkerLease,undefined);
  jobs[0].nextAt=Date.now()-1;x.setFail(false);await x.api.dispatchDebtPush();assert.equal(x.messages.length,1);assert.equal(Object.keys(x.db.data.debtPushOutbox).length,0);
});
test('device registration cannot replace another account installation',async()=>{
  const x=setup();
  await assert.rejects(()=>x.api.registerDebtPushDevice({auth:{uid:'intruder'},data:{installationId:'device',token:'x'.repeat(80)}}),e=>e.code==='failed-precondition');
  assert.equal(x.db.data.debtPushInstallations.device.uid,'u');
});
test('device listing excludes tokens and disabling is owner-scoped',async()=>{
  const x=setup();const result=await x.api.getDebtPushDevices({auth:{uid:'u'},data:{}});
  assert.equal(result.devices[0].token,undefined);
  await x.api.disableDebtPushDevice({auth:{uid:'intruder'},data:{installationId:'device'}});assert.ok(x.db.data.debtPushInstallations.device);
  await x.api.disableDebtPushDevice({auth:{uid:'u'},data:{installationId:'device'}});assert.equal(x.db.data.debtPushInstallations.device,undefined);
});
test('worker respects an active lease',async()=>{
  const x=setup({debtPushWorkerLease:{id:'other',until:Date.now()+60000}});await x.queue('a');await x.api.dispatchDebtPush();assert.equal(x.messages.length,0);
});
test('queue does not retain events for accounts without push opt-in',async()=>{
  const x=setup({debtPushDeviceMembers:{}});await x.queue('a');assert.equal(x.db.data.debtPushOutbox,undefined);
});
