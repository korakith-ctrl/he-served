import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSiteManifest } from "../api/site-manifest.js";

test("admin PWA has an identity and launch scope separate from customer ordering", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/admin.webmanifest", import.meta.url), "utf8"));
  const customerManifest = JSON.parse(readFileSync(new URL("../public/site.webmanifest", import.meta.url), "utf8"));

  assert.equal(manifest.id, "/admin");
  assert.notEqual(manifest.id, customerManifest.id);
  assert.equal(manifest.start_url, "/admin?source=pwa");
  assert.equal(manifest.scope, "/admin");
  assert.equal(customerManifest.scope, "/order");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512", "2048x2048"]);
});

test("creates a manifest that starts at the exact customer shop", () => {
  const manifest = createSiteManifest({ shopUid: "shop_123", event: "event_456" });
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/order/shop_123?event=event_456");
  assert.equal(manifest.scope, "/order");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512", "2048x2048"]);
});

test("falls back safely when manifest parameters are invalid", () => {
  const manifest = createSiteManifest({ shopUid: "../admin", event: "bad/event" });
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/order?source=pwa");
});
