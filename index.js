// =======================
// LOAD ENV
// =======================
require("dotenv").config();

// =======================
// IMPORTS
// =======================
const { COLORS, config, INITIAL_CAPITAL, LOOP_SLEEP_MS, CANDLE_RED_TRIGGER_PCT } = require("./config");
const { log, initLogSystem } = require("./log");
const { sleep } = require("./utils");
const { BinanceClient } = require("./binanceClient");
const { runSymbolStrategy, initPositions } = require("./strategy");
const { setupKeypressListener } = require("./input");
const { initTradeHistory, getStats } = require("./tradeHistory");
const { loadState, saveState, loadPerformance, savePerformance } = require("./stateManager");
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
      log(COLORS.PURPLE + "[SYSTEM] SELL SWITCH ACTIVATED (Shift+S)" + COLORS.RESET);
      return true;
    }

    if (key.shift && key.name === "r") {
      SELL_SWITCH = true;
      pendingResetBaseline = true;
      log(COLORS.PURPLE + "[SYSTEM] RESET BASELINE REQUESTED (Shift+R)" + COLORS.RESET);
      return true;
    }

    return false;
  },
  (newId) => {
    activeStrategyId = newId;
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

      log(`[${base}] amount=${totalBase.toFixed(6)} ≈ ${(price * totalBase).toFixed(2)} ${config.QUOTE}`);
    }

    const equity = totalUSDT + coinsValue;
    log(`[EQUITY] ≈ ${equity.toFixed(2)} ${config.QUOTE}`);
    log("==========================================");

    if (pendingResetBaseline) {
      performanceBaseline = equity;
      pendingResetBaseline = false;
      log(COLORS.PURPLE + `[SYSTEM] PERFORMANCE BASELINE RESET TO ${equity.toFixed(2)} USDT` + COLORS.RESET);
    }

    logPerformance(equity);

    const stats = getStats();
    if (stats.total > 0) {
      const avgPct = stats.sumPnLPct / stats.total;
      log(`[TRADES] total=${stats.total}, wins=${stats.wins}, losses=${stats.losses}, avg=${avgPct.toFixed(2)}%`);
    }
  } catch (err) {
    log(COLORS.RED + "[PORTFOLIO] Error:" + COLORS.RESET, err.response?.data || err.message);
  }
}

function logPerformance(equity) {
  const pnlPct = ((equity - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;

  log(`[PERFORMANCE] Start=${INITIAL_CAPITAL.toFixed(2)} | Equity=${equity.toFixed(2)} | PNL=${pnlPct.toFixed(2)}%`);

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
    log(COLORS.YELLOW + "[PERFORMANCE] Persist failed:" + COLORS.RESET, err.message);
  }
}

// =======================
// MAIN LOOP
// =======================
async function mainLoop() {
  try {
    log(COLORS.PURPLE + "Starting bot..." + COLORS.RESET);

    activeSymbols = await binanceClient.fetchTopSymbols(config);
    positions = initPositions(activeSymbols);

    const persisted = loadState();
    if (persisted) {
      if (persisted.runtimeConfig.activeStrategyId !== undefined) {
        runtimeConfig.activeStrategyId = persisted.runtimeConfig.activeStrategyId;
      }
      if (persisted.positions) {
        for (const sym of Object.keys(persisted.positions)) {
          positions[sym] = persisted.positions[sym];
        }
      }
      log(COLORS.PURPLE + "[STATE] Restored previous state" + COLORS.RESET);
    }

    while (true) {
      // עדכון ל-API
      shared.runtimeConfig.activeStrategyId = runtimeConfig.activeStrategyId;

      log(COLORS.PURPLE + `[STRATEGY] Current: ${runtimeConfig.activeStrategyId}` + COLORS.RESET);

      // אם ה-API ביקש KILL
      if (shared.killSwitch) SELL_SWITCH = true;

      // SELL ALL
      if (SELL_SWITCH) {
        log(COLORS.PURPLE + "[SYSTEM] GLOBAL SELL SWITCH ON" + COLORS.RESET);

        for (const sym of activeSymbols) {
          try {
            await binanceClient.sellMarketAll(sym, config.QUOTE);
            positions[sym] = { hasPosition: false, entryPrice: 0, qty: 0, maxPrice: 0 };
            log(COLORS.GREEN + `[${sym}] SOLD (GLOBAL)` + COLORS.RESET);
          } catch (e) {
            log(COLORS.RED + `[${sym}] SELL ERROR:` + COLORS.RESET, e.response?.data || e.message);
          }
        }

        SELL_SWITCH = false;
        shared.killSwitch = false;

        await logPortfolio();
        await sleep(runtimeConfig.loopIntervalMs);
        continue;
      }

      // רגיל – מריץ אסטרטגיה
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

      saveState({
        positions,
        activeStrategyId,
        lastUpdateTs: Date.now(),
      });

      log(`---- wait ${(LOOP_SLEEP_MS / 1000).toFixed(0)} sec ----`);
      await sleep(runtimeConfig.loopIntervalMs);
    }
  } catch (err) {
    log(COLORS.RED + "FATAL ERROR in mainLoop:" + COLORS.RESET, err.message);
  }
}

// =======================
// START HTTP + BOT
// =======================
startHttpServer(shared);
mainLoop();
