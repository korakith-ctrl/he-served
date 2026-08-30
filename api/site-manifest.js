const ROUTE_VALUE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function queryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

export function createSiteManifest(query = {}) {
  const shopUid = String(queryValue(query.shopUid) || "");
  const requestedEventId = String(queryValue(query.event) || "");
  const eventId = ROUTE_VALUE_PATTERN.test(requestedEventId) ? requestedEventId : null;
  const hasShop = ROUTE_VALUE_PATTERN.test(shopUid);
  const eventQuery = eventId ? `?event=${encodeURIComponent(eventId)}` : "";
  const startUrl = hasShop ? `/order/${encodeURIComponent(shopUid)}${eventQuery}` : "/order?source=pwa";

  return {
    name: "ZONE 2 - RESERVE BAR",
    short_name: "ZONE 2",
    description: "ZONE 2 Reserve Bar coffee ordering",
    id: "/",
    start_url: startUrl,
    scope: "/order",
    display: "standalone",
    background_color: "#F4F6F4",
    theme_color: "#0B446F",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/logo-zone2.png", sizes: "2048x2048", type: "image/png", purpose: "any" },
    ],
  };
}

export default function handler(request, response) {
  response.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=300, s-maxage=86400");
  response.status(200).json(createSiteManifest(request.query));
}
