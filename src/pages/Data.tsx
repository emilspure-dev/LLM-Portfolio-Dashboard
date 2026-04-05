import { useEffect, useState } from "react";
import { fetchJson, hasApiBase } from "../lib/api";

export default function Data() {
  const [status, setStatus] = useState<string>("idle");
  const [payload, setPayload] = useState<unknown>(null);

  useEffect(() => {
    if (!hasApiBase()) {
      setStatus("no-api");
      return;
    }
    setStatus("loading");
    fetchJson<{ ok?: boolean }>("/health")
      .then((j) => {
        setPayload(j);
        setStatus("ok");
      })
      .catch((e: Error) => {
        setPayload({ error: e.message });
        setStatus("error");
      });
  }, []);

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <h2 className="text-base font-semibold text-slate-200">Data &amp; API</h2>
      <p className="text-sm text-slate-400">
        SQLite should sit <strong className="text-slate-300">behind an API</strong> (FastAPI + SQLAlchemy is a
        common pair). The browser calls HTTP; the server opens the <code className="rounded bg-slate-800 px-1">.db</code>{" "}
        file.
      </p>
      {!hasApiBase() ? (
        <div className="rounded-lg bg-amber-950/40 p-4 text-sm text-amber-200/90">
          Set <code className="rounded bg-slate-900 px-1">VITE_API_URL</code> (e.g.{" "}
          <code className="rounded bg-slate-900 px-1">https://your-api.example.com</code>) to probe{" "}
          <code className="rounded bg-slate-900 px-1">/health</code>.
        </div>
      ) : (
        <div className="rounded-lg bg-slate-800/50 p-4 font-mono text-xs text-slate-300">
          <div className="mb-2 text-slate-500">status: {status}</div>
          <pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(payload, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
