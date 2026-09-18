import { deleteToken, getMessaging, getToken, isSupported } from "firebase/messaging";
import { httpsCallable } from "firebase/functions";
import { app, auth, cloudFunctions } from "./firebase";

const INSTALLATION_KEY = "he-served-order-push-installation";
const ENABLED_KEY = "he-served-order-push-enabled";
const ACCOUNT_KEY = "he-served-order-push-account";
const WORKER_URL = "/order-push-sw.js";

export function orderPushInstallationId() {
  let id = localStorage.getItem(INSTALLATION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(INSTALLATION_KEY, id);
  }
  return id;
}

export function orderPushIsEnabled(uid) {
  return localStorage.getItem(ENABLED_KEY) === uid;
}

export async function orderPushIsSupported() {
  return window.isSecureContext
    && "Notification" in window
    && "serviceWorker" in navigator
    && await isSupported();
}

async function setWorkerAccount(uid) {
  const registration = await navigator.serviceWorker.getRegistration("/");
  const worker = registration?.active || registration?.waiting || registration?.installing;
  if (!worker) return;
  await new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => reject(new Error("เชื่อมต่อการแจ้งเตือนไม่สำเร็จ")), 5000);
    channel.port1.onmessage = () => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve();
    };
    worker.postMessage({ type: "ORDER_PUSH_ACCOUNT", uid: uid || null }, [channel.port2]);
  });
}

function deviceLabel() {
  if (/iPhone|iPad/i.test(navigator.userAgent)) return "iPhone / iPad";
  if (/Android/i.test(navigator.userAgent)) return "Android";
  return "เว็บเบราว์เซอร์";
}

export async function enableOrderPush() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("กรุณาเข้าสู่ระบบก่อน");
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!vapidKey) throw new Error("ระบบยังไม่ได้ตั้งค่า Web Push ของ Firebase");
  // This permission request must run directly from the button interaction for iOS.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("กรุณาอนุญาตการแจ้งเตือนในการตั้งค่าอุปกรณ์");
  if (!await orderPushIsSupported()) throw new Error("อุปกรณ์นี้ยังไม่รองรับ Push Notification");

  const registration = await navigator.serviceWorker.register(WORKER_URL, { scope: "/" });
  await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
  if (!token || auth.currentUser?.uid !== uid) throw new Error("สร้างการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่");

  await httpsCallable(cloudFunctions, "registerOrderPushDevice")({
    installationId: orderPushInstallationId(), token, label: deviceLabel(),
  });
  localStorage.setItem(ENABLED_KEY, uid);
  localStorage.setItem(ACCOUNT_KEY, uid);
  await setWorkerAccount(uid);
}

export async function disableOrderPush() {
  const uid = auth.currentUser?.uid;
  const id = orderPushInstallationId();
  if (uid) await httpsCallable(cloudFunctions, "disableOrderPushDevice")({ installationId: id });
  await setWorkerAccount(null).catch(() => {});
  localStorage.removeItem(ENABLED_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
  if (await orderPushIsSupported()) await deleteToken(getMessaging(app));
}

export async function syncOrderPushAccount(uid) {
  if (!orderPushIsEnabled(uid) || !await orderPushIsSupported()) return;
  const boundUid = localStorage.getItem(ACCOUNT_KEY);
  if (boundUid && boundUid !== uid) {
    await setWorkerAccount(null).catch(() => {});
    localStorage.removeItem(ENABLED_KEY);
    localStorage.removeItem(ACCOUNT_KEY);
    return;
  }
  if (Notification.permission !== "granted") return;
  await setWorkerAccount(uid);
}
