import test from "node:test";
import assert from "node:assert/strict";
import { createSiteManifest } from "../api/site-manifest.js";

test("creates a manifest that starts at the exact customer shop", () => {
  const manifest = createSiteManifest({ shopUid: "shop_123", event: "event_456" });
  assert.equal(manifest.start_url, "/order/shop_123?event=event_456");
  assert.equal(manifest.scope, "/order");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512", "2048x2048"]);
});

test("falls back safely when manifest parameters are invalid", () => {
  const manifest = createSiteManifest({ shopUid: "../admin", event: "bad/event" });
  assert.equal(manifest.start_url, "/order?source=pwa");
});
