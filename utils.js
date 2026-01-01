// utils.js (Technical Analysis and Generic Helpers)

const { log } = require("./log");

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// --- Candle Parsing ---
function parseKlines(data) {
  return data.map((c) => ({
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    volume: parseFloat(c[5]), 
  }));
}

// --- SMA Calculation ---
function calcSMA(values, period) {
  if (!values || values.length < period) return null;
  // Slice from the end to get the latest `period` values
  const slice = values.slice(-period); 
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

// --- EMA Calculation ---
function calcEMA(closes, period) {
  if (!closes || closes.length < period) return null;
  const multiplier = 2 / (period + 1);
  // Use SMA for the initial EMA value
  let ema = calcSMA(closes.slice(0, period), period); 

  for (let i = period; i < closes.length; i++) {
    // EMA = (Close - EMA_prev) * Multiplier + EMA_prev
    ema = (closes[i] - ema) * multiplier + ema;
  }

  return ema;
}

// --- RSI Calculation ---
function calcRSI(closes, period) {
  if (!closes || closes.length < period + 1) return null;

  const slice = closes.slice(-(period + 1));
  let gain = 0;
  let loss = 0;

  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff > 0) gain += diff;
    else loss -= diff;
  }

  const avgGain = gain / period;
  const avgLoss = loss / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  return rsi;
}

// --- ATR Calculation ---
function calculateTrueRange(candle, prevClose) {
    const highLow = candle.high - candle.low;
    const highPrevClose = Math.abs(candle.high - prevClose);
    const lowPrevClose = Math.abs(candle.low - prevClose);
    return Math.max(highLow, highPrevClose, lowPrevClose);
}

function calcATR(candles, period) {
  // חייבים שיהיה לפחות period+1 נרות (כי צריך גם prevClose)
  if (!candles || candles.length < period + 1) return null;

  // נחשב ATR על ה־period האחרון
  // נניח שיש N נרות – נעבור על האינדקסים:
  // i = N - period .. N-1
  let sumTR = 0;
  const lastIndex = candles.length - 1;

  for (let i = candles.length - period; i <= lastIndex; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    if (!c || !prev) continue; // הגנה נוספת, ליתר ביטחון

    const tr = calculateTrueRange(c, prev.close);
    sumTR += tr;
  }

  const atr = sumTR / period;
  return atr;
}

function calcADX(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;

  let trSum = 0;
  let plusDmSum = 0;
  let minusDmSum = 0;

  for (let i = candles.length - period; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    if (!curr || !prev) continue;

    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;

    const plusDm = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDm = downMove > upMove && downMove > 0 ? downMove : 0;

    const tr = calculateTrueRange(curr, prev.close);

    trSum += tr;
    plusDmSum += plusDm;
    minusDmSum += minusDm;
  }

  if (trSum === 0) return null;

  const plusDi = (plusDmSum / trSum) * 100;
  const minusDi = (minusDmSum / trSum) * 100;
  const dx = Math.abs(plusDi - minusDi) / Math.max(plusDi + minusDi, 1e-9);

  return dx * 100;
}

function calcVWAP(candles = []) {
  if (!candles.length) return null;
  let totalPv = 0;
  let totalVol = 0;
  candles.forEach((c) => {
    const typical = (c.high + c.low + c.close) / 3;
    totalPv += typical * c.volume;
    totalVol += c.volume;
  });
  if (totalVol === 0) return null;
  return totalPv / totalVol;
}

function calcVolumeMA(candles = [], period = 20) {
  if (!candles.length || candles.length < period) return null;
  const slice = candles.slice(-period);
  const sum = slice.reduce((acc, c) => acc + (c.volume || 0), 0);
  return sum / period;
}

function getHighestHigh(candles = [], lookback = 20) {
  if (!candles.length) return null;
  const slice = candles.slice(-lookback);
  let high = null;
  slice.forEach((c) => {
    if (!Number.isFinite(c.high)) return;
    if (high === null || c.high > high) high = c.high;
  });
  return high;
}

function getLowestLow(candles = [], lookback = 20) {
  if (!candles.length) return null;
  const slice = candles.slice(-lookback);
  let low = null;
  slice.forEach((c) => {
    if (!Number.isFinite(c.low)) return;
    if (low === null || c.low < low) low = c.low;
  });
  return low;
}


// --- Candle Patterns ---

function isBullishEngulfing(prev, curr) {
  const prevRed = prev.close < prev.open;
  const currGreen = curr.close > curr.open;
  if (!prevRed || !currGreen) return false;

  const prevBody = Math.abs(prev.close - prev.open);
  const currBody = Math.abs(curr.close - curr.open);
  if (currBody <= prevBody) return false;

  const engulf = curr.open <= prev.close && curr.close >= prev.open;
  return engulf;
}

function isBullishHammer(c) {
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  if (range <= 0) return false;

  const upperWick = c.high - Math.max(c.close, c.open);
  const lowerWick = Math.min(c.close, c.open) - c.low;

  if (body === 0) return false;
  const lowerOk = lowerWick >= body * 2;
  const upperOk = upperWick <= body * 1.2;
  const closeUpperHalf = c.close > (c.high + c.low) / 2;

  return lowerOk && upperOk && closeUpperHalf;
}

module.exports = {
  sleep,
  calcSMA,
  calcEMA,
  calcRSI,
  calcATR,
  calcADX,
  calcVWAP,
  calcVolumeMA,
  getHighestHigh,
  getLowestLow,
  parseKlines,
  isBullishEngulfing,
  isBullishHammer,
};
