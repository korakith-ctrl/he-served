import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);
export const supabase = supabaseConfigured ? createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;

export async function getSyncSession() {
  if (!supabase) return { configured: false, session: null };
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return { configured: true, session: data.session };
}

export async function requestMagicLink(email) {
  if (!supabase) throw new Error("ยังไม่ได้ตั้งค่า Supabase environment variables");
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
  if (error) throw error;
}

export async function signOutSync() {
  if (supabase) await supabase.auth.signOut();
}

export async function syncProfileLogs(profile, logs, workouts = []) {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw new Error("กรุณาเข้าสู่ระบบก่อน Sync");
  const { data: remoteProfile, error: profileError } = await supabase.from("profiles").select("id").eq("user_id", sessionData.session.user.id).maybeSingle();
  if (profileError) throw profileError;
  if (!remoteProfile) throw new Error(`ยังไม่มี Supabase profile สำหรับ ${profile.name}`);
  const rows = logs.map(log => ({
    profile_id: remoteProfile.id, date: log.date, weight: log.weight ?? null, calories: log.calories ?? null,
    protein: log.protein ?? null, carbs: log.carbs ?? null, fat: log.fat ?? null, water: log.water ?? null,
    steps: log.steps ?? null, sleep_minutes: log.sleep ?? null, waist: log.waist ?? null, body_fat: log.bodyFat ?? null,
    muscle_mass: log.muscle ?? null, visceral_fat: log.visceral ?? null, mood: log.mood ?? null,
    hunger: log.hunger ?? null, energy: log.energy ?? null, notes: log.notes ?? null,
    workout_completed: Boolean(log.workout), rest_day: Boolean(log.restDay), sick_day: Boolean(log.sickDay),
    vacation_mode: Boolean(log.vacationMode), updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from("daily_logs").upsert(rows, { onConflict: "profile_id,date" });
  if (error) throw error;
  let syncedWorkouts = 0;
  for (const workout of workouts) {
    const { data: saved, error: workoutError } = await supabase.from("workouts").upsert({
      profile_id: remoteProfile.id, date: workout.date, workout_type: workout.type,
    }, { onConflict: "profile_id,date,workout_type" }).select("id").single();
    if (workoutError) throw workoutError;
    const { error: deleteError } = await supabase.from("workout_sets").delete().eq("workout_id", saved.id);
    if (deleteError) throw deleteError;
    const sets = (workout.exercises || []).flatMap(exercise => exercise.sets.map((set, index) => ({
      workout_id: saved.id, exercise: exercise.name, set_number: index + 1, weight: set.weight ?? null,
      reps: set.reps ?? null, rir: exercise.rir ?? null,
    }))).filter(set => set.weight != null || set.reps != null);
    if (sets.length) {
      const { error: setsError } = await supabase.from("workout_sets").insert(sets);
      if (setsError) throw setsError;
    }
    syncedWorkouts += 1;
  }
  return { logs: rows.length, workouts: syncedWorkouts };
}
