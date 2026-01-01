const { detectRegime } = require("./regimeDetector");
const {
  normalizeLayerId,
  computeLayerBudgets,
  getOpenPositionCounts,
} = require("./riskEngine");
const {
  resolveLayerStrategy,
  resolveLayerEntryPreset,
  resolveLayerExitPreset,
  buildEntryPresetMap,
  buildExitPresetMap,
} = require("./strategyRegistry");
const { getAllTrades } = require("./tradeHistory");
const { StrategyPortfolioConfig } = require("./strategyPortfolio.config");

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function sumPnLForLayer(trades, layerId, cutoffMs, now) {
  const id = normalizeLayerId(layerId);
  if (!id) return 0;
  const cutoff = now - cutoffMs;

  return trades.reduce((acc, trade) => {
    if (!trade) return acc;
    const tradeLayer = normalizeLayerId(trade.layerId);
    if (tradeLayer !== id) return acc;
    const ts = Date.parse(trade.time || trade.timestamp || "") || trade.timestamp || 0;
    if (ts < cutoff) return acc;
    const pnl = Number(trade.pnlValue) || 0;
    return acc + pnl;
  }, 0);
}

function sumPnLTotal(trades, cutoffMs, now) {
  const cutoff = now - cutoffMs;
  return trades.reduce((acc, trade) => {
    if (!trade) return acc;
    const ts = Date.parse(trade.time || trade.timestamp || "") || trade.timestamp || 0;
    if (ts < cutoff) return acc;
    return acc + (Number(trade.pnlValue) || 0);
  }, 0);
}

function computeLayerState(layerConfig, trades, equity, persisted = {}, now) {
  const allocationPct = Number(layerConfig.allocationPct) || 0;
  const equityAllocated = equity * allocationPct;
  const pnlDay = sumPnLForLayer(trades, layerConfig.id, DAY_MS, now);
  const pnlWeek = sumPnLForLayer(trades, layerConfig.id, WEEK_MS, now);

  const drawdownDay =
    equityAllocated > 0 ? (Math.max(0, -pnlDay) / equityAllocated) * 100 : 0;
  const drawdownWeek =
    equityAllocated > 0 ? (Math.max(0, -pnlWeek) / equityAllocated) * 100 : 0;

  const lossStopDailyPct = Number(layerConfig.lossStopDailyPct) || 0;
  const lossStopWeeklyPct = Number(layerConfig.lossStopWeeklyPct) || 0;
  const cooldownHours = Number(layerConfig.cooldownHoursAfterStop) || 0;

  let pauseUntil = Number(persisted.pauseUntil) || 0;
  let isPaused = pauseUntil > now;

  if (!isPaused) {
    const dailyStop = lossStopDailyPct > 0 && drawdownDay >= lossStopDailyPct;
    const weeklyStop = lossStopWeeklyPct > 0 && drawdownWeek >= lossStopWeeklyPct;
    if (dailyStop || weeklyStop) {
      pauseUntil = now + cooldownHours * 60 * 60 * 1000;
      isPaused = pauseUntil > now;
    }
  }

  return {
    equityAllocatedPct: allocationPct,
    pnlDay,
    pnlWeek,
    drawdownDay,
    drawdownWeek,
    isPaused,
    pauseUntil: pauseUntil || null,
  };
}

function getTradingPlan(context = {}) {
  const layers = Array.isArray(context.settings?.PORTFOLIO_LAYERS)
    ? context.settings.PORTFOLIO_LAYERS
    : Array.isArray(context.config?.PORTFOLIO_LAYERS)
      ? context.config.PORTFOLIO_LAYERS
      : [];

  const rules =
    context.settings?.REGIME_RULES || context.config?.REGIME_RULES || {};

  const equity = Number(context.equity) || 0;
  const now = Number(context.now) || Date.now();
  const regime = detectRegime(context.candles || []);
  const allowedLayers = Array.isArray(rules[regime])
    ? rules[regime].map((id) => normalizeLayerId(id)).filter(Boolean)
    : [];

  const trades = getAllTrades(context.market || "stocks");
  const persistedLayers = context.state?.portfolio?.layers || {};
  const layerStates = {};
  const layerStrategy = {};
  const layerEntry = {};
  const layerExit = {};
  const layerConfigsById = {};
  const entryPresetMap = buildEntryPresetMap(layers);
  const exitPresetMap = buildExitPresetMap(layers);

  layers.forEach((layer) => {
    const id = normalizeLayerId(layer.id);
    if (!id) return;
    layerConfigsById[id] = layer;
    layerStates[id] = computeLayerState(
      layer,
      trades,
      equity,
      persistedLayers[id] || {},
      now
    );
    layerStrategy[id] = resolveLayerStrategy(layer);
    layerEntry[id] = resolveLayerEntryPreset(layer, entryPresetMap);
    layerExit[id] = resolveLayerExitPreset(layer, exitPresetMap);
  });

  const enabledLayers = layers
    .map((layer) => normalizeLayerId(layer.id))
    .filter(Boolean)
    .filter((id) => allowedLayers.includes(id))
    .filter((id) => !layerStates[id]?.isPaused);

  const layerBudgets = computeLayerBudgets({
    equity,
    layers,
    positions: context.positions,
    lastPrices: context.lastPrices,
  });

  const openCounts = getOpenPositionCounts(context.positions);
  const dailyPnl = sumPnLTotal(trades, DAY_MS, now);
  const globalRisk = StrategyPortfolioConfig.globalRisk || {};
  const dailyStopPct = Number(globalRisk.dailyStopPct) || 0;
  const dailyStopHit =
    equity > 0 && dailyStopPct > 0
      ? Math.max(0, -dailyPnl) / equity >= dailyStopPct / 100
      : false;
  const effectiveEnabledLayers = dailyStopHit ? [] : enabledLayers;

  return {
    regime,
    enabledLayers: effectiveEnabledLayers,
    layerBudgets,
    layerStrategy,
    layerEntry,
    layerExit,
    layerStates,
    layerConfigsById,
    entryPresetMap,
    exitPresetMap,
    openCounts,
    statePatch: {
      portfolio: {
        regime,
        dailyStopHit,
        layers: layerStates,
        lastPlanTs: now,
      },
    },
  };
}

module.exports = {
  getTradingPlan,
};
