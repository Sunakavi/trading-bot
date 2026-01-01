// stateManager.js
const fs = require("fs");
const { ensureDataDir, resolveDataPath } = require("./dataDir");

const STATE_FILES = {
  crypto: resolveDataPath("state.json"),
  stocks: resolveDataPath("state.stocks.json"),
};

const PERFORMANCE_FILES = {
  crypto: resolveDataPath("performance.json"),
  stocks: resolveDataPath("performance.stocks.json"),
};

function normalizeMarket(market) {
  return market === "stocks" ? "stocks" : "crypto";
}

function resolveStateFile(market) {
  const key = normalizeMarket(market);
  return STATE_FILES[key] || STATE_FILES.crypto;
}

function resolvePerformanceFile(market) {
  const key = normalizeMarket(market);
  return PERFORMANCE_FILES[key] || PERFORMANCE_FILES.crypto;
}

function loadState(market = "crypto") {
  try {
    const file = resolveStateFile(market);
    if (!fs.existsSync(file)) {
      return null;
    }

    const raw = fs.readFileSync(file, "utf8");
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    console.error("[STATE] loadState error:", err.message);
    return null;
  }
}

function saveState(state, market = "crypto") {
  try {
    const file = resolveStateFile(market);
    ensureDataDir();
    const json = JSON.stringify(state, null, 2);
    fs.writeFileSync(file, json, "utf8");
  } catch (err) {
    console.error("[STATE] saveState error:", err.message);
  }
}

function updateState(partialState, market = "crypto") {
  try {
    const current = loadState(market) || {};
    const merged = {
      ...current,
      ...partialState,
      lastUpdateTs: Date.now(),
    };

    saveState(merged, market);
  } catch (err) {
    console.error("[STATE] updateState error:", err.message);
  }
}

function loadPerformance(market = "crypto") {
  try {
    const file = resolvePerformanceFile(market);
    if (!fs.existsSync(file)) {
      return null;
    }
    const raw = fs.readFileSync(file, "utf8");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error("[PERFORMANCE] loadPerformance error:", err.message);
    return null;
  }
}

function savePerformance(perf, market = "crypto") {
  try {
    const file = resolvePerformanceFile(market);
    ensureDataDir();
    const json = JSON.stringify(perf, null, 2);
    fs.writeFileSync(file, json, "utf8");
  } catch (err) {
    console.error("[PERFORMANCE] savePerformance error:", err.message);
  }
}

module.exports = {
  loadState,
  saveState,
  updateState,
  loadPerformance,
  savePerformance,
};
