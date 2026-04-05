/**
 * Same as dashboard/api/shim.js when Vercel Root Directory is the repo root.
 */
module.exports = async function handler(req, res) {
  const base = (process.env.BACKEND_API_ORIGIN || "http://204.168.227.31").replace(
    /\/$/,
    ""
  );

  const host = req.headers.host || "localhost";
  const incoming = new URL(req.url || "/", `http://${host}`);
  const subPath = (incoming.searchParams.get("p") ?? "").replace(/^\/+/, "");
  incoming.searchParams.delete("p");
  const qs = incoming.searchParams.toString();
  const search = qs ? `?${qs}` : "";
  const pathname = subPath ? `/api/${subPath}` : "/api";
  const target = `${base}${pathname}${search}`;

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
