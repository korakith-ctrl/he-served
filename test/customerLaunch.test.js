import test from "node:test";
import assert from "node:assert/strict";
import { resolveCustomerLaunch } from "../src/customerLaunch.js";

function testWindow(pathname, search = "", standalone = false, initialStorage = {}) {
  const values = new Map(Object.entries(initialStorage));
  return {
    location: { pathname, search },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    matchMedia: () => ({ matches: standalone }),
    navigator: {},
    values,
  };
}

test("remembers the exact customer shop route", () => {
  const browser = testWindow("/order/shop_123", "?event=event_456");
  const launch = resolveCustomerLaunch(browser);

  assert.equal(launch.route.shopUid, "shop_123");
  assert.equal(launch.route.eventId, "event_456");
  assert.equal(launch.route.path, "/order/shop_123?event=event_456");
  assert.deepEqual(JSON.parse(browser.values.get("coffee-shop-customer-launch")), {
    shopUid: "shop_123",
    eventId: "event_456",
  });
});

test("restores the remembered shop from the manifest start URL", () => {
  const browser = testWindow("/order", "?source=pwa", false, {
    "coffee-shop-customer-launch": JSON.stringify({ shopUid: "shop_123", eventId: null }),
  });
  const launch = resolveCustomerLaunch(browser);

  assert.equal(launch.isCustomerEntry, true);
  assert.equal(launch.restored, true);
  assert.equal(launch.route.path, "/order/shop_123");
});

test("restores an old installed icon that still launches at root", () => {
  const browser = testWindow("/", "", true, {
    "coffee-shop-customer-launch": JSON.stringify({ shopUid: "shop_123", eventId: "event_456" }),
  });
  const launch = resolveCustomerLaunch(browser);

  assert.equal(launch.isCustomerEntry, true);
  assert.equal(launch.route.path, "/order/shop_123?event=event_456");
});

test("keeps a normal root browser visit on the admin app", () => {
  const launch = resolveCustomerLaunch(testWindow("/"));
  assert.deepEqual(launch, { isCustomerEntry: false, route: null, restored: false });
});

test("does not route an uninitialized customer launcher to admin", () => {
  const launch = resolveCustomerLaunch(testWindow("/order", "?source=pwa"));
  assert.equal(launch.isCustomerEntry, true);
  assert.equal(launch.route, null);
});

test("does not expose admin for an invalid customer link", () => {
  const launch = resolveCustomerLaunch(testWindow("/order/not/a/valid/route"));
  assert.equal(launch.isCustomerEntry, true);
  assert.equal(launch.route, null);
});
