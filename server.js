// server.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const { loadState, loadPerformance } = require("./stateManager");
const { log } = require("./log");

// קונפיג חי – נשלט דרך /api/config
const runtimeConfig = {
  activeStrategyId: 2,
  loopIntervalMs: 900000, // 15 דקות (ברירת מחדל)
};

// קריאת שורות הלוג האחרונות מהקובץ האחרון בתיקיית logs
function getLatestLogLines(maxLines = 200) {
  try {
    const logDir = path.join(__dirname, "logs");
    if (!fs.existsSync(logDir)) return [];

    const files = fs
      .readdirSync(logDir)
      .filter((f) => f.endsWith(".log"))
      .sort(); // בד"כ לפי תאריך בשם הקובץ

    if (!files.length) return [];

    const lastFile = path.join(logDir, files[files.length - 1]);
    const content = fs.readFileSync(lastFile, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines);
  } catch (e) {
    console.error("getLatestLogLines error:", e);
    return [];
  }
}

function startHttpServer(shared) {
  const app = express();
  app.use(express.json());

  // סטטי – ה-frontend
  app.use(express.static(path.join(__dirname, "public")));

  // ===== API: STATUS =====
  app.get("/api/status", (req, res) => {
    try {
      const state = loadState() || {};
      const perf = loadPerformance() || {};

      const symbolsCount = state.positions
        ? Object.keys(state.positions).length
        : 0;

      res.json({
        ok: true,
        activeStrategyId:
          shared.activeStrategyId ?? runtimeConfig.activeStrategyId,
        killSwitch: shared.killSwitch ?? false,
        stateSummary: {
          symbols: symbolsCount,
          lastUpdateTs: state.lastUpdateTs || null,
        },
        performance: {
          lastEquity: perf.lastEquity ?? null,
          lastPnlPct: perf.lastPnlPct ?? null,
          lastUpdateTs: perf.lastUpdateTs ?? null,
        },
        config: {
          loopIntervalMs: runtimeConfig.loopIntervalMs,
        },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: "status failed" });
    }
  });

  // ===== API: LOGS =====
  app.get("/api/logs", (req, res) => {
    const lines = getLatestLogLines(300);
    res.json({ ok: true, lines });
  });

  // ===== API: KILL SWITCH (SELL ALL) =====
  app.post("/api/kill", (req, res) => {
    shared.killSwitch = true;
    log("[API] KILL SWITCH activated – will SELL ALL on next loop");
    res.json({ ok: true });
  });

  // ===== API: RESET FUNDS (GUI + Shift+R) =====
  app.post("/api/resetFunds", (req, res) => {
    // נבצע SELL ALL + resetFunds בלולאת הבוט
    shared.killSwitch = true;
    shared.resetFundsRequested = true;
    log("[API] RESET FUNDS requested – will SELL ALL + RESET on next loop");
    res.json({ ok: true, message: "RESET FUNDS REQUESTED" });
  });

  // ===== API: קבלת קונפיג =====
  app.get("/api/config", (req, res) => {
    res.json({
      ok: true,
      config: runtimeConfig,
    });
  });

  // ===== API: עדכון קונפיג (אסטרטגיה + אינטרוול) =====
  app.post("/api/config", (req, res) => {
    const body = req.body;

    // אסטרטגיה
    if (body.activeStrategyId !== undefined) {
      const id = Number(body.activeStrategyId);
      if (![1, 2, 3].includes(id)) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid strategy ID" });
      }
      runtimeConfig.activeStrategyId = id;
      shared.activeStrategyId = id;
      log(`[API] Strategy set to ${id}`);
    }

    // אינטרוול
    if (body.loopIntervalMs !== undefined) {
      const allowed = [60000, 300000, 900000]; // 60s, 5m, 15m
      const val = Number(body.loopIntervalMs);
      if (!allowed.includes(val)) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid loop interval" });
      }
      runtimeConfig.loopIntervalMs = val;
      log(`[API] Interval set to ${val} ms`);
    }

    res.json({
      ok: true,
      config: runtimeConfig,
    });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    log(`[API] HTTP server listening on port ${PORT}`);
  });
}

module.exports = {
  startHttpServer,
  runtimeConfig,
};
