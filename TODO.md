# Lovable + web dashboard — what to do & how to do it

Check items off as you go. **What** = task. **How** = concrete steps (commands, clicks, code patterns).

---

## 1. Get the app into Lovable

### What

- [ ] Push `lovable-web/` to GitHub (dedicated repo or monorepo subfolder).
- [ ] In Lovable: import project from GitHub **or** create empty Vite React and copy files from `lovable-web/`.
- [ ] Confirm build: `npm run build`, output directory `dist`, Node 18+.
- [ ] Paste the prompt block from `LOVABLE_PROMPT.txt` into Lovable chat (optional).

### How

**Push only `lovable-web` as its own repo (simplest)**

```powershell
cd c:\Users\jkmo\thesis_dashboard\lovable-web
git init
git add .
git commit -m "Initial Lovable web shell"
```

Create an **empty** repo on GitHub (no README), then:

```powershell
git remote add origin https://github.com/YOU/thesis-dashboard-web.git
git branch -M main
git push -u origin main
```

**Or** keep monorepo: push whole `thesis_dashboard` and in Lovable set **root directory** / build context to `lovable-web` if the host supports it (Netlify/Vercel “base directory”; Lovable may expect repo root—check their import UI).

**Local run before Lovable**

```powershell
cd c:\Users\jkmo\thesis_dashboard\lovable-web
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

**In Lovable (typical flow)**

1. New project → **Import from GitHub** → pick the repo.  
2. If it doesn’t auto-detect: set **Install** `npm install`, **Build** `npm run build`, **Output** `dist`.  
3. SPA routing: if deep links 404 on refresh, add a rewrite rule so all paths serve `index.html` (Vercel/Netlify/Lovable docs usually call this “SPA fallback”).

**Env in Lovable**

- Add **`VITE_API_URL`** in the project’s environment settings (e.g. `https://api.yourdomain.com` — **no** trailing slash required; code trims it).  
- Redeploy after changing env vars.

---

## 2. Pick data storage (choose one path)

### What

- [ ] **A — Postgres** (Lovable Cloud / Supabase).  
- [ ] **B — SQLite + your own API** (FastAPI on a VPS/Railway/Fly with a disk).  
- [ ] **C — Turso / libSQL** (hosted SQLite, server-side driver).

### How

**A — Supabase (Postgres)**

1. Go to [supabase.com](https://supabase.com) → New project.  
2. **SQL Editor** → run `CREATE TABLE` statements for `runs`, etc.  
3. **Project Settings → API**: copy `URL` and `anon` key.  
4. Use the **service role** or **serverless functions** for anything sensitive; the **anon** key in the browser is public—use **Row Level Security** or only call Supabase from a backend you control.  
5. In Lovable, store secrets in **server-side** env, not hardcoded in `src/`.

**B — SQLite file + FastAPI (minimal pattern)**

1. Put `data.db` on the same machine/container as the API (persistent volume on Railway/Fly/Render).  
2. Open DB only in Python:

```python
import sqlite3
conn = sqlite3.connect("/data/eval.db")  # path only on server
```

3. Expose JSON over HTTP; the React app never sees the path.

**C — Turso**

1. Create DB at [turso.tech](https://turso.tech), get URL + auth token.  
2. Use their client in **Node or Python on the server**; keep token in env.

---

## 3. Backend API

### What

- [ ] `GET /health`
- [ ] `GET /api/runs` (query: `market`, `period`, `prompt_type`)
- [ ] `GET /api/post-loss/summary`
- [ ] Optional: `GET /api/regime`
- [ ] CORS for Lovable + production origins
- [ ] Set `VITE_API_URL` on the frontend

### How

**FastAPI skeleton (SQLite + CORS)**

```python
# pip install fastapi uvicorn
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import sqlite3

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://YOUR-LOVABLE-PREVIEW.lovable.app",  # replace
        "https://YOUR-PROD-DOMAIN.com",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

def db():
    return sqlite3.connect("eval.db")  # use absolute path + volume in prod

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/api/runs")
def runs(market: str | None = None, period: str | None = None):
    conn = db()
    q = "SELECT * FROM portfolio_runs WHERE 1=1"
    params = []
    if market:
        q += " AND market = ?"
        params.append(market)
    if period:
        q += " AND period = ?"
        params.append(period)
    # ... use cursor, return list of dicts
    return {"rows": []}
```

Run locally:

```powershell
uvicorn main:app --reload --port 8000
```

Frontend dev: create `lovable-web/.env.development`:

```env
VITE_API_URL=http://localhost:8000
```

**Contract with the React app**

- `src/lib/api.ts` expects `VITE_API_URL` and calls paths like `/health`.  
- Keep JSON shapes stable; TypeScript `types/` in `lovable-web` can mirror responses.

---

## 4. Data load (ETL)

### What

- [ ] Define tables matching what you need from the evaluation package (at minimum: runs + identifiers + returns + `post_loss_rebalance` + reasoning column names).
- [ ] Script: Excel → SQLite/Postgres.
- [ ] Defer Excel-in-browser until reads work.

### How

**One-shot Python (pandas → SQLite)**

```python
import pandas as pd
df = pd.read_excel("evaluation_package.xlsx", sheet_name="Portfolio runs")
conn = sqlite3.connect("eval.db")
df.to_sql("portfolio_runs", conn, if_exists="replace", index=False)
conn.close()
```

Adjust `sheet_name` and column names to match your file. For Postgres, use `sqlalchemy` + `to_sql` with a connection string.

**Schema tip**

Mirror columns you already use in Streamlit (`trajectory_id`, `period`, `market`, `prompt_type`, `net_return` / `period_return`, `post_loss_rebalance`, any `reasoning_*` text column). Add indexes on `(trajectory_id, period, market)` for faster filters.

---

## 5. Frontend routes & UI

### What

- [ ] Overview, Performance, Run explorer, Post-loss, Data/debug pages filled in.
- [ ] Charts (Recharts or Plotly.js).

### How

**Add a route**

1. Create `src/pages/YourPage.tsx`.  
2. In `App.tsx`, add `<Route path="/your-page" element={<YourPage />} />` and a `NavLink`.

**Fetch data**

```tsx
const base = import.meta.env.VITE_API_URL;
const res = await fetch(`${base}/api/runs?market=us`);
const data = await res.json();
```

Wrap in `useEffect` + `useState`; show spinner while loading and `error.message` on failure.

**Charts**

- **Recharts**: `npm install recharts` — `BarChart`, `LineChart`, etc.  
- **Plotly.js**: `npm install react-plotly.js plotly.js` — heavier but closer to Streamlit Plotly.

**Theme**

Tailwind classes already use `slate-950` / accents; extend `tailwind.config.js` to match `app.py` colors if you want pixel parity.

---

## 6. Polish

### What

- [ ] Loading/error on every fetch.
- [ ] Auth if needed.

### How

- **Loading:** `const [loading, setLoading] = useState(true)` → set false in `finally`.  
- **Auth:** Supabase Auth, Clerk, or Lovable’s built-in auth—protect API with JWT or session cookies and validate on the server.

---

## 7. Optional later

### What

- [ ] Excel upload in UI.
- [ ] More Streamlit tabs ported.

### How

- **Upload:** `<input type="file" />` → `FormData` → `POST /api/upload` → server saves file and runs pandas/sqlite import (or queues a job). Max file size limits on the host.  
- **Port tabs:** open `app.py`, find the `st.tabs` / section, list KPIs and charts, recreate one screen at a time using the same API fields.

---

## Quick verification

| Step | How to verify |
|------|----------------|
| Frontend builds | `npm run build` succeeds locally. |
| API reachable | Browser or curl: `GET {VITE_API_URL}/health` returns JSON. |
| CORS | Open Lovable preview; Network tab shows runs request not blocked by CORS. |
| Data page | `Data.tsx` shows pretty JSON from `/health` when `VITE_API_URL` is set. |

Official Lovable deployment notes: [Deployment & hosting](https://docs.lovable.dev/tips-tricks/deployment-hosting-ownership) and [External deployment](https://docs.lovable.dev/tips-tricks/external-deployment-hosting).
