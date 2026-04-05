# Thesis dashboard (React UI)

Vite + React + TypeScript + Tailwind + shadcn-style components. Full evaluation logic lives in the parent repo’s Streamlit `app.py`; this app can load an evaluation `.xlsx` or static JSON exports.

## Develop

```bash
npm install
npm run dev
```

## Build / Vercel

Root directory for hosting: **`dashboard`** (inside the `web` folder once you rename `lovable-web` → `web`). `vercel.json` includes SPA rewrites.

## Playwright

```bash
npx playwright install
npx playwright test
```
