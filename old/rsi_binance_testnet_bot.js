const COLORS = {
    RESET: "\x1b[0m",
    PURPLE: "\x1b[35m",
    GREEN: "\x1b[32m",
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

// ===== Logging system (safe, no recursion) =====
const LOG_DIR = "./logs";

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFilePath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `bot_${date}.log`);
}

function writeLine(line) {
  fs.appendFileSync(getLogFilePath(), line + "\n", "utf8");
}

// ******* IMPORTANT *******
// log() MUST NOT call log() inside itself.
function log(...args) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${args.join(" ")}`;

  console.log(line);  // <-- OK
  writeLine(line);    // <-- OK
}
// =======================

// מינימום עוצמת נר אדום (באחוז מגודל הגוף של הנר הקודם) כדי לאפשר יציאה
const CANDLE_RED_TRIGGER_PCT = 0.6; // 60% – תוכל לשחק עם זה



const REQUIRE_CANDLE_PATTERN = false;
const INITIAL_CAPITAL = 100000;   // הון התחלתי לצורך חישוב PNL

// =======================
// CONFIG
// =======================
// שים פה את מפתחות ה-Spot Testnet שלך

const BINANCE_API_KEY = "kok1EaWE1bHXn9SmlLOeSRMdFXmYB3Id05GG001ulD53WlBaLf8duAFInFXHLJ3h";
const BINANCE_API_SECRET = "DGAsykpjG1xTKMv9VG3IzdbTJuV9tPWkJPZDxYZxbTP2z9SfpPxYJ8qOb4VOs1xW";

const BINANCE_BASE_URL = "https://testnet.binance.vision";

// כמה מטבעות לסחור (Top N לפי מחזור דולר)
const MAX_SYMBOLS = 10;
const QUOTE = "USDT";

// לא רוצים טוקנים מוזרים / ממונפים
const EXCLUDE_KEYWORDS = ["UP", "DOWN", "BULL", "BEAR", "2L", "2S", "3L", "3S", "BANANA"];

// בסיסים שלא נסחור בהם (סטייבל / פיאט)
const STABLE_BASES = ["USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD"];
const FIAT_BASES = ["EUR", "TRY", "BRL", "PLN", "ARS", "ZAR", "JPY", "MXN"];


// טיים-פריים 1H
const INTERVAL = "15m";
const KLINES_LIMIT = 250; // קצת ספייר מעל 200

// ממוצעים
const FAST_MA = 50;
const SLOW_MA = 200;

// RSI
const RSI_PERIOD = 14;
const RSI_MIN = 35;
const RSI_MAX = 65;


// אחוז מהמזומן הפנוי ב-USDT לכל טרייד
const QUOTE_ORDER_FRACTION = 0.5; // 50%


// TP / SL
const SL_PCT = 0.015; // -1.5%
const TP_PCT = 0.03; // +3%

// Trailing
const TRAIL_START_PCT = 0.02; // מתחיל טראילינג אחרי +2%
const TRAIL_DISTANCE_PCT = 0.01; // סטופ 1% מתחת לשיא

// KILL SWITCH – אם true לא נעשה שום טרייד
const KILL_SWITCH = false;
let SELL_SWITCH = false;

// כמה מחכים בין לופים (מילי-שניות)
const LOOP_SLEEP_MS = 60_000;

// =======================
// STATE
// =======================

/**
 * positions[symbol] = {
 *   hasPosition: boolean,
 *   entryPrice: number,
 *   qty: number,
 *   maxPrice: number
 * }
 */
let positions = {};
let activeSymbols = [];
let lastPrices = {}; // lastPrices[symbol] = number

// =======================
// HELPERS
// =======================

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function signedRequest(method, path, params = {}) {
  const timestamp = Date.now();
  const query = new URLSearchParams({
    ...params,
    timestamp: String(timestamp),
  }).toString();

  const signature = crypto
    .createHmac("sha256", BINANCE_API_SECRET)
    .update(query)
    .digest("hex");

  const url = `${BINANCE_BASE_URL}${path}?${query}&signature=${signature}`;

  const res = await axios({
    method,
    url,
    headers: { "X-MBX-APIKEY": BINANCE_API_KEY },
  });

  return res.data;
}

async function publicRequest(path, params = {}) {
  const url = `${BINANCE_BASE_URL}${path}`;
  const res = await axios.get(url, { params });
  return res.data;
}

// מחזיר מערך של נרות: {open, high, low, close}
async function fetchKlines(symbol) {
  const data = await publicRequest("/api/v3/klines", {
    symbol,
    interval: INTERVAL,
    limit: KLINES_LIMIT,
  });

  return data.map((c) => ({
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
  }));
}

function calcSMA(values, period) {
  if (!values || values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

// RSI פשוט על חלון אחרון (לא Wilder מלא, אבל מספיק לנו)
function calcRSI(closes, period = RSI_PERIOD) {
  if (!closes || closes.length < period + 1) return null;

  const slice = closes.slice(- (period + 1));
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

async function getAccount() {
  return await signedRequest("GET", "/api/v3/account");
}

function findBalance(accountData, asset) {
  const bal = accountData.balances.find((b) => b.asset === asset);
  if (!bal) return { free: 0, locked: 0 };
  return {
    free: parseFloat(bal.free),
    locked: parseFloat(bal.locked),
  };
}

function symbolEndsWithQuote(sym, quote) {
  return sym.endsWith(quote);
}

function isExcludedSymbol(sym) {
  return EXCLUDE_KEYWORDS.some((kw) => sym.includes(kw));
}
function isStableOrFiatSymbol(sym) {
    // sym כמו "USDCUSDT", "FDUSDUSDT", "EURUSDT"
    if (!sym.endsWith(QUOTE)) return false;
    const base = sym.replace(QUOTE, "");
    return STABLE_BASES.includes(base) || FIAT_BASES.includes(base);
  }
  
// =======================
// CANDLE PATTERNS
// =======================

function isBullishEngulfing(prev, curr) {
  const prevRed = prev.close < prev.open;
  const currGreen = curr.close > curr.open;
  if (!prevRed || !currGreen) return false;

  const prevBody = Math.abs(prev.close - prev.open);
  const currBody = Math.abs(curr.close - curr.open);
  if (currBody <= prevBody) return false;

  // הגוף הירוק עוטף את האדום
  const engulf =
    curr.open <= prev.close &&
    curr.close >= prev.open;

  return engulf;
}

function isBullishHammer(c) {
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  if (range <= 0) return false;

  const upperWick = c.high - Math.max(c.close, c.open);
  const lowerWick = Math.min(c.close, c.open) - c.low;

  // זנב תחתון ארוך, גוף קטן, סגירה בחלק העליון
  if (body === 0) return false;
  const lowerOk = lowerWick >= body * 2;
  const upperOk = upperWick <= body * 1.2;
  const closeUpperHalf = c.close > (c.high + c.low) / 2;

  return lowerOk && upperOk && closeUpperHalf;
}

// =======================
// UNIVERSE SELECTION – TOP N BY VOLUME
// =======================

async function fetchTopSymbols() {
  const tickers = await publicRequest("/api/v3/ticker/24hr");

  const usdtTickers = tickers
  .filter((t) => symbolEndsWithQuote(t.symbol, QUOTE))
  .filter((t) => !isExcludedSymbol(t.symbol))
  .filter((t) => !isStableOrFiatSymbol(t.symbol)); // לא לסחור סטייבלים/פיאט



  usdtTickers.sort(
    (a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume)
  );

  const top = usdtTickers.slice(0, MAX_SYMBOLS);
  const symbols = top.map((t) => t.symbol);

  log("=== TOP SYMBOLS (by quoteVolume USDT) ===");
  top.forEach((t, i) => {
    log(
      `${i + 1}. ${t.symbol} | quoteVol=${parseFloat(
        t.quoteVolume
      ).toFixed(0)}`
    );
  });
  log("========================================");

  return symbols;
}

// =======================
// ORDER HELPERS
// =======================

async function buyMarket(symbol) {
  try {
    // 1. מביא את היתרות מהחשבון
    const account = await binanceRequest("/api/v3/account", "GET", null, true);
    const usdtBalance = account.balances.find((b) => b.asset === QUOTE);
    const freeUSDT = usdtBalance ? parseFloat(usdtBalance.free) : 0;

    if (freeUSDT <= 0) {
      log(`[${symbol}] אין USDT פנוי (freeUSDT=${freeUSDT}) – לא קונה`);
      return null;
    }

    // 2. מחשב כמה USDT לשים בטרייד: 50% מהמזומן הפנוי
    const quoteQty = freeUSDT * QUOTE_ORDER_FRACTION;

    log(
      COLORS.PURPLE +
        `→ BUY ${symbol} for ${quoteQty.toFixed(2)} ${QUOTE} (free=${freeUSDT.toFixed(
          2
        )})` +
        COLORS.RESET
    );

    // 3. שליחת הוראת קנייה בשוק
    const res = await binanceRequest(
      "/api/v3/order",
      "POST",
      {
        symbol,
        side: "BUY",
        type: "MARKET",
        quoteOrderQty: quoteQty.toFixed(2),
        newClientOrderId: `BUY_${symbol}_${Date.now()}`,
      },
      true
    );

    const executedQty = parseFloat(res.executedQty);
    const avgPrice = parseFloat(res.cummulativeQuoteQty) / executedQty;

    log(
      COLORS.PURPLE + "   BUY ORDER:" + COLORS.RESET,
      JSON.stringify({
        symbol,
        orderId: res.orderId,
        executedQty,
        avgPrice,
      })
    );

    return {
      executedQty,
      avgPrice,
    };
  } catch (err) {
    log(
      COLORS.RED +
        `[${symbol}] BUY ERROR` +
        COLORS.RESET,
      err.response?.data || err.message
    );
    return null;
  }
}


async function sellMarketAll(symbol, baseAsset) {
  const account = await getAccount();
  const { free } = findBalance(account, baseAsset);
  if (free <= 0.000001) {
    log(`NOTHING TO SELL ${baseAsset} (${symbol})`);
    return null;
  }

  const qty = Number(free.toFixed(6));

  log(
  COLORS.GREEN +
  `→ SELL ${symbol} amount ${qty}` +
  COLORS.RESET
);

  
  const res = await signedRequest("POST", "/api/v3/order", {
    symbol,
    side: "SELL",
    type: "MARKET",
    quantity: qty,
  });

  const executedQty = parseFloat(res.executedQty || "0");
  const cumQuote = parseFloat(res.cummulativeQuoteQty || "0");
  let avgPrice = 0;
  if (executedQty > 0) {
    avgPrice = cumQuote / executedQty;
  }

  log(
  COLORS.GREEN +
  "   SELL ORDER:" +
  COLORS.RESET,
  JSON.stringify({
    symbol,
    orderId: res.orderId,
    executedQty,
    avgPrice,
  })
);

  

  return { executedQty, avgPrice };
}

// =======================
// PORTFOLIO LOG
// =======================

async function logPortfolio() {
  try {
    const account = await getAccount();
    const usdtBal = findBalance(account, QUOTE);
    const totalUSDT = usdtBal.free + usdtBal.locked;

    log("===== PORTFOLIO (USDT + top symbols) =====");
    log(`[${QUOTE}] free=${totalUSDT.toFixed(2)}`);

    let coinsValue = 0;

    for (const sym of activeSymbols) {
      const base = sym.replace(QUOTE, "");
      const bal = findBalance(account, base);
      const totalBase = bal.free + bal.locked;
      const price = lastPrices[sym] || 0;
      const val = price * totalBase;
      coinsValue += val;

      log(
     `[${base}] amount=${totalBase.toFixed(6)} ≈ ${val.toFixed(2)} ${QUOTE}`
      );

    }

    const equity = totalUSDT + coinsValue;
    log(`[EQUITY] ≈ ${equity.toFixed(2)} ${QUOTE}`);
    log("==========================================");

    
    logPerformance(equity);
    
  } catch (err) {
  log("[PORTFOLIO] Error:", err.response?.data || err.message);
  }
}

function logPerformance(equity) {
    const pnl = ((equity - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;
  
    const formattedPNL =
      pnl >= 0 ? `+${pnl.toFixed(2)}%` : `${pnl.toFixed(2)}%`;
  
    log(
    `[PERFORMANCE] Start=${INITIAL_CAPITAL}  |  Equity=${equity.toFixed(
    2
    )}  |  PNL=${formattedPNL}`
    );

  }
  
// =======================
// CORE STRATEGY PER SYMBOL
// =======================

async function runSymbol(symbol) {
  try {
  const candles = await fetchKlines(symbol);
  if (!candles || candles.length < SLOW_MA) {
    log(
      `[${symbol}] NOT ENOUGH CANDLES: have=${candles ? candles.length : 0}, need=${SLOW_MA}`
    );
    // ensure position slot exists and bail out
    positions[symbol] = positions[symbol] || {
      hasPosition: false,
      entryPrice: 0,
      qty: 0,
      maxPrice: 0,
    };
    return;
  }

  const closes = candles.map((c) => c.close);
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    lastPrices[symbol] = last.close;

    const maFast = calcSMA(closes, FAST_MA);
    const maSlow = calcSMA(closes, SLOW_MA);
    const rsi = calcRSI(closes, RSI_PERIOD);

    const pos = positions[symbol] || {
      hasPosition: false,
      entryPrice: 0,
      qty: 0,
      maxPrice: 0,
    };

    log(
  `[${symbol}] LONG OPENED @ ${pos.entryPrice.toFixed(
    2
  )} qty=${pos.qty}`
);


    if (KILL_SWITCH) {
      log(`[${symbol}] KILL_SWITCH ON – NO TRADES`);
      positions[symbol] = pos;
      return;
    }

    // === TREND FILTER ===
const trendUp = maFast > maSlow && last.close > maSlow;

// === PULLBACK FILTER ===
const pullback =
  prev.low < maFast * 1.005 &&   // עד 0.5% מעל MA50
  last.close > maFast * 0.997;   // חזרה בערך ל־MA50 ומעלה

// === RSI FILTER ===
const rsiOk =
  rsi !== null && rsi >= RSI_MIN && rsi <= RSI_MAX;

// === CANDLE PATTERN ===
const candleOk =
  isBullishEngulfing(prev, last) || isBullishHammer(last);

// -------------------
// ENTRY LOGIC
// -------------------
if (pos.hasPosition) {
  // =========================
  // חישובי SL/TP שיש לך היום
  // =========================
  const price = lastPrice; // מה שאתה כבר משתמש בו
  // baseSL, dynSL, baseTP, dynTP וכו' – לא נוגעים

  const hitTP = price >= baseTP || price >= dynSL_TP /* לפי הקוד שלך */;
  const hitSL = price <= baseSL || price <= dynSL;

  // =========================
  // 🔥 לוגיקת נר ליציאה
  // מניח שיש לך שתי הנרות האחרונות כ־OHLC:
  // lastCandle = [open, high, low, close, ...]
  // prevCandle = [open, high, low, close, ...]
  // אם השמות שונים – רק תתאים.
  // =========================
  const lastOpen = lastCandle[0];
  const lastClose = lastCandle[3];
  const prevOpen = prevCandle[0];
  const prevClose = prevCandle[3];

  const isGreen = lastClose >= lastOpen;
  const isRed = lastClose < lastOpen;

  const prevBody = Math.abs(prevClose - prevOpen);
  const redBody = isRed ? Math.abs(lastClose - lastOpen) : 0;

  // ברירת מחדל: לא מאפשרים יציאה (ממשיכים להחזיק)
  let candleExitOk = false;

  if (isGreen) {
    // נר ירוק → ממשיכים, לא מוכרים
    candleExitOk = false;
  } else if (isRed) {
    // נר אדום:
    // אם הגוף האדום גדול מספיק ביחס לנר הקודם → מאפשרים יציאה
    if (prevBody > 0 && redBody / prevBody >= CANDLE_RED_TRIGGER_PCT) {
      candleExitOk = true;
    } else {
      // נר אדום קטן → ממשיכים להחזיק
      candleExitOk = false;
    }
  }

  // =========================
  // שילוב: יוצאים רק אם TP/SL הופעלו *וגם* הנר מאשר יציאה
  // =========================
  const rawExitSignal = hitTP || hitSL;
  const exitSignal = rawExitSignal && candleExitOk;

  log(
    `[${symbol}] in LONG @ ${pos.entryPrice.toFixed(
      2
    )} | price=${price.toFixed(
      2
    )} | baseSL<=${baseSL.toFixed(
      2
    )} | dynSL<=${dynSL.toFixed(
      2
    )} | TP>=${baseTP.toFixed(
      2
    )} | maxPrice=${pos.maxPrice.toFixed(
      2
    )} | isGreen=${isGreen} | isRed=${isRed} | candleExitOk=${candleExitOk}`
  );

  if (exitSignal) {
    log(
      `[${symbol}] → EXIT SIGNAL (TP/SL & candleConfirm, hitTP=${hitTP}, hitSL=${hitSL})`
    );
    const result = await sellMarketAll(symbol);
    if (result) {
      pos.hasPosition = false;
      log(
        `[${symbol}] LONG CLOSED @ avg=${result.avgPrice.toFixed(2)}`
      );
    }
  } else if (rawExitSignal && !candleExitOk) {
    // למעקב: TP/SL הופעלו אבל הנר מנע יציאה
    log(
      `[${symbol}] TP/SL HIT BUT candleExitOk=false → HOLD`
    );
  }
}


    // ===================
    // POSITION MANAGEMENT
    // ===================

    if (pos.hasPosition) {
      const entry = pos.entryPrice;
      const price = last.close;

      // עדכון maxPrice
      if (!pos.maxPrice || price > pos.maxPrice) {
        pos.maxPrice = price;
      }

      const baseSL = entry * (1 - SL_PCT);
      const baseTP = entry * (1 + TP_PCT);

      let dynSL = baseSL;

      // Trailing מתחיל אחרי +3%
      if (price >= entry * (1 + TRAIL_START_PCT)) {
        const trailSL = pos.maxPrice * (1 - TRAIL_DISTANCE_PCT);
        if (trailSL > dynSL) dynSL = trailSL;
      }

      log(
        `[${symbol}] in LONG @ ${entry.toFixed(
          2
        )} | price=${price.toFixed(
          2
        )} | baseSL<=${baseSL.toFixed(2)} | dynSL<=${dynSL.toFixed(
          2
        )} | TP>=${baseTP.toFixed(2)} | maxPrice=${pos.maxPrice.toFixed(2)}`
      );

      const hitTP = price >= baseTP;
      const hitSL = price <= dynSL;

      if (hitTP || hitSL) {
        log(
          `[${symbol}] → EXIT SIGNAL (${hitTP ? "TP" : "SL/TRAIL"})`
        );
        const base = symbol.replace(QUOTE, "");
        const result = await sellMarketAll(symbol, base);
        if (result) {
          log(
            `[${symbol}] LONG CLOSED @ avg=${result.avgPrice.toFixed(2)}`
          );
        }
        pos.hasPosition = false;
        pos.entryPrice = 0;
        pos.qty = 0;
        pos.maxPrice = 0;
      } else {
        log(`[${symbol}] → HOLD POSITION`);
      }
    }

    positions[symbol] = pos;
  } catch (err) {
    log(
      `[${symbol}] Error:`,
      err.response?.data || err.message
    );
  }
}

// =======================
// MAIN LOOP
// =======================

async function mainLoop() {
  try {
    activeSymbols = await fetchTopSymbols();
    positions = {};
    activeSymbols.forEach((s) => {
      positions[s] = {
        hasPosition: false,
        entryPrice: 0,
        qty: 0,
        maxPrice: 0,
      };
    });
  } catch (err) {
    log("Error fetching top symbols:", err.response?.data || err.message);
    return;
  }

  while (true) {
    for (const sym of activeSymbols) {
      await runSymbol(sym);
    }

    await logPortfolio();
    log(`---- wait ${(LOOP_SLEEP_MS / 1000)} sec ----`);
    await sleep(LOOP_SLEEP_MS);
  }
}

mainLoop();
