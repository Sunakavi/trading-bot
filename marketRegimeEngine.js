const {
  calcEMA,
  calcRSI,
  calcATR,
  calcSMA,
  calcVolumeMA,
} = require("./utils");

function buildRegimeSettings(input = {}) {
  const mode = input.MODE === "AUTO" ? "AUTO" : "MANUAL";
  const proxySymbol =
    typeof input.REGIME_PROXY_SYMBOL === "string" && input.REGIME_PROXY_SYMBOL
      ? input.REGIME_PROXY_SYMBOL
      : "BTCUSDT";
  const timeframe =
    typeof input.TIMEFRAME === "string" && input.TIMEFRAME
      ? input.TIMEFRAME
      : "15m";

  const numberOr = (value, fallback, min = null) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    if (min != null && num < min) return fallback;
    return num;
  };

  const packs = input.STRATEGY_PACKS || {};
  const parsePack = (pack, fallbackEntry, fallbackExit) => {
    const entryId = Number(pack?.entryStrategyId);
    const exitId = Number(pack?.exitPresetId);
    return {
      entryStrategyId: Number.isFinite(entryId) ? entryId : fallbackEntry,
      exitPresetId: Number.isFinite(exitId) ? exitId : fallbackExit,
    };
  };

  return {
    MODE: mode,
    REGIME_PROXY_SYMBOL: proxySymbol,
    TIMEFRAME: timeframe,
    MIN_CONFIDENCE: numberOr(input.MIN_CONFIDENCE, 0.55, 0),
    REGIME_MIN_HOLD_CANDLES: Math.max(
      1,
      Math.round(numberOr(input.REGIME_MIN_HOLD_CANDLES, 3, 1))
    ),
    RSI_PERIOD: Math.max(2, Math.round(numberOr(input.RSI_PERIOD, 14, 2))),
    ATR_PERIOD: Math.max(2, Math.round(numberOr(input.ATR_PERIOD, 14, 2))),
    ATR_MA_PERIOD: Math.max(2, Math.round(numberOr(input.ATR_MA_PERIOD, 14, 2))),
    VOLUME_MA_PERIOD: Math.max(2, Math.round(numberOr(input.VOLUME_MA_PERIOD, 10, 2))),
    SLOW_MA_PERIOD: Math.max(2, Math.round(numberOr(input.SLOW_MA_PERIOD, 200, 2))),
    SLOPE_WINDOW: Math.max(1, Math.round(numberOr(input.SLOPE_WINDOW, 20, 1))),
    ATR_RATIO_BREAKOUT: numberOr(input.ATR_RATIO_BREAKOUT, 1.35, 0),
    VOL_RATIO_BREAKOUT: numberOr(input.VOL_RATIO_BREAKOUT, 1.2, 0),
    RSI_BREAKOUT_MIN: numberOr(input.RSI_BREAKOUT_MIN, 60, 0),
    SLOPE_TREND_MIN: numberOr(input.SLOPE_TREND_MIN, 0.1, 0),
    RSI_TREND_MIN: numberOr(input.RSI_TREND_MIN, 50, 0),
    RSI_TREND_MAX: numberOr(input.RSI_TREND_MAX, 65, 0),
    ATR_RATIO_TREND_MIN: numberOr(input.ATR_RATIO_TREND_MIN, 0.9, 0),
    ATR_RATIO_TREND_MAX: numberOr(input.ATR_RATIO_TREND_MAX, 1.3, 0),
    SLOPE_RANGE_MAX: numberOr(input.SLOPE_RANGE_MAX, 0.03, 0),
    RSI_RANGE_MIN: numberOr(input.RSI_RANGE_MIN, 45, 0),
    RSI_RANGE_MAX: numberOr(input.RSI_RANGE_MAX, 55, 0),
    ATR_RATIO_RANGE_MAX: numberOr(input.ATR_RATIO_RANGE_MAX, 1.05, 0),
    STRATEGY_PACKS: {
      TREND: parsePack(packs.TREND, 101, 1),
      RANGE: parsePack(packs.RANGE, 103, 3),
      BREAKOUT: parsePack(packs.BREAKOUT, 105, 7),
    },
  };
}

function computeAtrSeries(candles, period, sampleCount) {
  const values = [];
  const start = Math.max(period + 1, candles.length - sampleCount);
  for (let i = start; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const atr = calcATR(slice, period);
    if (Number.isFinite(atr)) values.push(atr);
  }
  return values;
}

function computeRegimeMetrics(candles, cfg) {
  if (!Array.isArray(candles)) {
    return { ready: false, reason: "candles missing" };
  }

  const closes = candles.map((c) => c.close).filter(Number.isFinite);
  const volumeAvg = calcVolumeMA(candles, cfg.VOLUME_MA_PERIOD);
  const rsi = calcRSI(closes, cfg.RSI_PERIOD);
  const atr = calcATR(candles, cfg.ATR_PERIOD);
  const atrSeries = computeAtrSeries(candles, cfg.ATR_PERIOD, cfg.ATR_MA_PERIOD);
  const atrMa = atrSeries.length
    ? calcSMA(atrSeries, atrSeries.length)
    : null;
  const slowNow = calcEMA(closes, cfg.SLOW_MA_PERIOD);
  const slopeSlice = closes.slice(0, Math.max(0, closes.length - cfg.SLOPE_WINDOW));
  const slowPrev = slopeSlice.length >= cfg.SLOW_MA_PERIOD
    ? calcEMA(slopeSlice, cfg.SLOW_MA_PERIOD)
    : null;

  const last = candles[candles.length - 1];
  const volume = Number(last?.volume);

  if (
    !Number.isFinite(volume) ||
    !Number.isFinite(rsi) ||
    !Number.isFinite(atr) ||
    !Number.isFinite(atrMa) ||
    !Number.isFinite(slowNow) ||
    !Number.isFinite(slowPrev) ||
    !Number.isFinite(volumeAvg)
  ) {
    return { ready: false, reason: "insufficient data" };
  }

  const atrRatio = atrMa > 0 ? atr / atrMa : null;
  const volumeRatio = volumeAvg > 0 ? volume / volumeAvg : null;
  const slopePct = slowPrev > 0 ? ((slowNow - slowPrev) / slowPrev) * 100 : null;

  return {
    ready: Number.isFinite(atrRatio) && Number.isFinite(volumeRatio) && Number.isFinite(slopePct),
    atr,
    atrMa,
    atrRatio,
    volume,
    volumeAvg,
    volumeRatio,
    rsi,
    slowNow,
    slowPrev,
    slopePct,
  };
}

function buildCondition(label, passed, actual, target) {
  return { label, passed: Boolean(passed), actual, target };
}

function evaluateRegime(metrics, cfg) {
  if (!metrics?.ready) {
    return {
      regime: "NO_TRADE",
      confidence: 0,
      reason: metrics?.reason || "missing data",
      checks: {},
    };
  }

  const breakoutChecks = [
    buildCondition(
      "ATR_RATIO",
      metrics.atrRatio >= cfg.ATR_RATIO_BREAKOUT,
      metrics.atrRatio,
      cfg.ATR_RATIO_BREAKOUT
    ),
    buildCondition(
      "VOL_RATIO",
      metrics.volumeRatio >= cfg.VOL_RATIO_BREAKOUT,
      metrics.volumeRatio,
      cfg.VOL_RATIO_BREAKOUT
    ),
    buildCondition(
      "RSI",
      metrics.rsi >= cfg.RSI_BREAKOUT_MIN,
      metrics.rsi,
      cfg.RSI_BREAKOUT_MIN
    ),
  ];

  const trendChecks = [
    buildCondition(
      "SLOPE_ABS",
      Math.abs(metrics.slopePct) >= cfg.SLOPE_TREND_MIN,
      Math.abs(metrics.slopePct),
      cfg.SLOPE_TREND_MIN
    ),
    buildCondition(
      "RSI_RANGE",
      metrics.rsi >= cfg.RSI_TREND_MIN && metrics.rsi <= cfg.RSI_TREND_MAX,
      metrics.rsi,
      `${cfg.RSI_TREND_MIN}-${cfg.RSI_TREND_MAX}`
    ),
    buildCondition(
      "ATR_RATIO_RANGE",
      metrics.atrRatio >= cfg.ATR_RATIO_TREND_MIN &&
        metrics.atrRatio <= cfg.ATR_RATIO_TREND_MAX,
      metrics.atrRatio,
      `${cfg.ATR_RATIO_TREND_MIN}-${cfg.ATR_RATIO_TREND_MAX}`
    ),
  ];

  const rangeChecks = [
    buildCondition(
      "SLOPE_ABS",
      Math.abs(metrics.slopePct) <= cfg.SLOPE_RANGE_MAX,
      Math.abs(metrics.slopePct),
      cfg.SLOPE_RANGE_MAX
    ),
    buildCondition(
      "RSI_RANGE",
      metrics.rsi >= cfg.RSI_RANGE_MIN && metrics.rsi <= cfg.RSI_RANGE_MAX,
      metrics.rsi,
      `${cfg.RSI_RANGE_MIN}-${cfg.RSI_RANGE_MAX}`
    ),
    buildCondition(
      "ATR_RATIO_MAX",
      metrics.atrRatio <= cfg.ATR_RATIO_RANGE_MAX,
      metrics.atrRatio,
      cfg.ATR_RATIO_RANGE_MAX
    ),
  ];

  const summarize = (checks) => {
    const total = checks.length;
    const met = checks.filter((c) => c.passed).length;
    return {
      total,
      met,
      confidence: total > 0 ? met / total : 0,
      matched: met === total,
      checks,
    };
  };

  const breakout = summarize(breakoutChecks);
  const trend = summarize(trendChecks);
  const range = summarize(rangeChecks);

  let regime = "NO_TRADE";
  if (breakout.matched) regime = "BREAKOUT";
  else if (trend.matched) regime = "TREND";
  else if (range.matched) regime = "RANGE";

  const bestCandidate = [breakout, trend, range].reduce(
    (best, current, idx) => {
      const name = idx === 0 ? "BREAKOUT" : idx === 1 ? "TREND" : "RANGE";
      if (!best || current.confidence > best.confidence) {
        return { name, confidence: current.confidence };
      }
      return best;
    },
    null
  );

  const confidence =
    regime === "BREAKOUT"
      ? breakout.confidence
      : regime === "TREND"
        ? trend.confidence
        : regime === "RANGE"
          ? range.confidence
          : bestCandidate?.confidence || 0;

  let reason = "matched";
  if (regime === "NO_TRADE") {
    reason = "no rule set matched";
  }

  if (confidence < cfg.MIN_CONFIDENCE) {
    regime = "NO_TRADE";
    reason = `confidence ${confidence.toFixed(2)} below ${cfg.MIN_CONFIDENCE}`;
  }

  return {
    regime,
    confidence,
    reason,
    checks: {
      BREAKOUT: breakout,
      TREND: trend,
      RANGE: range,
    },
  };
}

function detectMarketRegime(candles, config = {}) {
  const cfg = buildRegimeSettings(config);
  const metrics = computeRegimeMetrics(candles, cfg);
  const evaluation = evaluateRegime(metrics, cfg);
  return {
    config: cfg,
    metrics,
    ...evaluation,
  };
}

function applyRegimeLock(previousState = {}, detection, cfg) {
  const prevRegime = previousState.currentRegime || null;
  const prevHold = Number(previousState.holdCount) || 0;
  const minHold = cfg.REGIME_MIN_HOLD_CANDLES || 1;

  let currentRegime = detection.regime;
  let holdCount = 1;
  let lockStatus = "switched";
  let switched = true;

  if (prevRegime && prevRegime === detection.regime) {
    currentRegime = prevRegime;
    holdCount = prevHold + 1;
    lockStatus = "held";
    switched = false;
  } else if (prevRegime && detection.regime !== "BREAKOUT") {
    if (prevHold < minHold) {
      currentRegime = prevRegime;
      holdCount = prevHold + 1;
      lockStatus = "held";
      switched = false;
    }
  }

  return {
    currentRegime,
    previousRegime: prevRegime,
    holdCount,
    lockStatus,
    switched,
  };
}

module.exports = {
  buildRegimeSettings,
  detectMarketRegime,
  applyRegimeLock,
};
