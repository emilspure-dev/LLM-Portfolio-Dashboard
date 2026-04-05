import type { ReactNode } from "react";

type Props = { children: ReactNode; nav: ReactNode };

export default function Layout({ children, nav }: Props) {
  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-lg font-semibold tracking-tight text-slate-100">
            Thesis portfolio dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            React shell — connect a backend + DB for full parity with Streamlit{" "}
            <code className="rounded bg-slate-800 px-1">app.py</code>
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-6">
        {nav}
        <main className="mt-6">{children}</main>
      </div>
    </div>
  );
}
