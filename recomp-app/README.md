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
