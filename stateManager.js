// stateManager.js
const fs = require("fs");
const path = require("path");
const PERFORMANCE_FILE = path.join(__dirname, "performance.json");

// קובץ ה-STATE נשמר ליד הקבצים של הבוט
const STATE_FILE = path.join(__dirname, "state.json");

/**
 * טוען מצב מהדיסק (אם קיים).
 * מחזיר:
 * - אובייקט state (אם הצליח)
 * - או null אם אין קובץ / שבור
 */
function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return null;
    }

    const raw = fs.readFileSync(STATE_FILE, "utf8");
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    console.error("[STATE] loadState error:", err.message);
    return null;
  }
}

/**
 * שומר מצב לדיסק.
 * מקבל אובייקט state (למשל: { activeSymbols, positions, activeStrategyId, lastUpdateTs })
 */
function saveState(state) {
  try {
    const json = JSON.stringify(state, null, 2);
    fs.writeFileSync(STATE_FILE, json, "utf8");
  } catch (err) {
    console.error("[STATE] saveState error:", err.message);
  }
}
function loadPerformance() {
  try {
    if (!fs.existsSync(PERFORMANCE_FILE)) {
      return null;
    }
    const raw = fs.readFileSync(PERFORMANCE_FILE, "utf8");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error("[PERFORMANCE] loadPerformance error:", err.message);
    return null;
  }
}

function savePerformance(perf) {
  try {
    const json = JSON.stringify(perf, null, 2);
    fs.writeFileSync(PERFORMANCE_FILE, json, "utf8");
  } catch (err) {
    console.error("[PERFORMANCE] savePerformance error:", err.message);
  }
}

module.exports = {
  loadState,
  saveState,
  loadPerformance,
  savePerformance,
};
