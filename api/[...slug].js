/**
 * Same-origin /api proxy when Vercel **Root Directory** is the repo root (`.`).
 * If Root Directory is `dashboard`, use `dashboard/api/[...slug].js` instead.
 */
module.exports = async function handler(req, res) {
  const base = (process.env.BACKEND_API_ORIGIN || "http://204.168.227.31").replace(
    /\/$/,
    ""
  );

  const slug = req.query.slug;
  const parts = !slug ? [] : Array.isArray(slug) ? slug : [slug];
  const suffix = parts.length ? `/${parts.join("/")}` : "";
  const pathname = `/api${suffix}`;

  const host = req.headers.host || "localhost";
  const incoming = new URL(req.url || "/", `http://${host}`);
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
};
