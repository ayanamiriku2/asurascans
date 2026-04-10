/**
 * Generate a robots.txt that allows full crawling and points to the sitemap.
 */
function generateRobotsTxt(proto, mirror) {
  return [
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${proto}://${mirror}/sitemap.xml`,
    "",
  ].join("\n");
}

module.exports = { generateRobotsTxt };
