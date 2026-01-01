// server.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const { loadState, loadPerformance, updateState } = require("./stateManager");
const { log } = require("./log");
const { initTradeHistory, getStats, getMultiRangeStats } = require("./tradeHistory");
const { config, CANDLE_RED_TRIGGER_PCT, USE_CANDLE_EXIT } = require("./config");
const {
  loadSettings,
  saveSettings,
  normalizeSettings,
  DEFAULT_SETTINGS,
} = require("./settingsManager");

// קונפיג חי – נשלט דרך /api/config
const runtimeConfig = {
  activeStrategyId: 102,
  loopIntervalMs: 900000, 

   // EXIT SETTINGS (דיפולט מה-config)
  SL_PCT: config.SL_PCT,
  TP_PCT: config.TP_PCT,
  TRAIL_START_PCT: config.TRAIL_START_PCT,
  TRAIL_DISTANCE_PCT: config.TRAIL_DISTANCE_PCT,
  CANDLE_RED_TRIGGER_PCT, // טריגר לנר אדום
  CANDLE_EXIT_ENABLED: USE_CANDLE_EXIT,
};

const ALLOWED_STRATEGY_IDS = [1, 2, 3, 101, 102, 103, 104, 105, 106, 107, 108];
const ALLOWED_LOOP_INTERVALS = [60000, 300000, 900000]; // 60s, 5m, 15m

function normalizeRuntimeConfig(input = {}) {
  const normalized = { ...runtimeConfig };

  if (input.activeStrategyId !== undefined) {
    const id = Number(input.activeStrategyId);
    if (ALLOWED_STRATEGY_IDS.includes(id)) {
      normalized.activeStrategyId = id;
    }
  }

  if (input.loopIntervalMs !== undefined) {
    const interval = Number(input.loopIntervalMs);
    if (ALLOWED_LOOP_INTERVALS.includes(interval)) {
      normalized.loopIntervalMs = interval;
    }
  }

  if (input.SL_PCT !== undefined) {
    const sl = Number(input.SL_PCT);
    if (sl > 0 && sl < 0.5) normalized.SL_PCT = sl;
  }

  if (input.TP_PCT !== undefined) {
    const tp = Number(input.TP_PCT);
    if (tp > 0 && tp < 1.0) normalized.TP_PCT = tp;
  }

  if (input.TRAIL_START_PCT !== undefined) {
    const ts = Number(input.TRAIL_START_PCT);
    if (ts > 0 && ts < 1.0) normalized.TRAIL_START_PCT = ts;
  }

  if (input.TRAIL_DISTANCE_PCT !== undefined) {
    const td = Number(input.TRAIL_DISTANCE_PCT);
    if (td > 0 && td < 1.0) normalized.TRAIL_DISTANCE_PCT = td;
  }

  if (input.CANDLE_RED_TRIGGER_PCT !== undefined) {
    const cr = Number(input.CANDLE_RED_TRIGGER_PCT);
    if (cr >= 0 && cr <= 1.0) normalized.CANDLE_RED_TRIGGER_PCT = cr;
  }

  if (input.CANDLE_EXIT_ENABLED !== undefined) {
    if (typeof input.CANDLE_EXIT_ENABLED === "boolean") {
      normalized.CANDLE_EXIT_ENABLED = input.CANDLE_EXIT_ENABLED;
    }
  }

  return normalized;
}

function buildRuntimeConfigSnapshot() {
  return {
    activeStrategyId: runtimeConfig.activeStrategyId,
    loopIntervalMs: runtimeConfig.loopIntervalMs,
    SL_PCT: runtimeConfig.SL_PCT,
    TP_PCT: runtimeConfig.TP_PCT,
    TRAIL_START_PCT: runtimeConfig.TRAIL_START_PCT,
    TRAIL_DISTANCE_PCT: runtimeConfig.TRAIL_DISTANCE_PCT,
    CANDLE_RED_TRIGGER_PCT: runtimeConfig.CANDLE_RED_TRIGGER_PCT,
    CANDLE_EXIT_ENABLED: runtimeConfig.CANDLE_EXIT_ENABLED,
  };
}

function restoreRuntimeConfigFromState() {
  const persisted = loadState();
  if (persisted?.runtimeConfig) {
    const normalized = normalizeRuntimeConfig(persisted.runtimeConfig);
    Object.assign(runtimeConfig, normalized);
  }
}



const LOG_DIR = path.join(__dirname, "logs");

function listLogFiles() {
  if (!fs.existsSync(LOG_DIR)) return [];

  return fs
    .readdirSync(LOG_DIR)
    .filter((f) => f.endsWith(".log"))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      const stats = fs.statSync(filePath);
      const dateMatch = name.match(/(\d{4}-\d{2}-\d{2})/);

      return {
        name,
        date: dateMatch ? dateMatch[1] : null,
        size: stats.size,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveLogFile(fileName) {
  const safeName = path.basename(fileName);
  const target = path.join(LOG_DIR, safeName);

  if (!target.startsWith(LOG_DIR)) {
    throw new Error("Invalid log path");
  }

  if (!fs.existsSync(target)) {
    throw new Error("Log file not found");
  }

  return target;
}

// קריאת שורות הלוג האחרונות מהקובץ האחרון או מקובץ ספציפי בתיקיית logs
function getLatestLogLines(maxLines = 200, fileName = "") {
  try {
    if (!fs.existsSync(LOG_DIR)) return [];

    let filePath = "";

    if (fileName) {
      filePath = resolveLogFile(fileName);
    } else {
      const files = listLogFiles();
      if (!files.length) return [];
      filePath = path.join(LOG_DIR, files[files.length - 1].name);
    }

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines);
  } catch (e) {
    console.error("getLatestLogLines error:", e.message);
    return [];
  }
}

function startHttpServer(shared = {}) {
  initTradeHistory();
  const app = express();
  app.use(express.json());

  // סטטי – ה-frontend
  app.use(express.static(path.join(__dirname, "public")));

  let runtimeSettings = loadSettings().settings;
  restoreRuntimeConfigFromState();

  function applySettings(settings) {
    const baseUrl =
      settings.binanceBaseUrl || DEFAULT_SETTINGS.binanceBaseUrl;
    config.BINANCE_API_KEY = settings.binanceApiKey;
    config.BINANCE_API_SECRET = settings.binanceApiSecret;
    config.BINANCE_BASE_URL = baseUrl;
    config.TRADINGVIEW_WEBHOOK_URL = settings.tradingViewWebhookUrl;
    config.MARKET_TYPE = settings.marketType === "stocks" ? "stocks" : "crypto";
    config.MARKET_MODE = config.MARKET_TYPE;
    config.ALPACA_API_KEY = settings.alpacaApiKey;
    config.ALPACA_API_SECRET = settings.alpacaApiSecret;
    config.ALPACA_TRADING_BASE_URL = settings.alpacaTradingBaseUrl;
    config.ALPACA_DATA_BASE_URL = settings.alpacaDataBaseUrl;
    config.ALPACA_DATA_FEED = settings.alpacaDataFeed || config.ALPACA_DATA_FEED;
    config.QUOTE =
      config.MARKET_TYPE === "stocks" ? config.STOCK_QUOTE : config.CRYPTO_QUOTE;

    if (shared.marketClient && config.MARKET_TYPE === "crypto") {
      shared.marketClient.setCredentials({
        baseURL: baseUrl,
        apiKey: settings.binanceApiKey,
        apiSecret: settings.binanceApiSecret,
      });
    }

    if (shared.marketClient && config.MARKET_TYPE === "stocks") {
      shared.marketClient.setCredentials({
        apiKey: settings.alpacaApiKey,
        apiSecret: settings.alpacaApiSecret,
        tradingBaseUrl: settings.alpacaTradingBaseUrl,
        dataBaseUrl: settings.alpacaDataBaseUrl,
        dataFeed: settings.alpacaDataFeed,
      });
    }
  }

  function validateSettings(settings) {
    const marketType = settings.marketType === "stocks" ? "stocks" : "crypto";
    if (!["crypto", "stocks"].includes(marketType)) {
      return "Market type must be crypto or stocks.";
    }
    if (marketType === "crypto") {
      if (
        (settings.binanceApiKey && !settings.binanceApiSecret) ||
        (!settings.binanceApiKey && settings.binanceApiSecret)
      ) {
        return "Both Binance API key and secret are required for crypto mode.";
      }
    }
    if (marketType === "stocks") {
      if (
        (settings.alpacaApiKey && !settings.alpacaApiSecret) ||
        (!settings.alpacaApiKey && settings.alpacaApiSecret)
      ) {
        return "Both Alpaca API key and secret are required for stocks mode.";
      }
    }

    if (settings.binanceBaseUrl) {
      try {
        new URL(settings.binanceBaseUrl);
      } catch (err) {
        return "Binance base URL must be a valid URL.";
      }
    }

    if (settings.tradingViewWebhookUrl) {
      try {
        new URL(settings.tradingViewWebhookUrl);
      } catch (err) {
        return "TradingView webhook URL must be a valid URL.";
      }
    }

    if (settings.alpacaTradingBaseUrl) {
      try {
        new URL(settings.alpacaTradingBaseUrl);
      } catch (err) {
        return "Alpaca trading base URL must be a valid URL.";
      }
    }

    if (settings.alpacaDataBaseUrl) {
      try {
        new URL(settings.alpacaDataBaseUrl);
      } catch (err) {
        return "Alpaca data base URL must be a valid URL.";
      }
    }

    return null;
  }

  applySettings(runtimeSettings);

  function buildTradeStats() {
    try {
      return {
        overall: getStats(),
        ...getMultiRangeStats(),
      };
    } catch (err) {
      console.error("trade stats failed", err.message);
      return {
        overall: { total: 0, wins: 0, losses: 0, sumPnLPct: 0, sumPnlValue: 0 },
        last24h: { total: 0, wins: 0, losses: 0, sumPnLPct: 0, sumPnlValue: 0 },
        last3d: { total: 0, wins: 0, losses: 0, sumPnLPct: 0, sumPnlValue: 0 },
        last7d: { total: 0, wins: 0, losses: 0, sumPnLPct: 0, sumPnlValue: 0 },
      };
    }
  }

  // ===== API: STATUS =====
  app.get("/api/status", (req, res) => {
    try {
      const state = loadState() || {};
      const perf = loadPerformance() || {};

      const symbolsCount = state.positions
        ? Object.keys(state.positions).length
        : 0;

      res.json({
        ok: true,
        activeStrategyId:
          shared?.activeStrategyId ?? runtimeConfig.activeStrategyId,
        killSwitch: shared?.killSwitch ?? false,
        botRunning: shared?.botRunning !== false,
        stateSummary: {
          symbols: symbolsCount,
          lastUpdateTs: state.lastUpdateTs || null,
        },
        performance: {
          lastEquity: perf.lastEquity ?? null,
          lastPnlPct: perf.lastPnlPct ?? null,
          lastUpdateTs: perf.lastUpdateTs ?? null,
        },
        tradeStats: buildTradeStats(),
        config: {
          loopIntervalMs: runtimeConfig.loopIntervalMs,
        },
        exitConfig: {
          slPct: runtimeConfig.SL_PCT,
          tpPct: runtimeConfig.TP_PCT,
          trailStartPct: runtimeConfig.TRAIL_START_PCT,
          trailDistancePct: runtimeConfig.TRAIL_DISTANCE_PCT,
          candleRedTriggerPct: runtimeConfig.CANDLE_RED_TRIGGER_PCT,
          candleExitEnabled: runtimeConfig.CANDLE_EXIT_ENABLED,
        },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: "status failed" });
    }
  });

  // ===== API: LOGS =====
  app.get("/api/logs", (req, res) => {
    const fileName = typeof req.query.file === "string" ? req.query.file : "";
    const lines = getLatestLogLines(300, fileName);
    res.json({ ok: true, lines });
  });

  app.get("/api/logs/list", (req, res) => {
    try {
      const files = listLogFiles();
      res.json({ ok: true, files });
    } catch (err) {
      res.status(500).json({ ok: false, error: "Failed to list log files" });
    }
  });

  app.get("/api/logs/download", (req, res) => {
    try {
      const fileName = req.query.file;
      if (typeof fileName !== "string" || !fileName.endsWith(".log")) {
        return res.status(400).json({ ok: false, error: "Invalid log file" });
      }

      const filePath = resolveLogFile(fileName);
      res.download(filePath, fileName);
    } catch (err) {
      res.status(404).json({ ok: false, error: "Log file not found" });
    }
  });

  // ===== API: KILL SWITCH (SELL ALL) =====
  app.post("/api/kill", (req, res) => {
    shared.killSwitch = true;
    shared.interruptNow = true; // חדש – שובר את השינה
    log("[API] KILL SWITCH activated – will SELL ALL on next loop");
    res.json({ ok: true });
  });

  // ===== API: BOT START/STOP =====
  app.post("/api/bot/start", (req, res) => {
    shared.botRunning = true;
    shared.stopRequested = false;
    shared.interruptNow = true;
    log("[API] BOT START requested – resuming loop");
    res.json({ ok: true });
  });

  app.post("/api/bot/stop", (req, res) => {
    shared.stopRequested = true;
    shared.interruptNow = true;
    log("[API] BOT STOP requested – will pause after persisting state");
    res.json({ ok: true });
  });

  // ===== API: RESET FUNDS (GUI + Shift+R) =====
  app.post("/api/resetFunds", (req, res) => {
    // נבצע SELL ALL + resetFunds בלולאת הבוט
    shared.killSwitch = true;
    shared.resetFundsRequested = true;
    shared.interruptNow = true; // חדש – שובר את השינה
    log("[API] RESET FUNDS requested – will SELL ALL + RESET on next loop");
    res.json({ ok: true, message: "RESET FUNDS REQUESTED" });
  });

  app.get("/api/config", (req, res) => {
    res.json({
      ok: true,
      config: runtimeConfig,
      exitConfig: {
        slPct: runtimeConfig.SL_PCT,
        tpPct: runtimeConfig.TP_PCT,
        trailStartPct: runtimeConfig.TRAIL_START_PCT,
        trailDistancePct: runtimeConfig.TRAIL_DISTANCE_PCT,
        candleRedTriggerPct: runtimeConfig.CANDLE_RED_TRIGGER_PCT,
        candleExitEnabled: runtimeConfig.CANDLE_EXIT_ENABLED,
      },
    });
  });

  // ===== API: SETTINGS =====
  app.get("/api/settings", (req, res) => {
    res.json({
      ok: true,
      settings: runtimeSettings,
    });
  });

  app.post("/api/settings", (req, res) => {
    try {
      const normalized = normalizeSettings(req.body);
      const error = validateSettings(normalized);
      if (error) {
        return res.status(400).json({ ok: false, error });
      }

      runtimeSettings = saveSettings(normalized);
      applySettings(runtimeSettings);
      log("[API] Settings updated");
      return res.json({ ok: true, settings: runtimeSettings });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "Failed to save settings" });
    }
  });

  // ===== API: עדכון קונפיג (אסטרטגיה + אינטרוול) =====
  app.post("/api/config", (req, res) => {
    const body = req.body;
    let stateDirty = false;

    // אסטרטגיה
    if (body.activeStrategyId !== undefined) {
      const id = Number(body.activeStrategyId);
      if (!ALLOWED_STRATEGY_IDS.includes(id)) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid strategy ID" });
      }
      runtimeConfig.activeStrategyId = id;
      shared.activeStrategyId = id;
      shared.interruptNow = true; // חדש – שובר את השינה
      log(`[API] Strategy set to ${id}`);
      stateDirty = true;
    }

    // אינטרוול
    if (body.loopIntervalMs !== undefined) {
      const val = Number(body.loopIntervalMs);
      if (!ALLOWED_LOOP_INTERVALS.includes(val)) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid loop interval" });
      }
      runtimeConfig.loopIntervalMs = val;
      shared.interruptNow = true; // חדש – שובר את השינה
      log(`[API] Interval set to ${val} ms`);
      stateDirty = true;
    }

    // --- EXIT SETTINGS (SL/TP/TRAIL/CANDLE) ---
    // הערכים נשלחים בדצימל (0.012 = 1.2%)

    // SL_PCT
    if (body.slPct !== undefined) {
      const v = Number(body.slPct);
      if (!(v > 0 && v < 0.5)) {
        return res.status(400).json({ ok: false, error: "Invalid slPct" });
      }
      runtimeConfig.SL_PCT = v;
      config.SL_PCT = v; // כדי שה-strategy.js יקבל את זה דרך config
      shared.interruptNow = true;
      log(`[API] SL_PCT set to ${v}`);
      stateDirty = true;
    }

    // TP_PCT
    if (body.tpPct !== undefined) {
      const v = Number(body.tpPct);
      if (!(v > 0 && v < 1.0)) {
        return res.status(400).json({ ok: false, error: "Invalid tpPct" });
      }
      runtimeConfig.TP_PCT = v;
      config.TP_PCT = v;
      shared.interruptNow = true;
      log(`[API] TP_PCT set to ${v}`);
      stateDirty = true;
    }

    // TRAIL_START_PCT
    if (body.trailStartPct !== undefined) {
      const v = Number(body.trailStartPct);
      if (!(v > 0 && v < 1.0)) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid trailStartPct" });
      }
      runtimeConfig.TRAIL_START_PCT = v;
      config.TRAIL_START_PCT = v;
      shared.interruptNow = true;
      log(`[API] TRAIL_START_PCT set to ${v}`);
      stateDirty = true;
    }

    // TRAIL_DISTANCE_PCT
    if (body.trailDistancePct !== undefined) {
      const v = Number(body.trailDistancePct);
      if (!(v > 0 && v < 1.0)) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid trailDistancePct" });
      }
      runtimeConfig.TRAIL_DISTANCE_PCT = v;
      config.TRAIL_DISTANCE_PCT = v;
      shared.interruptNow = true;
      log(`[API] TRAIL_DISTANCE_PCT set to ${v}`);
      stateDirty = true;
    }

    // CANDLE_RED_TRIGGER_PCT
    if (body.candleRedTriggerPct !== undefined) {
      const v = Number(body.candleRedTriggerPct);
      if (!(v >= 0 && v <= 1.0)) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid candleRedTriggerPct" });
      }
      runtimeConfig.CANDLE_RED_TRIGGER_PCT = v;
      shared.interruptNow = true;
      log(`[API] CANDLE_RED_TRIGGER_PCT set to ${v}`);
      stateDirty = true;
    }

    if (body.candleExitEnabled !== undefined) {
      if (typeof body.candleExitEnabled !== "boolean") {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid candleExitEnabled" });
      }
      runtimeConfig.CANDLE_EXIT_ENABLED = body.candleExitEnabled;
      config.USE_CANDLE_EXIT = body.candleExitEnabled;
      shared.interruptNow = true;
      log(
        `[API] CANDLE_EXIT_ENABLED set to ${body.candleExitEnabled ? "ON" : "OFF"}`
      );
      stateDirty = true;
    }

    if (stateDirty) {
      updateState({
        activeStrategyId: runtimeConfig.activeStrategyId,
        runtimeConfig: buildRuntimeConfigSnapshot(),
      });
    }

    res.json({
      ok: true,
      config: runtimeConfig,
    });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    log(`[API] HTTP server listening on port ${PORT}`);
  });
}

module.exports = {
  startHttpServer,
  runtimeConfig,
  buildRuntimeConfigSnapshot,
  normalizeRuntimeConfig,
};
