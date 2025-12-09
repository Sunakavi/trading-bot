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

// reset baseline
let performanceBaseline = INITIAL_CAPITAL;
let pendingResetBaseline = false;

// shared – זה עובר לשרת API
const shared = {
  activeStrategyId: activeStrategyId,
  killSwitch: false,
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
      log(
        COLORS.PURPLE +
          "[SYSTEM] SELL SWITCH ACTIVATED (Shift+S)" +
          COLORS.RESET
      );
      return true;
    }

    if (key.shift && key.name === "r") {
      SELL_SWITCH = true;
      pendingResetBaseline = true;
      log(
        COLORS.PURPLE +
          "[SYSTEM] RESET BASELINE REQUESTED (Shift+R)" +
          COLORS.RESET
      );
      return true;
    }

    return false;
  },
  (newId) => {
    activeStrategyId = newId;
    runtimeConfig.activeStrategyId = newId; // סינכרון גם ל-API
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

    if (pendingResetBaseline) {
      performanceBaseline = equity;
      pendingResetBaseline = false;
      log(
        COLORS.PURPLE +
          `[SYSTEM] PERFORMANCE BASELINE RESET TO ${equity.toFixed(
            2
          )} USDT` +
          COLORS.RESET
      );
    }

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
  const pnlPct = ((equity - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;

  log(
    `[PERFORMANCE] Start=${INITIAL_CAPITAL.toFixed(
      2
    )} | Equity=${equity.toFixed(2)} | PNL=${pnlPct.toFixed(2)}%`
  );

  try {
    let perf = loadPerformance();
    if (!perf) {
      perf = { initialCapital: INITIAL_CAPITAL, samples: [] };
    }

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
    // אם לחצו Shift+S או Shift+R – נצא מיד מההמתנה
    if (SELL_SWITCH || pendingResetBaseline) {
      return;
    }

    const remaining = ms - elapsed;
    const step = Math.min(chunk, remaining);
    await sleep(step);
    elapsed += step;
  }
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
      // עדכון נתונים שנגישים לשרת ה-API
      shared.activeStrategyId = runtimeConfig.activeStrategyId ?? activeStrategyId;

      log(
        COLORS.PURPLE +
          `[STRATEGY] Current: ${runtimeConfig.activeStrategyId}` +
          COLORS.RESET
      );

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
          CANDLE_RED_TRIGGER_PCT,
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
