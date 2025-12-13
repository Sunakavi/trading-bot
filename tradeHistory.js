// tradeHistory.js
const fs = require("fs");
const path = require("path");
const { log } = require("./log");

// תיקיה וקובץ להיסטוריה (נתיב מוחלט כדי שלא ישתנה לפי CWD)
const STATE_DIR = path.join(__dirname, "state");
const HISTORY_FILE = path.join(STATE_DIR, "history.json");

// נשמור היסטוריה של חודש אחרון
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// זיכרון חי
let trades = [];

// ----- עזר לדיסק -----

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function loadHistoryFromDisk() {
  try {
    ensureStateDir();

    if (!fs.existsSync(HISTORY_FILE)) {
      trades = [];
      return;
    }

    const raw = fs.readFileSync(HISTORY_FILE, "utf8");
    if (!raw.trim()) {
      trades = [];
      return;
    }

    const parsed = JSON.parse(raw);
    trades = Array.isArray(parsed) ? parsed : [];

    // ננקה טריידים ישנים לפני חודש ונשמור שוב אם התעדכן
    const pruned = pruneOldTrades();
    if (pruned) {
      saveHistoryToDisk();
    }
  } catch (e) {
    log("[HISTORY] Failed to load history.json:", e.message);
    trades = [];
  }
}

function saveHistoryToDisk() {
  try {
    ensureStateDir();
    fs.writeFileSync(
      HISTORY_FILE,
      JSON.stringify(trades, null, 2),
      "utf8"
    );
  } catch (e) {
    log("[HISTORY] Failed to save history.json:", e.message);
  }
}

// ----- API חיצוני -----

function initTradeHistory() {
  loadHistoryFromDisk();
  log(
    `[HISTORY] Loaded ${trades.length} trades from ${HISTORY_FILE}`
  );
}

/**
 * addTrade({
 *   symbol, side, entry, exit, qty, pnlValue, pnlPct
 * })
 */
function addTrade(trade) {
  const t = {
    ...trade,
    time: new Date().toISOString(),
  };

  trades.push(t);
  pruneOldTrades();
  saveHistoryToDisk();

  log(
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

// מחזיר true אם נמחקו טריידים ישנים
function pruneOldTrades() {
  const now = Date.now();
  const cutoff = now - RETENTION_MS;

  const before = trades.length;
  trades = trades.filter((t) => {
    const ts = new Date(t.time).getTime();
    return Number.isFinite(ts) && ts >= cutoff;
  });

  return trades.length !== before;
}

// סטטיסטיקה כללית לשורת לוג
function getStats() {
  return buildStats(trades);
}

function getRecentStats(hours = 24) {
  const now = Date.now();
  const cutoff = now - hours * 60 * 60 * 1000;

  const recent = trades.filter((t) => {
    const ts = new Date(t.time).getTime();
    return Number.isFinite(ts) && ts >= cutoff;
  });

  return buildStats(recent);
}

function getMultiRangeStats() {
  return {
    last24h: getRecentStats(24),
    last3d: getRecentStats(24 * 3),
    last7d: getRecentStats(24 * 7),
  };
}

// אם תרצה בעתיד – גישה להיסטוריה מלאה
function getAllTrades() {
  return trades;
}

module.exports = {
  initTradeHistory,
  addTrade,
  getStats,
  getRecentStats,
  getMultiRangeStats,
  getAllTrades,
};
