// settingsManager.js
const fs = require("fs");
const { ensureDataDir, resolveDataPath } = require("./dataDir");
const { loadState, updateState } = require("./stateManager");

const SETTINGS_FILE = resolveDataPath("settings.json");

const { StrategyPortfolioConfig } = require("./strategyPortfolio.config");

const DEFAULT_REGIME_ENGINE = {
  MODE: "AUTO",
  REGIME_PROXY_SYMBOL: "BTCUSDT",
  TIMEFRAME: "15m",
  MIN_CONFIDENCE: 0.55,
  REGIME_MIN_HOLD_CANDLES: 3,
  RSI_PERIOD: 14,
  ATR_PERIOD: 14,
  ATR_MA_PERIOD: 14,
  VOLUME_MA_PERIOD: 10,
  SLOW_MA_PERIOD: 200,
  SLOPE_WINDOW: 20,
  ATR_RATIO_BREAKOUT: 1.35,
  VOL_RATIO_BREAKOUT: 1.2,
  RSI_BREAKOUT_MIN: 60,
  SLOPE_TREND_MIN: 0.1,
  RSI_TREND_MIN: 50,
  RSI_TREND_MAX: 65,
  ATR_RATIO_TREND_MIN: 0.9,
  ATR_RATIO_TREND_MAX: 1.3,
  SLOPE_RANGE_MAX: 0.03,
  RSI_RANGE_MIN: 45,
  RSI_RANGE_MAX: 55,
  ATR_RATIO_RANGE_MAX: 1.05,
  STRATEGY_PACKS: {
    TREND: { entryStrategyId: 101, exitPresetId: 4 },
    RANGE: { entryStrategyId: 103, exitPresetId: 3 },
    BREAKOUT: { entryStrategyId: 105, exitPresetId: 7 },
  },
};

const DEFAULT_SETTINGS = {
  binanceApiKey: "",
  binanceApiSecret: "",
  binanceBaseUrl: "https://testnet.binance.vision",
  tradingViewWebhookUrl: "",
  marketType: "stocks",
  alpacaApiKey: "",
  alpacaApiSecret: "",
  alpacaTradingBaseUrl: "https://paper-api.alpaca.markets",
  alpacaDataBaseUrl: "https://data.alpaca.markets",
  alpacaDataFeed: "iex",
  PORTFOLIO_LAYERS: StrategyPortfolioConfig.layers.map((layer) => ({ ...layer })),
  REGIME_RULES: { ...StrategyPortfolioConfig.regimeRules },
  REGIME_ENGINE: { ...DEFAULT_REGIME_ENGINE },
};

function normalizeLayerId(id) {
  if (typeof id !== "string") return "";
  return id.trim().toUpperCase();
}

function normalizePortfolioLayers(layers) {
  if (!Array.isArray(layers) || layers.length === 0) {
    return DEFAULT_SETTINGS.PORTFOLIO_LAYERS.map((layer) => ({ ...layer }));
  }

  return layers
    .filter((layer) => layer && typeof layer === "object")
    .map((layer) => {
      const allocation = Number(layer.allocationPct);
      const maxRisk = Number(layer.maxRiskPerTradePct);
      const maxOpenPositions = Number(layer.maxOpenPositions);
      const lossStopDailyPct = Number(layer.lossStopDailyPct);
      const lossStopWeeklyPct = Number(layer.lossStopWeeklyPct);
      const cooldownHoursAfterStop = Number(layer.cooldownHoursAfterStop);

      return {
        id: normalizeLayerId(layer.id) || "CORE",
        name: typeof layer.name === "string" ? layer.name : "Layer",
        allocationPct:
          Number.isFinite(allocation) && allocation > 0 ? allocation : 0.0,
        maxRiskPerTradePct:
          Number.isFinite(maxRisk) && maxRisk > 0 ? maxRisk : 0.0,
        maxOpenPositions:
          Number.isFinite(maxOpenPositions) && maxOpenPositions >= 0
            ? maxOpenPositions
            : 0,
        entryPresetId:
          typeof layer.entryPresetId === "string"
            ? layer.entryPresetId
            : "CORE_TREND",
        strategyPresetId:
          Number.isFinite(Number(layer.strategyPresetId))
            ? Number(layer.strategyPresetId)
            : undefined,
        exitPresetId:
          typeof layer.exitPresetId === "string"
            ? layer.exitPresetId
            : "DEFAULT_EXIT",
        exitPreset:
          layer.exitPreset && typeof layer.exitPreset === "object"
            ? { ...layer.exitPreset }
            : {},
        timeframe:
          typeof layer.timeframe === "string"
            ? layer.timeframe
            : "1h",
        lossStopDailyPct:
          Number.isFinite(lossStopDailyPct) && lossStopDailyPct >= 0
            ? lossStopDailyPct
            : 0,
        lossStopWeeklyPct:
          Number.isFinite(lossStopWeeklyPct) && lossStopWeeklyPct >= 0
            ? lossStopWeeklyPct
            : 0,
        cooldownHoursAfterStop:
          Number.isFinite(cooldownHoursAfterStop) && cooldownHoursAfterStop >= 0
            ? cooldownHoursAfterStop
            : 0,
      };
    });
}

function normalizeRegimeRules(rules) {
  if (!rules || typeof rules !== "object") {
    return { ...DEFAULT_SETTINGS.REGIME_RULES };
  }

  const normalizeList = (value) =>
    Array.isArray(value)
      ? value.map((id) => normalizeLayerId(id)).filter(Boolean)
      : [];

  return {
    TREND: normalizeList(rules.TREND ?? DEFAULT_SETTINGS.REGIME_RULES.TREND),
    RANGE: normalizeList(rules.RANGE ?? DEFAULT_SETTINGS.REGIME_RULES.RANGE),
    VOLATILE: normalizeList(
      rules.VOLATILE ?? DEFAULT_SETTINGS.REGIME_RULES.VOLATILE
    ),
    OFF: normalizeList(rules.OFF ?? DEFAULT_SETTINGS.REGIME_RULES.OFF),
  };
}

function normalizeRegimeEngine(input = {}) {
  const normalizeNumber = (value, fallback, min = null) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    if (min != null && num < min) return fallback;
    return num;
  };

  const mode = input.MODE === "AUTO" ? "AUTO" : "MANUAL";
  const proxySymbol =
    typeof input.REGIME_PROXY_SYMBOL === "string" && input.REGIME_PROXY_SYMBOL
      ? input.REGIME_PROXY_SYMBOL
      : DEFAULT_REGIME_ENGINE.REGIME_PROXY_SYMBOL;
  const timeframe =
    typeof input.TIMEFRAME === "string" && input.TIMEFRAME
      ? input.TIMEFRAME
      : DEFAULT_REGIME_ENGINE.TIMEFRAME;

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
    MIN_CONFIDENCE: normalizeNumber(
      input.MIN_CONFIDENCE,
      DEFAULT_REGIME_ENGINE.MIN_CONFIDENCE,
      0
    ),
    REGIME_MIN_HOLD_CANDLES: Math.max(
      1,
      Math.round(
        normalizeNumber(
          input.REGIME_MIN_HOLD_CANDLES,
          DEFAULT_REGIME_ENGINE.REGIME_MIN_HOLD_CANDLES,
          1
        )
      )
    ),
    RSI_PERIOD: Math.max(
      2,
      Math.round(
        normalizeNumber(
          input.RSI_PERIOD,
          DEFAULT_REGIME_ENGINE.RSI_PERIOD,
          2
        )
      )
    ),
    ATR_PERIOD: Math.max(
      2,
      Math.round(
        normalizeNumber(
          input.ATR_PERIOD,
          DEFAULT_REGIME_ENGINE.ATR_PERIOD,
          2
        )
      )
    ),
    ATR_MA_PERIOD: Math.max(
      2,
      Math.round(
        normalizeNumber(
          input.ATR_MA_PERIOD,
          DEFAULT_REGIME_ENGINE.ATR_MA_PERIOD,
          2
        )
      )
    ),
    VOLUME_MA_PERIOD: Math.max(
      2,
      Math.round(
        normalizeNumber(
          input.VOLUME_MA_PERIOD,
          DEFAULT_REGIME_ENGINE.VOLUME_MA_PERIOD,
          2
        )
      )
    ),
    SLOW_MA_PERIOD: Math.max(
      2,
      Math.round(
        normalizeNumber(
          input.SLOW_MA_PERIOD,
          DEFAULT_REGIME_ENGINE.SLOW_MA_PERIOD,
          2
        )
      )
    ),
    SLOPE_WINDOW: Math.max(
      1,
      Math.round(
        normalizeNumber(
          input.SLOPE_WINDOW,
          DEFAULT_REGIME_ENGINE.SLOPE_WINDOW,
          1
        )
      )
    ),
    ATR_RATIO_BREAKOUT: normalizeNumber(
      input.ATR_RATIO_BREAKOUT,
      DEFAULT_REGIME_ENGINE.ATR_RATIO_BREAKOUT,
      0
    ),
    VOL_RATIO_BREAKOUT: normalizeNumber(
      input.VOL_RATIO_BREAKOUT,
      DEFAULT_REGIME_ENGINE.VOL_RATIO_BREAKOUT,
      0
    ),
    RSI_BREAKOUT_MIN: normalizeNumber(
      input.RSI_BREAKOUT_MIN,
      DEFAULT_REGIME_ENGINE.RSI_BREAKOUT_MIN,
      0
    ),
    SLOPE_TREND_MIN: normalizeNumber(
      input.SLOPE_TREND_MIN,
      DEFAULT_REGIME_ENGINE.SLOPE_TREND_MIN,
      0
    ),
    RSI_TREND_MIN: normalizeNumber(
      input.RSI_TREND_MIN,
      DEFAULT_REGIME_ENGINE.RSI_TREND_MIN,
      0
    ),
    RSI_TREND_MAX: normalizeNumber(
      input.RSI_TREND_MAX,
      DEFAULT_REGIME_ENGINE.RSI_TREND_MAX,
      0
    ),
    ATR_RATIO_TREND_MIN: normalizeNumber(
      input.ATR_RATIO_TREND_MIN,
      DEFAULT_REGIME_ENGINE.ATR_RATIO_TREND_MIN,
      0
    ),
    ATR_RATIO_TREND_MAX: normalizeNumber(
      input.ATR_RATIO_TREND_MAX,
      DEFAULT_REGIME_ENGINE.ATR_RATIO_TREND_MAX,
      0
    ),
    SLOPE_RANGE_MAX: normalizeNumber(
      input.SLOPE_RANGE_MAX,
      DEFAULT_REGIME_ENGINE.SLOPE_RANGE_MAX,
      0
    ),
    RSI_RANGE_MIN: normalizeNumber(
      input.RSI_RANGE_MIN,
      DEFAULT_REGIME_ENGINE.RSI_RANGE_MIN,
      0
    ),
    RSI_RANGE_MAX: normalizeNumber(
      input.RSI_RANGE_MAX,
      DEFAULT_REGIME_ENGINE.RSI_RANGE_MAX,
      0
    ),
    ATR_RATIO_RANGE_MAX: normalizeNumber(
      input.ATR_RATIO_RANGE_MAX,
      DEFAULT_REGIME_ENGINE.ATR_RATIO_RANGE_MAX,
      0
    ),
    STRATEGY_PACKS: {
      TREND: parsePack(
        packs.TREND,
        DEFAULT_REGIME_ENGINE.STRATEGY_PACKS.TREND.entryStrategyId,
        DEFAULT_REGIME_ENGINE.STRATEGY_PACKS.TREND.exitPresetId
      ),
      RANGE: parsePack(
        packs.RANGE,
        DEFAULT_REGIME_ENGINE.STRATEGY_PACKS.RANGE.entryStrategyId,
        DEFAULT_REGIME_ENGINE.STRATEGY_PACKS.RANGE.exitPresetId
      ),
      BREAKOUT: parsePack(
        packs.BREAKOUT,
        DEFAULT_REGIME_ENGINE.STRATEGY_PACKS.BREAKOUT.entryStrategyId,
        DEFAULT_REGIME_ENGINE.STRATEGY_PACKS.BREAKOUT.exitPresetId
      ),
    },
  };
}

function normalizeSettings(input = {}) {
  return {
    ...DEFAULT_SETTINGS,
    binanceApiKey: typeof input.binanceApiKey === "string" ? input.binanceApiKey : "",
    binanceApiSecret:
      typeof input.binanceApiSecret === "string" ? input.binanceApiSecret : "",
    binanceBaseUrl:
      typeof input.binanceBaseUrl === "string" && input.binanceBaseUrl
        ? input.binanceBaseUrl
        : DEFAULT_SETTINGS.binanceBaseUrl,
    tradingViewWebhookUrl:
      typeof input.tradingViewWebhookUrl === "string" ? input.tradingViewWebhookUrl : "",
    marketType:
      input.marketType === "stocks" || input.marketType === "crypto"
        ? input.marketType
        : DEFAULT_SETTINGS.marketType,
    alpacaApiKey: typeof input.alpacaApiKey === "string" ? input.alpacaApiKey : "",
    alpacaApiSecret:
      typeof input.alpacaApiSecret === "string" ? input.alpacaApiSecret : "",
    alpacaTradingBaseUrl:
      typeof input.alpacaTradingBaseUrl === "string" && input.alpacaTradingBaseUrl
        ? input.alpacaTradingBaseUrl
        : DEFAULT_SETTINGS.alpacaTradingBaseUrl,
    alpacaDataBaseUrl:
      typeof input.alpacaDataBaseUrl === "string" && input.alpacaDataBaseUrl
        ? input.alpacaDataBaseUrl
        : DEFAULT_SETTINGS.alpacaDataBaseUrl,
    alpacaDataFeed:
      typeof input.alpacaDataFeed === "string" && input.alpacaDataFeed
        ? input.alpacaDataFeed
        : DEFAULT_SETTINGS.alpacaDataFeed,
    PORTFOLIO_LAYERS: normalizePortfolioLayers(input.PORTFOLIO_LAYERS),
    REGIME_RULES: normalizeRegimeRules(input.REGIME_RULES),
    REGIME_ENGINE: normalizeRegimeEngine(input.REGIME_ENGINE),
  };
}

function loadSettings() {
  const fallbackFromState = () => {
    const persisted = loadState();
    if (persisted?.settings) {
      return normalizeSettings(persisted.settings);
    }
    return null;
  };

  const writeSettingsFile = (settings) => {
    try {
      ensureDataDir();
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
      return true;
    } catch (err) {
      console.error("[SETTINGS] Failed to persist fallback settings:", err.message);
      return false;
    }
  };

  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      const fallback = fallbackFromState();
      if (fallback) {
        writeSettingsFile(fallback);
        return { settings: fallback, fromFile: false, fromState: true };
      }
      return { settings: { ...DEFAULT_SETTINGS }, fromFile: false };
    }
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    if (!raw.trim()) {
      const fallback = fallbackFromState();
      if (fallback) {
        writeSettingsFile(fallback);
        return { settings: fallback, fromFile: false, fromState: true };
      }
      return { settings: { ...DEFAULT_SETTINGS }, fromFile: false };
    }
    const parsed = JSON.parse(raw);
    return { settings: normalizeSettings(parsed), fromFile: true };
  } catch (err) {
    console.error("[SETTINGS] Failed to load settings:", err.message);
    const fallback = fallbackFromState();
    if (fallback) {
      writeSettingsFile(fallback);
      return { settings: fallback, fromFile: false, fromState: true };
    }
    return { settings: { ...DEFAULT_SETTINGS }, fromFile: false };
  }
}

function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(normalized, null, 2), "utf8");
  updateState({ settings: normalized });
  return normalized;
}

module.exports = {
  loadSettings,
  saveSettings,
  normalizeSettings,
  DEFAULT_SETTINGS,
  normalizePortfolioLayers,
  normalizeRegimeRules,
  normalizeRegimeEngine,
};
