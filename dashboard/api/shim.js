/**
 * All browser `/api/*` requests are rewritten here (see vercel.json). The previous rewrite
 * used a regex negative lookahead that Vercel did not apply, so every `/api/*` route 404’d.
 */
async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : null;
}

export default async function handler(req, res) {
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
