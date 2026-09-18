import { getMessaging, getToken, deleteToken, isSupported } from 'firebase/messaging';
import { httpsCallable } from 'firebase/functions';
import { app, auth, cloudFunctions } from './firebase';
export const pushCall = async (name, data = {}) => (await httpsCallable(cloudFunctions, name)(data)).data;
const bindingKey = 'clear-kan-push-binding';
export function installationId() {
  let id = localStorage.getItem('clear-kan-push-installation');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('clear-kan-push-installation',id); }
  return id;
}
export const needsHomeScreen = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? !window.matchMedia('(display-mode: standalone)').matches && !navigator.standalone : false;
export async function pushSupport() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'Notification' in window && await isSupported();
}
async function account(uid) {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const worker = registration?.active;
  if (!worker || !worker.scriptURL.endsWith('/debt-push-sw.js')) return;
  await new Promise((resolve,reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('เชื่อมต่อการแจ้งเตือนไม่สำเร็จ')),5000);
    channel.port1.onmessage = () => { clearTimeout(timer); channel.port1.close(); resolve(); };
    worker.postMessage({type:'PUSH_ACCOUNT',uid},[channel.port2]);
  });
}
export async function enablePush() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('กรุณาเข้าสู่ระบบ');
  if (!import.meta.env.VITE_FIREBASE_VAPID_KEY) throw new Error('ระบบยังไม่ได้ตั้งค่าการแจ้งเตือน กรุณาลองอีกครั้งภายหลัง');
  // Keep this call before the first await so iOS retains the user gesture.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('กรุณาอนุญาตการแจ้งเตือนในการตั้งค่าอุปกรณ์');
  if (!await pushSupport()) throw new Error('อุปกรณ์นี้ยังไม่รองรับ Push');
  const registration = await navigator.serviceWorker.register('/debt-push-sw.js');
  await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app),{vapidKey:import.meta.env.VITE_FIREBASE_VAPID_KEY,serviceWorkerRegistration:registration});
  if (!token || auth.currentUser?.uid !== uid) throw new Error('กรุณาเข้าสู่ระบบแล้วลองใหม่');
  await pushCall('registerDebtPushDevice',{installationId:installationId(),token,label:/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone / iPad' : /Android/.test(navigator.userAgent) ? 'Android' : 'เว็บเบราว์เซอร์'});
  localStorage.setItem(bindingKey,uid);
  await account(uid);
}
export async function disablePush(id = installationId()) {
  if (id === installationId()) { await account(null); localStorage.removeItem(bindingKey); }
  await pushCall('disableDebtPushDevice',{installationId:id});
  if (id === installationId() && await pushSupport()) await deleteToken(getMessaging(app));
}
export async function syncPushAccount(uid) {
  await account(null);
  if (!uid || !await pushSupport()) return;
  const bound = localStorage.getItem(bindingKey);
  if (bound && bound !== uid) {
    await deleteToken(getMessaging(app));
    localStorage.removeItem(bindingKey);
    localStorage.removeItem('clear-kan-push-installation');
    return;
  }
  if (bound !== uid) return;
  if (Notification.permission !== 'granted') { await disablePush(); return; }
  const result = await pushCall('getDebtPushDevices');
  if (!result.devices.some(d => d.id === installationId())) { localStorage.removeItem(bindingKey); return; }
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) return;
  const token = await getToken(getMessaging(app),{vapidKey:import.meta.env.VITE_FIREBASE_VAPID_KEY,serviceWorkerRegistration:registration});
  if (auth.currentUser?.uid !== uid) return;
  await pushCall('registerDebtPushDevice',{installationId:installationId(),token});
  await account(uid);
}
export async function logoutWithPush(signOut) {
  await account(null);
  if (localStorage.getItem(bindingKey)) {
    try { await disablePush(); } catch {
      // Delete the subscription locally even when the server cannot be reached.
      const registration = await navigator.serviceWorker.getRegistration('/');
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
      localStorage.removeItem(bindingKey);
      localStorage.removeItem('clear-kan-push-installation');
    }
  }
  await signOut(auth);
}
