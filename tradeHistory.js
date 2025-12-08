// tradeHistory.js
const fs = require("fs");
const path = require("path");
const { log } = require("./log");

// תיקיה וקובץ להיסטוריה
const STATE_DIR = "./state";
const HISTORY_FILE = path.join(STATE_DIR, "history.json");

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
  saveHistoryToDisk();

  log(
    `[HISTORY] TRADE ADDED ${t.symbol} side=${t.side} pnl=${t.pnlValue?.toFixed(
      2
    )} (${t.pnlPct?.toFixed(2)}%)`
  );
}

// סטטיסטיקה כללית לשורת לוג
function getStats() {
  let total = trades.length;
  let wins = 0;
  let losses = 0;
  let sumPnLPct = 0;

  for (const t of trades) {
    const pct = Number(t.pnlPct) || 0;
    sumPnLPct += pct;
    if (pct > 0) wins++;
    if (pct < 0) losses++;
  }

  return { total, wins, losses, sumPnLPct };
}

// אם תרצה בעתיד – גישה להיסטוריה מלאה
function getAllTrades() {
  return trades;
}

module.exports = {
  initTradeHistory,
  addTrade,
  getStats,
  getAllTrades,
};
