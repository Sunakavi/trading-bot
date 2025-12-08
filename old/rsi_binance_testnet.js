const COLORS = {
  RESET: "\x1b[0m",
  PURPLE: "\x1b[35m",
  GREEN: "\x1b[32m",
  RED: "\x1b[31m",
};

const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

process.stdin.on("keypress", (str, key) => {
  if (!key) return;
  if (key.shift && key.name === "s") {
    SELL_SWITCH = true;
    log("[SYSTEM] SELL SWITCH ACTIVATED (Shift+S)");
  }
  if (key.ctrl && key.name === "c") {
    log("[SYSTEM] Exit.");
    process.exit();
  }
});

// ===== Logging =====
const LOG_DIR = "./logs";
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogFilePath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `bot_${date}.log`);
}

function writeLine(line) {
  fs.appendFileSync(getLogFilePath(), line + "\n", "utf8");
}

function log(...args) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${args.join(" ")}`;
  console.log(line);
  writeLine(line);
}

// ===== Config =====
const CANDLE_RED_TRIGGER_PCT = 0.6;
const REQUIRE_CANDLE_PATTERN = false;
const INITIAL_CAPITAL = 100000;

const BINANCE_API_KEY = "kok1EaWE1bHXn9SmlLOeSRMdFXmYB3Id05GG001ulD53WlBaLf8duAFInFXHLJ3h";
const BINANCE_API_SECRET = "DGAsykpjG1xTKMv9VG3IzdbTJuV9tPWkJPZDxYZxbTP2z9SfpPxYJ8qOb4VOs1xW";
const BINANCE_BASE_URL = "https://testnet.binance.vision"; // ⚠️ Fixed extra spaces

const MAX_SYMBOLS = 10;
const QUOTE = "USDT";
const EXCLUDE_KEYWORDS = ["UP", "DOWN", "BULL", "BEAR", "2L", "2S", "3L", "3S", "BANANA"];
const STABLE_BASES = ["USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD"];
const FIAT_BASES = ["EUR", "TRY", "BRL", "PLN", "ARS", "ZAR", "JPY", "MXN"];

const INTERVAL = "15m";
const KLINES_LIMIT = 250;
const FAST_MA = 50;
const SLOW_MA = 200;
const RSI_PERIOD = 14;
const RSI_MIN = 35;
const RSI_MAX = 65;
const QUOTE_ORDER_FRACTION = 0.5;
const SL_PCT = 0.015;   // 1.5%
const TP_PCT = 0.03;    // 3%
const TRAIL_START_PCT = 0.02;     // Start trailing after +2%
const TRAIL_DISTANCE_PCT = 0.01;  // Trail 1% below peak

const KILL_SWITCH = false;
let SELL_SWITCH = false;
const LOOP_SLEEP_MS = 60_000;

// ===== State =====
let positions = {};
let activeSymbols = [];
let lastPrices = {};

// ===== Helpers =====
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function signedRequest(method, path, params = {}) {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp: String(timestamp) }).toString();
  const signature = crypto.createHmac("sha256", BINANCE_API_SECRET).update(query).digest("hex");
  const url = `${BINANCE_BASE_URL}${path}?${query}&signature=${signature}`;
  const res = await axios({ method, url, headers: { "X-MBX-APIKEY": BINANCE_API_KEY } });
  return res.data;
}

async function publicRequest(path, params = {}) {
  const res = await axios.get(`${BINANCE_BASE_URL}${path}`, { params });
  return res.data;
}

async function fetchKlines(symbol) {
  const data = await publicRequest("/api/v3/klines", { symbol, interval: INTERVAL, limit: KLINES_LIMIT });
  return data.map((c) => ({
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    time: c[0],
  }));
}

function calcSMA(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcRSI(closes, period = RSI_PERIOD) {
  if (closes.length < period + 1) return null;
  const slice = closes.slice(-(period + 1));
  let gain = 0, loss = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff > 0) gain += diff;
    else loss -= diff;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function isBullishEngulfing(prev, curr) {
  if (prev.close >= prev.open || curr.close <= curr.open) return false;
  if (Math.abs(curr.close - curr.open) <= Math.abs(prev.close - prev.open)) return false;
  return curr.open <= prev.close && curr.close >= prev.open;
}

function isBullishHammer(c) {
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  if (range === 0 || body === 0) return false;
  const lowerWick = Math.min(c.close, c.open) - c.low;
  const upperWick = c.high - Math.max(c.close, c.open);
  return lowerWick >= body * 2 && upperWick <= body * 1.2 && c.close > (c.high + c.low) / 2;
}

// ===== Order Functions =====
async function buyMarket(symbol) {
  try {
    const account = await signedRequest("GET", "/api/v3/account");
    const usdtBalance = account.balances.find(b => b.asset === QUOTE);
    const freeUSDT = usdtBalance ? parseFloat(usdtBalance.free) : 0;
    if (freeUSDT <= 1) {
      log(`[${symbol}] Not enough USDT (${freeUSDT})`);
      return null;
    }

    const quoteQty = freeUSDT * QUOTE_ORDER_FRACTION;
    log(COLORS.PURPLE + `→ BUY ${symbol} for ${quoteQty.toFixed(2)} ${QUOTE}` + COLORS.RESET);

    const res = await signedRequest("POST", "/api/v3/order", {
      symbol,
      side: "BUY",
      type: "MARKET",
      quoteOrderQty: quoteQty.toFixed(2),
      newClientOrderId: `BUY_${symbol}_${Date.now()}`,
    });

    const executedQty = parseFloat(res.executedQty);
    const avgPrice = parseFloat(res.cummulativeQuoteQty) / executedQty;
    log(COLORS.PURPLE + "   BUY ORDER:" + COLORS.RESET, { symbol, orderId: res.orderId, executedQty, avgPrice });
    return { executedQty, avgPrice };
  } catch (err) {
    log(COLORS.RED + `[${symbol}] BUY ERROR` + COLORS.RESET, err.response?.data || err.message);
    return null;
  }
}

async function sellMarketAll(symbol, baseAsset) {
  const account = await signedRequest("GET", "/api/v3/account");
  const { free } = account.balances.find(b => b.asset === baseAsset) || { free: "0" };
  const qty = parseFloat(free);
  if (qty <= 0.000001) {
    log(`[${symbol}] Nothing to sell`);
    return null;
  }

  const qtyStr = qty.toFixed(6);
  log(COLORS.GREEN + `→ SELL ${symbol} amount ${qtyStr}` + COLORS.RESET);

  const res = await signedRequest("POST", "/api/v3/order", {
    symbol,
    side: "SELL",
    type: "MARKET",
    quantity: qtyStr,
  });

  const executedQty = parseFloat(res.executedQty || "0");
  const cumQuote = parseFloat(res.cummulativeQuoteQty || "0");
  const avgPrice = executedQty > 0 ? cumQuote / executedQty : 0;
  log(COLORS.GREEN + "   SELL ORDER:" + COLORS.RESET, { symbol, orderId: res.orderId, executedQty, avgPrice });
  return { executedQty, avgPrice };
}

// ===== Strategy Core =====
async function runSymbol(symbol) {
  try {
    const candles = await fetchKlines(symbol);
    if (!candles || candles.length < SLOW_MA) {
      log(`[${symbol}] Not enough data`);
      return;
    }

    const closes = candles.map(c => c.close);
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    lastPrices[symbol] = last.close;

    const maFast = calcSMA(closes, FAST_MA);
    const maSlow = calcSMA(closes, SLOW_MA);
    const rsi = calcRSI(closes, RSI_PERIOD);
    const pos = positions[symbol] || { hasPosition: false, entryPrice: 0, qty: 0, maxPrice: 0 };

    // === ENTRY LOGIC ===
    if (!pos.hasPosition && !KILL_SWITCH && !SELL_SWITCH) {
      const trendUp = maFast > maSlow && last.close > maSlow;
      const rsiOk = rsi !== null && rsi >= RSI_MIN && rsi <= RSI_MAX;
      const candleOk = isBullishEngulfing(prev, last) || isBullishHammer(last);

      if (trendUp && rsiOk && (!REQUIRE_CANDLE_PATTERN || candleOk)) {
        log(`[${symbol}] ✅ Entry conditions met`);
        const buyResult = await buyMarket(symbol);
        if (buyResult) {
          positions[symbol] = {
            hasPosition: true,
            entryPrice: buyResult.avgPrice,
            qty: buyResult.executedQty,
            maxPrice: buyResult.avgPrice,
          };
        }
      }
    }

    // === EXIT / MANAGEMENT LOGIC ===
    if (pos.hasPosition) {
      const price = last.close;
      if (price > pos.maxPrice) pos.maxPrice = price;

      const baseSL = pos.entryPrice * (1 - SL_PCT);
      const baseTP = pos.entryPrice * (1 + TP_PCT);
      let dynSL = baseSL;

      // Trailing stop
      if (price >= pos.entryPrice * (1 + TRAIL_START_PCT)) {
        const trailSL = pos.maxPrice * (1 - TRAIL_DISTANCE_PCT);
        if (trailSL > dynSL) dynSL = trailSL;
      }

      const hitTP = price >= baseTP;
      const hitSL = price <= dynSL;
      const rawExitSignal = hitTP || hitSL;

      // Candle-based exit confirmation
      let candleExitOk = true; // default = allow exit
      if (rawExitSignal) {
        const isRed = last.close < last.open;
        if (isRed) {
          const prevBody = Math.abs(prev.close - prev.open);
          const redBody = Math.abs(last.close - last.open);
          if (prevBody > 0) {
            candleExitOk = redBody / prevBody >= CANDLE_RED_TRIGGER_PCT;
          }
        } else {
          // Green candle → allow exit (no restriction)
          candleExitOk = true;
        }
      }

      const exitSignal = rawExitSignal && candleExitOk;

      log(
        `[${symbol}] LONG @ ${pos.entryPrice.toFixed(2)} | P=${price.toFixed(2)} | ` +
        `SL=${dynSL.toFixed(2)} | TP=${baseTP.toFixed(2)} | Max=${pos.maxPrice.toFixed(2)} | ` +
        `CandleExit=${candleExitOk}`
      );

      if (exitSignal) {
        log(`[${symbol}] 🚨 EXIT TRIGGERED (${hitTP ? 'TP' : 'SL'})`);
        const base = symbol.replace(QUOTE, '');
        await sellMarketAll(symbol, base);
        positions[symbol] = { hasPosition: false, entryPrice: 0, qty: 0, maxPrice: 0 };
      }
    }
  } catch (err) {
    log(`[${symbol}] Error:`, err.response?.data || err.message);
  }
}

// ===== Portfolio =====
async function getAccount() {
  return await signedRequest("GET", "/api/v3/account");
}

function findBalance(accountData, asset) {
  const bal = accountData.balances.find(b => b.asset === asset);
  return bal ? { free: parseFloat(bal.free), locked: parseFloat(bal.locked) } : { free: 0, locked: 0 };
}

function symbolEndsWithQuote(sym, quote) {
  return sym.endsWith(quote);
}

function isExcludedSymbol(sym) {
  return EXCLUDE_KEYWORDS.some(kw => sym.includes(kw));
}

function isStableOrFiatSymbol(sym) {
  if (!sym.endsWith(QUOTE)) return false;
  const base = sym.slice(0, -QUOTE.length);
  return STABLE_BASES.includes(base) || FIAT_BASES.includes(base);
}

async function fetchTopSymbols() {
  const tickers = await publicRequest("/api/v3/ticker/24hr");
  const filtered = tickers
    .filter(t => symbolEndsWithQuote(t.symbol, QUOTE))
    .filter(t => !isExcludedSymbol(t.symbol))
    .filter(t => !isStableOrFiatSymbol(t.symbol));

  const top = filtered
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, MAX_SYMBOLS)
    .map(t => t.symbol);

  log("=== TOP SYMBOLS ===");
  top.forEach((sym, i) => log(`${i + 1}. ${sym}`));
  log("====================");
  return top;
}

async function logPortfolio() {
  try {
    const account = await getAccount();
    const usdtBal = findBalance(account, QUOTE);
    const totalUSDT = usdtBal.free + usdtBal.locked;
    let coinsValue = 0;

    for (const sym of activeSymbols) {
      const base = sym.replace(QUOTE, '');
      const bal = findBalance(account, base);
      const totalBase = bal.free + bal.locked;
      const price = lastPrices[sym] || 0;
      const val = price * totalBase;
      coinsValue += val;
    }

    const equity = totalUSDT + coinsValue;
    const pnl = ((equity - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;
    const pnlStr = pnl >= 0 ? `+${pnl.toFixed(2)}%` : `${pnl.toFixed(2)}%`;

    log(`[PORTFOLIO] USDT=${totalUSDT.toFixed(2)} | Coins=${coinsValue.toFixed(2)} | Equity=${equity.toFixed(2)} | PnL=${pnlStr}`);
  } catch (err) {
    log("[PORTFOLIO] Error:", err.message);
  }
}

// ===== Main Loop =====
async function mainLoop() {
  activeSymbols = await fetchTopSymbols();
  positions = {};
  activeSymbols.forEach(sym => {
    positions[sym] = { hasPosition: false, entryPrice: 0, qty: 0, maxPrice: 0 };
  });

  while (true) {
    for (const sym of activeSymbols) {
      await runSymbol(sym);
    }
    await logPortfolio();
    log(`---- wait ${(LOOP_SLEEP_MS / 1000)} sec ----`);
    await sleep(LOOP_SLEEP_MS);
  }
}

mainLoop().catch(err => log("[CRITICAL]", err));