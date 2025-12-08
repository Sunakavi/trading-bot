// config.js

const COLORS = {
  RESET: "\x1b[0m",
  PURPLE: "\x1b[35m",
  GREEN: "\x1b[32m",
  RED: "\x1b[31m", 
  YELLOW: "\x1b[33m", // Added YELLOW
};

// מינימום עוצמת נר אדום (באחוז מגודל הגוף של הנר הקודם) כדי לאפשר יציאה
const CANDLE_RED_TRIGGER_PCT = 0.4; // 40% – תוכל לשחק עם זה

const INITIAL_CAPITAL = 100000; // הון התחלתי לצורך חישוב PNL

const config = {
  // BINANCE API
  BINANCE_API_KEY: process.env.BINANCE_API_KEY,
  BINANCE_API_SECRET: process.env.BINANCE_API_SECRET,
  BINANCE_BASE_URL: process.env.BINANCE_BASE_URL || "https://testnet.binance.vision",
  


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

};

module.exports = {
  COLORS,
  config,
  INITIAL_CAPITAL,
  CANDLE_RED_TRIGGER_PCT,
  LOOP_SLEEP_MS: config.LOOP_SLEEP_MS,
};