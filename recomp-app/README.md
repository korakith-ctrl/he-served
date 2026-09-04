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

## Reminders

The installed PWA can request browser-notification permission and check incomplete weigh-in, protein, workout, and weekly-review tasks at configurable Bangkok times. Browser timers can show these reminders while the app is running. Reliable delivery after the app is fully terminated requires a separately configured Web Push server; the UI states this limitation instead of claiming background delivery.

## Apple Health beta

Signed-in members can create or revoke a one-time pairing token from **Realtime sync & reminders → Apple Health · Beta**. The native source is in `../recomp-health-ios`. Its HTTPS bridge fills empty daily fields from HealthKit—including exercise minutes and resting heart rate—and refreshes fields already sourced from Apple Health; manually entered Recomp values take precedence.
