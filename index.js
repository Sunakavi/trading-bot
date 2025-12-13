// =======================
// LOAD ENV
// =======================
require("dotenv").config();

// =======================
// IMPORTS
// =======================
const {
  COLORS,
  config,
  INITIAL_CAPITAL,
  LOOP_SLEEP_MS,
  CANDLE_RED_TRIGGER_PCT,
} = require("./config");
const { log, initLogSystem } = require("./log");
const { sleep } = require("./utils");
const { BinanceClient } = require("./binanceClient");
const { runSymbolStrategy, initPositions } = require("./strategy");
const { setupKeypressListener } = require("./input");
const { initTradeHistory, getStats } = require("./tradeHistory");
const {
  loadState,
  saveState,
  loadPerformance,
  savePerformance,
  updateState,
} = require("./stateManager");
const { startHttpServer, runtimeConfig } = require("./server");

// =======================
// GLOBAL STATE
// =======================
let positions = {};
let activeSymbols = [];
let lastPrices = {};

let SELL_SWITCH = false;
const KILL_SWITCH = config.KILL_SWITCH;
let activeStrategyId = 2;
let botRunning = true;


// shared – זה עובר לשרת API
const shared = {
  activeStrategyId: activeStrategyId,
  killSwitch: false,
  resetFundsRequested: false,
  interruptNow: false, // חדש – בקשה לעצור שינה
  stopRequested: false,
  botRunning: true,
};


// =======================
// INITIAL SETUP
// =======================
initLogSystem();
initTradeHistory();

// מקשי קיצור (עובד רק מקומית, לא בענן)
setupKeypressListener(
  (key) => {
    if (key.shift && key.name === "s") {
      SELL_SWITCH = true;
      shared.interruptNow = true; // עצור שינה
      log(
        COLORS.PURPLE +
          "[SYSTEM] SELL SWITCH ACTIVATED (Shift+S)" +
          COLORS.RESET
      );
      return true;
    }

    if (key.shift && key.name === "r") {
      SELL_SWITCH = true;
      shared.resetFundsRequested = true; // נבצע resetFunds בלולאה
      shared.interruptNow = true;        // עצור שינה מייד
      log(
        COLORS.PURPLE +
          "[SYSTEM] RESET FUNDS REQUESTED (Shift+R)" +
          COLORS.RESET
      );
      return true;
    }

    return false;
  },
  (newId) => {
    activeStrategyId = newId;
    runtimeConfig.activeStrategyId = newId; // סינכרון גם ל-API
    updateState({ activeStrategyId: newId });
  }
);


// Binance Client
const binanceClient = new BinanceClient(
  config.BINANCE_BASE_URL,
  config.BINANCE_API_KEY,
  config.BINANCE_API_SECRET
);

// =======================
// PORTFOLIO / PERFORMANCE
// =======================
async function logPortfolio() {
  try {
    const account = await binanceClient.getAccount();
    const usdtBal = binanceClient.findBalance(account, config.QUOTE);
    const totalUSDT = usdtBal.free + usdtBal.locked;

    log("===== PORTFOLIO (USDT + top symbols) =====");
    log(`[${config.QUOTE}] free=${totalUSDT.toFixed(2)}`);

    let coinsValue = 0;

    for (const sym of activeSymbols) {
      const base = sym.replace(config.QUOTE, "");
      const bal = binanceClient.findBalance(account, base);
      const totalBase = bal.free + bal.locked;
      const price = lastPrices[sym] || 0;
      coinsValue += price * totalBase;

      log(
        `[${base}] amount=${totalBase.toFixed(6)} ≈ ${(price * totalBase).toFixed(
          2
        )} ${config.QUOTE}`
      );
    }

    const equity = totalUSDT + coinsValue;
    log(`[EQUITY] ≈ ${equity.toFixed(2)} ${config.QUOTE}`);
    log("==========================================");

        logPerformance(equity);

    const stats = getStats();
    if (stats.total > 0) {
      const avgPct = stats.sumPnLPct / stats.total;
      log(
        `[TRADES] total=${stats.total}, wins=${stats.wins}, losses=${stats.losses}, avg=${avgPct.toFixed(
          2
        )}%`
      );
    }
  } catch (err) {
    log(
      COLORS.RED + "[PORTFOLIO] Error:" + COLORS.RESET,
      err.response?.data || err.message
    );
  }
}

function logPerformance(equity) {
  let perf = loadPerformance();
  if (!perf) {
    perf = { initialCapital: INITIAL_CAPITAL, samples: [] };
  }

  const base = perf.initialCapital || INITIAL_CAPITAL;
  const pnlPct = ((equity - base) / base) * 100;

  log(
    `[PERFORMANCE] Start=${base.toFixed(
      2
    )} | Equity=${equity.toFixed(2)} | PNL=${pnlPct.toFixed(2)}%`
  );

  try {
    const ts = Date.now();
    perf.lastEquity = equity;
    perf.lastPnlPct = pnlPct;
    perf.lastUpdateTs = ts;
    perf.samples.push({ ts, equity, pnlPct });

    savePerformance(perf);
  } catch (err) {
    log(
      COLORS.YELLOW +
        "[PERFORMANCE] Persist failed:" +
        COLORS.RESET,
      err.message
    );
  }
}

// =======================
// INTERRUPTIBLE SLEEP – מאפשר לקטוע המתנה אם יש SELL_SWITCH / RESET
// =======================
async function interruptibleSleep(ms) {
  const chunk = 500; // נבדוק כל חצי שנייה
  let elapsed = 0;

  while (elapsed < ms) {
    // כל שינוי מה-GUI / מקלדת שמצדיק לופ חדש – שובר את השינה
    if (
      SELL_SWITCH ||
      shared.killSwitch ||
      shared.resetFundsRequested ||
      shared.interruptNow ||
      shared.stopRequested
    ) {
      return;
    }

    const remaining = ms - elapsed;
    const step = Math.min(chunk, remaining);
    await sleep(step);
    elapsed += step;
  }
}


async function resetFunds() {
  log(COLORS.PURPLE + "[RESET] Starting full funds reset…" + COLORS.RESET);

  // DELETE HISTORY
  const fs = require("fs");
  fs.writeFileSync("state/history.json", "[]");

  // RESET PERFORMANCE TO 10000
  savePerformance({
    initialCapital: 10000,
    lastEquity: 10000,
    lastPnlPct: 0,
    lastUpdateTs: Date.now(),
    samples: [],
  });

  // RESET STATE
  saveState({
    positions: {},
    activeStrategyId: 2,
    lastUpdateTs: Date.now(),
  });

  log(
    COLORS.GREEN +
      "[RESET] Trade history cleared, performance reset to 10000, state cleared." +
      COLORS.RESET
  );
}

// =======================
// MAIN LOOP
// =======================
async function mainLoop() {
  try {
    log(COLORS.PURPLE + "Starting bot..." + COLORS.RESET);

    // בחירת סימלים
    activeSymbols = await binanceClient.fetchTopSymbols(config);
    positions = initPositions(activeSymbols);

    // טעינת state מהדיסק (ללא runtimeConfig בפנים)
    const persisted = loadState();
    if (persisted) {
      if (persisted.activeStrategyId !== undefined) {
        runtimeConfig.activeStrategyId = persisted.activeStrategyId;
        activeStrategyId = persisted.activeStrategyId;
      }

      if (persisted.positions) {
        for (const sym of Object.keys(persisted.positions)) {
          positions[sym] = persisted.positions[sym];
        }
      }

      log(
        COLORS.PURPLE +
          "[STATE] Restored previous state" +
          COLORS.RESET
      );
    }

    while (true) {
      botRunning = shared.botRunning;

      // עדכון נתונים שנגישים לשרת ה-API
      shared.activeStrategyId = runtimeConfig.activeStrategyId ?? activeStrategyId;
      shared.botRunning = botRunning;

      // אם הבוט במצב עצירה – נחכה לחידוש
      if (!botRunning) {
        shared.interruptNow = false;
        await interruptibleSleep(1000);
        continue;
      }

      // אם התקבלה בקשה לעצור – נשמור מצב ונעצור
      if (shared.stopRequested) {
        log(
          COLORS.PURPLE +
            "[SYSTEM] STOP requested – persisting state and pausing bot" +
            COLORS.RESET
        );

        await logPortfolio();

        activeStrategyId = runtimeConfig.activeStrategyId;
        saveState({
          positions,
          activeStrategyId,
          lastUpdateTs: Date.now(),
        });

        botRunning = false;
        shared.botRunning = false;
        shared.stopRequested = false;
        shared.interruptNow = false;
        continue;
      }

      shared.interruptNow = false; // מתחילים איטרציה חדשה – מנקים דגל
      log(
        COLORS.PURPLE +
          `[STRATEGY] Current: ${runtimeConfig.activeStrategyId}` +
          COLORS.RESET
      );
      // סינכרון ערכי EXIT חיים לתוך config (ש-strategy.js משתמש בו)
      config.SL_PCT = runtimeConfig.SL_PCT ?? config.SL_PCT;
      config.TP_PCT = runtimeConfig.TP_PCT ?? config.TP_PCT;
      config.TRAIL_START_PCT =
        runtimeConfig.TRAIL_START_PCT ?? config.TRAIL_START_PCT;
      config.TRAIL_DISTANCE_PCT =
        runtimeConfig.TRAIL_DISTANCE_PCT ?? config.TRAIL_DISTANCE_PCT;
      config.USE_CANDLE_EXIT =
        runtimeConfig.CANDLE_EXIT_ENABLED ?? config.USE_CANDLE_EXIT;

      // אם ה-API ביקש KILL
      if (shared.killSwitch) SELL_SWITCH = true;

      // SELL ALL (גלובלי)
      if (SELL_SWITCH) {
        log(
          COLORS.PURPLE +
            "[SYSTEM] GLOBAL SELL SWITCH ON" +
            COLORS.RESET
        );
      
        for (const sym of activeSymbols) {
          try {
            await binanceClient.sellMarketAll(sym, config.QUOTE);
            positions[sym] = {
              hasPosition: false,
              entryPrice: 0,
              qty: 0,
              maxPrice: 0,
            };
            log(
              COLORS.GREEN +
                `[${sym}] SOLD (GLOBAL)` +
                COLORS.RESET
            );
          } catch (e) {
            log(
              COLORS.RED +
                `[${sym}] SELL ERROR:` +
                COLORS.RESET,
              e.response?.data || e.message
            );
          }
        }

        SELL_SWITCH = false;
        shared.killSwitch = false;
      if (shared.resetFundsRequested) {
          shared.resetFundsRequested = false;
          await resetFunds();
      }
        await logPortfolio();
        const waitSecAfterSell =
          runtimeConfig.loopIntervalMs / 1000;
        log(
          `---- wait ${waitSecAfterSell.toFixed(0)} sec ----`
        );
        await sleep(runtimeConfig.loopIntervalMs);
        continue;
      }

      // רגיל – מריץ אסטרטגיה על כל סימבול
      for (const sym of activeSymbols) {
        await runSymbolStrategy(
        sym,
        positions,
        lastPrices,
        binanceClient,
        config,
        KILL_SWITCH,
        SELL_SWITCH,
        runtimeConfig.CANDLE_RED_TRIGGER_PCT ?? CANDLE_RED_TRIGGER_PCT,
        runtimeConfig.CANDLE_EXIT_ENABLED ?? config.USE_CANDLE_EXIT,
        runtimeConfig.activeStrategyId
      );

      }

      await logPortfolio();

      // לוודא ש-activeStrategyId מסונכרן לפני שמירה ל-state
      activeStrategyId = runtimeConfig.activeStrategyId;

     saveState({
  positions,
  activeStrategyId,
  lastUpdateTs: Date.now(),
});

// לוג לפי האינטרוול החי
const waitSec = runtimeConfig.loopIntervalMs / 1000;
log(`---- wait ${waitSec.toFixed(0)} sec ----`);

// המתנה שניתנת לקטיעה ע"י Shift+S / Shift+R
await interruptibleSleep(runtimeConfig.loopIntervalMs);

    }
  } catch (err) {
    log(
      COLORS.RED + "FATAL ERROR in mainLoop:" + COLORS.RESET,
      err.message
    );
  }
}

// =======================
// START HTTP + BOT
// =======================
startHttpServer(shared);
mainLoop();
