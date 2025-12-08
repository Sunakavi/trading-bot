// server.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const { loadState, loadPerformance } = require("./stateManager");
const { log } = require("./log");

function getLatestLogLines(maxLines = 200) {
  const logDir = path.join(__dirname, "logs");
  if (!fs.existsSync(logDir)) return [];

  const files = fs
    .readdirSync(logDir)
    .filter((f) => f.endsWith(".log"))
    .sort(); // לפי תאריך בשם

  if (!files.length) return [];

  const lastFile = path.join(logDir, files[files.length - 1]);
  const content = fs.readFileSync(lastFile, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  return lines.slice(-maxLines);
}

function startHttpServer(shared) {
  const app = express();
  app.use(express.json());

  // סטטי – ה־frontend
  app.use(express.static(path.join(__dirname, "public")));

  // סטטוס כללי
  app.get("/api/status", (req, res) => {
    const state = loadState() || {};
    const perf = loadPerformance() || {};
    res.json({
      ok: true,
      activeStrategyId: shared.activeStrategyId,
      killSwitch: shared.killSwitch,
      stateSummary: {
        symbols: state.positions ? Object.keys(state.positions).length : 0,
        lastUpdateTs: state.lastUpdateTs || null,
      },
      performance: perf,
    });
  });

  // שינוי אסטרטגיה חיה
  app.post("/api/strategy", (req, res) => {
    const { id } = req.body;
    if (![1, 2, 3].includes(id)) {
      return res.status(400).json({ ok: false, error: "invalid strategy id" });
    }
    shared.activeStrategyId = id;
    log(`[API] Strategy changed to ${id}`);
    res.json({ ok: true, activeStrategyId: id });
  });

  // KILL SWITCH – מכירת הכל בלולאה הבאה
  app.post("/api/kill", (req, res) => {
    shared.killSwitch = true;
    log("[API] KILL SWITCH activated – will SELL ALL next loop");
    res.json({ ok: true, killSwitch: true });
  });

  // לוגים אחרונים
  app.get("/api/logs", (req, res) => {
    const lines = getLatestLogLines(300);
    res.json({ ok: true, lines });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    log(`[API] HTTP server listening on port ${PORT}`);
  });
}
// =======================
// CONFIG API
// =======================

let runtimeConfig = {
  activeStrategyId: 2,
  loopIntervalMs: 900000 // 15 דקות
};

// קבלת קונפיג
app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    config: runtimeConfig
  });
});

// עדכון קונפיג
app.post("/api/config", (req, res) => {
  const body = req.body;

  // ולידציה: אסטרטגיה
  if (body.activeStrategyId !== undefined) {
    const id = Number(body.activeStrategyId);
    if (![1, 2, 3].includes(id)) {
      return res.status(400).json({ ok: false, error: "Invalid strategy ID" });
    }
    runtimeConfig.activeStrategyId = id;
    log(`[API] Strategy set to ${id}`);
  }

  // ולידציה: אינטרוול
  if (body.loopIntervalMs !== undefined) {
    const allowed = [60000, 300000, 900000]; // 1 דקה, 5 דקות, 15 דקות
    const val = Number(body.loopIntervalMs);
    if (!allowed.includes(val)) {
      return res.status(400).json({ ok: false, error: "Invalid loop interval" });
    }
    runtimeConfig.loopIntervalMs = val;
    log(`[API] Interval set to ${val} ms`);
  }

  res.json({
    ok: true,
    config: runtimeConfig
  });
});
module.exports = {
  startHttpServer,
  runtimeConfig
};

