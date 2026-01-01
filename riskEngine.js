function normalizeLayerId(id) {
  if (typeof id !== "string") return "";
  return id.trim().toUpperCase();
}

function getOpenPositionCounts(positions = {}) {
  const perLayer = {};
  let totalOpen = 0;

  Object.values(positions).forEach((pos) => {
    if (!pos?.hasPosition) return;
    totalOpen += 1;
    const layerId = normalizeLayerId(pos.layerId) || "UNASSIGNED";
    perLayer[layerId] = (perLayer[layerId] || 0) + 1;
  });

  return { perLayer, totalOpen };
}

function getLayerExposure(positions = {}, lastPrices = {}) {
  const perLayer = {};

  Object.entries(positions).forEach(([symbol, pos]) => {
    if (!pos?.hasPosition) return;
    const layerId = normalizeLayerId(pos.layerId) || "UNASSIGNED";
    const price = Number(lastPrices[symbol] ?? pos.entryPrice ?? 0);
    const qty = Number(pos.qty ?? 0);
    const value = Number.isFinite(price) && Number.isFinite(qty) ? price * qty : 0;
    perLayer[layerId] = (perLayer[layerId] || 0) + value;
  });

  return perLayer;
}

function computeLayerBudgets({ equity = 0, layers = [], positions = {}, lastPrices = {} }) {
  const exposureByLayer = getLayerExposure(positions, lastPrices);
  const budgets = {};

  layers.forEach((layer) => {
    const id = normalizeLayerId(layer.id) || "UNASSIGNED";
    const allocation = Number(layer.allocationPct) || 0;
    const budgetUsd = equity * allocation;
    const exposureUsd = exposureByLayer[id] || 0;
    const availableUsd = Math.max(0, budgetUsd - exposureUsd);

    budgets[id] = {
      budgetUsd,
      exposureUsd,
      availableUsd,
      allocationPct: allocation,
    };
  });

  return budgets;
}

function canOpenPosition({
  layerId,
  layerConfig,
  layerState,
  positions,
  lastPrices,
  equity,
  globalMaxOpenPositions,
}) {
  const id = normalizeLayerId(layerId) || "UNASSIGNED";
  const { perLayer, totalOpen } = getOpenPositionCounts(positions);
  const maxOpen = Number(layerConfig?.maxOpenPositions ?? 0);

  if (layerState?.isPaused) {
    return { allowed: false, reason: "layer_paused" };
  }

  if (Number.isFinite(globalMaxOpenPositions) && totalOpen >= globalMaxOpenPositions) {
    return { allowed: false, reason: "global_max_open" };
  }

  if (Number.isFinite(maxOpen) && (perLayer[id] || 0) >= maxOpen) {
    return { allowed: false, reason: "layer_max_open" };
  }

  const budgets = computeLayerBudgets({
    equity,
    layers: [layerConfig],
    positions,
    lastPrices,
  });
  const budget = budgets[id];
  if (budget && budget.availableUsd <= 0) {
    return { allowed: false, reason: "layer_budget_exhausted" };
  }

  return { allowed: true };
}

module.exports = {
  normalizeLayerId,
  getOpenPositionCounts,
  getLayerExposure,
  computeLayerBudgets,
  canOpenPosition,
};
