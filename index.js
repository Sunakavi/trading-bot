// index.js (Main File)
require('dotenv').config();
const http = require("http");
const { startHttpServer } = require("./server");

// state משותף בין mainLoop ל־API
const shared = {
  activeStrategyId: 2,  // ברירת מחדל – או לטעון מ-state.json
  killSwitch: false,
};

const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK\n");
  })
  .listen(PORT, () => {
    console.log(`[HEALTH] HTTP server listening on ${PORT}`);
  });
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
const {  loadState,  saveState,  loadPerformance,  savePerformance,} = require("./stateManager");



// =======================
// GLOBAL STATE
// =======================
/**
 * Global map for position state:
 * positions[symbol] = { hasPosition: boolean, entryPrice: number, qty: number, maxPrice: number }
 */
let positions = {};
let activeSymbols = [];
let lastPrices = {}; // lastPrices[symbol] = number

let SELL_SWITCH = false; // Controls emergency sell
const KILL_SWITCH = config.KILL_SWITCH; // Permanent halt switch
let activeStrategyId = 2; // Default starting strategy (Trend/Pullback/RSI)

// Performance baseline (for reset)
let performanceBaseline = INITIAL_CAPITAL;
let pendingResetBaseline = false;

// =======================
// SETUP & INPUT HANDLING
// =======================

// Initialize logging system
initLogSystem();
// Initialize trade history (PNL per trade)
initTradeHistory();

// Setup keypress listener for emergency SELL/KILL switches and strategy switching
setupKeypressListener(
  (key) => {
    // SELL ALL – existing
    if (key.shift && key.name === "s") {
      SELL_SWITCH = true;
      log(
        COLORS.PURPLE +
          "[SYSTEM] SELL SWITCH ACTIVATED (Shift+S)" +
          COLORS.RESET
      );
      return true;
    }

    // RESET PERFORMANCE + FORCE SELL
    if (key.shift && key.name === "r") {
      SELL_SWITCH = true;              // סוגר את כל הפוזיציות בסיבוב הבא
      pendingResetBaseline = true;     // נסמן לאיפוס הבסיס של ה-PNL
      log(
        COLORS.PURPLE +
          "[SYSTEM] RESET REQUESTED (Shift+R) – SELL ALL & RESET PNL BASELINE" +
          COLORS.RESET
      );
      return true;
    }

    return false;
  },
  (newId) => {
    activeStrategyId = newId;
  }
);


// Initialize Binance Client
const binanceClient = new BinanceClient(
  config.BINANCE_BASE_URL,
  config.BINANCE_API_KEY,
  config.BINANCE_API_SECRET
);

// =======================
// PORTFOLIO LOGGING
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
      const val = price * totalBase;
      coinsValue += val;

      log(`[${base}] amount=${totalBase.toFixed(6)} ≈ ${val.toFixed(2)} ${config.QUOTE}`);
    }

    const equity = totalUSDT + coinsValue;
log(`[EQUITY] ≈ ${equity.toFixed(2)} ${config.QUOTE}`);
log("==========================================");

// אם לחצו Shift+R – נעדכן את הבסיס לביצועים לנקודת ההון הזאת
if (pendingResetBaseline) {
  performanceBaseline = equity;
  pendingResetBaseline = false;
  log(
    COLORS.PURPLE +
      `[SYSTEM] PERFORMANCE BASELINE RESET TO ${equity.toFixed(2)} ${config.QUOTE}` +
      COLORS.RESET
  );
}

logPerformance(equity);
// סטטיסטיקה של עסקאות
const s = getStats();
if (s.total > 0) {
  const avgPct = s.sumPnLPct / s.total;
  log(
    `[TRADES] total=${s.total}, wins=${s.wins}, losses=${
      s.losses
    }, avg PNL=${avgPct.toFixed(2)}%`
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
  const pnlPct =
    ((equity - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;

  // לוג רגיל למסך (כמו שהיה)
  log(
    `[PERFORMANCE] Start=${INITIAL_CAPITAL.toFixed(
      2
    )} | Equity=${equity.toFixed(2)} | PNL=${pnlPct.toFixed(2)}%`
  );

  // שמירה לקובץ performance.json
  try {
    let perf = loadPerformance();

    if (!perf) {
      perf = {
        initialCapital: INITIAL_CAPITAL,
        samples: [],
      };
    }

    const ts = Date.now();

    perf.lastEquity = equity;
    perf.lastPnlPct = pnlPct;
    perf.lastUpdateTs = ts;
    perf.samples = perf.samples || [];
    perf.samples.push({
      ts,
      equity,
      pnlPct,
    });

    savePerformance(perf);
  } catch (err) {
    log(
      COLORS.YELLOW +
        "[PERFORMANCE] Failed to persist:" +
        COLORS.RESET,
      err.message
    );
  }
}



// =======================
// MAIN LOOP
// =======================

async function mainLoop() {
  try {
    log(COLORS.PURPLE + "Starting bot..." + COLORS.RESET);

    // 1. Initial symbol selection
    activeSymbols = await binanceClient.fetchTopSymbols(config);
    positions = initPositions(activeSymbols);

    // 1.1 ניסיון לטעון מצב קודם מהדיסק
    const persisted = loadState();
    if (persisted) {
      if (persisted.activeStrategyId !== undefined) {
        activeStrategyId = persisted.activeStrategyId;
        log(
          COLORS.PURPLE +
            `[STATE] Restored activeStrategyId=${activeStrategyId}` +
            COLORS.RESET
        );
      }

      if (persisted.positions) {
        // נדרוך מעל המצב ההתחלתי עם הפוזיציות השמורות
        for (const sym of Object.keys(persisted.positions)) {
          positions[sym] = persisted.positions[sym];
        }
        log(
          COLORS.PURPLE +
            `[STATE] Restored positions for ${Object.keys(persisted.positions).length} symbols` +
            COLORS.RESET
        );
      }
    }


    while (true) {
      // 2. Main Strategy Loop
      log(
        COLORS.PURPLE +
          `[STRATEGY] Current: ${activeStrategyId}` +
          COLORS.RESET
      );

      // 🔴 GLOBAL SELL SWITCH – מוכר את כל הסימבולים הפעילים
      if (SELL_SWITCH) {
        log(
          COLORS.PURPLE +
            "[SYSTEM] GLOBAL SELL SWITCH ON – SELLING ALL ACTIVE SYMBOLS" +
            COLORS.RESET
        );

        for (const sym of activeSymbols) {
          try {
            const result = await binanceClient.sellMarketAll(
              sym,
              config.QUOTE
            );

            // ניקוי מצב הפוזיציה הפנימי
            if (positions[sym]) {
              positions[sym].hasPosition = false;
              positions[sym].entryPrice = 0;
              positions[sym].qty = 0;
              positions[sym].maxPrice = 0;
            }

            if (result) {
              log(
                COLORS.GREEN +
                  `[${sym}] GLOBAL SELL DONE @ avg=${result.avgPrice.toFixed(
                    4
                  )}` +
                  COLORS.RESET
              );
            }
          } catch (e) {
            log(
              COLORS.RED +
                `[${sym}] GLOBAL SELL ERROR:` +
                COLORS.RESET,
              e.response?.data || e.message
            );
          }
        }

        // reset של הסוויץ׳
        SELL_SWITCH = false;
        log(COLORS.PURPLE + "[SYSTEM] SELL SWITCH RESET" + COLORS.RESET);

        // לוג פורטפוליו אחרי המכירה
        await logPortfolio();

        // המתנה לסיבוב הבא
        log(`---- wait ${(LOOP_SLEEP_MS / 1000).toFixed(0)} sec ----`);
        await sleep(LOOP_SLEEP_MS);
        continue; // לא להריץ אסטרטגיה בסיבוב הזה
      }

      // 👇 מצב רגיל – מריץ אסטרטגיה
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
          activeStrategyId
        );
      }

            // 3. Log results
      await logPortfolio();

      // 3.1 שמירת מצב לדיסק (positions + אסטרטגיה פעילה)
      saveState({
        positions,
        activeStrategyId,
        lastUpdateTs: Date.now(),
      });

      log(`---- wait ${(LOOP_SLEEP_MS / 1000).toFixed(0)} sec ----`);

      // 4. המתנה קבועה בין ריצות
      await sleep(LOOP_SLEEP_MS);
    }
3
  } catch (err) {
    log(
      COLORS.RED + "FATAL ERROR in mainLoop:" + COLORS.RESET,
      err.message
    );
  }
}


mainLoop();