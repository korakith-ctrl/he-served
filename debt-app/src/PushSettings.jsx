import { useEffect, useState } from 'react';
import { auth } from './firebase';
import { Bell, ShieldCheck, Smartphone } from 'lucide-react';
import { disablePush, enablePush, installationId, needsHomeScreen, pushCall, pushSupport } from './push';
const defaults = {reminders:true,activity:true,reminderTime:'09:00',quietStart:'21:00',quietEnd:'08:00',pausedUntil:0,showSensitivePreview:false};
export default function PushSettings() {
  const [expanded,setExpanded] = useState(false), [supported,setSupported] = useState(null), [devices,setDevices] = useState([]), [prefs,setPrefs] = useState(defaults), [busy,setBusy] = useState(false), [message,setMessage] = useState(''), [loaded,setLoaded] = useState(false);
  const dismissKey = `clear-kan-push-dismiss:${auth.currentUser?.uid}`;
  const [dismissed,setDismissed] = useState(() => Number(localStorage.getItem(dismissKey)) > Date.now());
  const installed = !needsHomeScreen();
  const enabled = devices.some(d => d.id === installationId()) && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const denied = typeof Notification !== 'undefined' && Notification.permission === 'denied';
  async function refresh() { const result = await pushCall('getDebtPushDevices'); setDevices(result.devices); setPrefs(result.preferences); setLoaded(true); }
  useEffect(() => { pushSupport().then(setSupported).catch(() => setSupported(false)); refresh().catch(() => setMessage('โหลดการตั้งค่าไม่สำเร็จ กรุณาลองใหม่')); },[]);
  async function run(action,success) { setBusy(true); setMessage(''); try { await action(); await refresh(); setMessage(success); } catch(e) { setMessage(e.message || 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่'); } finally {setBusy(false);} }
  if (dismissed && !expanded && !enabled) return <section className="push-settings"><button className="push-expand" onClick={() => setExpanded(true)}>ตั้งค่าการแจ้งเตือนบนอุปกรณ์</button></section>;
  return <section className="push-settings" aria-label="ตั้งค่า Push Notification">
    <div className="push-heading"><span className="push-symbol"><Bell size={20}/></span><div><strong>{enabled ? 'แจ้งเตือนบนอุปกรณ์นี้แล้ว' : 'ไม่พลาดเรื่องที่ต้องเคลียร์'}</strong><p>เตือนวันชำระและอัปเดตจากคู่สัญญา</p></div></div>
    {!installed ? <p className="push-help"><Smartphone size={16}/> บน iPhone / iPad ให้เปิดเมนูแชร์ → เพิ่มไปยังหน้าจอโฮม แล้วเปิดเคลียร์กันจากไอคอนเพื่อเปิดแจ้งเตือน</p> : supported === false ? <p className="push-help">อุปกรณ์นี้ใช้การแจ้งเตือนในแอปได้</p> : denied ? <p className="push-help">การแจ้งเตือนถูกปิดในอุปกรณ์นี้ เปิดสิทธิ์ในการตั้งค่าเว็บไซต์หรือการแจ้งเตือนของระบบ แล้วกลับมาลองใหม่</p> : !enabled && <><p className="push-privacy"><ShieldCheck size={15}/> ซ่อนชื่อและยอดเงินบนหน้าจอล็อกเป็นค่าเริ่มต้น</p><button className="push-primary" disabled={busy || !supported} onClick={() => run(enablePush,'เปิดการแจ้งเตือนบนอุปกรณ์นี้แล้ว')}>เปิดการแจ้งเตือน</button></>}
    {!enabled && !expanded && <button className="push-expand" onClick={() => { localStorage.setItem(dismissKey,String(Date.now()+7*86400000)); setDismissed(true); }}>ไว้ทีหลัง</button>}
    <button className="push-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'ซ่อนการตั้งค่า' : 'ตั้งค่าการแจ้งเตือน'}</button>
    {expanded && <div className="push-options">
      {!loaded && <button disabled={busy} onClick={() => run(refresh,'โหลดการตั้งค่าแล้ว')}>ลองโหลดอีกครั้ง</button>}
      <fieldset disabled={busy || !loaded}>
        {[['reminders','เตือนวันชำระ'],['activity','คำขอและการชำระ'],['showSensitivePreview','แสดงรายละเอียดบนหน้าจอล็อก']].map(([key,label]) => <label className="push-toggle" key={key}><span>{label}</span><input type="checkbox" checked={prefs[key]} onChange={e => setPrefs({...prefs,[key]:e.target.checked})}/></label>)}
        <label>เวลาเตือน <input type="time" value={prefs.reminderTime} onChange={e => setPrefs({...prefs,reminderTime:e.target.value})}/></label>
        <div className="push-times"><label>พักตั้งแต่<input type="time" value={prefs.quietStart} onChange={e => setPrefs({...prefs,quietStart:e.target.value})}/></label><label>ถึง<input type="time" value={prefs.quietEnd} onChange={e => setPrefs({...prefs,quietEnd:e.target.value})}/></label></div>
        <small>เวลาประเทศไทย · ตั้งเวลาเริ่มและสิ้นสุดเท่ากันเพื่อไม่ใช้ช่วงพัก</small>
        <label className="push-toggle"><span>พักการแจ้งเตือน 7 วัน</span><input type="checkbox" checked={prefs.pausedUntil > Date.now()} onChange={e => setPrefs({...prefs,pausedUntil:e.target.checked ? Date.now()+7*86400000 : 0})}/></label>
        {prefs.pausedUntil > Date.now() && <small>พักถึง {new Date(prefs.pausedUntil).toLocaleString('th-TH')}</small>}
        <button className="push-primary" onClick={() => run(() => pushCall('updateDebtPushPreferences',prefs),'บันทึกการตั้งค่าแล้ว')}>บันทึกการตั้งค่า</button>
      </fieldset>
      {enabled && <button disabled={busy} onClick={() => run(() => pushCall('sendDebtPushTest',{installationId:installationId()}),'ส่งทดสอบแล้ว หากเปิดแอปอยู่จะแสดงข้อความในแอป')}>ส่งทดสอบบนอุปกรณ์นี้</button>}
      {devices.map(d => <div className="push-device" key={d.id}><span><Smartphone size={15}/> {d.label}{d.id === installationId() ? ' · เครื่องนี้' : ''}</span><button disabled={busy} onClick={() => run(() => disablePush(d.id),'ปิดการแจ้งเตือนบนอุปกรณ์แล้ว')}>ปิด</button></div>)}
    </div>}
    {message && <p role="status" className="push-feedback">{message}</p>}
  </section>;
}
