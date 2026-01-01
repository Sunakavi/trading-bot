const { config, CANDLE_RED_TRIGGER_PCT } = require("./config");
const { StrategyPortfolioConfig } = require("./strategyPortfolio.config");

function normalizeLayerId(id) {
  if (typeof id !== "string") return "";
  return id.trim().toUpperCase();
}

function normalizeExitPresetId(id) {
  if (typeof id !== "string") return "DEFAULT_EXIT";
  return id.trim();
}

function resolveLayerStrategy(layerConfig = {}) {
  const id = Number(layerConfig.strategyPresetId);
  return Number.isFinite(id) ? id : 2;
}

function resolveLayerEntryPreset(layerConfig = {}, entryPresets = {}) {
  const presetId =
    typeof layerConfig.entryPresetId === "string"
      ? layerConfig.entryPresetId
      : "CORE_TREND";
  const preset = entryPresets[presetId];
  return {
    entryPresetId: presetId,
    entryPreset: preset || null,
  };
}

function resolveLayerExitPreset(layerConfig = {}, exitPresets = {}) {
  const exitPreset = layerConfig.exitPreset || {};
  const presetId =
    typeof layerConfig.exitPresetId === "string"
      ? layerConfig.exitPresetId
      : "DEFAULT_EXIT";
  const resolvedPreset = exitPresets[presetId] || {};
  const exitConfig = {
    SL_PCT: Number(
      exitPreset.SL_PCT ?? resolvedPreset.SL_PCT ?? config.SL_PCT
    ),
    TP_PCT: Number(
      exitPreset.TP_PCT ?? resolvedPreset.TP_PCT ?? config.TP_PCT
    ),
    TRAIL_START_PCT: Number(
      exitPreset.TRAIL_START_PCT ??
        resolvedPreset.TRAIL_START_PCT ??
        config.TRAIL_START_PCT
    ),
    TRAIL_DISTANCE_PCT: Number(
      exitPreset.TRAIL_DISTANCE_PCT ??
        resolvedPreset.TRAIL_DISTANCE_PCT ??
        config.TRAIL_DISTANCE_PCT
    ),
    CANDLE_EXIT_ENABLED: Boolean(
      exitPreset.CANDLE_EXIT_ENABLED ??
        resolvedPreset.CANDLE_EXIT_ENABLED ??
        config.USE_CANDLE_EXIT
    ),
    CANDLE_RED_TRIGGER_PCT: Number(
      exitPreset.CANDLE_RED_TRIGGER_PCT ??
        resolvedPreset.CANDLE_RED_TRIGGER_PCT ??
        CANDLE_RED_TRIGGER_PCT
    ),
  };

  return {
    exitPresetId: normalizeExitPresetId(presetId),
    exitConfig,
  };
}

function resolveExitPresetById(exitPresets = {}, exitPresetId, fallbackConfig) {
  const preset =
    exitPresets && exitPresetId ? exitPresets[exitPresetId] : undefined;

  const base = fallbackConfig || {
    SL_PCT: config.SL_PCT,
    TP_PCT: config.TP_PCT,
    TRAIL_START_PCT: config.TRAIL_START_PCT,
    TRAIL_DISTANCE_PCT: config.TRAIL_DISTANCE_PCT,
    CANDLE_EXIT_ENABLED: config.USE_CANDLE_EXIT,
    CANDLE_RED_TRIGGER_PCT,
  };

  if (!preset || typeof preset !== "object") {
    return base;
  }

  return {
    SL_PCT: Number(preset.SL_PCT ?? base.SL_PCT),
    TP_PCT: Number(preset.TP_PCT ?? base.TP_PCT),
    TRAIL_START_PCT: Number(preset.TRAIL_START_PCT ?? base.TRAIL_START_PCT),
    TRAIL_DISTANCE_PCT: Number(
      preset.TRAIL_DISTANCE_PCT ?? base.TRAIL_DISTANCE_PCT
    ),
    CANDLE_EXIT_ENABLED: Boolean(
      preset.CANDLE_EXIT_ENABLED ?? base.CANDLE_EXIT_ENABLED
    ),
    CANDLE_RED_TRIGGER_PCT: Number(
      preset.CANDLE_RED_TRIGGER_PCT ?? base.CANDLE_RED_TRIGGER_PCT
    ),
  };
}

function buildExitPresetMap(layers = []) {
  const presets = {};
  const basePresets = StrategyPortfolioConfig.exitPresets || {};
  Object.keys(basePresets).forEach((id) => {
    presets[id] = { ...basePresets[id] };
  });
  layers.forEach((layer) => {
    if (!layer || typeof layer !== "object") return;
    const id = normalizeExitPresetId(layer.exitPresetId);
    if (!id || presets[id]) return;
    if (layer.exitPreset && typeof layer.exitPreset === "object") {
      presets[id] = { ...layer.exitPreset };
    }
  });
  return presets;
}

function buildEntryPresetMap(layers = []) {
  const presets = {};
  const basePresets = StrategyPortfolioConfig.entryPresets || {};
  Object.keys(basePresets).forEach((id) => {
    presets[id] = { ...basePresets[id] };
  });
  layers.forEach((layer) => {
    if (!layer || typeof layer !== "object") return;
    const id = typeof layer.entryPresetId === "string" ? layer.entryPresetId : "";
    if (!id || presets[id]) return;
    if (layer.entryPreset && typeof layer.entryPreset === "object") {
      presets[id] = { ...layer.entryPreset };
    }
  });
  return presets;
}

module.exports = {
  normalizeLayerId,
  resolveLayerStrategy,
  resolveLayerEntryPreset,
  resolveLayerExitPreset,
  resolveExitPresetById,
  buildExitPresetMap,
  buildEntryPresetMap,
};
