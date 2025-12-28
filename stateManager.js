// stateManager.js
const fs = require("fs");
const path = require("path");
const DATA_DIR = path.join(__dirname, "state");
const PERFORMANCE_FILE = path.join(DATA_DIR, "performance.json");
const LEGACY_PERFORMANCE_FILE = path.join(__dirname, "performance.json");

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

/**
 * מעדכן חלקית את ה-state הקיים ושומר לדיסק.
 * שימושי לשינויים קטנים (למשל החלפת activeStrategyId) גם כשהבוט לא בשלב שמירה רגיל.
 */
function updateState(partialState) {
  try {
    const current = loadState() || {};
    const merged = {
      ...current,
      ...partialState,
      lastUpdateTs: Date.now(),
    };

    saveState(merged);
  } catch (err) {
    console.error("[STATE] updateState error:", err.message);
  }
}
function loadPerformance() {
  try {
    if (!fs.existsSync(PERFORMANCE_FILE) && fs.existsSync(LEGACY_PERFORMANCE_FILE)) {
      const legacyRaw = fs.readFileSync(LEGACY_PERFORMANCE_FILE, "utf8");
      if (legacyRaw) {
        const legacyData = JSON.parse(legacyRaw);
        savePerformance(legacyData);
        return legacyData;
      }
    }
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
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const json = JSON.stringify(perf, null, 2);
    fs.writeFileSync(PERFORMANCE_FILE, json, "utf8");
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
