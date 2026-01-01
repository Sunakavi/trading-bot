// timeframeResolver.js

const TIMEFRAME_MS = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
};

function normalizeTimeframe(tf) {
  const key = typeof tf === "string" ? tf.trim().toLowerCase() : "";
  return TIMEFRAME_MS[key] ? key : "1h";
}

function getTimeframeMs(tf) {
  const key = normalizeTimeframe(tf);
  return TIMEFRAME_MS[key];
}

function getCandleTimestamp(candle) {
  const ts = Number(candle?.ts);
  if (Number.isFinite(ts)) return ts;
  const raw = candle?.time;
  const parsed = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function isBarClosed(candle, timeframe, now = Date.now()) {
  const ts = getCandleTimestamp(candle);
  if (!ts) return true;
  const ms = getTimeframeMs(timeframe);
  return now >= ts + ms;
}

function shouldEvaluate(candles, position, timeframe, now = Date.now()) {
  if (!Array.isArray(candles) || candles.length === 0) return false;
  const last = candles[candles.length - 1];
  if (!isBarClosed(last, timeframe, now)) return false;
  const lastTs = getCandleTimestamp(last);
  if (!lastTs) return true;
  if (position?.lastEvaluatedAt === lastTs) return false;
  return true;
}

module.exports = {
  normalizeTimeframe,
  getTimeframeMs,
  getCandleTimestamp,
  isBarClosed,
  shouldEvaluate,
};
