# Recomp · 16 Week Protocol

Standalone Vite application for Zackdark and Tony. This app has its own dependencies, build output, PWA scope, offline storage, database migration, and Vercel project.

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

Real logs and workout sessions are local-first in the app's own versioned `localStorage` namespace. Demo preview is generated in memory and never overwrites real logs. Optional Supabase magic-link sync, schema, and Row Level Security policies are in `supabase/migrations`.
