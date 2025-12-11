// server.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const { loadState, loadPerformance } = require("./stateManager");
const { log } = require("./log");
const { config, CANDLE_RED_TRIGGER_PCT, USE_CANDLE_EXIT } = require("./config");

// קונפיג חי – נשלט דרך /api/config
const runtimeConfig = {
  activeStrategyId: 102,
  loopIntervalMs: 900000, 

   // EXIT SETTINGS (דיפולט מה-config)
  SL_PCT: config.SL_PCT,
  TP_PCT: config.TP_PCT,
  TRAIL_START_PCT: config.TRAIL_START_PCT,
  TRAIL_DISTANCE_PCT: config.TRAIL_DISTANCE_PCT,
  CANDLE_RED_TRIGGER_PCT, // טריגר לנר אדום
  CANDLE_EXIT_ENABLED: USE_CANDLE_EXIT,
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
    botRunning: shared.botRunning !== false,
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
    exitConfig: {
      slPct: runtimeConfig.SL_PCT,
      tpPct: runtimeConfig.TP_PCT,
      trailStartPct: runtimeConfig.TRAIL_START_PCT,
      trailDistancePct: runtimeConfig.TRAIL_DISTANCE_PCT,
      candleRedTriggerPct: runtimeConfig.CANDLE_RED_TRIGGER_PCT,
      candleExitEnabled: runtimeConfig.CANDLE_EXIT_ENABLED,
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
    shared.interruptNow = true; // חדש – שובר את השינה
    log("[API] KILL SWITCH activated – will SELL ALL on next loop");
    res.json({ ok: true });
  });

  // ===== API: BOT START/STOP =====
  app.post("/api/bot/start", (req, res) => {
    shared.botRunning = true;
    shared.stopRequested = false;
    shared.interruptNow = true;
    log("[API] BOT START requested – resuming loop");
    res.json({ ok: true });
  });

  app.post("/api/bot/stop", (req, res) => {
    shared.stopRequested = true;
    shared.interruptNow = true;
    log("[API] BOT STOP requested – will pause after persisting state");
    res.json({ ok: true });
  });

  // ===== API: RESET FUNDS (GUI + Shift+R) =====
  app.post("/api/resetFunds", (req, res) => {
    // נבצע SELL ALL + resetFunds בלולאת הבוט
    shared.killSwitch = true;
    shared.resetFundsRequested = true;
    shared.interruptNow = true; // חדש – שובר את השינה
    log("[API] RESET FUNDS requested – will SELL ALL + RESET on next loop");
    res.json({ ok: true, message: "RESET FUNDS REQUESTED" });
  });

 app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    config: runtimeConfig,
    exitConfig: {
      slPct: runtimeConfig.SL_PCT,
      tpPct: runtimeConfig.TP_PCT,
      trailStartPct: runtimeConfig.TRAIL_START_PCT,
      trailDistancePct: runtimeConfig.TRAIL_DISTANCE_PCT,
      candleRedTriggerPct: runtimeConfig.CANDLE_RED_TRIGGER_PCT,
      candleExitEnabled: runtimeConfig.CANDLE_EXIT_ENABLED,
    },
  });
});


  // ===== API: עדכון קונפיג (אסטרטגיה + אינטרוול) =====
  app.post("/api/config", (req, res) => {
    const body = req.body;

    // אסטרטגיה
    if (body.activeStrategyId !== undefined) {
      const id = Number(body.activeStrategyId);
      const allowedStrategyIds = [1, 2, 3, 101, 102, 103, 104, 105, 106, 107, 108];
      if (!allowedStrategyIds.includes(id)) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid strategy ID" });
      }
      runtimeConfig.activeStrategyId = id;
      shared.activeStrategyId = id;
      shared.interruptNow = true; // חדש – שובר את השינה
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
      shared.interruptNow = true; // חדש – שובר את השינה
      log(`[API] Interval set to ${val} ms`);
    }
      // --- EXIT SETTINGS (SL/TP/TRAIL/CANDLE) ---
  // הערכים נשלחים בדצימל (0.012 = 1.2%)

  // SL_PCT
  if (body.slPct !== undefined) {
    const v = Number(body.slPct);
    if (!(v > 0 && v < 0.5)) {
      return res.status(400).json({ ok: false, error: "Invalid slPct" });
    }
    runtimeConfig.SL_PCT = v;
    config.SL_PCT = v; // כדי שה-strategy.js יקבל את זה דרך config
    shared.interruptNow = true;
    log(`[API] SL_PCT set to ${v}`);
  }

  // TP_PCT
  if (body.tpPct !== undefined) {
    const v = Number(body.tpPct);
    if (!(v > 0 && v < 1.0)) {
      return res.status(400).json({ ok: false, error: "Invalid tpPct" });
    }
    runtimeConfig.TP_PCT = v;
    config.TP_PCT = v;
    shared.interruptNow = true;
    log(`[API] TP_PCT set to ${v}`);
  }

  // TRAIL_START_PCT
  if (body.trailStartPct !== undefined) {
    const v = Number(body.trailStartPct);
    if (!(v > 0 && v < 1.0)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid trailStartPct" });
    }
    runtimeConfig.TRAIL_START_PCT = v;
    config.TRAIL_START_PCT = v;
    shared.interruptNow = true;
    log(`[API] TRAIL_START_PCT set to ${v}`);
  }

  // TRAIL_DISTANCE_PCT
  if (body.trailDistancePct !== undefined) {
    const v = Number(body.trailDistancePct);
    if (!(v > 0 && v < 1.0)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid trailDistancePct" });
    }
    runtimeConfig.TRAIL_DISTANCE_PCT = v;
    config.TRAIL_DISTANCE_PCT = v;
    shared.interruptNow = true;
    log(`[API] TRAIL_DISTANCE_PCT set to ${v}`);
  }

  // CANDLE_RED_TRIGGER_PCT
  if (body.candleRedTriggerPct !== undefined) {
    const v = Number(body.candleRedTriggerPct);
    if (!(v >= 0 && v <= 1.0)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid candleRedTriggerPct" });
    }
    runtimeConfig.CANDLE_RED_TRIGGER_PCT = v;
    shared.interruptNow = true;
    log(`[API] CANDLE_RED_TRIGGER_PCT set to ${v}`);
  }

  if (body.candleExitEnabled !== undefined) {
    if (typeof body.candleExitEnabled !== "boolean") {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid candleExitEnabled" });
    }
    runtimeConfig.CANDLE_EXIT_ENABLED = body.candleExitEnabled;
    config.USE_CANDLE_EXIT = body.candleExitEnabled;
    shared.interruptNow = true;
    log(
      `[API] CANDLE_EXIT_ENABLED set to ${body.candleExitEnabled ? "ON" : "OFF"}`
    );
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
