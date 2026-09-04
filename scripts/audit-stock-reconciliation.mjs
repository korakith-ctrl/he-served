import { execFileSync } from "node:child_process";
import {
  resolveIngredientAdjustmentsFromOptions,
  resolveLines,
} from "../src/inventory.js";

const projectId = process.argv[2] || "he-served";
const shopUid = process.argv[3];
const applyRequested = process.argv.includes("--apply");

if (!shopUid) {
  console.error("Usage: node scripts/audit-stock-reconciliation.mjs <project-id> <shop-uid>");
  process.exit(1);
}

const round4 = (value) => Math.round((Number(value) || 0) * 10000) / 10000;

function databaseGet(path) {
  const env = { ...process.env };
  delete env.DEBUG;
  const output = execFileSync(
    "npx",
    ["firebase-tools", "database:get", path, "--project", projectId],
    { encoding: "utf8", env, maxBuffer: 50 * 1024 * 1024 },
  );
  return JSON.parse(output || "null");
}

function values(value) {
  return Array.isArray(value) ? value.filter(Boolean) : Object.values(value || {}).filter(Boolean);
}

function legacyAdjustmentsFromOptions(menu, options, ingredientsById) {
  const adjustments = {};
  for (const option of options || []) {
    if (option?.ingredientId) {
      const chosenIngredient = ingredientsById[option.ingredientId];
      if (chosenIngredient?.altGroup) {
        const originalLine = (menu.ingredients || []).find((line) =>
          ingredientsById[line.ingredientId]?.altGroup === chosenIngredient.altGroup
        );
        if (originalLine) {
          const qtyPercent = option.qtyPercent != null ? option.qtyPercent : 100;
          if (!(originalLine.ingredientId === option.ingredientId && qtyPercent === 100)) {
            adjustments[originalLine.ingredientId] = {
              ingredientId: option.ingredientId,
              qtyPercent,
            };
          }
        }
      }
    }
    for (const extra of option?.extraAdjustments || []) {
      if (!extra?.ingredientId) continue;
      if (!(menu.ingredients || []).some((line) => line.ingredientId === extra.ingredientId)) continue;
      adjustments[extra.ingredientId] = {
        ingredientId: extra.ingredientId,
        qtyPercent: extra.qtyPercent != null ? extra.qtyPercent : 100,
      };
    }
  }
  return adjustments;
}

function choiceMatchesHistorical(choice, historical) {
  if (historical?.id && choice.id === historical.id) return true;
  if (choice.label !== historical?.label) return false;
  if (choice.ingredientId || historical.ingredientId) return choice.ingredientId === historical.ingredientId;
  const currentIds = new Set((choice.extraAdjustments || []).map((extra) => extra.ingredientId));
  const historicalIds = new Set((historical.extraAdjustments || []).map((extra) => extra.ingredientId));
  return currentIds.size === historicalIds.size && [...currentIds].every((id) => historicalIds.has(id));
}

function intendedOptions(menu, options, groupsById, migratedGroups) {
  const menuGroups = (menu.optionGroupIds || []).map((id) => groupsById[id]).filter(Boolean);
  let migrated = false;
  const resolved = (options || []).map((historical) => {
    let migratedGroupId = null;
    let configuredChoice = null;
    for (const group of menuGroups) {
      if (!migratedGroups[group.id]) continue;
      const match = values(group.choices).find((choice) => choiceMatchesHistorical(choice, historical));
      if (match) {
        migratedGroupId = group.id;
        configuredChoice = match;
        break;
      }
    }
    if (!migratedGroupId) return historical;

    const migratedChoice = migratedGroups[migratedGroupId]?.choices?.[configuredChoice.id];
    if (!migratedChoice) return historical;
    const next = { ...historical };
    if (
      migratedChoice.hadQtyMode === false
      && Number(historical.qtyPercent) === Number(migratedChoice.qtyPercent)
    ) {
      next.qtyMode = "absolute";
      next.qtyValue = Number(historical.qtyPercent) || 0;
      migrated = true;
    }
    if (migratedChoice.extras) {
      const historicalExtras = new Map((historical.extraAdjustments || []).map((extra) => [extra.ingredientId, extra]));
      const matchesMigratedValues = migratedChoice.extras.every((backupExtra) =>
        Number(historicalExtras.get(backupExtra.ingredientId)?.qtyPercent) === Number(backupExtra.qtyPercent)
      );
      const affectedIngredients = matchesMigratedValues
        ? new Set(migratedChoice.extras.map((extra) => extra.ingredientId))
        : new Set();
      next.extraAdjustments = (historical.extraAdjustments || []).map((extra) =>
        affectedIngredients.has(extra.ingredientId)
          ? { ...extra, qtyMode: "absolute", qtyValue: Number(extra.qtyPercent) || 0 }
          : extra
      );
      if (affectedIngredients.size) migrated = true;
    }
    return next;
  });
  return { options: resolved, migrated };
}

function usageFor(menu, options, ingredientsById, mode, groupsById, migratedGroups) {
  const intended = mode === "intended"
    ? intendedOptions(menu, options, groupsById, migratedGroups)
    : { options, migrated: false };
  const resolvedOptions = intended.options;
  const adjustments = mode === "intended"
    ? resolveIngredientAdjustmentsFromOptions(menu, resolvedOptions, ingredientsById)
    : legacyAdjustmentsFromOptions(menu, resolvedOptions, ingredientsById);
  return {
    migrated: intended.migrated,
    usage: Object.fromEntries(resolveLines(menu, adjustments, ingredientsById).map((line) => [line.ingredientId, line.qty])),
  };
}

const [shop, ordersNode, auditNode] = [
  databaseGet(`/shops/${shopUid}`),
  databaseGet(`/orders/${shopUid}`),
  databaseGet(`/auditLogs/${shopUid}`),
];

const backup = shop?.migrationBackups?.stock_v2_20260904;
if (!backup?.groups) throw new Error("Missing stock_v2_20260904 migration backup");

const ingredients = values(shop.ingredients);
const menus = values(shop.menus);
const optionGroups = values(shop.optionGroups);
const ingredientsById = Object.fromEntries(ingredients.map((ingredient) => [ingredient.id, ingredient]));
const menusById = Object.fromEntries(menus.map((menu) => [menu.id, menu]));
const groupsById = Object.fromEntries(optionGroups.map((group) => [group.id, group]));
const manualAdjustments = values(auditNode)
  .filter((entry) => entry.action === "stock_adjustment" && entry.details?.ingredientId)
  .map((entry) => ({
    createdAt: entry.createdAt,
    ingredientId: entry.details.ingredientId,
    name: ingredientsById[entry.details.ingredientId]?.name || entry.details.ingredientId,
    from: entry.details.from,
    to: entry.details.to,
    reason: entry.details.reason || "",
  }))
  .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
const lastManualAdjustmentByIngredient = Object.fromEntries(
  manualAdjustments.map((entry) => [entry.ingredientId, entry]),
);
const historicalCorrections = {};
const outstandingCorrections = {};
const affectedOrders = [];
const skippedOrders = [];

for (const [orderId, order] of Object.entries(ordersNode || {})) {
  if (order.status === "cancelled" || order.saleRecorded !== true) continue;
  const effectiveAt = order.saleRecordedAt || order.createdAt;
  const orderDelta = {};
  const affectedItems = [];
  for (const item of order.items || []) {
    const menu = menusById[item.menuId];
    if (!menu) {
      skippedOrders.push({ orderId, menuId: item.menuId, menuName: item.name, reason: "menu_missing" });
      continue;
    }
    const options = values(item.options);
    const oldResult = usageFor(menu, options, ingredientsById, "legacy", groupsById, backup.groups);
    const intendedResult = usageFor(menu, options, ingredientsById, "intended", groupsById, backup.groups);
    if (!intendedResult.migrated) continue;
    const oldUsage = oldResult.usage;
    const intendedUsage = intendedResult.usage;
    const quantity = Number(item.qty) || 1;
    const itemDelta = {};
    for (const ingredientId of new Set([...Object.keys(oldUsage), ...Object.keys(intendedUsage)])) {
      if (ingredientsById[ingredientId]?.unlimited) continue;
      const delta = round4(((intendedUsage[ingredientId] || 0) - (oldUsage[ingredientId] || 0)) * quantity);
      if (!delta) continue;
      itemDelta[ingredientId] = delta;
      orderDelta[ingredientId] = round4((orderDelta[ingredientId] || 0) + delta);
      historicalCorrections[ingredientId] = round4((historicalCorrections[ingredientId] || 0) + delta);
      const lastAdjustment = lastManualAdjustmentByIngredient[ingredientId];
      if (!lastAdjustment || Date.parse(effectiveAt) > Date.parse(lastAdjustment.createdAt)) {
        outstandingCorrections[ingredientId] = round4((outstandingCorrections[ingredientId] || 0) + delta);
      }
    }
    if (Object.keys(itemDelta).length) {
      affectedItems.push({ menuId: item.menuId, menuName: item.name || menu.name, qty: quantity, delta: itemDelta });
    }
  }
  if (affectedItems.length) affectedOrders.push({ orderId, createdAt: order.createdAt, effectiveAt, status: order.status, items: affectedItems, delta: orderDelta });
}

const ingredientSummary = Object.entries(historicalCorrections).map(([ingredientId, historicalDiscrepancy]) => {
  const ingredient = ingredientsById[ingredientId] || {};
  const correction = round4(outstandingCorrections[ingredientId] || 0);
  const currentStock = round4(ingredient.stockQty);
  const proposedStock = round4(currentStock - correction);
  const lastAdjustment = lastManualAdjustmentByIngredient[ingredientId] || null;
  const relevantOrders = affectedOrders.filter((order) =>
    order.delta[ingredientId]
    && (!lastAdjustment || Date.parse(order.effectiveAt) > Date.parse(lastAdjustment.createdAt))
  );
  return {
    ingredientId,
    name: ingredient.name || ingredientId,
    unit: ingredient.unit || "",
    currentStock,
    historicalDiscrepancy,
    lastManualAdjustment: lastAdjustment,
    correctionToDeduct: correction,
    proposedStock,
    affectedOrders: relevantOrders.length,
    affectedUnits: relevantOrders.reduce((sum, order) =>
      sum + order.items.filter((item) => item.delta[ingredientId]).reduce((itemSum, item) => itemSum + item.qty, 0), 0),
    safeToApply: proposedStock >= 0,
  };
}).sort((a, b) => Math.abs(b.correctionToDeduct) - Math.abs(a.correctionToDeduct));

const affectedIds = new Set(ingredientSummary.map((item) => item.ingredientId));
const relevantManualAdjustments = manualAdjustments.filter((entry) => affectedIds.has(entry.ingredientId));

let applyResult = null;
if (applyRequested) {
  const reconciliationId = "stock_v2_reconciliation_20260904";
  const approvedCorrections = {
    syrup: 809,
    milk_oat: 420,
    milk_evaporated: 136,
    milk_condensed: 134.6,
    milk_fresh: 62,
    ing_odtjxr3: 61.52,
  };
  const actualCorrections = Object.fromEntries(ingredientSummary.map((item) => [item.ingredientId, item.correctionToDeduct]));
  for (const [ingredientId, approved] of Object.entries(approvedCorrections)) {
    if (actualCorrections[ingredientId] !== approved) {
      throw new Error(`Audit changed for ${ingredientId}: approved ${approved}, fresh audit ${actualCorrections[ingredientId]}`);
    }
  }
  if (Object.keys(actualCorrections).some((ingredientId) => !(ingredientId in approvedCorrections))) {
    throw new Error("Fresh audit contains an unapproved ingredient correction");
  }
  const existing = databaseGet(`/stockReconciliations/${shopUid}/${reconciliationId}`);
  if (existing?.status === "applied") throw new Error(`Reconciliation ${reconciliationId} was already applied`);

  const appliedAt = new Date().toISOString();
  const indexByIngredientId = new Map(values(shop.ingredients).map((ingredient) => [ingredient.id, shop.ingredients.indexOf(ingredient)]));
  const items = {};
  const patch = {};
  for (const summary of ingredientSummary) {
    const index = indexByIngredientId.get(summary.ingredientId);
    if (index == null) throw new Error(`Missing ingredient index for ${summary.ingredientId}`);
    if (!summary.safeToApply) throw new Error(`Correction would make ${summary.name} negative`);
    patch[`shops/${shopUid}/ingredients/${index}/stockQty`] = { ".sv": { increment: -summary.correctionToDeduct } };
    items[summary.ingredientId] = {
      ingredientId: summary.ingredientId,
      name: summary.name,
      unit: summary.unit,
      qty: summary.correctionToDeduct,
      delta: -summary.correctionToDeduct,
      stockBefore: summary.currentStock,
      expectedStockAfter: summary.proposedStock,
      affectedOrders: summary.affectedOrders,
    };
  }
  const record = {
    id: reconciliationId,
    status: "applied",
    appliedAt,
    actorUid: shopUid,
    reason: "ปรับยอดย้อนหลังจาก quantity mode ที่เคยตีความจำนวนจริงเป็นเปอร์เซ็นต์",
    migrationBackup: `shops/${shopUid}/migrationBackups/stock_v2_20260904`,
    scope: {
      totalOrders: Object.keys(ordersNode || {}).length,
      recordedNonCancelledOrders: values(ordersNode).filter((order) => order.status !== "cancelled" && order.saleRecorded === true).length,
      affectedOrdersAfterLastManualAdjustment: new Set(affectedOrders.filter((order) =>
        Object.keys(order.delta).some((ingredientId) => {
          const lastAdjustment = lastManualAdjustmentByIngredient[ingredientId];
          return !lastAdjustment || Date.parse(order.effectiveAt) > Date.parse(lastAdjustment.createdAt);
        })
      ).map((order) => order.orderId)).size,
    },
    items,
  };
  patch[`stockReconciliations/${shopUid}/${reconciliationId}`] = record;
  patch[`shops/${shopUid}/reconciliationBackups/${reconciliationId}`] = record;
  patch[`inventoryMovements/${shopUid}/${reconciliationId}`] = {
    id: reconciliationId,
    type: "adjustment",
    createdAt: appliedAt,
    actorUid: shopUid,
    reason: record.reason,
    items,
  };
  patch[`auditLogs/${shopUid}/${reconciliationId}`] = {
    action: "stock_reconciliation",
    actorUid: shopUid,
    createdAt: appliedAt,
    details: { reconciliationId, reason: record.reason, items },
  };

  const env = { ...process.env };
  delete env.DEBUG;
  execFileSync(
    "npx",
    ["firebase-tools", "database:update", "/", "--project", projectId, "--data", JSON.stringify(patch), "--force"],
    { encoding: "utf8", env, maxBuffer: 10 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
  applyResult = { reconciliationId, appliedAt, corrections: approvedCorrections };
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  projectId,
  shopUid,
  migrationCreatedAt: backup.createdAt,
  scope: {
    totalOrders: Object.keys(ordersNode || {}).length,
    includedRecordedNonCancelledOrders: values(ordersNode).filter((order) => order.status !== "cancelled" && order.saleRecorded === true).length,
    cancelledOrdersExcluded: values(ordersNode).filter((order) => order.status === "cancelled").length,
    unrecordedOrdersExcluded: values(ordersNode).filter((order) => order.status !== "cancelled" && order.saleRecorded !== true).length,
    affectedOrders: affectedOrders.length,
    affectedOrdersAfterLastManualAdjustment: new Set(affectedOrders.filter((order) =>
      Object.keys(order.delta).some((ingredientId) => {
        const lastAdjustment = lastManualAdjustmentByIngredient[ingredientId];
        return !lastAdjustment || Date.parse(order.effectiveAt) > Date.parse(lastAdjustment.createdAt);
      })
    ).map((order) => order.orderId)).size,
  },
  ingredientSummary,
  manualAdjustments: relevantManualAdjustments,
  skippedOrders,
  affectedOrders,
  applyResult,
}, null, 2));
