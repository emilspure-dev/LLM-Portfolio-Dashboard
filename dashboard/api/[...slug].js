/**
 * Proxies /api/* to the real dashboard API (Node SQLite server).
 * Set BACKEND_API_ORIGIN in Vercel → Environment Variables (e.g. http://204.168.227.31 — no trailing slash).
 * Keeps the browser on same-origin /api so the SPA does not need VITE_API_BASE_URL.
 */
export default async function handler(req, res) {
  const base = (process.env.BACKEND_API_ORIGIN || "http://204.168.227.31").replace(
    /\/$/,
    ""
  );

  const host = req.headers.host || "localhost";
  const incoming = new URL(req.url || "/", `http://${host}`);
  // Do not rebuild the path from req.query.slug — on Vercel it is often missing/wrong for
  // catch-all routes, which produced upstream GET /api instead of /api/health.
  const pathname = incoming.pathname || "/api";
  const target = `${base}${pathname}${incoming.search}`;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        Accept: req.headers.accept || "application/json",
      },
    });

    const ct = upstream.headers.get("content-type");
    if (ct) {
      res.setHeader("content-type", ct);
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).send(buf);
  } catch (err) {
    res.status(502).json({
      error: "api_proxy_failed",
      message: err instanceof Error ? err.message : String(err),
      target,
    });
  }
}
