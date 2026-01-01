// settingsManager.js
const fs = require("fs");
const { ensureDataDir, resolveDataPath } = require("./dataDir");
const { loadState, updateState } = require("./stateManager");

const SETTINGS_FILE = resolveDataPath("settings.json");

const DEFAULT_SETTINGS = {
  binanceApiKey: "",
  binanceApiSecret: "",
  binanceBaseUrl: "https://testnet.binance.vision",
  tradingViewWebhookUrl: "",
  marketType: "crypto",
  alpacaApiKey: "",
  alpacaApiSecret: "",
  alpacaTradingBaseUrl: "https://paper-api.alpaca.markets",
  alpacaDataBaseUrl: "https://data.alpaca.markets",
  alpacaDataFeed: "iex",
  PORTFOLIO_LAYERS: [
    {
      id: "CORE",
      name: "Core",
      allocationPct: 0.5,
      maxRiskPerTradePct: 1.0,
      maxOpenPositions: 3,
      strategyPresetId: 102,
      exitPresetId: "CORE_EXIT",
      exitPreset: {},
      lossStopDailyPct: 2.0,
      lossStopWeeklyPct: 5.0,
      cooldownHoursAfterStop: 6,
    },
    {
      id: "SWING",
      name: "Swing",
      allocationPct: 0.35,
      maxRiskPerTradePct: 0.7,
      maxOpenPositions: 5,
      strategyPresetId: 104,
      exitPresetId: "SWING_EXIT",
      exitPreset: {},
      lossStopDailyPct: 2.5,
      lossStopWeeklyPct: 6.0,
      cooldownHoursAfterStop: 6,
    },
    {
      id: "AGGR",
      name: "Aggressive",
      allocationPct: 0.15,
      maxRiskPerTradePct: 0.3,
      maxOpenPositions: 2,
      strategyPresetId: 103,
      exitPresetId: "AGGR_EXIT",
      exitPreset: {},
      lossStopDailyPct: 3.0,
      lossStopWeeklyPct: 7.0,
      cooldownHoursAfterStop: 8,
    },
  ],
  REGIME_RULES: {
    TREND: ["CORE", "SWING"],
    RANGE: ["SWING"],
    VOLATILE: ["AGGR"],
    OFF: [],
  },
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
        strategyPresetId:
          Number.isFinite(Number(layer.strategyPresetId))
            ? Number(layer.strategyPresetId)
            : 2,
        exitPresetId:
          typeof layer.exitPresetId === "string"
            ? layer.exitPresetId
            : "DEFAULT_EXIT",
        exitPreset:
          layer.exitPreset && typeof layer.exitPreset === "object"
            ? { ...layer.exitPreset }
            : {},
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
};
