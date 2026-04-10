const { Readable } = require("stream");
const zlib = require("zlib");
const { rewriteHtml } = require("./rewriter");

// Headers we must NOT forward downstream
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
]);

/**
 * Fetch a page from the origin, rewrite HTML / redirects / headers, and pipe
 * the response back to the client.
 */
async function proxyAndRewrite(req, res, { origin, mirror, proto }) {
  // ---- Build the upstream URL ----
  const upstreamUrl = new URL(req.originalUrl, `https://${origin}`);

  // ---- Build upstream request headers ----
  const upHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    upHeaders[k] = v;
  }
  upHeaders["host"] = origin;
  upHeaders["x-forwarded-for"] =
    req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  // Accept-Encoding: we need to decompress to rewrite, so ask for identity
  // unless it's a non-rewritable type (images, fonts, etc.)
  upHeaders["accept-encoding"] = "gzip, deflate, br";

  // ---- Fetch from origin ----
  const upstreamRes = await fetch(upstreamUrl.toString(), {
    method: req.method,
    headers: upHeaders,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
    redirect: "manual", // We handle redirects ourselves
  });

  const status = upstreamRes.status;
  const contentType = upstreamRes.headers.get("content-type") || "";
  const isHtml = contentType.includes("text/html");
  const isXml =
    contentType.includes("text/xml") ||
    contentType.includes("application/xml") ||
    contentType.includes("application/rss+xml") ||
    contentType.includes("application/atom+xml");
  const isCss = contentType.includes("text/css");
  const isJs =
    contentType.includes("javascript") ||
    contentType.includes("application/json");

  // ---- Copy response headers ----
  for (const [key, value] of upstreamRes.headers.entries()) {
    const lk = key.toLowerCase();
    if (HOP_BY_HOP.has(lk)) continue;
    if (lk === "content-encoding") continue; // we decompress ourselves
    if (lk === "content-length") continue; // length changes after rewrite
    if (lk === "content-security-policy") continue; // often blocks mirror

    // Rewrite location headers for redirects
    if (lk === "location") {
      const newLoc = rewriteUrl(value, origin, mirror, proto);
      res.setHeader("location", newLoc);
      continue;
    }

    // Rewrite set-cookie domain
    if (lk === "set-cookie") {
      const rewritten = value.replace(
        new RegExp(escapeRegex(origin), "gi"),
        mirror
      );
      res.append("set-cookie", rewritten);
      continue;
    }

    // Rewrite Link headers
    if (lk === "link") {
      res.setHeader(
        key,
        value.replace(new RegExp(escapeRegex(origin), "gi"), mirror)
      );
      continue;
    }

    res.setHeader(key, value);
  }

  // Make sure we don't send X-Frame-Options that blocks embedding
  res.removeHeader("x-frame-options");

  // ---- Handle redirects (3xx) ----
  if (status >= 300 && status < 400) {
    res.status(status).end();
    return;
  }

  // ---- Non-rewritable content — stream it straight through ----
  if (!isHtml && !isXml && !isCss && !isJs) {
    res.status(status);
    const body = Readable.fromWeb(upstreamRes.body);
    body.pipe(res);
    return;
  }

  // ---- Decompress the body ----
  const rawBody = Buffer.from(await upstreamRes.arrayBuffer());
  const encoding = upstreamRes.headers.get("content-encoding");
  let body;
  try {
    if (encoding === "gzip") {
      body = zlib.gunzipSync(rawBody);
    } else if (encoding === "deflate") {
      body = zlib.inflateSync(rawBody);
    } else if (encoding === "br") {
      body = zlib.brotliDecompressSync(rawBody);
    } else {
      body = rawBody;
    }
  } catch {
    body = rawBody;
  }

  let text = body.toString("utf-8");

  // ---- Rewrite content ----
  if (isHtml) {
    text = rewriteHtml(text, origin, mirror, proto);
    // Replace canonical placeholder with the actual request path
    text = text.replace("%%CANONICAL_PATH%%", `${proto}://${mirror}${req.originalUrl}`);
  } else {
    // CSS / JS / XML — simple string replacement
    text = text.replace(
      new RegExp(escapeRegex(origin), "gi"),
      mirror
    );
    // Also replace protocol-relative URLs
    text = text.replace(
      new RegExp(`//${escapeRegex(origin)}`, "gi"),
      `//${mirror}`
    );
  }

  res.status(status);
  res.setHeader("content-type", contentType);
  res.send(text);
}

function rewriteUrl(url, origin, mirror, proto) {
  try {
    const u = new URL(url);
    if (u.hostname === origin) {
      u.hostname = mirror.split(":")[0];
      if (mirror.includes(":")) u.port = mirror.split(":")[1];
      u.protocol = proto + ":";
    }
    return u.toString();
  } catch {
    // relative URL
    return url.replace(new RegExp(escapeRegex(origin), "gi"), mirror);
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { proxyAndRewrite };
