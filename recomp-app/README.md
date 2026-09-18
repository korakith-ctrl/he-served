# Recomp · 16 Week Protocol

Standalone Vite application for Zackdark and Tony. This app has its own dependencies, build output, PWA scope, offline storage, Firebase Realtime Database namespace, and Vercel project.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Production build

```bash
npm run build
npm run preview
```

Real logs and workout sessions are local-first in the app's own versioned `localStorage` namespace and synchronize live through the existing Firebase project after Google sign-in. Challenge data lives under `recompChallenges/16-week-2026`; database rules restrict access to the seeded ZackDark and Tony Kora member UIDs. Demo preview is generated in memory and never overwrites real or remote logs.

## Coaching behavior

- Weight trends use fixed Bangkok calendar windows and require at least four weigh-ins in each 7-day window.
- Calorie changes are suggestions only, require explicit confirmation, and are limited to one change every seven days.
- A calorie reduction is not suggested until two slow-loss weeks also have at least five nutrition logs and 80% calorie adherence.
- Sick and vacation days are excluded from adherence decisions.
- Meal details, weekly active minutes, strength progression, recovery signals, and calorie-plan history are included in JSON backups and Realtime Database sync.

## Food photo estimates

Open **บันทึก → Nutrition**, select a meal, then **ถ่ายรูปอาหาร** or **เลือกรูป**. The image is prepared locally; only pressing **ประเมินจากรูป** sends it to Google Gemini. Review the food names, visible portions, nutrition, and the amount actually eaten (e.g. `0.5` for half the pictured portion). **เพิ่มลงมื้อ** adds all reviewed items once; **บันทึก** saves the daily log through the existing local-first/sync flow. Changing meal/date or leaving the page discards the pending photo draft and ignores late analysis responses.

Results are approximate, not measured nutrition. Users can edit every nutrient or remove misidentified foods. Empty/non-food results never add calories. The original image is not stored in RTDB, Storage, logs, or diary backups; only reviewed food entries are saved. The client re-encodes photos to JPEG at at most 1600px and removes original metadata. HEIC/HEIF uses native browser decoding when available, with a lazily loaded local decoder as a fallback. Files with an empty MIME type are recognized by their HEIC/HEIF extension.

The callable `estimateRecompFoodPhoto` requires Google sign-in and existing challenge membership. It uses the server-side `GEMINI_API_KEY` secret, with `GEMINI_FOOD_MODEL` defaulting to `gemini-3.5-flash`, a 12 estimates/hour/member quota, and a 5MB encoded-image limit. No AI key is exposed to Vite. The integration follows [Gemini image input documentation](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding). Temporary model failures (including HTTP 503) fall back to Flash-Lite models. Sampling parameters such as `temperature` are omitted.

The **บันทึก** page also offers a single daily text entry. `parseRecompDailyLog` separates food into breakfast/lunch/dinner/snacks (or leaves the meal unassigned for review), plain water, exercise minutes/description, Zone 2 and stated steps. It has a separate 12 estimates/hour/member quota. Users edit the preview before adding it to the selected date's form, then press **บันทึก**. Food is appended to existing meals; stated water and activity become daily totals. Exercise descriptions and minutes are saved with the log and included in CSV exports.

Deploy the backend from the repository root before deploying the Vercel app:

```bash
npx firebase-tools deploy --only functions:estimateRecompFoodPhoto,functions:parseRecompDailyLog --project he-served
```

For Vercel, use the `recomp-16-week` project link at the repository root, then run `npx vercel --prod --yes` there. That Vercel project's Root Directory is `recomp-app`.

The project must already have `GEMINI_API_KEY` in Secret Manager. Unit tests cover authorization, quota, malformed/provider responses, non-food images, portion scaling, batch addition and log serialization. A real model response needs a configured, signed-in environment.

## Reminders

The installed PWA can request browser-notification permission and check incomplete weigh-in, protein, workout, and weekly-review tasks at configurable Bangkok times. Browser timers can show these reminders while the app is running. Reliable delivery after the app is fully terminated requires a separately configured Web Push server; the UI states this limitation instead of claiming background delivery.

## Apple Health beta

Signed-in members can create or revoke a one-time pairing token from **Realtime sync & reminders → Apple Health · Beta**. The native source is in `../recomp-health-ios`. Its HTTPS bridge fills empty daily fields from HealthKit—including exercise minutes and resting heart rate—and refreshes fields already sourced from Apple Health; manually entered Recomp values take precedence.

The separate SwiftUI app in `../recomp-ios` has its own pairing token under **Realtime sync & reminders → Recomp SwiftUI · Beta**. It reads the same challenge data and can add daily values or sync Apple Health without replacing meal details or manual values. The web app and the existing Health companion remain available in parallel.
