const express = require("express");
const compression = require("compression");
const { proxyAndRewrite } = require("./lib/proxy");
const { generateSitemap } = require("./lib/sitemap");
const { generateRobotsTxt } = require("./lib/robots");

const app = express();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const ORIGIN = process.env.ORIGIN_HOST || "asurascans.com";
const PORT = process.env.PORT || 3000;
// MIRROR_HOST may be set at deploy time; if empty we derive it from the
// incoming request's Host header so it works on any domain automatically.
const MIRROR_HOST = process.env.MIRROR_HOST || "asurascans.app";

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(compression());

// Health-check (useful on Railway / Render)
app.get("/healthz", (_req, res) => res.send("ok"));

// ---------------------------------------------------------------------------
// robots.txt — make sure search engines can crawl and find the sitemap
// ---------------------------------------------------------------------------
app.get("/robots.txt", (req, res) => {
  const mirror = MIRROR_HOST || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  res.type("text/plain").send(generateRobotsTxt(proto, mirror));
});

// ---------------------------------------------------------------------------
// Sitemap proxy — fetch origin sitemap and rewrite URLs
// ---------------------------------------------------------------------------
app.get(["/sitemap.xml", "/sitemap*.xml", "/sitemap-index.xml"], async (req, res) => {
  try {
    const mirror = MIRROR_HOST || req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const xml = await generateSitemap(ORIGIN, proto, mirror, req.path);
    res.type("application/xml").send(xml);
  } catch (err) {
    console.error("[sitemap]", err.message);
    res.status(502).send("Sitemap fetch failed");
  }
});

// ---------------------------------------------------------------------------
// Main catch-all reverse proxy
// ---------------------------------------------------------------------------
app.all("*", async (req, res) => {
  try {
    const mirror = MIRROR_HOST || req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    await proxyAndRewrite(req, res, { origin: ORIGIN, mirror, proto });
  } catch (err) {
    console.error("[proxy]", err.message);
    if (!res.headersSent) {
      res.status(502).send("Bad Gateway");
    }
  }
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Mirror proxy listening on :${PORT}`);
  console.log(`Origin: ${ORIGIN}`);
  console.log(`Mirror host: ${MIRROR_HOST || "(auto from Host header)"}`);
});
