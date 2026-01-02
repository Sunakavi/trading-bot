const DEFAULT_EXIT_PRESETS = {
  1: {
    id: 1,
    name: "Conservative",
    sl: 1.2,
    tp: 2.4,
    trailStart: 1.2,
    trailDistance: 0.6,
    candleRed: 60,
  },
  2: {
    id: 2,
    name: "Aggressive Trend",
    sl: 0.9,
    tp: 3.2,
    trailStart: 1.6,
    trailDistance: 0.8,
    candleRed: 40,
  },
  3: {
    id: 3,
    name: "Safe Scalping",
    sl: 0.6,
    tp: 1.2,
    trailStart: 0.8,
    trailDistance: 0.4,
    candleRed: 50,
  },
  4: {
    id: 4,
    name: "Momentum Rider",
    sl: 1.0,
    tp: 4.0,
    trailStart: 2.0,
    trailDistance: 1.0,
    candleRed: 30,
  },
  5: {
    id: 5,
    name: "ATR Mixed (semi-dynamic)",
    sl: 0.6,
    tp: 1.4,
    trailStart: 2.0,
    trailDistance: 1.0,
    candleRed: 40,
  },
  6: {
    id: 6,
    name: "Volatility Shield",
    sl: 1.5,
    tp: 2.5,
    trailStart: 2.2,
    trailDistance: 1.2,
    candleRed: 70,
  },
  7: {
    id: 7,
    name: "Breakout Mode",
    sl: 0.8,
    tp: 5.0,
    trailStart: 3.0,
    trailDistance: 1.5,
    candleRed: 20,
  },
  8: {
    id: 8,
    name: "Ultra Tight",
    sl: 0.4,
    tp: 0.8,
    trailStart: 0.6,
    trailDistance: 0.3,
    candleRed: 35,
  },
};

function normalizeExitPresetId(id) {
  const numeric = Number(id);
  return Number.isFinite(numeric) ? numeric : null;
}

function getExitPresetById(id) {
  const numeric = normalizeExitPresetId(id);
  if (!numeric) return null;
  return DEFAULT_EXIT_PRESETS[numeric] || null;
}

function resolveExitPresetConfig(exitPresetId, baseConfig = {}) {
  const preset = getExitPresetById(exitPresetId);
  if (!preset) {
    return {
      SL_PCT: Number(baseConfig.SL_PCT),
      TP_PCT: Number(baseConfig.TP_PCT),
      TRAIL_START_PCT: Number(baseConfig.TRAIL_START_PCT),
      TRAIL_DISTANCE_PCT: Number(baseConfig.TRAIL_DISTANCE_PCT),
      CANDLE_EXIT_ENABLED: Boolean(baseConfig.CANDLE_EXIT_ENABLED),
      CANDLE_RED_TRIGGER_PCT: Number(baseConfig.CANDLE_RED_TRIGGER_PCT),
    };
  }

  return {
    SL_PCT: preset.sl / 100,
    TP_PCT: preset.tp / 100,
    TRAIL_START_PCT: preset.trailStart / 100,
    TRAIL_DISTANCE_PCT: preset.trailDistance / 100,
    CANDLE_EXIT_ENABLED: Boolean(baseConfig.CANDLE_EXIT_ENABLED),
    CANDLE_RED_TRIGGER_PCT: preset.candleRed / 100,
  };
}

module.exports = {
  DEFAULT_EXIT_PRESETS,
  getExitPresetById,
  resolveExitPresetConfig,
};
