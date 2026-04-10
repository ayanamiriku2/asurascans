/**
 * Fetch the origin sitemap and rewrite all URLs to the mirror domain.
 */
async function generateSitemap(origin, proto, mirror, path) {
  const url = `https://${origin}${path}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; MirrorBot/1.0; +https://" + mirror + ")",
      Host: origin,
      Accept: "application/xml, text/xml, */*",
    },
  });

  if (!res.ok) {
    throw new Error(`Origin sitemap returned ${res.status}`);
  }

  let xml = await res.text();

  // Replace all occurrences of the origin with the mirror
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  xml = xml
    .replace(new RegExp(`https://${esc(origin)}`, "gi"), `${proto}://${mirror}`)
    .replace(new RegExp(`http://${esc(origin)}`, "gi"), `${proto}://${mirror}`)
    .replace(new RegExp(`//${esc(origin)}`, "gi"), `//${mirror}`);

  return xml;
}

module.exports = { generateSitemap };
