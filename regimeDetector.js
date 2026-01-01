const { calcSMA, calcATR } = require("./utils");

const DEFAULTS = {
  minCandles: 60,
  fastMa: 20,
  slowMa: 50,
  trendGapPct: 0.002,
  highVolPct: 0.02,
  deadVolPct: 0.005,
};

function detectRegime(candles = [], options = {}) {
  if (!Array.isArray(candles) || candles.length < DEFAULTS.minCandles) {
    return "OFF";
  }

  const settings = { ...DEFAULTS, ...options };
  const closes = candles.map((c) => c.close).filter(Number.isFinite);
  if (closes.length < settings.slowMa) return "OFF";

  const price = closes[closes.length - 1];
  const fast = calcSMA(closes, settings.fastMa);
  const slow = calcSMA(closes, settings.slowMa);
  const atr = calcATR(candles, 14);

  if (!fast || !slow || !atr || !Number.isFinite(price) || price <= 0) {
    return "OFF";
  }

  const trendGap = Math.abs(fast - slow) / price;
  const volPct = atr / price;

  if (volPct < settings.deadVolPct) return "OFF";
  if (volPct > settings.highVolPct) return "VOLATILE";

  if (trendGap >= settings.trendGapPct) return "TREND";
  return "RANGE";
}

module.exports = { detectRegime };
