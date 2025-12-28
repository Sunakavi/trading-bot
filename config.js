// config.js
const { loadSettings } = require("./settingsManager");

const COLORS = {
  RESET: "\x1b[0m",
  PURPLE: "\x1b[35m",
  GREEN: "\x1b[32m",
  RED: "\x1b[31m", 
  YELLOW: "\x1b[33m", // Added YELLOW
};

// מינימום עוצמת נר אדום (באחוז מגודל הגוף של הנר הקודם) כדי לאפשר יציאה
const CANDLE_RED_TRIGGER_PCT = 0.4; // 40% – תוכל לשחק עם זה
const USE_CANDLE_EXIT = false; // ברירת מחדל: יציאה ללא דרישת נר

const INITIAL_CAPITAL = 100000; // הון התחלתי לצורך חישוב PNL

const defaultSettings = {
  binanceApiKey: process.env.BINANCE_API_KEY,
  binanceApiSecret: process.env.BINANCE_API_SECRET,
  binanceBaseUrl: process.env.BINANCE_BASE_URL || "https://testnet.binance.vision",
  tradingViewWebhookUrl: process.env.TRADINGVIEW_WEBHOOK_URL || "",
};

const { settings: storedSettings, fromFile } = loadSettings();
const resolvedSettings = fromFile
  ? { ...defaultSettings, ...storedSettings }
  : defaultSettings;

const config = {
  // BINANCE API
  BINANCE_API_KEY: resolvedSettings.binanceApiKey,
  BINANCE_API_SECRET: resolvedSettings.binanceApiSecret,
  BINANCE_BASE_URL: resolvedSettings.binanceBaseUrl,
  TRADINGVIEW_WEBHOOK_URL: resolvedSettings.tradingViewWebhookUrl,
  


  // UNIVERSE SELECTION
  MAX_SYMBOLS: 10,
  QUOTE: "USDT",
  EXCLUDE_KEYWORDS: [
    "UP",
    "DOWN",
    "BULL",
    "BEAR",
    "2L",
    "2S",
    "3L",
    "3S",
    "BANANA",
  ],
  STABLE_BASES: ["USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD"],
  FIAT_BASES: ["EUR", "TRY", "BRL", "PLN", "ARS", "ZAR", "JPY", "MXN"],

  // TECHNICAL ANALYSIS (Settings for Strategy 2 - Trend/Pullback/RSI)
  INTERVAL: "15m", // Trading interval
  KLINES_LIMIT: 250,
  FAST_MA: 25,
  SLOW_MA: 100,
  RSI_PERIOD: 14,
  RSI_MIN: 28,
  RSI_MAX: 68,
  REQUIRE_CANDLE_PATTERN: false,

  // TRADE MANAGEMENT
  QUOTE_ORDER_FRACTION: 0.5, // 50%
  SL_PCT: 0.012, 
  TP_PCT: 0.024, 

  // TRAILING STOP
  TRAIL_START_PCT: 0.012, 
  TRAIL_DISTANCE_PCT: 0.006, 

  // SYSTEM
  KILL_SWITCH: false, // אם true לא נעשה שום טרייד
  LOOP_SLEEP_MS: 15 * 60 * 1000, // 15 minutes
  USE_CANDLE_EXIT,

};

module.exports = {
  COLORS,
  config,
  INITIAL_CAPITAL,
  CANDLE_RED_TRIGGER_PCT,
  USE_CANDLE_EXIT,
  LOOP_SLEEP_MS: config.LOOP_SLEEP_MS,
};
