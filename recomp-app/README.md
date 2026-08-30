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

Demo logs are stored only in this app's `localStorage` namespace. The production Supabase schema and Row Level Security policies are in `supabase/migrations`.
