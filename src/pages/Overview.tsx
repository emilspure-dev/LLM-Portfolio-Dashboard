export default function Overview() {
  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <h2 className="text-base font-semibold text-slate-200">Overview</h2>
      <p className="text-sm leading-relaxed text-slate-400">
        This is a starter UI aligned with hosting on{" "}
        <strong className="text-slate-300">Lovable</strong> (Vite + React + TypeScript + Tailwind).
        Your original dashboard logic lives in Python Streamlit{" "}
        <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">../app.py</code>.
      </p>
      <ul className="list-inside list-disc space-y-2 text-sm text-slate-400">
        <li>Add charts (e.g. Recharts, ECharts, or Plotly.js) per route.</li>
        <li>
          Load data from <code className="rounded bg-slate-800 px-1">fetch</code> against your API, not from{" "}
          <code className="rounded bg-slate-800 px-1">pandas</code> in the browser.
        </li>
        <li>Keep SQLite on the server; expose read-only JSON endpoints for the SPA.</li>
      </ul>
    </div>
  );
}
