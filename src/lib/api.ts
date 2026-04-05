/**
 * Point this at a FastAPI (or other) service that reads SQLite / Postgres.
 * In Lovable: set VITE_API_URL in project env, or use Lovable Cloud server routes.
 */
const base = () => (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export async function fetchJson<T>(path: string): Promise<T> {
  const b = base();
  if (!b) {
    throw new Error("VITE_API_URL is not set");
  }
  const res = await fetch(`${b}${path.startsWith("/") ? path : `/${path}`}`);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function hasApiBase(): boolean {
  return Boolean(base());
}
