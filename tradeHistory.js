// tradeHistory.js
const fs = require("fs");
const path = require("path");
const { resolveDataPath } = require("./dataDir");
const { log, createMarketLogger } = require("./log");

const DEFAULT_MARKET = "crypto";
const MARKET_KEYS = ["crypto", "stocks"];

const HISTORY_FILES = {
  crypto: resolveDataPath("state", "history.json"),
  stocks: resolveDataPath("state", "history.stocks.json"),
};

// Retain up to 30 days of trades
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const marketStores = {};
const marketLoggers = {
  crypto: createMarketLogger("crypto"),
  stocks: createMarketLogger("stocks"),
};

function normalizeMarket(market) {
  return market === "stocks" ? "stocks" : "crypto";
}

function ensureMarketStore(market) {
  const key = normalizeMarket(market);
  if (!marketStores[key]) {
    marketStores[key] = { trades: [] };
  }
  return marketStores[key];
}

function getHistoryFile(market) {
  const key = normalizeMarket(market);
  return HISTORY_FILES[key] || HISTORY_FILES.crypto;
}

function getLogger(market) {
  const key = normalizeMarket(market);
  return marketLoggers[key] || log;
}

function getTradeTimestampMs(trade) {
  const iso = trade?.time;
  const isoMs = iso ? Date.parse(iso) : NaN;
  if (Number.isFinite(isoMs)) return isoMs;

  const legacy = trade?.timestamp;
  if (legacy !== undefined) {
    const fromNumber = Number(legacy);
    if (Number.isFinite(fromNumber)) return fromNumber;

    const parsedLegacy = Date.parse(legacy);
    if (Number.isFinite(parsedLegacy)) return parsedLegacy;
  }

  return NaN;
}

function normaliseTrade(trade) {
  const ts = getTradeTimestampMs(trade);
  if (!Number.isFinite(ts)) return trade;

  return {
    ...trade,
    time: new Date(ts).toISOString(),
  };
}

function ensureStateDir(market) {
  const historyFile = getHistoryFile(market);
  const dir = path.dirname(historyFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function pruneOldTrades(list) {
  const now = Date.now();
  const cutoff = now - RETENTION_MS;
  const before = list.length;

  const next = list
    .map(normaliseTrade)
    .filter((t) => {
      const ts = getTradeTimestampMs(t);
      return Number.isFinite(ts) && ts >= cutoff;
    });

  return { next, pruned: next.length !== before };
}

function loadHistoryFromDisk(market) {
  const key = normalizeMarket(market);
  const store = ensureMarketStore(key);
  const historyFile = getHistoryFile(key);
  const logger = getLogger(key);

  try {
    ensureStateDir(key);
    if (!fs.existsSync(historyFile)) {
      store.trades = [];
      return;
    }

    const raw = fs.readFileSync(historyFile, "utf8");
    if (!raw.trim()) {
      store.trades = [];
      return;
    }

    const parsed = JSON.parse(raw);
    store.trades = Array.isArray(parsed) ? parsed.map(normaliseTrade) : [];

    const { next, pruned } = pruneOldTrades(store.trades);
    store.trades = next;
    if (pruned) {
      saveHistoryToDisk(key);
    }
  } catch (e) {
    logger("[HISTORY] Failed to load history:", e.message);
    store.trades = [];
  }
}

function saveHistoryToDisk(market) {
  const key = normalizeMarket(market);
  const store = ensureMarketStore(key);
  const historyFile = getHistoryFile(key);
  const logger = getLogger(key);

  try {
    ensureStateDir(key);
    fs.writeFileSync(
      historyFile,
      JSON.stringify(store.trades, null, 2),
      "utf8"
    );
  } catch (e) {
    logger("[HISTORY] Failed to save history:", e.message);
  }
}

function initTradeHistory(market = DEFAULT_MARKET) {
  if (market === "all") {
    MARKET_KEYS.forEach((key) => initTradeHistory(key));
    return;
  }

  const key = normalizeMarket(market);
  const logger = getLogger(key);
  loadHistoryFromDisk(key);
  logger(`[HISTORY] Loaded ${ensureMarketStore(key).trades.length} trades`);
}

function addTrade(trade, market = DEFAULT_MARKET) {
  const key = normalizeMarket(market);
  const store = ensureMarketStore(key);
  const logger = getLogger(key);

  const t = {
    ...trade,
    timestamp: Date.now(),
    time: new Date().toISOString(),
  };

  store.trades.push(t);
  const { next } = pruneOldTrades(store.trades);
  store.trades = next;
  saveHistoryToDisk(key);

  logger(
    `[HISTORY] TRADE ADDED ${t.symbol} side=${t.side} pnl=${t.pnlValue?.toFixed(
      2
    )} (${t.pnlPct?.toFixed(2)}%)`
  );
}

function buildStats(list) {
  let total = list.length;
  let wins = 0;
  let losses = 0;
  let sumPnLPct = 0;
  let sumPnlValue = 0;

  for (const t of list) {
    const pct = Number(t.pnlPct) || 0;
    const val = Number(t.pnlValue) || 0;
    sumPnLPct += pct;
    sumPnlValue += val;
    if (pct > 0) wins++;
    if (pct < 0) losses++;
  }

  return { total, wins, losses, sumPnLPct, sumPnlValue };
}

function getStats(market = DEFAULT_MARKET) {
  const key = normalizeMarket(market);
  return buildStats(ensureMarketStore(key).trades);
}

function getRecentStats(hours = 24, market = DEFAULT_MARKET) {
  const key = normalizeMarket(market);
  const list = ensureMarketStore(key).trades;
  const now = Date.now();
  const cutoff = now - hours * 60 * 60 * 1000;

  const recent = list.filter((t) => {
    const ts = getTradeTimestampMs(t);
    return Number.isFinite(ts) && ts >= cutoff;
  });

  return buildStats(recent);
}

function getMultiRangeStats(market = DEFAULT_MARKET) {
  return {
    last24h: getRecentStats(24, market),
    last3d: getRecentStats(24 * 3, market),
    last7d: getRecentStats(24 * 7, market),
  };
}

function getAllTrades(market = DEFAULT_MARKET) {
  const key = normalizeMarket(market);
  return ensureMarketStore(key).trades;
}

module.exports = {
  initTradeHistory,
  addTrade,
  getStats,
  getRecentStats,
  getMultiRangeStats,
  getAllTrades,
};
