const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/debt-push-sw.js'),'utf8');
function worker({uid='u',visible=false}={}) {
  const handlers={}, notifications=[], messages=[], navigation=[];
  const client={visibilityState:visible?'visible':'hidden',url:'https://clear.test/',postMessage:m=>messages.push(m),navigate:async url=>navigation.push(url),focus:async()=>{}};
  const self={addEventListener:(name,fn)=>handlers[name]=fn,location:{origin:'https://clear.test'},registration:{showNotification:async(title,options)=>notifications.push({title,...options}),getNotifications:async()=>[]},clients:{matchAll:async()=>[client],claim:async()=>{},openWindow:async url=>navigation.push(url)},skipWaiting:()=>{}};
  const caches={open:async()=>({match:async()=>({json:async()=>({uid})}),put:async(_,response)=>{uid=(await response.json()).uid;}})};
  vm.runInNewContext(source,{self,caches,URL,Response});
  async function dispatch(type,event) {let pending;handlers[type]({...event,waitUntil:p=>{pending=p;}});await pending;}
  return {notifications,messages,navigation,dispatch};
}
const data={uid:'u',notificationId:'abc',title:'เคลียร์กัน',body:'มีรายการใหม่',tag:'a'};
test('background push displays once with internal destination metadata',async()=>{
  const w=worker();await w.dispatch('push',{data:{json:()=>({data})}});assert.equal(w.notifications.length,1);assert.equal(w.notifications[0].data.notificationId,'abc');
});
test('foreground push becomes an in-app message',async()=>{
  const w=worker({visible:true});await w.dispatch('push',{data:{json:()=>({data})}});assert.equal(w.notifications.length,0);assert.equal(w.messages[0].type,'DEBT_PUSH');
});
test('logout or different account suppresses old account payload',async()=>{
  const w=worker({uid:'other'});await w.dispatch('push',{data:{json:()=>({data})}});assert.equal(w.notifications.length,0);
  await w.dispatch('message',{data:{type:'PUSH_ACCOUNT',uid:null},ports:[]});await w.dispatch('push',{data:{json:()=>({data})}});assert.equal(w.notifications.length,0);
});
test('notification click ignores external URLs and encodes notification id',async()=>{
  const w=worker();await w.dispatch('notificationclick',{notification:{close(){},data:{uid:'u',notificationId:'https://evil.test/?x=1',url:'https://evil.test'}}});
  assert.equal(new URL(w.navigation[0]).origin,'https://clear.test');assert.equal(new URL(w.navigation[0]).searchParams.get('notification'),'https://evil.test/?x=1');
});
test('malformed push payload is ignored',async()=>{
  const w=worker();await w.dispatch('push',{data:{json(){throw new Error('invalid json');}}});assert.equal(w.notifications.length,0);
});
