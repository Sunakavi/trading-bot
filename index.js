// =======================
// LOAD ENV
// =======================
require("dotenv").config();

// =======================
// IMPORTS
// =======================
const fs = require("fs");
const path = require("path");
const {
  COLORS,
  config,
  INITIAL_CAPITAL,
  CANDLE_RED_TRIGGER_PCT,
} = require("./config");
const { log, initLogSystem, createMarketLogger } = require("./log");
const { sleep } = require("./utils");
const { BinanceClient } = require("./binanceClient");
const { StockClient } = require("./stockClient");
const { runSymbolStrategy, initPositions } = require("./strategy");
const { setupKeypressListener } = require("./input");
const { getStats } = require("./tradeHistory");
const {
  loadState,
  saveState,
  loadPerformance,
  savePerformance,
  updateState,
} = require("./stateManager");
const { loadSettings } = require("./settingsManager");
const {
  startHttpServer,
  runtimeConfigCrypto,
  runtimeConfigStocks,
  buildRuntimeConfigSnapshot,
  normalizeRuntimeConfig,
} = require("./server");
const { resolveDataPath } = require("./dataDir");

// =======================
// GLOBALS
// =======================
const MARKET_KEYS = ["crypto", "stocks"];
const marketLoggers = {
  crypto: createMarketLogger("crypto"),
  stocks: createMarketLogger("stocks"),
};

const marketConfigs = {
  crypto: { ...config, MARKET_TYPE: "crypto", QUOTE: config.CRYPTO_QUOTE },
  stocks: { ...config, MARKET_TYPE: "stocks", QUOTE: config.STOCK_QUOTE },
};

const shared = {
  botRunning: true,
  stopRequested: false,
  resetFundsRequested: false,
  markets: {
    crypto: {
      activeStrategyId: runtimeConfigCrypto.activeStrategyId ?? 2,
      sellAllRequested: false,
      interruptNow: false,
      marketClock: {},
      stopHandled: false,
      resetHandled: false,
    },
    stocks: {
      activeStrategyId: runtimeConfigStocks.activeStrategyId ?? 2,
      sellAllRequested: false,
      interruptNow: false,
      marketClock: {},
      stopHandled: false,
      resetHandled: false,
    },
  },
  marketClients: {},
};

// =======================
// INITIAL SETUP
// =======================
initLogSystem();

// Keyboard controls
setupKeypressListener(
  (key) => {
    if (key.shift && key.name === "s") {
      const marketShared = shared.markets.crypto;
      marketShared.sellAllRequested = true;
      marketShared.interruptNow = true;
      marketLoggers.crypto(
        COLORS.PURPLE + "[SYSTEM] SELL ALL (Shift+S)" + COLORS.RESET
      );
      return true;
    }

    if (key.shift && key.name === "r") {
      shared.resetFundsRequested = true;
      MARKET_KEYS.forEach((market) => {
        const marketShared = shared.markets[market];
        marketShared.sellAllRequested = true;
        marketShared.interruptNow = true;
        marketShared.resetHandled = false;
      });
      marketLoggers.crypto(
        COLORS.PURPLE + "[SYSTEM] RESET FUNDS REQUESTED (Shift+R)" + COLORS.RESET
      );
      return true;
    }

    return false;
  },
  (newId) => {
    runtimeConfigCrypto.activeStrategyId = newId;
    shared.markets.crypto.activeStrategyId = newId;
    updateState({ activeStrategyId: newId }, "crypto");
  }
);

// =======================
// CLIENTS
// =======================
const cryptoClient = new BinanceClient(
  config.BINANCE_BASE_URL,
  config.BINANCE_API_KEY,
  config.BINANCE_API_SECRET,
  marketLoggers.crypto
);

const stocksClient = new StockClient({
  quote: config.STOCK_QUOTE,
  apiKey: config.ALPACA_API_KEY,
  apiSecret: config.ALPACA_API_SECRET,
  tradingBaseUrl: config.ALPACA_TRADING_BASE_URL,
  dataBaseUrl: config.ALPACA_DATA_BASE_URL,
  dataFeed: config.ALPACA_DATA_FEED,
  logger: marketLoggers.stocks,
});

shared.marketClients = {
  crypto: cryptoClient,
  stocks: stocksClient,
};

// =======================
// HELPERS
// =======================
function shouldInterrupt(market) {
  const marketShared = shared.markets[market];
  return (
    marketShared.sellAllRequested ||
    marketShared.interruptNow ||
    shared.stopRequested ||
    shared.resetFundsRequested ||
    shared.botRunning === false
  );
}

async function interruptibleSleep(ms, market) {
  const chunk = 500;
  let elapsed = 0;
  while (elapsed < ms) {
    if (shouldInterrupt(market)) return;
    const remaining = ms - elapsed;
    const step = Math.min(chunk, remaining);
    await sleep(step);
    elapsed += step;
  }
}

function updateRuntimeExitConfig(marketConfig, runtimeConfig) {
  marketConfig.SL_PCT = runtimeConfig.SL_PCT ?? marketConfig.SL_PCT;
  marketConfig.TP_PCT = runtimeConfig.TP_PCT ?? marketConfig.TP_PCT;
  marketConfig.TRAIL_START_PCT =
    runtimeConfig.TRAIL_START_PCT ?? marketConfig.TRAIL_START_PCT;
  marketConfig.TRAIL_DISTANCE_PCT =
    runtimeConfig.TRAIL_DISTANCE_PCT ?? marketConfig.TRAIL_DISTANCE_PCT;
  marketConfig.USE_CANDLE_EXIT =
    runtimeConfig.CANDLE_EXIT_ENABLED ?? marketConfig.USE_CANDLE_EXIT;
}

function formatCountdown(totalSec) {
  if (!Number.isFinite(totalSec)) return "--:--:--";
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = Math.floor(totalSec % 60);
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function markStopHandled(market) {
  shared.markets[market].stopHandled = true;
  const allHandled = MARKET_KEYS.every(
    (key) => shared.markets[key].stopHandled
  );
  if (allHandled) {
    shared.botRunning = false;
    shared.stopRequested = false;
    MARKET_KEYS.forEach((key) => {
      shared.markets[key].stopHandled = false;
    });
  }
}

function markResetHandled(market) {
  shared.markets[market].resetHandled = true;
  const allHandled = MARKET_KEYS.every(
    (key) => shared.markets[key].resetHandled
  );
  if (allHandled) {
    shared.resetFundsRequested = false;
    MARKET_KEYS.forEach((key) => {
      shared.markets[key].resetHandled = false;
    });
  }
}

function ensureHistoryDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function resetFundsForMarket(market, runtimeConfig, logger) {
  const historyFile =
    market === "stocks"
      ? resolveDataPath("state", "history.stocks.json")
      : resolveDataPath("state", "history.json");

  ensureHistoryDir(historyFile);
  fs.writeFileSync(historyFile, "[]", "utf8");

  savePerformance(
    {
      initialCapital: INITIAL_CAPITAL,
      lastEquity: INITIAL_CAPITAL,
      lastPnlPct: 0,
      lastUpdateTs: Date.now(),
      samples: [],
    },
    market
  );

  saveState(
    {
      positions: {},
      activeStrategyId: runtimeConfig.activeStrategyId,
      runtimeConfig: buildRuntimeConfigSnapshot(runtimeConfig),
      settings: loadSettings().settings,
      lastUpdateTs: Date.now(),
    },
    market
  );

  logger(
    COLORS.GREEN +
      `[RESET] ${market.toUpperCase()} history cleared, performance reset.` +
      COLORS.RESET
  );
}

async function logPerformance(market, equity, logger) {
  let perf = loadPerformance(market);
  if (!perf) {
    perf = { initialCapital: INITIAL_CAPITAL, samples: [] };
  }

  const base = perf.initialCapital || INITIAL_CAPITAL;
  const pnlPct = ((equity - base) / base) * 100;

  logger(
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

    savePerformance(perf, market);
  } catch (err) {
    logger(
      COLORS.YELLOW + "[PERFORMANCE] Persist failed:" + COLORS.RESET,
      err.message
    );
  }
}

async function logPortfolio(market, context) {
  const { marketClient, marketConfig, logger } = context;
  try {
    const account = await marketClient.getAccount();
    const quote = marketConfig.QUOTE;
    const quoteBal = marketClient.findBalance(account, quote);
    const totalQuote = quoteBal.free + quoteBal.locked;

    logger(`===== PORTFOLIO (${quote} + top symbols) =====`);
    logger(`[${quote}] free=${totalQuote.toFixed(2)}`);

    let assetsValue = 0;
    for (const sym of context.activeSymbols) {
      const base = market === "stocks" ? sym : sym.replace(quote, "");
      const bal = marketClient.findBalance(account, base);
      const totalBase = bal.free + bal.locked;
      const price = context.lastPrices[sym] || 0;
      assetsValue += price * totalBase;

      logger(
        `[${base}] amount=${totalBase.toFixed(6)} ? ${(price * totalBase).toFixed(
          2
        )} ${quote}`
      );
    }

    const equity = totalQuote + assetsValue;
    logger(`[EQUITY] ? ${equity.toFixed(2)} ${quote}`);
    logger("==========================================");

    await logPerformance(market, equity, logger);

    const stats = getStats(market);
    if (stats.total > 0) {
      const avgPct = stats.sumPnLPct / stats.total;
      logger(
        `[TRADES] total=${stats.total}, wins=${stats.wins}, losses=${stats.losses}, avg=${avgPct.toFixed(
          2
        )}%`
      );
    }
  } catch (err) {
    logger(
      COLORS.RED + "[PORTFOLIO] Error:" + COLORS.RESET,
      err.response?.data || err.message
    );
  }
}

async function sellAllPositions(market, context) {
  const { marketConfig, marketClient, logger } = context;
  const quote = marketConfig.QUOTE;
  const symbols = new Set([
    ...context.activeSymbols,
    ...Object.keys(context.positions),
  ]);

  for (const sym of symbols) {
    try {
      await marketClient.sellMarketAll(sym, quote);
      context.positions[sym] = {
        hasPosition: false,
        entryPrice: 0,
        qty: 0,
        maxPrice: 0,
      };
      logger(COLORS.GREEN + `[${sym}] SOLD (SELL ALL)` + COLORS.RESET);
    } catch (e) {
      logger(
        COLORS.RED + `[${sym}] SELL ERROR:` + COLORS.RESET,
        e.response?.data || e.message
      );
    }
  }
}

function updateMarketClock(marketShared, clock) {
  const nextOpen = clock?.next_open ? Date.parse(clock.next_open) : NaN;
  const nextClose = clock?.next_close ? Date.parse(clock.next_close) : NaN;
  const now = Date.now();
  const countdownSec = Number.isFinite(nextOpen)
    ? Math.max(0, Math.floor((nextOpen - now) / 1000))
    : null;

  marketShared.marketClock = {
    isOpen: !!clock?.is_open,
    nextOpen: clock?.next_open || null,
    nextClose: clock?.next_close || null,
    countdownSec,
    countdown: countdownSec != null ? formatCountdown(countdownSec) : null,
  };
}

// =======================
// MARKET LOOP
// =======================
async function runMarketLoop(market) {
  const logger = marketLoggers[market];
  const marketClient = shared.marketClients[market];
  const runtimeConfig = market === "stocks" ? runtimeConfigStocks : runtimeConfigCrypto;
  const marketConfig = marketConfigs[market];
  const marketShared = shared.markets[market];

  const context = {
    market,
    positions: {},
    activeSymbols: [],
    lastPrices: {},
    marketClient,
    marketConfig,
    logger,
  };

  logger(COLORS.PURPLE + `[SYSTEM] Starting ${market} loop...` + COLORS.RESET);

  if (market === "crypto") {
    context.activeSymbols = await marketClient.fetchTopSymbols(marketConfig);
    context.positions = initPositions(context.activeSymbols);
  }

  const persisted = loadState(market);
  if (persisted) {
    if (persisted.activeStrategyId !== undefined) {
      runtimeConfig.activeStrategyId = persisted.activeStrategyId;
    }

    if (persisted.runtimeConfig) {
      const normalized = normalizeRuntimeConfig(persisted.runtimeConfig, runtimeConfig);
      Object.assign(runtimeConfig, normalized);
    }

    if (persisted.positions) {
      const keys = Object.keys(persisted.positions);
      if (keys.length) {
        const nextPositions = initPositions(keys);
        keys.forEach((sym) => {
          nextPositions[sym] = persisted.positions[sym];
        });
        context.positions = nextPositions;
        context.activeSymbols = keys;
      }
    }

    logger(COLORS.PURPLE + "[STATE] Restored previous state" + COLORS.RESET);
  }

  while (true) {
    marketShared.activeStrategyId = runtimeConfig.activeStrategyId;

    if (shared.stopRequested) {
      logger(
        COLORS.PURPLE +
          "[SYSTEM] STOP requested – persisting state and pausing bot" +
          COLORS.RESET
      );

      await logPortfolio(market, context);

      saveState(
        {
          positions: context.positions,
          activeStrategyId: runtimeConfig.activeStrategyId,
          runtimeConfig: buildRuntimeConfigSnapshot(runtimeConfig),
          settings: loadSettings().settings,
          lastUpdateTs: Date.now(),
        },
        market
      );

      marketShared.interruptNow = false;
      markStopHandled(market);
      await sleep(1000);
      continue;
    }

    if (!shared.botRunning) {
      marketShared.interruptNow = false;
      await sleep(1000);
      continue;
    }

    if (market === "stocks") {
      try {
        const clock = await marketClient.getClock();
        updateMarketClock(marketShared, clock);

        if (!clock?.is_open) {
          const countdown = marketShared.marketClock.countdown || "--:--:--";
          const nextOpen = clock?.next_open || "unknown";
          logger(
            `[STOCKS] MARKET CLOSED | opens in ${countdown} | next_open=${nextOpen} ET`
          );
          await interruptibleSleep(60000, market);
          continue;
        }
      } catch (err) {
        logger(
          COLORS.YELLOW + "[MARKET] Clock check failed, skipping this loop." + COLORS.RESET,
          err.response?.data || err.message
        );
        await interruptibleSleep(runtimeConfig.loopIntervalMs, market);
        continue;
      }

      const refreshed = await marketClient.fetchTopSymbols(marketConfig);
      if (Array.isArray(refreshed) && refreshed.length > 0) {
        const openPositions = Object.entries(context.positions)
          .filter(([, pos]) => pos?.hasPosition)
          .map(([sym]) => sym);
        const merged = Array.from(new Set([...refreshed, ...openPositions]));
        const nextPositions = initPositions(merged);
        merged.forEach((sym) => {
          if (context.positions[sym]) nextPositions[sym] = context.positions[sym];
        });
        context.activeSymbols = merged;
        context.positions = nextPositions;
      }
    }

    marketShared.interruptNow = false;

    updateRuntimeExitConfig(marketConfig, runtimeConfig);

    if (marketShared.sellAllRequested) {
      logger(COLORS.PURPLE + "[SYSTEM] SELL ALL" + COLORS.RESET);
      await sellAllPositions(market, context);
      marketShared.sellAllRequested = false;

      if (shared.resetFundsRequested) {
        await resetFundsForMarket(market, runtimeConfig, logger);
        markResetHandled(market);
        context.positions = initPositions(context.activeSymbols);
      }

      await logPortfolio(market, context);
      const waitSecAfterSell = runtimeConfig.loopIntervalMs / 1000;
      logger(`---- wait ${waitSecAfterSell.toFixed(0)} sec ----`);
      await interruptibleSleep(runtimeConfig.loopIntervalMs, market);
      continue;
    }

    for (const sym of context.activeSymbols) {
      await runSymbolStrategy(
        sym,
        context.positions,
        context.lastPrices,
        marketClient,
        marketConfig,
        config.KILL_SWITCH,
        false,
        runtimeConfig.CANDLE_RED_TRIGGER_PCT ?? CANDLE_RED_TRIGGER_PCT,
        runtimeConfig.CANDLE_EXIT_ENABLED ?? marketConfig.USE_CANDLE_EXIT,
        runtimeConfig.activeStrategyId,
        market,
        logger
      );
    }

    await logPortfolio(market, context);

    saveState(
      {
        positions: context.positions,
        activeStrategyId: runtimeConfig.activeStrategyId,
        runtimeConfig: buildRuntimeConfigSnapshot(runtimeConfig),
        settings: loadSettings().settings,
        lastUpdateTs: Date.now(),
      },
      market
    );

    const waitSec = runtimeConfig.loopIntervalMs / 1000;
    logger(`---- wait ${waitSec.toFixed(0)} sec ----`);
    await interruptibleSleep(runtimeConfig.loopIntervalMs, market);
  }
}

// =======================
// START HTTP + BOT
// =======================
startHttpServer(shared);
runMarketLoop("crypto");
runMarketLoop("stocks");


