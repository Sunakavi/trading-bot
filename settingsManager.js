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
};

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
};
