/**
 * Same as dashboard/api/shim.js when Vercel Root Directory is the repo root.
 * Rewrites must stay path-to-regexp–friendly (no fragile lookaheads).
 */
async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : null;
}

const UPSTREAM_TIMEOUT_MS = Number(
  process.env.BACKEND_API_TIMEOUT_MS || 25000
);

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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const method = req.method || "GET";
    const hasBody = method !== "GET" && method !== "HEAD";
    const body = hasBody ? await readRequestBody(req) : null;
    const headers = {
      Accept: req.headers.accept || "application/json",
    };
    const contentType = req.headers["content-type"];
    if (contentType) {
      headers["Content-Type"] = contentType;
    }

    const upstream = await fetch(target, {
      method,
      headers,
      body: body && body.length > 0 ? body : undefined,
      duplex: hasBody ? "half" : undefined,
      signal: controller.signal,
    });

    const ct = upstream.headers.get("content-type");
    if (ct) {
      res.setHeader("content-type", ct);
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).send(buf);
  } catch (err) {
    const aborted = controller.signal.aborted;
    res.status(aborted ? 504 : 502).json({
      error: aborted ? "api_proxy_timeout" : "api_proxy_failed",
      message: aborted
        ? `Upstream API at ${base} did not respond within ${Math.round(
            UPSTREAM_TIMEOUT_MS / 1000
          )}s. The backend may be overloaded or restarting.`
        : err instanceof Error
          ? err.message
          : String(err),
      target,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};
