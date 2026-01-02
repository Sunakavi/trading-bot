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
const { getTradingPlan } = require("./portfolioManager");
const { canOpenPosition } = require("./riskEngine");
const {
  resolveExitPresetById,
  normalizeLayerId,
} = require("./strategyRegistry");
const { StrategyPortfolioConfig } = require("./strategyPortfolio.config");
const { IexProvider } = require("./providers/iexProvider");
const { AlpacaBroker } = require("./brokers/alpacaBroker");
const { MarketSessionGate } = require("./session/marketSessionGate");
const { setupKeypressListener } = require("./input");
const { getStats } = require("./tradeHistory");
const {
  detectMarketRegime,
  applyRegimeLock,
  buildRegimeSettings,
} = require("./marketRegimeEngine");
const {
  resolveExitPresetConfig,
  getExitPresetById,
} = require("./exitPresetRegistry");
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

const stocksDataProvider = new IexProvider({
  dataClient: stocksClient,
  config: StrategyPortfolioConfig,
  logger: marketLoggers.stocks,
});

const stocksBroker = new AlpacaBroker({ tradingClient: stocksClient });
const stocksSessionGate = new MarketSessionGate({ dataProvider: stocksDataProvider });

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

function formatRegimeNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function formatRegimePercent(value, digits = 2) {
  return Number.isFinite(value) ? `${value.toFixed(digits)}%` : "n/a";
}

const ENTRY_PRESET_IDS = {
  TREND_CONSERVATIVE: 101,
  TREND_AGGRESSIVE: 102,
  SWING_PULLBACK: 104,
  BREAKOUT: 105,
  SCALPING: 103,
};

function pickRegimeStrategyPack(detection) {
  const cfg = detection?.config || {};
  const metrics = detection?.metrics || {};
  const regime = detection?.regime;
  const packs = cfg.STRATEGY_PACKS || {};

  const trendPack = packs.TREND || {
    entryStrategyId: ENTRY_PRESET_IDS.TREND_CONSERVATIVE,
    exitPresetId: 1,
  };
  const rangePack = packs.RANGE || {
    entryStrategyId: ENTRY_PRESET_IDS.SCALPING,
    exitPresetId: 3,
  };
  const breakoutPack = packs.BREAKOUT || {
    entryStrategyId: ENTRY_PRESET_IDS.BREAKOUT,
    exitPresetId: 7,
  };

  if (regime === "BREAKOUT") {
    return { ...breakoutPack, selection: "BREAKOUT" };
  }

  if (regime === "TREND") {
    const slope = Number(metrics.slopePct);
    const atrRatio = Number(metrics.atrRatio);
    const rsi = Number(metrics.rsi);
    const trendStrong =
      Number.isFinite(slope) && slope >= Number(cfg.SLOPE_TREND_MIN || 0) * 2;
    const atrStrong =
      Number.isFinite(atrRatio) &&
      atrRatio >= Number(cfg.ATR_RATIO_TREND_MAX || 0);
    const pullbackWindow =
      Number.isFinite(rsi) &&
      rsi <= Number(cfg.RSI_TREND_MIN || 0) + 2;

    if (pullbackWindow) {
      return {
        entryStrategyId: ENTRY_PRESET_IDS.SWING_PULLBACK,
        exitPresetId: 6,
        selection: "PULLBACK_OPPORTUNITY",
      };
    }
    if (trendStrong || atrStrong) {
      return {
        entryStrategyId: ENTRY_PRESET_IDS.TREND_AGGRESSIVE,
        exitPresetId: 4,
        selection: "TREND_STRONG",
      };
    }

    return { ...trendPack, selection: "TREND_STABLE" };
  }

  if (regime === "RANGE") {
    const atrRatio = Number(metrics.atrRatio);
    const rangeMax = Number(cfg.ATR_RATIO_RANGE_MAX || 0);
    const lowVol = Number.isFinite(atrRatio) && atrRatio <= rangeMax * 0.9;
    if (lowVol) {
      return { ...rangePack, selection: "RANGE_LOW_VOL" };
    }
    return {
      blockReason: "range volatility too high",
      selection: "RANGE_HIGH_VOL",
    };
  }

  return {
    blockReason: detection?.reason || "no trade",
    selection: "NO_TRADE",
  };
}

function describeExitPreset(exitPresetId) {
  const preset = getExitPresetById(exitPresetId);
  if (!preset) return exitPresetId != null ? String(exitPresetId) : "n/a";
  return `${preset.id} (${preset.name})`;
}

function countOpenPositions(positions = {}) {
  return Object.values(positions).filter((pos) => pos?.hasPosition).length;
}


const POSITION_DEFAULTS = {
  hasPosition: false,
  entryPrice: 0,
  qty: 0,
  maxPrice: 0,
  layerId: null,
  strategyId: null,
  entryPresetId: null,
  exitPresetId: null,
  riskAllocatedUSD: null,
  openedAt: null,
  cooldownUntil: null,
  entryBarTs: null,
  lastEvaluatedAt: null,
  initialStop: null,
  trailingStop: null,
  entryAtr: null,
  entryR: null,
  breakoutLevel: null,
};

function normalizePositionState(pos) {
  return { ...POSITION_DEFAULTS, ...(pos || {}) };
}

function computeEquityFromAccount(accountData, quote, lastPrices = {}) {
  if (!accountData) return 0;
  const balances = Array.isArray(accountData.balances) ? accountData.balances : [];
  const cashBal = balances.find((b) => b.asset === quote);
  const cash = cashBal ? Number(cashBal.free || 0) + Number(cashBal.locked || 0) : 0;

  const positions = Array.isArray(accountData.positions) ? accountData.positions : [];
  let positionsValue = 0;
  positions.forEach((pos) => {
    const marketValue = Number(pos.market_value || pos.marketValue || 0);
    if (Number.isFinite(marketValue) && marketValue > 0) {
      positionsValue += marketValue;
      return;
    }
    const qty = Number(pos.qty || pos.quantity || 0);
    const currentPrice = Number(pos.current_price || pos.currentPrice || 0);
    const fallbackPrice = Number(lastPrices[pos.symbol] || 0);
    const price = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : fallbackPrice;
    if (Number.isFinite(qty) && Number.isFinite(price)) {
      positionsValue += qty * price;
    }
  });

  return cash + positionsValue;
}

function getFreeCashFromAccount(accountData, quote) {
  if (!accountData) return 0;
  const balances = Array.isArray(accountData.balances) ? accountData.balances : [];
  const cashBal = balances.find((b) => b.asset === quote);
  return cashBal ? Number(cashBal.free || 0) : 0;
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
  const { marketClient, marketConfig, broker, logger } = context;
  try {
    const account = broker?.getAccount
      ? await broker.getAccount()
      : await marketClient.getAccount();
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
  const { marketConfig, marketClient, broker, logger } = context;
  const quote = marketConfig.QUOTE;
  const symbols = new Set([
    ...context.activeSymbols,
    ...Object.keys(context.positions),
  ]);

  for (const sym of symbols) {
    try {
      if (broker?.sellMarketAll) {
        await broker.sellMarketAll(sym, quote);
      } else {
        await marketClient.sellMarketAll(sym, quote);
      }
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
  const nextOpenRaw = clock?.next_open || clock?.nextOpen;
  const nextCloseRaw = clock?.next_close || clock?.nextClose;
  const nextOpen = nextOpenRaw ? Date.parse(nextOpenRaw) : NaN;
  const nextClose = nextCloseRaw ? Date.parse(nextCloseRaw) : NaN;
  const now = Date.now();
  const countdownSec = Number.isFinite(nextOpen)
    ? Math.max(0, Math.floor((nextOpen - now) / 1000))
    : null;

  marketShared.marketClock = {
    isOpen: !!(clock?.is_open ?? clock?.isOpen),
    nextOpen: nextOpenRaw || null,
    nextClose: nextCloseRaw || null,
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
  const dataProvider = market === "stocks" ? stocksDataProvider : marketClient;
  const broker = market === "stocks" ? stocksBroker : marketClient;
  const runtimeConfig = market === "stocks" ? runtimeConfigStocks : runtimeConfigCrypto;
  const marketConfig = marketConfigs[market];
  const marketShared = shared.markets[market];
  const resolveActiveMarket = () =>
    config.MARKET_TYPE === "stocks" ? "stocks" : "crypto";

  const context = {
    market,
    positions: {},
    activeSymbols: [],
    lastPrices: {},
    marketClient,
    broker,
    dataProvider,
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
          nextPositions[sym] = normalizePositionState(persisted.positions[sym]);
        });
        context.positions = nextPositions;
        context.activeSymbols = keys;
      }
    }

    logger(COLORS.PURPLE + "[STATE] Restored previous state" + COLORS.RESET);
  }

  while (true) {
    marketShared.activeStrategyId = runtimeConfig.activeStrategyId;
    marketShared.openPositions = countOpenPositions(context.positions);

    if (resolveActiveMarket() !== market) {
      marketShared.interruptNow = false;
      await sleep(1000);
      continue;
    }

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
          portfolio: context.portfolio?.statePatch?.portfolio,
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

    let marketOpen = true;
    if (market === "stocks") {
      try {
        const clock = await stocksSessionGate.getSession();
        updateMarketClock(marketShared, clock);

        if (!clock?.isOpen) {
          marketOpen = false;
          const countdown = marketShared.marketClock.countdown || "--:--:--";
          const nextOpen = clock?.nextOpen || "unknown";
          logger(
            `[STOCKS] MARKET CLOSED | opens in ${countdown} | next_open=${nextOpen} ET`
          );
        }
      } catch (err) {
        logger(
          COLORS.YELLOW + "[MARKET] Clock check failed, continuing loop." + COLORS.RESET,
          err.response?.data || err.message
        );
      }

      const today = new Date().toISOString().slice(0, 10);
      if (context.lastUniverseRefresh !== today) {
        try {
          const refreshed = await dataProvider.listUniverse();
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
            context.lastUniverseRefresh = today;
          } else {
            logger(
              COLORS.YELLOW + "[STOCKS] Universe refresh returned 0 symbols" + COLORS.RESET
            );
          }
        } catch (err) {
          logger(
            COLORS.YELLOW + "[STOCKS] Universe refresh failed:" + COLORS.RESET,
            err.response?.data || err.message
          );
        }
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

    let entryStrategyId = runtimeConfig.activeStrategyId;
    let selectedExitPresetId = null;
    let allowEntriesByRegime = true;
    let exitConfigResolver = null;

    if (market === "crypto") {
      const settingsSnapshot = loadSettings().settings;
      const regimeSettings =
        settingsSnapshot?.REGIME_ENGINE || config.REGIME_ENGINE || {};
      const regimeConfig = buildRegimeSettings(regimeSettings);
      let proxyCandles = [];
      try {
        proxyCandles = await dataProvider.fetchKlines(
          regimeConfig.REGIME_PROXY_SYMBOL,
          regimeConfig.TIMEFRAME,
          marketConfig.KLINES_LIMIT
        );
      } catch (err) {
        logger(
          COLORS.YELLOW + "[REGIME] Proxy candles failed:" + COLORS.RESET,
          err.response?.data || err.message
        );
      }

      const detection = detectMarketRegime(proxyCandles, regimeConfig);
      const lock = applyRegimeLock(
        marketShared.regimeState || {},
        detection,
        detection.config
      );

      const appliedRegime = lock.currentRegime;
      const mode = detection.config.MODE;
      const pack = pickRegimeStrategyPack(detection);
      let blockReason = null;
      if (mode === "AUTO") {
        if (appliedRegime === "NO_TRADE" || pack?.blockReason) {
          allowEntriesByRegime = false;
          blockReason = pack?.blockReason || detection.reason || "no trade";
        } else if (pack?.entryStrategyId && pack?.exitPresetId) {
          entryStrategyId = pack.entryStrategyId;
          selectedExitPresetId = pack.exitPresetId;
        } else {
          allowEntriesByRegime = false;
          blockReason = "strategy pack missing";
        }

        runtimeConfig.activeStrategyId = entryStrategyId;
        marketShared.activeStrategyId = entryStrategyId;
      }

      const baseExitConfig = {
        SL_PCT: runtimeConfig.SL_PCT ?? marketConfig.SL_PCT,
        TP_PCT: runtimeConfig.TP_PCT ?? marketConfig.TP_PCT,
        TRAIL_START_PCT:
          runtimeConfig.TRAIL_START_PCT ?? marketConfig.TRAIL_START_PCT,
        TRAIL_DISTANCE_PCT:
          runtimeConfig.TRAIL_DISTANCE_PCT ?? marketConfig.TRAIL_DISTANCE_PCT,
        CANDLE_EXIT_ENABLED:
          runtimeConfig.CANDLE_EXIT_ENABLED ?? marketConfig.USE_CANDLE_EXIT,
        CANDLE_RED_TRIGGER_PCT:
          runtimeConfig.CANDLE_RED_TRIGGER_PCT ?? CANDLE_RED_TRIGGER_PCT,
      };
      exitConfigResolver = (presetId) =>
        resolveExitPresetConfig(presetId, baseExitConfig);
      const resolvedExitConfig = selectedExitPresetId
        ? exitConfigResolver(selectedExitPresetId)
        : baseExitConfig;

      marketShared.regimeState = {
        currentRegime: lock.currentRegime,
        holdCount: lock.holdCount,
        lockStatus: lock.lockStatus,
        detectedRegime: detection.regime,
        confidence: detection.confidence,
        mode,
        reason: detection.reason,
        blockReason,
        selection: pack?.selection || null,
        checks: detection.checks || {},
        metrics: detection.metrics || {},
        proxySymbol: detection.config.REGIME_PROXY_SYMBOL,
        timeframe: detection.config.TIMEFRAME,
        entryStrategyId,
        exitPresetId: selectedExitPresetId,
        allowEntries: allowEntriesByRegime,
        exitConfig: resolvedExitConfig,
        updatedAt: Date.now(),
      };

      const metrics = detection.metrics || {};
      const confidence = Number.isFinite(detection.confidence)
        ? detection.confidence.toFixed(2)
        : "n/a";
      const holdNote = `${lock.holdCount}/${detection.config.REGIME_MIN_HOLD_CANDLES}`;
      const reasonNote =
        detection.reason && detection.reason !== "matched"
          ? ` reason=${detection.reason}`
          : "";

      logger(
        `[REGIME] detected=${detection.regime} applied=${appliedRegime} confidence=${confidence} lock=${lock.lockStatus} hold=${holdNote}${reasonNote}`
      );
      logger(
        `[REGIME] metrics ATR_ratio=${formatRegimeNumber(
          metrics.atrRatio
        )} VOL_ratio=${formatRegimeNumber(
          metrics.volumeRatio
        )} slope=${formatRegimePercent(metrics.slopePct, 3)} RSI=${formatRegimeNumber(
          metrics.rsi,
          0
        )}`
      );

      if (mode === "AUTO") {
        logger(
          `[REGIME] mode=AUTO entry=${entryStrategyId} exit=${describeExitPreset(
            selectedExitPresetId
          )}`
        );
      } else {
        logger(`[REGIME] mode=MANUAL entry=${entryStrategyId} exit=MANUAL`);
      }

      if (!allowEntriesByRegime) {
        logger(`[REGIME] TRADE BLOCKED - ${blockReason || "NO_TRADE"}`);
      }
    }

    let portfolioPlan = null;
    let accountSnapshot = null;
    let equity = 0;
    let freeCash = 0;

    if (market === "stocks") {
      try {
        accountSnapshot = await broker.getAccount();
        equity = computeEquityFromAccount(
          accountSnapshot,
          marketConfig.QUOTE,
          context.lastPrices
        );
        freeCash = getFreeCashFromAccount(accountSnapshot, marketConfig.QUOTE);

        const alpacaEquityRaw = Number(accountSnapshot?.account?.equity);
        const alpacaEquity = Number.isFinite(alpacaEquityRaw)
          ? alpacaEquityRaw
          : equity;

        marketShared.alpacaStatus = {
          connected: true,
          baseUrl: marketClient.tradingBaseUrl,
          lastCheckTs: Date.now(),
          lastError: null,
          equity: alpacaEquity,
        };

        logger(
          `[ALPACA] Connected ${marketClient.tradingBaseUrl} | Equity=${alpacaEquity.toFixed(
            2
          )} ${marketConfig.QUOTE}`
        );
      } catch (err) {
        marketShared.alpacaStatus = {
          connected: false,
          baseUrl: marketClient.tradingBaseUrl,
          lastCheckTs: Date.now(),
          lastError: err.response?.data || err.message,
          equity: null,
        };
        logger(
          COLORS.YELLOW + "[PORTFOLIO] Account fetch failed:" + COLORS.RESET,
          err.response?.data || err.message
        );
      }

      const benchmarkSymbol = context.activeSymbols.includes("SPY")
        ? "SPY"
        : context.activeSymbols[0];
      let regimeCandles = [];
      if (benchmarkSymbol) {
        try {
          regimeCandles = await dataProvider.getBars(
            benchmarkSymbol,
            "1h",
            marketConfig.KLINES_LIMIT
          );
        } catch (err) {
          logger(
            COLORS.YELLOW + "[PORTFOLIO] Regime candles failed:" + COLORS.RESET,
            err.response?.data || err.message
          );
        }
      }

      const latestState = loadState(market) || {};
      portfolioPlan = getTradingPlan({
        market,
        equity,
        positions: context.positions,
        lastPrices: context.lastPrices,
        state: latestState,
        settings: loadSettings().settings,
        config: marketConfig,
        candles: regimeCandles,
        now: Date.now(),
      });
      context.portfolio = portfolioPlan;
    }

    if (market === "stocks" && portfolioPlan) {
      const enabledLayers = portfolioPlan.enabledLayers || [];
      const layerConfigsById = portfolioPlan.layerConfigsById || {};
      const exitPresetMap = portfolioPlan.exitPresetMap || {};
      const entryPresetMap = portfolioPlan.entryPresetMap || {};
      const exitConfigResolver = (presetId) =>
        resolveExitPresetById(exitPresetMap, presetId);

      const globalMaxOpenPositions = Object.values(layerConfigsById).reduce(
        (sum, layer) => sum + (Number(layer?.maxOpenPositions) || 0),
        0
      );

      for (const sym of context.activeSymbols) {
        const pos = normalizePositionState(context.positions[sym]);
        context.positions[sym] = pos;

        if (pos.hasPosition && !pos.layerId) {
          const fallbackLayer = enabledLayers[0] || Object.keys(layerConfigsById)[0];
          pos.layerId = fallbackLayer || "CORE";
        }

        const posLayerId = normalizeLayerId(pos.layerId);
        if (pos.hasPosition) {
          const layerId = posLayerId || enabledLayers[0];
          const layerConfig = layerConfigsById[layerId];
          const strategyId = layerConfig
            ? (portfolioPlan.layerStrategy[layerId] || runtimeConfig.activeStrategyId)
            : runtimeConfig.activeStrategyId;
          const exitPreset = portfolioPlan.layerExit[layerId] || {};
          const entryPreset = portfolioPlan.layerEntry[layerId] || {};
          const entryPresetResolved =
            entryPresetMap[entryPreset.entryPresetId] || entryPreset.entryPreset;
          if (!pos.strategyId) pos.strategyId = strategyId;
          if (!pos.entryPresetId) pos.entryPresetId = entryPreset.entryPresetId || null;
          if (!pos.exitPresetId) pos.exitPresetId = exitPreset.exitPresetId || null;
          if (!pos.openedAt) pos.openedAt = Date.now();

          await runSymbolStrategy(
            sym,
            context.positions,
            context.lastPrices,
            dataProvider,
            broker,
            marketConfig,
            config.KILL_SWITCH,
            false,
            runtimeConfig.CANDLE_RED_TRIGGER_PCT ?? CANDLE_RED_TRIGGER_PCT,
            runtimeConfig.CANDLE_EXIT_ENABLED ?? marketConfig.USE_CANDLE_EXIT,
            strategyId,
            market,
            logger,
            {
              allowEntries: false,
              layerId,
              strategyId,
              entryPresetId: entryPreset.entryPresetId,
              entryPreset: entryPresetResolved,
              timeframe: layerConfig?.timeframe,
              exitPresetId: pos.exitPresetId || exitPreset.exitPresetId,
              exitConfig: exitPreset.exitConfig,
              exitPreset: exitPresetMap[exitPreset.exitPresetId],
              exitConfigResolver,
            }
          );
          continue;
        }

        if (!enabledLayers.length) {
          await runSymbolStrategy(
            sym,
            context.positions,
            context.lastPrices,
            dataProvider,
            broker,
            marketConfig,
            config.KILL_SWITCH,
            false,
            runtimeConfig.CANDLE_RED_TRIGGER_PCT ?? CANDLE_RED_TRIGGER_PCT,
            runtimeConfig.CANDLE_EXIT_ENABLED ?? marketConfig.USE_CANDLE_EXIT,
            runtimeConfig.activeStrategyId,
            market,
            logger,
            { allowEntries: false }
          );
          continue;
        }

        for (const layerId of enabledLayers) {
          const layerConfig = layerConfigsById[layerId];
          const layerState = portfolioPlan.layerStates[layerId];
          const allowance = canOpenPosition({
            layerId,
            layerConfig,
            layerState,
            positions: context.positions,
            lastPrices: context.lastPrices,
            equity,
            globalMaxOpenPositions,
            globalRisk: StrategyPortfolioConfig.globalRisk,
          });

          if (!allowance.allowed) {
            continue;
          }

          const layerBudget = portfolioPlan.layerBudgets[layerId];
          const maxRiskUsd =
            equity *
            (Number(layerConfig?.allocationPct) || 0) *
            ((Number(layerConfig?.maxRiskPerTradePct) || 0) / 100);
          const orderBudget = Math.min(layerBudget?.availableUsd || 0, maxRiskUsd);
          const orderFraction = freeCash > 0 ? Math.min(1, orderBudget / freeCash) : 0;
          const strategyId = portfolioPlan.layerStrategy[layerId] || runtimeConfig.activeStrategyId;
          const exitPreset = portfolioPlan.layerExit[layerId] || {};
          const entryPreset = portfolioPlan.layerEntry[layerId] || {};
          const entryPresetResolved =
            entryPresetMap[entryPreset.entryPresetId] || entryPreset.entryPreset;
          if (!pos.strategyId) pos.strategyId = strategyId;
          if (!pos.entryPresetId) pos.entryPresetId = entryPreset.entryPresetId || null;
          if (!pos.exitPresetId) pos.exitPresetId = exitPreset.exitPresetId || null;
          if (!pos.openedAt) pos.openedAt = Date.now();

          await runSymbolStrategy(
            sym,
            context.positions,
            context.lastPrices,
            dataProvider,
            broker,
            marketConfig,
            config.KILL_SWITCH,
            false,
            runtimeConfig.CANDLE_RED_TRIGGER_PCT ?? CANDLE_RED_TRIGGER_PCT,
            runtimeConfig.CANDLE_EXIT_ENABLED ?? marketConfig.USE_CANDLE_EXIT,
            strategyId,
            market,
            logger,
            {
              allowEntries: orderFraction > 0 && marketOpen,
              orderFraction,
              layerId,
              strategyId,
              entryPresetId: entryPreset.entryPresetId,
              entryPreset: entryPresetResolved,
              timeframe: layerConfig?.timeframe,
              exitPresetId: pos.exitPresetId || exitPreset.exitPresetId,
              exitConfig: exitPreset.exitConfig,
              exitPreset: exitPresetMap[exitPreset.exitPresetId],
              exitConfigResolver,
              riskAllocatedUSD: maxRiskUsd,
            }
          );

          if (context.positions[sym]?.hasPosition) {
            break;
          }
        }
      }
    } else {
      for (const sym of context.activeSymbols) {
        const pos = normalizePositionState(context.positions[sym]);
        context.positions[sym] = pos;
        const effectiveExitPresetId = pos.hasPosition
          ? pos.exitPresetId || null
          : selectedExitPresetId;

        await runSymbolStrategy(
          sym,
          context.positions,
          context.lastPrices,
          dataProvider,
          broker,
          marketConfig,
          config.KILL_SWITCH,
          false,
          runtimeConfig.CANDLE_RED_TRIGGER_PCT ?? CANDLE_RED_TRIGGER_PCT,
          runtimeConfig.CANDLE_EXIT_ENABLED ?? marketConfig.USE_CANDLE_EXIT,
          entryStrategyId,
          market,
          logger,
          {
            allowEntries: allowEntriesByRegime && marketOpen,
            strategyId: entryStrategyId,
            exitPresetId: effectiveExitPresetId,
            exitConfigResolver: exitConfigResolver || undefined,
          }
        );
      }
    }

    await logPortfolio(market, context);

    saveState(
      {
        positions: context.positions,
        activeStrategyId: runtimeConfig.activeStrategyId,
        runtimeConfig: buildRuntimeConfigSnapshot(runtimeConfig),
        settings: loadSettings().settings,
        portfolio: context.portfolio?.statePatch?.portfolio,
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




