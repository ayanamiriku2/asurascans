const cheerio = require("cheerio");

/**
 * Deep-rewrite an HTML page so every reference to the origin domain is
 * replaced with the mirror domain. Also fixes:
 *  - canonical tags
 *  - og:url / twitter:url meta tags
 *  - JSON-LD structured data (breadcrumbs, article, website, etc.)
 *  - hreflang tags
 *  - all href / src / action / srcset attributes
 *  - inline styles with url()
 *  - inline scripts containing origin URLs
 */
function rewriteHtml(html, origin, mirror, proto) {
  const $ = cheerio.load(html, { decodeEntities: false });

  const mirrorBase = `${proto}://${mirror}`;
  const originPatterns = [
    `https://${origin}`,
    `http://${origin}`,
    `//${origin}`,
  ];

  // -----------------------------------------------------------------------
  // 1. Canonical — this is the #1 fix for "Google chose different canonical"
  // -----------------------------------------------------------------------
  // Remove ALL existing canonical tags first, then add exactly one
  $('link[rel="canonical"]').remove();

  // Determine the canonical path from og:url or from the page itself
  let canonicalPath = "";
  const ogUrl = $('meta[property="og:url"]').attr("content");
  if (ogUrl) {
    try {
      canonicalPath = new URL(ogUrl).pathname;
    } catch {
      canonicalPath = ogUrl;
    }
  }
  // If no og:url, we can't determine canonical here – the proxy will add it
  // from the request URL (see below, we inject a placeholder)
  if (!canonicalPath) {
    // We insert a placeholder that server.js can replace
    canonicalPath = "%%CANONICAL_PATH%%";
  }

  // Insert a fresh canonical tag at the top of <head>
  const canonUrl =
    canonicalPath === "%%CANONICAL_PATH%%"
      ? canonicalPath
      : mirrorBase + canonicalPath;
  $("head").prepend(`<link rel="canonical" href="${canonUrl}" />\n`);

  // -----------------------------------------------------------------------
  // 2. Meta tags: og:url, og:image, twitter:url, twitter:image
  // -----------------------------------------------------------------------
  $(
    'meta[property="og:url"], meta[property="og:image"], meta[name="twitter:url"], meta[name="twitter:image"]'
  ).each(function () {
    const content = $(this).attr("content");
    if (content) {
      $(this).attr("content", replaceOrigin(content, origin, mirror, proto));
    }
  });

  // og:site_name — some themes set this to the origin domain
  $('meta[property="og:site_name"]').each(function () {
    const v = $(this).attr("content");
    if (v && v.toLowerCase().includes(origin.toLowerCase())) {
      $(this).attr("content", v.replace(new RegExp(esc(origin), "gi"), mirror));
    }
  });

  // -----------------------------------------------------------------------
  // 3. JSON-LD structured data — fix breadcrumbs, website, article, etc.
  // -----------------------------------------------------------------------
  $('script[type="application/ld+json"]').each(function () {
    try {
      let raw = $(this).html();
      if (!raw) return;

      // Parse, deeply rewrite, re-serialize
      let data = JSON.parse(raw);
      data = deepRewriteJsonLd(data, origin, mirror, proto);
      $(this).html(JSON.stringify(data, null, 0));
    } catch (e) {
      // If JSON-LD is malformed, try to fix it by removing it or doing
      // plain string replacement so Google doesn't flag "unparseable"
      let raw = $(this).html() || "";
      const fixed = replaceAllOccurrences(raw, origin, mirror, proto);
      // Validate resulting JSON
      try {
        JSON.parse(fixed);
        $(this).html(fixed);
      } catch {
        // Completely broken JSON-LD — remove it to avoid GSC errors
        $(this).remove();
      }
    }
  });

  // -----------------------------------------------------------------------
  // 4. hreflang tags
  // -----------------------------------------------------------------------
  $("link[hreflang]").each(function () {
    const href = $(this).attr("href");
    if (href) {
      $(this).attr("href", replaceOrigin(href, origin, mirror, proto));
    }
  });

  // -----------------------------------------------------------------------
  // 5. All href, src, action, data, poster, srcset attributes
  // -----------------------------------------------------------------------
  $("[href]").each(function () {
    const v = $(this).attr("href");
    if (v) $(this).attr("href", replaceOrigin(v, origin, mirror, proto));
  });
  $("[src]").each(function () {
    const v = $(this).attr("src");
    if (v) $(this).attr("src", replaceOrigin(v, origin, mirror, proto));
  });
  $("[action]").each(function () {
    const v = $(this).attr("action");
    if (v) $(this).attr("action", replaceOrigin(v, origin, mirror, proto));
  });
  $("[data-src]").each(function () {
    const v = $(this).attr("data-src");
    if (v) $(this).attr("data-src", replaceOrigin(v, origin, mirror, proto));
  });
  $("[data-lazy-src]").each(function () {
    const v = $(this).attr("data-lazy-src");
    if (v)
      $(this).attr("data-lazy-src", replaceOrigin(v, origin, mirror, proto));
  });
  $("[poster]").each(function () {
    const v = $(this).attr("poster");
    if (v) $(this).attr("poster", replaceOrigin(v, origin, mirror, proto));
  });
  $("[srcset]").each(function () {
    const v = $(this).attr("srcset");
    if (v)
      $(this).attr("srcset", replaceAllOccurrences(v, origin, mirror, proto));
  });

  // -----------------------------------------------------------------------
  // 6. Inline <style> blocks
  // -----------------------------------------------------------------------
  $("style").each(function () {
    const css = $(this).html();
    if (css) {
      $(this).html(replaceAllOccurrences(css, origin, mirror, proto));
    }
  });

  // -----------------------------------------------------------------------
  // 7. Inline style= attributes
  // -----------------------------------------------------------------------
  $("[style]").each(function () {
    const v = $(this).attr("style");
    if (v) $(this).attr("style", replaceAllOccurrences(v, origin, mirror, proto));
  });

  // -----------------------------------------------------------------------
  // 8. Inline <script> blocks (non JSON-LD)
  // -----------------------------------------------------------------------
  $('script:not([type="application/ld+json"])').each(function () {
    let code = $(this).html();
    if (!code) return;

    // Fix: google-btn element was removed, so guard the .href assignment
    // to prevent a JS error that kills the rest of the script (toggle handlers etc.)
    code = code.replace(
      /document\.getElementById\(['"]google-btn['"]\)\.href\s*=/g,
      "var _gb=document.getElementById('google-btn'); if(_gb) _gb.href ="
    );

    if (code.includes(origin)) {
      code = replaceAllOccurrences(code, origin, mirror, proto);
    }
    $(this).html(code);
  });

  // -----------------------------------------------------------------------
  // 9. Remove any <base> tag that points to origin
  // -----------------------------------------------------------------------
  $("base").each(function () {
    const href = $(this).attr("href");
    if (href && href.includes(origin)) {
      $(this).attr("href", replaceOrigin(href, origin, mirror, proto));
    }
  });

  // -----------------------------------------------------------------------
  // 10. Remove Google login button & "or" divider (keep email forms)
  // -----------------------------------------------------------------------
  $('#google-btn').remove();
  $('.or-divider').remove();

  // -----------------------------------------------------------------------
  // 11. Add / fix meta robots — allow indexing
  // -----------------------------------------------------------------------
  $('meta[name="robots"]').remove();
  $("head").append('<meta name="robots" content="index, follow" />\n');

  return $.html();
}

// ---------------------------------------------------------------------------
// JSON-LD deep rewriter
// ---------------------------------------------------------------------------
function deepRewriteJsonLd(obj, origin, mirror, proto) {
  if (typeof obj === "string") {
    return replaceOrigin(obj, origin, mirror, proto);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepRewriteJsonLd(item, origin, mirror, proto));
  }
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [key, val] of Object.entries(obj)) {
      out[key] = deepRewriteJsonLd(val, origin, mirror, proto);
    }
    // Fix common breadcrumb issues: ensure @type and @id exist
    if (out["@type"] === "BreadcrumbList" && Array.isArray(out.itemListElement)) {
      out.itemListElement = out.itemListElement.map((item, idx) => {
        if (!item["@type"]) item["@type"] = "ListItem";
        if (!item.position) item.position = idx + 1;
        // Ensure item has a valid URL in "item" field
        if (item.item && typeof item.item === "object" && item.item["@id"]) {
          // Already good
        } else if (typeof item.item === "string") {
          // wrap string URL as proper object
          item.item = { "@type": "WebPage", "@id": item.item };
        }
        return item;
      });
    }
    return out;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function replaceOrigin(str, origin, mirror, proto) {
  if (!str || typeof str !== "string") return str;
  return str
    .replace(new RegExp(`https://${esc(origin)}`, "gi"), `${proto}://${mirror}`)
    .replace(new RegExp(`http://${esc(origin)}`, "gi"), `${proto}://${mirror}`)
    .replace(new RegExp(`//${esc(origin)}`, "gi"), `//${mirror}`);
}

function replaceAllOccurrences(str, origin, mirror, proto) {
  if (!str || typeof str !== "string") return str;
  return str
    .replace(new RegExp(`https://${esc(origin)}`, "gi"), `${proto}://${mirror}`)
    .replace(new RegExp(`http://${esc(origin)}`, "gi"), `${proto}://${mirror}`)
    .replace(new RegExp(`//${esc(origin)}`, "gi"), `//${mirror}`)
    .replace(new RegExp(esc(origin), "gi"), mirror);
}

function esc(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { rewriteHtml };
