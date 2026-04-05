export default function Behavior() {
  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <h2 className="text-base font-semibold text-slate-200">Behavior &amp; post-loss</h2>
      <p className="text-sm text-slate-400">
        Placeholder for post-loss analysis, turnover charts, and qualitative reasoning — mirror the{" "}
        <strong className="text-slate-300">Tests &amp; risk → Behavior</strong> section from Streamlit once
        your API returns the same aggregates.
      </p>
      <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
        Chart area — wire to <code className="text-slate-400">GET /api/post-loss/summary</code> (example)
      </div>
    </div>
  );
}
