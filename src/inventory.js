const round4 = (value) => Math.round((Number(value) || 0) * 10000) / 10000;

function ingredientById(ingredientsById, id) {
  return ingredientsById instanceof Map ? ingredientsById.get(id) : ingredientsById?.[id];
}

export function normalizeQuantityRule(value, fallbackMode = "percent") {
  const requestedMode = value?.qtyMode;
  const mode = ["same", "percent", "absolute"].includes(requestedMode) ? requestedMode : fallbackMode;
  const legacyValue = value?.qtyPercent != null ? value.qtyPercent : 100;
  const rawValue = value?.qtyValue != null ? value.qtyValue : legacyValue;
  return { mode, value: round4(rawValue) };
}

function applyQuantityRule(baseQty, rule) {
  if (!rule || rule.mode === "same") return round4(baseQty);
  if (rule.mode === "absolute") return round4(rule.value);
  return round4(baseQty * (rule.value / 100));
}

function expandIngredientLine(ingredientId, qty, ingredientsById, path = []) {
  const ingredient = ingredientById(ingredientsById, ingredientId);
  if (!ingredient?.components?.length) return [{ ingredientId, qty: round4(qty) }];
  if (path.includes(ingredientId) || path.length > 20) {
    return [{ ingredientId, qty: round4(qty), issue: "mix_cycle" }];
  }
  const totalRatio = ingredient.components.reduce((sum, component) => sum + Math.max(0, Number(component.ratio) || 0), 0);
  if (totalRatio <= 0) return [{ ingredientId, qty: round4(qty), issue: "mix_ratio" }];
  return ingredient.components.flatMap((component) =>
    expandIngredientLine(
      component.ingredientId,
      qty * (Math.max(0, Number(component.ratio) || 0) / totalRatio),
      ingredientsById,
      [...path, ingredientId],
    )
  );
}

function mergeLines(lines) {
  const merged = new Map();
  for (const line of lines) {
    if (!line?.ingredientId) continue;
    const current = merged.get(line.ingredientId) || { ingredientId: line.ingredientId, qty: 0 };
    current.qty = round4(current.qty + (Number(line.qty) || 0));
    if (line.issue) current.issue = line.issue;
    merged.set(line.ingredientId, current);
  }
  return [...merged.values()];
}

export function expandLines(lines, ingredientsById) {
  return mergeLines((lines || []).flatMap((line) =>
    expandIngredientLine(line.ingredientId, Number(line.qty) || 0, ingredientsById)
  ));
}

function emptyAdjustments() {
  return {
    baseQuantities: {},
    directReplacements: {},
    leafQuantities: {},
    leafReplacements: {},
    additions: [],
    issues: [],
  };
}

function legacyAdjustments(adjustments) {
  const normalized = emptyAdjustments();
  for (const [ingredientId, adjustment] of Object.entries(adjustments || {})) {
    if (ingredientId.startsWith("__") || !adjustment) continue;
    normalized.directReplacements[ingredientId] = {
      ingredientId: adjustment.ingredientId || ingredientId,
      quantity: normalizeQuantityRule(adjustment),
    };
  }
  return normalized;
}

export function resolveLines(menu, adjustments, ingredientsById) {
  const rules = adjustments?.directReplacements ? adjustments : legacyAdjustments(adjustments);
  const directLines = (menu?.ingredients || []).map((line) => {
    const originalQty = Number(line.qty) || 0;
    const baseQty = applyQuantityRule(originalQty, rules.baseQuantities?.[line.ingredientId]);
    const replacement = rules.directReplacements?.[line.ingredientId];
    if (!replacement) return { ...line, qty: baseQty };
    const qty = replacement.quantity?.mode === "same"
      ? baseQty
      : applyQuantityRule(originalQty, replacement.quantity);
    return { ...line, ingredientId: replacement.ingredientId || line.ingredientId, qty };
  });

  let expanded = expandLines(directLines, ingredientsById).map((line) => {
    const replacement = rules.leafReplacements?.[line.ingredientId];
    if (!replacement) return line;
    return {
      ...line,
      ingredientId: replacement.ingredientId || line.ingredientId,
      qty: replacement.quantity?.mode === "same"
        ? line.qty
        : applyQuantityRule(line.qty, replacement.quantity),
    };
  });
  expanded = mergeLines(expanded);
  expanded = expanded.map((line) => ({
    ...line,
    qty: applyQuantityRule(line.qty, rules.leafQuantities?.[line.ingredientId]),
  }));
  return mergeLines([...expanded, ...(rules.additions || [])]).filter((line) => line.qty > 0);
}

function quantityRuleForOption(option, fallbackMode = "percent") {
  if (option?.qtyMode) return normalizeQuantityRule(option, fallbackMode);
  return normalizeQuantityRule(option, fallbackMode);
}

export function resolveIngredientAdjustmentsFromOptions(menu, options, ingredientsById) {
  const adjustments = emptyAdjustments();
  const directIds = new Set((menu?.ingredients || []).map((line) => line.ingredientId));
  const expandedBase = expandLines(menu?.ingredients || [], ingredientsById);
  const expandedIds = new Set(expandedBase.map((line) => line.ingredientId));

  for (const option of options || []) {
    if (!option) continue;
    if (option.ingredientId) {
      const chosenIngredient = ingredientById(ingredientsById, option.ingredientId);
      const quantity = quantityRuleForOption(option, "percent");
      if (!chosenIngredient) {
        adjustments.issues.push({ code: "missing_option_ingredient", ingredientId: option.ingredientId, option });
      } else if (!chosenIngredient.altGroup) {
        adjustments.issues.push({ code: "option_ingredient_without_group", ingredientId: option.ingredientId, option });
      } else {
        const directSource = (menu?.ingredients || []).find((line) =>
          ingredientById(ingredientsById, line.ingredientId)?.altGroup === chosenIngredient.altGroup
        );
        const leafSource = expandedBase.find((line) =>
          ingredientById(ingredientsById, line.ingredientId)?.altGroup === chosenIngredient.altGroup
        );
        const replacement = { ingredientId: option.ingredientId, quantity };
        if (directSource) adjustments.directReplacements[directSource.ingredientId] = replacement;
        else if (leafSource) adjustments.leafReplacements[leafSource.ingredientId] = replacement;
        else if (quantity.mode === "absolute") adjustments.additions.push({ ingredientId: option.ingredientId, qty: quantity.value });
        else adjustments.issues.push({ code: "option_has_no_recipe_source", ingredientId: option.ingredientId, option });
      }
    }

    for (const extra of option.extraAdjustments || []) {
      if (!extra?.ingredientId) continue;
      const quantity = normalizeQuantityRule(extra, "percent");
      if (!ingredientById(ingredientsById, extra.ingredientId)) {
        adjustments.issues.push({ code: "missing_extra_ingredient", ingredientId: extra.ingredientId, option });
      } else if (directIds.has(extra.ingredientId)) {
        adjustments.baseQuantities[extra.ingredientId] = quantity;
      } else if (expandedIds.has(extra.ingredientId)) {
        adjustments.leafQuantities[extra.ingredientId] = quantity;
      } else if (quantity.mode === "absolute") {
        adjustments.additions.push({ ingredientId: extra.ingredientId, qty: quantity.value });
      } else {
        // กลุ่มเดียวอาจใช้ร่วมกับหลายเมนู วัตถุดิบแบบเปอร์เซ็นต์จึงใช้เฉพาะเมนูที่มีวัตถุดิบนั้น
        // แต่ส่ง warning กลับเสมอเพื่อให้หน้า config แสดงได้ ไม่ข้ามแบบมองไม่เห็นเหมือนระบบเดิม
        adjustments.issues.push({ code: "extra_not_in_recipe", severity: "warning", ingredientId: extra.ingredientId, option });
      }
    }
  }
  return adjustments;
}

export function calcRecipeCost(menu, ingredientsById, adjustments) {
  const lines = resolveLines(menu, adjustments || emptyAdjustments(), ingredientsById);
  let ingredientCost = 0;
  const breakdown = [];
  for (const line of lines) {
    const ingredient = ingredientById(ingredientsById, line.ingredientId);
    if (!ingredient) continue;
    const lineCost = (Number(ingredient.costPerUnit) || 0) * line.qty;
    ingredientCost += lineCost;
    breakdown.push({ ...line, name: ingredient.name, unit: ingredient.unit, unitCost: ingredient.costPerUnit, lineCost });
  }
  return { ingredientCost, breakdown };
}

export function describeInventoryIssue(issue, ingredientsById) {
  const ingredient = ingredientById(ingredientsById, issue?.ingredientId);
  const name = ingredient?.name || issue?.ingredientId || "วัตถุดิบ";
  if (issue?.code === "missing_option_ingredient" || issue?.code === "missing_extra_ingredient") return `ไม่พบวัตถุดิบ ${name}`;
  if (issue?.code === "option_ingredient_without_group") return `${name} ยังไม่ได้ตั้งกลุ่มทางเลือก`;
  if (issue?.code === "option_has_no_recipe_source") return `ไม่มีวัตถุดิบกลุ่มเดียวกับ ${name} ในสูตร และไม่ได้กำหนดเป็นจำนวนจริง`;
  if (issue?.code === "extra_not_in_recipe") return `${name} ไม่มีในสูตรนี้ จึงข้ามการปรับแบบเปอร์เซ็นต์ (เลือก “จำนวนจริง” หากต้องการเพิ่ม)`;
  if (issue?.code === "zero_recipe_quantity") return `${name} มีจำนวน 0 ในสูตร`;
  if (issue?.code === "missing_recipe_ingredient") return `สูตรอ้างถึงวัตถุดิบที่ถูกลบ (${name})`;
  if (issue?.code === "missing_option_group") return `ไม่พบกลุ่มตัวเลือก ${issue.groupId}`;
  return `ตั้งค่าวัตถุดิบ ${name} ไม่สมบูรณ์`;
}

export function inventoryConfigurationIssues(menu, optionGroups, ingredientsById) {
  const issues = [];
  for (const line of menu?.ingredients || []) {
    const ingredient = ingredientById(ingredientsById, line.ingredientId);
    if (!ingredient) issues.push({ code: "missing_recipe_ingredient", ingredientId: line.ingredientId });
    else if (!ingredient.unlimited && !ingredient.components?.length && Number(line.qty) <= 0) {
      issues.push({ code: "zero_recipe_quantity", ingredientId: line.ingredientId });
    }
  }
  const groupsById = new Map((optionGroups || []).map((group) => [group.id, group]));
  for (const groupId of menu?.optionGroupIds || []) {
    const group = groupsById.get(groupId);
    if (!group) {
      issues.push({ code: "missing_option_group", groupId });
      continue;
    }
    for (const choice of group.choices || []) {
      if (choice.enabled === false) continue;
      const result = resolveIngredientAdjustmentsFromOptions(menu, [choice], ingredientsById);
      for (const issue of result.issues) issues.push({ ...issue, groupId, groupName: group.name, choiceId: choice.id, choiceLabel: choice.label });
    }
  }
  return issues;
}

export function inventoryUsageSnapshot(stockUsage, ingredientsById) {
  const snapshot = {};
  for (const [ingredientId, rawQty] of Object.entries(stockUsage || {})) {
    const qty = round4(rawQty);
    if (qty <= 0) continue;
    const ingredient = ingredientById(ingredientsById, ingredientId);
    snapshot[ingredientId] = {
      ingredientId,
      name: ingredient?.name || ingredientId,
      unit: ingredient?.unit || "",
      qty,
    };
  }
  return snapshot;
}

export function stockUsageFromSnapshot(snapshot) {
  const usage = {};
  const records = Array.isArray(snapshot) ? snapshot.filter(Boolean) : Object.values(snapshot || {}).filter(Boolean);
  for (const record of records) {
    if (!record?.ingredientId || !(Number(record.qty) > 0)) continue;
    usage[record.ingredientId] = round4((usage[record.ingredientId] || 0) + Number(record.qty));
  }
  return usage;
}
