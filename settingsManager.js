// settingsManager.js
const fs = require("fs");
const path = require("path");

const SETTINGS_FILE = path.join(__dirname, "settings.json");

const DEFAULT_SETTINGS = {
  binanceApiKey: "",
  binanceApiSecret: "",
  binanceBaseUrl: "https://testnet.binance.vision",
  tradingViewWebhookUrl: "",
  marketType: "crypto",
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
  };
}

function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      return { settings: { ...DEFAULT_SETTINGS }, fromFile: false };
    }
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    if (!raw.trim()) {
      return { settings: { ...DEFAULT_SETTINGS }, fromFile: false };
    }
    const parsed = JSON.parse(raw);
    return { settings: normalizeSettings(parsed), fromFile: true };
  } catch (err) {
    console.error("[SETTINGS] Failed to load settings:", err.message);
    return { settings: { ...DEFAULT_SETTINGS }, fromFile: false };
  }
}

function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

module.exports = {
  loadSettings,
  saveSettings,
  normalizeSettings,
  DEFAULT_SETTINGS,
};
