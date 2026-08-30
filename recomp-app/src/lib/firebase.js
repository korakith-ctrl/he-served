import { getApp, getApps, initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { get, getDatabase, onValue, ref, runTransaction, set } from "firebase/database";
import { initialStore } from "./store.js";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const required = ["apiKey", "authDomain", "databaseURL", "projectId", "appId"];
export const firebaseConfigured = required.every(key => Boolean(firebaseConfig[key]));
const app = firebaseConfigured ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null;
export const firebaseAuth = app ? getAuth(app) : null;
export const realtimeDb = app ? getDatabase(app) : null;
export const CHALLENGE_ID = "16-week-2026";
const challengePath = `recompChallenges/${CHALLENGE_ID}`;
const dataPath = `${challengePath}/data`;

const clean = value => JSON.parse(JSON.stringify(value));
const objectValues = value => Array.isArray(value) ? value : Object.values(value || {});

export function encodeStore(store, userId = null) {
  return clean({
    version: 4,
    logs: Object.fromEntries(Object.entries(store.logs).map(([profileId, logs]) => [profileId, Object.fromEntries(logs.map(log => [log.date, log]))])),
    workouts: Object.fromEntries(Object.entries(store.workouts).map(([profileId, workouts]) => [profileId, Object.fromEntries(workouts.map(workout => [`${workout.date}_${workout.type}`, workout]))])),
    preferences: store.preferences,
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  });
}

export function decodeStore(value) {
  const baseline = initialStore();
  if (!value) return baseline;
  return {
    ...baseline,
    version: 4,
    logs: {
      zackdark: objectValues(value.logs?.zackdark).sort((a, b) => a.date.localeCompare(b.date)),
      tony: objectValues(value.logs?.tony).sort((a, b) => a.date.localeCompare(b.date)),
    },
    workouts: {
      zackdark: objectValues(value.workouts?.zackdark).sort((a, b) => a.date.localeCompare(b.date)),
      tony: objectValues(value.workouts?.tony).sort((a, b) => a.date.localeCompare(b.date)),
    },
    preferences: { ...baseline.preferences, ...(value.preferences || {}) },
  };
}

const newest = (left, right) => {
  if (!left) return right;
  if (!right) return left;
  return String(right.updatedAt || right.createdAt || "") > String(left.updatedAt || left.createdAt || "") ? right : left;
};

export function mergeStores(remote, local) {
  const baseline = initialStore();
  const result = { ...baseline, version: 4, logs: {}, workouts: {}, preferences: { ...baseline.preferences, ...local.preferences, ...remote.preferences } };
  for (const profileId of ["zackdark", "tony"]) {
    const logs = new Map();
    [...(remote.logs[profileId] || []), ...(local.logs[profileId] || [])].forEach(log => logs.set(log.date, newest(logs.get(log.date), log)));
    result.logs[profileId] = [...logs.values()].sort((a, b) => a.date.localeCompare(b.date));
    const workouts = new Map();
    [...(remote.workouts[profileId] || []), ...(local.workouts[profileId] || [])].forEach(workout => {
      const key = `${workout.date}_${workout.type}`;
      workouts.set(key, newest(workouts.get(key), workout));
    });
    result.workouts[profileId] = [...workouts.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  return result;
}

export function observeFirebaseAuth(callback) {
  if (!firebaseAuth) { callback(null); return () => {}; }
  return onAuthStateChanged(firebaseAuth, callback);
}

export async function signInFirebase() {
  if (!firebaseAuth) throw new Error("ยังไม่ได้ตั้งค่า Firebase environment variables");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(firebaseAuth, provider);
}

export const signOutFirebase = () => firebaseAuth ? signOut(firebaseAuth) : Promise.resolve();

export async function connectRealtime(user, localStore, { onStore, onState }) {
  if (!realtimeDb || !user) return () => {};
  onState({ status: "connecting", authorized: false, connected: false });
  const membership = await get(ref(realtimeDb, `${challengePath}/members/${user.uid}`));
  if (!membership.exists()) {
    onState({ status: "denied", authorized: false, connected: true, message: "บัญชีนี้ไม่ได้เป็นสมาชิก Recomp challenge" });
    return () => {};
  }
  const member = membership.val();
  const transaction = await runTransaction(ref(realtimeDb, dataPath), current => {
    const merged = mergeStores(decodeStore(current), localStore);
    return encodeStore(merged, user.uid);
  });
  const merged = decodeStore(transaction.snapshot.val());
  onStore(merged, member);
  const stopData = onValue(ref(realtimeDb, dataPath), snapshot => onStore(decodeStore(snapshot.val()), member), error => onState({ status: "error", authorized: true, connected: false, message: error.message }));
  const stopConnection = onValue(ref(realtimeDb, ".info/connected"), snapshot => onState({ status: snapshot.val() ? "live" : "offline", authorized: true, connected: Boolean(snapshot.val()), member }));
  return () => { stopData(); stopConnection(); };
}

export function writeRealtimeLog(profileId, log) {
  if (!realtimeDb || !firebaseAuth?.currentUser) return Promise.resolve(false);
  return set(ref(realtimeDb, `${dataPath}/logs/${profileId}/${log.date}`), clean(log)).then(() => true);
}

export function writeRealtimeWorkout(profileId, workout) {
  if (!realtimeDb || !firebaseAuth?.currentUser) return Promise.resolve(false);
  return set(ref(realtimeDb, `${dataPath}/workouts/${profileId}/${workout.date}_${workout.type}`), clean(workout)).then(() => true);
}

export function writeRealtimePreferences(preferences) {
  if (!realtimeDb || !firebaseAuth?.currentUser) return Promise.resolve(false);
  return set(ref(realtimeDb, `${dataPath}/preferences`), clean(preferences)).then(() => true);
}

export function replaceRealtimeStore(store) {
  if (!realtimeDb || !firebaseAuth?.currentUser) return Promise.resolve(false);
  return set(ref(realtimeDb, dataPath), encodeStore(store, firebaseAuth.currentUser.uid)).then(() => true);
}
