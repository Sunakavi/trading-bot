// strategy.js

const {
  calcSMA,
  calcEMA,
  calcRSI,
  calcATR,
  calcADX,
  calcVWAP,
  calcVolumeMA,
  getHighestHigh,
  isBullishEngulfing,
  isBullishHammer,
} = require("./utils");
const { log } = require("./log");
const { COLORS } = require("./config");
const { addTrade } = require("./tradeHistory");
const {
  shouldEvaluate,
  getCandleTimestamp,
} = require("./timeframeResolver");


/**
 * Initializes the position state for a list of symbols.
 */
function initPositions(symbols) {
  const positions = {};
  symbols.forEach((s) => {
    positions[s] = {
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
  });
  return positions;
}

// =========================================================
// STRATEGY 1: GOLDEN CROSS (SMA 12 / SMA 50)
// =========================================================

// STRATEGY 1: GOLDEN CROSS (uses config.FAST_MA / config.SLOW_MA)

function checkEntryGoldenCross(closes, maFastPeriod, maSlowPeriod, logFn = log) {
  const fastNow = calcSMA(closes, maFastPeriod);
  const slowNow = calcSMA(closes, maSlowPeriod);
  const fastPrev = calcSMA(closes.slice(0, -1), maFastPeriod);
  const slowPrev = calcSMA(closes.slice(0, -1), maSlowPeriod);

  if (!fastNow || !slowNow || !fastPrev || !slowPrev) return false;

  // Golden Cross: fast MA crosses above slow MA
  const isGoldenCross = fastPrev <= slowPrev && fastNow > slowNow;

  logFn(
    `[Entry 1 Check] fastMA=${fastNow.toFixed(
      3
    )}, slowMA=${slowNow.toFixed(3)}, Cross=${isGoldenCross}`
  );

  return isGoldenCross;
}


// =========================================================
// STRATEGY 2: TREND/PULLBACK/RSI (Your Original Logic)
// =========================================================

function checkEntryTrendPullback(
  candles,
  closes,
  maFast,
  maSlow,
  rsi,
  config,
  logFn = log
) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  
  // Trend Filter
  const trendUp = maFast > maSlow && last.close > maSlow;

  // Pullback Filter – מותאם ל-15m
  const pullback =
    prev.low < maFast * 1.008 &&   // עד ~0.8% מתחת ל-MA
    last.close > maFast * 0.996;   // חזרה לסגור קרוב ל-MA (עד ~0.4% מתחת

  // RSI Filter
  const rsiOk =
    rsi !== null && rsi >= config.RSI_MIN && rsi <= config.RSI_MAX;

  // Candle Pattern
  const candleOk =
    isBullishEngulfing(prev, last) || isBullishHammer(last);

  const isEntryConditionMet =
    trendUp &&
    pullback &&
    rsiOk &&
    (config.REQUIRE_CANDLE_PATTERN ? candleOk : true);
    
  logFn(
    `[Entry 2 Check] Trend=${trendUp}, Pullback=${pullback}, RSI=${rsi?.toFixed(0) || "N/A"}`
  );
    
  return isEntryConditionMet;
}

// =========================================================
// STRATEGY 3: EMA 9/21 with Volatility Filter
// =========================================================

function checkEntryEmaVolume(candles, config, logFn = log) {
  const last = candles[candles.length - 1];
  const closes = candles.map(c => c.close);
  
  // Note: We are using periods 9 and 21 for this strategy
  const EMA9 = calcEMA(closes, 9);
  const EMA21 = calcEMA(closes, 21);
  const prevEMA9 = calcEMA(closes.slice(0, -1), 9);
  const prevEMA21 = calcEMA(closes.slice(0, -1), 21);
  const ATR = calcATR(candles, 14);

  if (!EMA9 || !EMA21 || !prevEMA9 || !prevEMA21 || !ATR) return false;
  
  // 1. Crossover: EMA 9 crosses above EMA 21
  const isCrossover = prevEMA9 <= prevEMA21 && EMA9 > EMA21;
  
  // 2. Trend: Price is above the EMA 21
  const isAboveEMA = last.close > EMA21;
  
  // 3. Volatility Filter: Ensure current candle size is meaningful (e.g., body > 0.5 * ATR)
  const lastBody = Math.abs(last.close - last.open);
  const volatilityOk = lastBody > 0.7 * ATR; 
  
  logFn(
    `[Entry 3 Check] Cross=${isCrossover}, AboveEMA=${isAboveEMA}, Volatility=${volatilityOk} (ATR=${ATR.toFixed(4)})`
  );
  
  return isCrossover && isAboveEMA && volatilityOk;
}

function evaluateCoreEntry(candles, preset, logFn = log) {
  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!last || !prev) return false;

  const emaFast = calcEMA(closes, preset.emaFast);
  const emaSlow = calcEMA(closes, preset.emaSlow);
  const adx = calcADX(candles, preset.adxPeriod);
  const rsi = calcRSI(closes, preset.rsiPeriod);

  if (!emaFast || !emaSlow || !adx || rsi === null) return false;

  const trendOk = emaFast > emaSlow && last.close > emaFast;
  const adxOk = adx >= preset.adxMin;
  const rsiOk = rsi >= preset.rsiMin && rsi <= preset.rsiMax;

  const pullback =
    preset.pullbackToEma &&
    prev.close < emaFast &&
    last.close > emaFast;

  const entryOk = trendOk && adxOk && rsiOk && pullback;

  logFn(
    `[Entry CORE] trend=${trendOk} adx=${adx.toFixed(
      1
    )} rsi=${rsi.toFixed(0)} pullback=${pullback}`
  );

  return entryOk;
}

function evaluateSwingEntry(candles, preset, logFn = log) {
  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];

  const emaFast = calcEMA(closes, preset.emaFast);
  const emaSlow = calcEMA(closes, preset.emaSlow);
  const rsi = calcRSI(closes, preset.rsiPeriod);
  const atr = calcATR(candles, preset.atrPeriod);
  const swingHigh = getHighestHigh(candles.slice(0, -1), preset.swingLookback);

  if (!emaFast || !emaSlow || rsi === null || !atr || !swingHigh) return false;

  const trendOk = emaFast > emaSlow;
  const pullbackPct = ((swingHigh - last.close) / swingHigh) * 100;
  const pullbackOk =
    pullbackPct >= preset.pullbackMinPct &&
    pullbackPct <= preset.pullbackMaxPct;
  const rsiOk = rsi >= preset.rsiMin && rsi <= preset.rsiMax;
  const atrPct = (atr / last.close) * 100;
  const atrOk = atrPct >= preset.atrPctMin && atrPct <= preset.atrPctMax;

  const reclaim =
    prev.close <= emaFast &&
    last.close > emaFast &&
    last.close > last.open;

  const entryOk = trendOk && pullbackOk && rsiOk && atrOk && reclaim;

  logFn(
    `[Entry SWING] trend=${trendOk} pullback=${pullbackPct.toFixed(
      2
    )}% rsi=${rsi.toFixed(0)} atrPct=${atrPct.toFixed(2)} reclaim=${reclaim}`
  );

  return entryOk;
}

function evaluateAggressiveEntry(candles, preset, logFn = log) {
  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];
  const ema = calcEMA(closes, preset.emaPeriod);
  const emaPrev = calcEMA(closes.slice(0, -1), preset.emaPeriod);
  const rsi = calcRSI(closes, preset.rsiPeriod);
  const vwap = calcVWAP(candles);
  const breakoutHigh = getHighestHigh(
    candles.slice(0, -1),
    preset.breakoutLookback
  );
  const volMa = calcVolumeMA(candles, preset.volumeMaPeriod);

  if (!ema || emaPrev === null || rsi === null || !breakoutHigh || !volMa) {
    return { enter: false, breakoutLevel: null };
  }

  const emaRising = ema > emaPrev;
  const vwapOk = vwap ? last.close > vwap : false;
  const trendOk = vwapOk || emaRising;
  const breakoutOk = last.close > breakoutHigh;
  const volOk = last.volume >= preset.volumeMultiplier * volMa;
  const rsiOk = rsi >= preset.rsiMin && rsi <= preset.rsiMax;

  const entryOk = trendOk && breakoutOk && volOk && rsiOk;

  logFn(
    `[Entry AGGR] trend=${trendOk} breakout=${breakoutOk} vol=${volOk} rsi=${rsi.toFixed(
      0
    )}`
  );

  return { enter: entryOk, breakoutLevel: breakoutHigh };
}


// =========================================================
// CORE EXECUTION FUNCTION
// =========================================================

async function runSymbolStrategy(
  symbol,
  positions,
  lastPrices,
  dataProvider,
  broker,
  config,
  killSwitch,
  sellSwitch,
  candleRedTriggerPct,
  candleExitEnabled,
  activeStrategyId,
  market,
  logFn = log,
  options = {}
) {
  try {
    const logger = typeof logFn === "function" ? logFn : log;
    const log = logger;
    const allowEntries = options.allowEntries !== false;
    const entryStrategyId =
      Number(options.strategyId) || Number(activeStrategyId) || 2;
    const entryPresetId = options.entryPresetId || null;
    const entryPreset = options.entryPreset || null;
    const exitPresetId = options.exitPresetId || null;
    const exitPreset = options.exitPreset || null;
    const timeframe = options.timeframe || config.INTERVAL;
    const requestedOrderFraction = Number(options.orderFraction);
    const orderFraction =
      Number.isFinite(requestedOrderFraction) && requestedOrderFraction > 0
        ? requestedOrderFraction
        : Number(config.QUOTE_ORDER_FRACTION) || 0;
    const exitConfig =
      options.exitConfigResolver && options.exitPresetId
        ? options.exitConfigResolver(options.exitPresetId)
        : options.exitConfig;
    const resolvedExitConfig = {
      SL_PCT: Number(exitConfig?.SL_PCT ?? config.SL_PCT),
      TP_PCT: Number(exitConfig?.TP_PCT ?? config.TP_PCT),
      TRAIL_START_PCT: Number(exitConfig?.TRAIL_START_PCT ?? config.TRAIL_START_PCT),
      TRAIL_DISTANCE_PCT: Number(
        exitConfig?.TRAIL_DISTANCE_PCT ?? config.TRAIL_DISTANCE_PCT
      ),
      CANDLE_EXIT_ENABLED: Boolean(
        exitConfig?.CANDLE_EXIT_ENABLED ?? candleExitEnabled
      ),
      CANDLE_RED_TRIGGER_PCT: Number(
        exitConfig?.CANDLE_RED_TRIGGER_PCT ?? candleRedTriggerPct
      ),
    };
    const candles = dataProvider.getBars
      ? await dataProvider.getBars(symbol, timeframe, config.KLINES_LIMIT)
      : await dataProvider.fetchKlines(symbol, timeframe, config.KLINES_LIMIT);

    const minRequired = Math.max(
      config.SLOW_MA,
      entryPreset?.emaSlow || 0,
      entryPreset?.emaFast || 0,
      entryPreset?.emaPeriod || 0,
      entryPreset?.swingLookback || 0,
      entryPreset?.breakoutLookback || 0,
      exitPreset?.trendExitSlowEma || 0,
      exitPreset?.trendExitFastEma || 0,
      exitPreset?.atrPeriod ? exitPreset.atrPeriod + 1 : 0
    );

    if (!candles || candles.length < minRequired) {
      logger(
        `[${symbol}] NOT ENOUGH CANDLES: have=${
          candles ? candles.length : 0
        }, need=${minRequired}`
      );
      positions[symbol] = positions[symbol] || { hasPosition: false, entryPrice: 0, qty: 0, maxPrice: 0, };
      return;
    }

    const closes = candles.map((c) => c.close);
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    lastPrices[symbol] = last.close;

    if (!shouldEvaluate(candles, positions[symbol], timeframe)) {
      positions[symbol] = positions[symbol] || {
        hasPosition: false,
        entryPrice: 0,
        qty: 0,
        maxPrice: 0,
      };
      return;
    }

    // Calculate TAs needed for multiple strategies
    const maFast = calcSMA(closes, config.FAST_MA);
    const maSlow = calcSMA(closes, config.SLOW_MA);
    const rsi = calcRSI(closes, config.RSI_PERIOD);

    // Get current position state
    const pos = positions[symbol] || {
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

    if (killSwitch) {
      logger(`[${symbol}] KILL_SWITCH ON – NO TRADES`);
      positions[symbol] = pos;
      return;
    }

    // 1. POSITION MANAGEMENT & EXIT LOGIC 
    if (pos.hasPosition) {
      await handleExit(
        symbol,
        pos,
        candles,
        dataProvider,
        broker,
        config,
        sellSwitch,
        resolvedExitConfig.CANDLE_RED_TRIGGER_PCT,
        resolvedExitConfig.CANDLE_EXIT_ENABLED,
        market,
        logger,
        resolvedExitConfig,
        exitPreset,
        options
      );
    }

    if (!allowEntries) {
      positions[symbol] = pos;
      return;
    }

    // 2. ENTRY LOGIC: Select strategy based on entry preset or legacy strategyId
    let isEntryConditionMet = false;
    let entryBreakoutLevel = null;

    if (entryPreset) {
      if (entryPresetId === "CORE_TREND") {
        isEntryConditionMet = evaluateCoreEntry(candles, entryPreset, logger);
      } else if (entryPresetId === "SWING_PULLBACK") {
        isEntryConditionMet = evaluateSwingEntry(candles, entryPreset, logger);
      } else if (entryPresetId === "AGGR_BREAKOUT") {
        const result = evaluateAggressiveEntry(candles, entryPreset, logger);
        isEntryConditionMet = result.enter;
        entryBreakoutLevel = result.breakoutLevel;
      }
    } else {
      switch (entryStrategyId) {
        case 1:
          isEntryConditionMet = checkEntryGoldenCross(
            closes,
            config.FAST_MA,
            config.SLOW_MA,
            logger
          );
          break;
        case 2:
        case 101: // Conservative Trend Entry
        case 102: // Aggressive Trend Entry
        case 104: // Deep Pullback Entry
        case 107: // MA Slope Entry
          isEntryConditionMet = checkEntryTrendPullback(
            candles,
            closes,
            maFast,
            maSlow,
            rsi,
            config,
            logger
          );
          break;
        case 3:
        case 103: // Scalping Mode
        case 105: // Breakout Entry
        case 106: // Volatility Adaptive Entry (ATR-Based)
        case 108: // EMA + ATR Core (Enhanced Version)
          isEntryConditionMet = checkEntryEmaVolume(candles, config, logger);
          break;
        default:
          log(
            COLORS.RED +
              `[${symbol}] Invalid Strategy ID: ${entryStrategyId}` +
              COLORS.RESET
          );
          return;
      }
    }
    
    // 3. Execute BUY if conditions are met and no position is open
    if (!pos.hasPosition && isEntryConditionMet) {
      log(
        COLORS.GREEN +
          `[${symbol}] → ENTRY SIGNAL: Strategy ${entryStrategyId} HIT` +
          COLORS.RESET
      );

      const result = broker.buyMarket
        ? await broker.buyMarket(symbol, config.QUOTE, orderFraction)
        : await broker.placeOrder?.({
            symbol,
            side: "buy",
            qty: null,
          });

      if (result) {
        // Update state on successful buy
        pos.hasPosition = true;
        pos.entryPrice = result.avgPrice;
        pos.qty = result.executedQty;
        pos.maxPrice = result.avgPrice; // Initial maxPrice
        pos.layerId = options.layerId || pos.layerId;
        pos.strategyId = entryStrategyId;
        pos.entryPresetId = entryPresetId || pos.entryPresetId;
        pos.exitPresetId = exitPresetId || pos.exitPresetId;
        pos.riskAllocatedUSD =
          options.riskAllocatedUSD ?? pos.riskAllocatedUSD ?? null;
        pos.openedAt = Date.now();
        pos.entryBarTs = getCandleTimestamp(last) || Date.now();
        pos.lastEvaluatedAt = getCandleTimestamp(last) || Date.now();
        pos.initialStop = null;
        pos.trailingStop = null;
        pos.entryAtr = null;
        pos.entryR = null;
        if (entryBreakoutLevel) pos.breakoutLevel = entryBreakoutLevel;
      }
    } else if (!pos.hasPosition) {
       log(`[${symbol}] NO POS | Strategy ${entryStrategyId} conditions NOT met.`);
    }

    pos.lastEvaluatedAt = getCandleTimestamp(last) || pos.lastEvaluatedAt;
    // Final state update
    positions[symbol] = pos;
  } catch (err) {
    log(
      COLORS.RED + `[${symbol}] Error:` + COLORS.RESET,
      err.response?.data || err.message
    );
  }
}

async function handleExit(
  symbol,
  pos,
  candles,
  dataProvider,
  broker,
  config,
  sellSwitch,
  candleRedTriggerPct,
  candleExitEnabled,
  market,
  logFn = log,
  exitConfig = null,
  exitPreset = null,
  options = {}
) {
  const logger = typeof logFn === "function" ? logFn : log;
  const log = logger;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!last || !prev) return false;
  const price = last.close;
  const entry = pos.entryPrice;

  // 1. Update maxPrice
  if (price > pos.maxPrice) {
    pos.maxPrice = price;
  }

  // 2. Calculate Exit Levels (Shared Logic)
  const slPct = Number(exitConfig?.SL_PCT ?? config.SL_PCT);
  const tpPct = Number(exitConfig?.TP_PCT ?? config.TP_PCT);
  const trailStartPct = Number(exitConfig?.TRAIL_START_PCT ?? config.TRAIL_START_PCT);
  const trailDistancePct = Number(
    exitConfig?.TRAIL_DISTANCE_PCT ?? config.TRAIL_DISTANCE_PCT
  );

  let baseSL = entry * (1 - slPct);
  let baseTP = entry * (1 + tpPct);
  let dynSL = baseSL;
  let rawExitSignal = false;

  if (exitPreset && exitPreset.initialAtrMult) {
    const atr = calcATR(candles, exitPreset.atrPeriod || 14);
    if (atr) {
      if (!pos.entryAtr) pos.entryAtr = atr;
      const stopDistance = (pos.entryAtr || atr) * exitPreset.initialAtrMult;
      pos.initialStop = pos.initialStop || entry - stopDistance;
      pos.entryR = pos.entryR || stopDistance;

      const r = pos.entryR || stopDistance;
      const tpR = exitPreset.takeProfitR || 0;
      baseSL = pos.initialStop;
      baseTP = tpR > 0 ? entry + r * tpR : null;

      if (exitPreset.trailStartR && price >= entry + r * exitPreset.trailStartR) {
        const trail = price - (pos.entryAtr || atr) * exitPreset.trailAtrMult;
        if (!pos.trailingStop || trail > pos.trailingStop) {
          pos.trailingStop = trail;
        }
      }

      dynSL = pos.trailingStop && pos.trailingStop > baseSL ? pos.trailingStop : baseSL;

      const hitTP = baseTP ? price >= baseTP : false;
      const hitSL = price <= dynSL;
      rawExitSignal = hitTP || hitSL;

      if (exitPreset.trendExitFastEma && exitPreset.trendExitSlowEma) {
        const closes = candles.map((c) => c.close);
        const emaFast = calcEMA(closes, exitPreset.trendExitFastEma);
        const emaSlow = calcEMA(closes, exitPreset.trendExitSlowEma);
        if (emaFast && emaSlow && emaFast < emaSlow) {
          rawExitSignal = true;
        }
      }

      if (exitPreset.timeStopBars) {
        const entryTs = pos.entryBarTs;
        const barsSinceEntry = entryTs
          ? candles.filter((c) => getCandleTimestamp(c) > entryTs).length
          : 0;
        if (barsSinceEntry >= exitPreset.timeStopBars) {
          const minR = exitPreset.timeStopMinR || 0;
          if (price < entry + r * minR) {
            rawExitSignal = true;
          }
        }
      }

      if (exitPreset.invalidationBars && pos.breakoutLevel) {
        const entryTs = pos.entryBarTs;
        const barsSinceEntry = entryTs
          ? candles.filter((c) => getCandleTimestamp(c) > entryTs).length
          : 0;
        if (barsSinceEntry <= exitPreset.invalidationBars) {
          if (price < pos.breakoutLevel) {
            rawExitSignal = true;
          }
        }
      }
    }
  } else {
    // Trailing Stop Logic (legacy)
    if (price >= entry * (1 + trailStartPct)) {
      const trailSL = pos.maxPrice * (1 - trailDistancePct);
      if (trailSL > dynSL) dynSL = trailSL;
    }

    const hitTP = price >= baseTP;
    const hitSL = price <= dynSL;
    rawExitSignal = hitTP || hitSL;
  }
  
  // 4. Candle Confirmation Logic (Your original upgrade)
  const prevBody = Math.abs(prev.close - prev.open);
  const isRed = last.close < last.open;
  const redBody = isRed ? Math.abs(last.close - last.open) : 0;
  
  let candleExitOk = !candleExitEnabled; // אם בדיקת נר כבויה – מאושר אוטומטית
  if (candleExitEnabled) {
    if (isRed && prevBody > 0) {
      if (redBody / prevBody >= candleRedTriggerPct) {
        candleExitOk = true;
      }
    } else if (!isRed) {
      candleExitOk = false;
    }
  }

  // 5. Final Exit Signal: TP/SL triggered AND candle confirms (אם מופעל) OR if emergency SELL_SWITCH is ON
  const exitSignal = (rawExitSignal && candleExitOk) || sellSwitch;

  if (exitSignal) {
    log(
      COLORS.RED +
      `[${symbol}] → EXIT SIGNAL: TP/SL/TRAIL (${rawExitSignal ? "YES" : "NO"}) AND ${
        candleExitEnabled ? "CandleConfirm" : "CandleCheck OFF"
      }/${sellSwitch ? "SELL_SWITCH" : "SW"} (${candleExitOk ? "YES" : "NO"})` +
      COLORS.RESET
    );
    
   const result = broker.sellMarketAll
     ? await broker.sellMarketAll(symbol, config.QUOTE)
     : await broker.placeOrder?.({
         symbol,
         side: "sell",
         qty: pos.qty,
       });

if (result) {
  const exitPrice = result.avgPrice;
  const qty = pos.qty || result.executedQty || 0;

  if (qty > 0 && entry > 0) {
    const pnlValue = (exitPrice - entry) * qty;      // כי אתה תמיד LONG
    const pnlPct = ((exitPrice - entry) / entry) * 100;

    addTrade(
      {
        symbol,
        side: "LONG",
        entry,
        exit: exitPrice,
        qty,
        pnlValue,
        pnlPct,
        layerId: pos.layerId || options.layerId || null,
        strategyId: pos.strategyId || options.strategyId || null,
        entryPresetId: pos.entryPresetId || options.entryPresetId || null,
        exitPresetId: pos.exitPresetId || options.exitPresetId || null,
      },
      market
    );
  }

  // Reset position state
  pos.hasPosition = false;
  pos.entryPrice = 0;
  pos.qty = 0;
  pos.maxPrice = 0;
  pos.entryPresetId = null;
  pos.exitPresetId = null;
  pos.entryBarTs = null;
  pos.initialStop = null;
  pos.trailingStop = null;
  pos.entryAtr = null;
  pos.entryR = null;
  pos.breakoutLevel = null;

  log(
    COLORS.RED +
      `[${symbol}] LONG CLOSED @ avg=${result.avgPrice.toFixed(2)}` +
      COLORS.RESET
  );
}

  } else if (rawExitSignal && candleExitEnabled && !candleExitOk) {
    log(
      COLORS.YELLOW + `[${symbol}] TP/SL HIT BUT candleExitOk=false → HOLD` + COLORS.RESET
    );
  }
}


module.exports = {
    runSymbolStrategy,
    initPositions
};
