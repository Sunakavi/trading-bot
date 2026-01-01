const { config, CANDLE_RED_TRIGGER_PCT } = require("./config");

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

function resolveLayerExitPreset(layerConfig = {}) {
  const exitPreset = layerConfig.exitPreset || {};
  const exitConfig = {
    SL_PCT: Number(exitPreset.SL_PCT ?? config.SL_PCT),
    TP_PCT: Number(exitPreset.TP_PCT ?? config.TP_PCT),
    TRAIL_START_PCT: Number(exitPreset.TRAIL_START_PCT ?? config.TRAIL_START_PCT),
    TRAIL_DISTANCE_PCT: Number(
      exitPreset.TRAIL_DISTANCE_PCT ?? config.TRAIL_DISTANCE_PCT
    ),
    CANDLE_EXIT_ENABLED: Boolean(
      exitPreset.CANDLE_EXIT_ENABLED ?? config.USE_CANDLE_EXIT
    ),
    CANDLE_RED_TRIGGER_PCT: Number(
      exitPreset.CANDLE_RED_TRIGGER_PCT ?? CANDLE_RED_TRIGGER_PCT
    ),
  };

  return {
    exitPresetId: normalizeExitPresetId(layerConfig.exitPresetId),
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

module.exports = {
  normalizeLayerId,
  resolveLayerStrategy,
  resolveLayerExitPreset,
  resolveExitPresetById,
  buildExitPresetMap,
};
