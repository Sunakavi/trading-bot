const { calcEMA, calcATR, calcADX } = require("./utils");
const { StrategyPortfolioConfig } = require("./strategyPortfolio.config");

const DEFAULTS = {
  minCandles: 220,
  emaFast: 50,
  emaSlow: 200,
  adxPeriod: 14,
  adxTrendMin: 18,
  adxChopMax: 16,
  atrPeriod: 14,
  atrPctHigh: 1.2,
};

function detectRegime(candles = [], options = {}) {
  if (!Array.isArray(candles) || candles.length < DEFAULTS.minCandles) {
    return "OFF";
  }

  const settings = buildRegimeConfig(options);
  const closes = candles.map((c) => c.close).filter(Number.isFinite);
  if (closes.length < settings.emaSlow) return "OFF";

  const price = closes[closes.length - 1];
  const fast = calcEMA(closes, settings.emaFast);
  const slow = calcEMA(closes, settings.emaSlow);
  const atr = calcATR(candles, settings.atrPeriod);
  const adx = calcADX(candles, settings.adxPeriod);

  if (!fast || !slow || !atr || !adx || !Number.isFinite(price) || price <= 0) {
    return "OFF";
  }

  const volPct = (atr / price) * 100;

  if (volPct > settings.atrPctHigh) return "VOLATILE";

  if (fast > slow && adx >= settings.adxTrendMin) return "TREND";
  if (adx < settings.adxChopMax) return "RANGE";

  return "RANGE";
}

function buildRegimeConfig(overrides = {}) {
  return {
    ...DEFAULTS,
    ...(StrategyPortfolioConfig.regimeConfig || {}),
    ...overrides,
  };
}

module.exports = { detectRegime, buildRegimeConfig };
