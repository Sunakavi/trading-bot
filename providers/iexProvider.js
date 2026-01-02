// providers/iexProvider.js
const { MarketDataProvider } = require("./marketDataProvider");
const { calcATR } = require("../utils");
const { sleep } = require("../utils");
const { StrategyPortfolioConfig } = require("../strategyPortfolio.config");

function chunkArray(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }
  return chunks;
}

function computeAdvDollar(bars = []) {
  if (!bars.length) return 0;
  const sum = bars.reduce((acc, bar) => acc + bar.close * bar.volume, 0);
  return sum / bars.length;
}

function computeAvgVolume(bars = []) {
  if (!bars.length) return 0;
  const sum = bars.reduce((acc, bar) => acc + bar.volume, 0);
  return sum / bars.length;
}

class IexProvider extends MarketDataProvider {
  constructor({ dataClient, config = StrategyPortfolioConfig, logger }) {
    super();
    this.dataClient = dataClient;
    this.config = config;
    this.logger = logger;
    this.universeCache = { symbols: [], ts: 0, filtersHash: "" };
  }

  async getBars(symbol, timeframe, lookback) {
    return await this.dataClient.fetchKlines(symbol, timeframe, lookback);
  }

  async getQuote(symbol) {
    if (typeof this.dataClient.fetchQuote === "function") {
      return await this.dataClient.fetchQuote(symbol);
    }
    const price = await this.dataClient.fetchLastPrice(symbol);
    return { price, time: new Date().toISOString() };
  }

  async getMarketCalendar() {
    if (typeof this.dataClient.getClock === "function") {
      return await this.dataClient.getClock();
    }
    return { is_open: true };
  }

  async listUniverse() {
    const filters = this.config.universe?.filters || {};
    const fallbackSymbols = this.config.universe?.fallbackSymbols || [];
    const filterKey = JSON.stringify(filters);
    const now = Date.now();
    const cacheAge = now - this.universeCache.ts;
    if (this.universeCache.symbols.length && cacheAge < 12 * 60 * 60 * 1000) {
      if (this.universeCache.filtersHash === filterKey) {
        return this.universeCache.symbols;
      }
    }

    const candidates =
      (await this.dataClient.fetchMostActiveSymbols?.()) ||
      (await this.dataClient.fetchTopSymbols?.(this.config)) ||
      [];

    let splitSymbols = [];
    if (typeof this.dataClient.fetchSplits === "function") {
      splitSymbols = await this.dataClient.fetchSplits(candidates);
    }
    const splitSet = new Set(
      (splitSymbols || []).map((sym) => String(sym).toUpperCase())
    );

    const normalized = Array.isArray(candidates) ? candidates : [];
    const filtered = await this.applyUniverseFilters(
      normalized.filter((sym) => !splitSet.has(String(sym).toUpperCase())),
      filters
    );

    if (!filtered.length && fallbackSymbols.length) {
      const fallback = fallbackSymbols
        .map((sym) => String(sym).toUpperCase())
        .filter(Boolean);
      this.universeCache = {
        symbols: fallback,
        ts: now,
        filtersHash: filterKey,
      };
      this.logger?.("[STOCKS] Universe fallback symbols used");
      return fallback;
    }

    this.universeCache = {
      symbols: filtered,
      ts: now,
      filtersHash: filterKey,
    };

    return filtered;
  }

  async applyUniverseFilters(symbols, filters) {
    const {
      priceMin,
      priceMax,
      advDollarMin,
      advDollarMinUpper,
      advDollarMinLower,
      avgShareVolumeMin,
      atrPctMin,
      atrPctMax,
      excludeKeywords = [],
      universeTargetMin,
      universeTargetMax,
      barLookbackDays,
      batchSize,
    } = filters;

    const sanitized = symbols.filter((sym) => typeof sym === "string" && sym.length);
    if (!sanitized.length) return [];

    const filteredOnce = await this.filterByBars(
      sanitized,
      advDollarMin,
      {
        priceMin,
        priceMax,
        avgShareVolumeMin,
        atrPctMin,
        atrPctMax,
        excludeKeywords,
        barLookbackDays,
        batchSize,
      }
    );

    if (
      Number.isFinite(universeTargetMax) &&
      filteredOnce.length > universeTargetMax &&
      Number.isFinite(advDollarMinUpper)
    ) {
      return await this.filterByBars(
        sanitized,
        advDollarMinUpper,
        {
          priceMin,
          priceMax,
          avgShareVolumeMin,
          atrPctMin,
          atrPctMax,
          excludeKeywords,
          barLookbackDays,
          batchSize,
        }
      );
    }

    if (
      Number.isFinite(universeTargetMin) &&
      filteredOnce.length < universeTargetMin &&
      Number.isFinite(advDollarMinLower)
    ) {
      return await this.filterByBars(
        sanitized,
        advDollarMinLower,
        {
          priceMin,
          priceMax,
          avgShareVolumeMin,
          atrPctMin,
          atrPctMax,
          excludeKeywords,
          barLookbackDays,
          batchSize,
        }
      );
    }

    return filteredOnce;
  }

  async filterByBars(symbols, advDollarMin, options) {
    const {
      priceMin,
      priceMax,
      avgShareVolumeMin,
      atrPctMin,
      atrPctMax,
      excludeKeywords,
      barLookbackDays,
      batchSize,
    } = options;

    const excluded = new Set(
      (excludeKeywords || []).map((entry) => entry.toUpperCase())
    );

    const chunks = chunkArray(symbols, batchSize || 200);
    const results = [];

    for (const chunk of chunks) {
      const barsBySymbol = await this.dataClient.fetchDailyBarsBatch?.(
        chunk,
        barLookbackDays || 20
      );

      for (const symbol of chunk) {
        const symbolKey = symbol.toUpperCase();
        if ([...excluded].some((kw) => symbolKey.includes(kw))) {
          continue;
        }

        const bars = barsBySymbol?.[symbol] || [];
        if (!Array.isArray(bars) || bars.length < (barLookbackDays || 20)) {
          continue;
        }

        const latest = bars[bars.length - 1];
        const price = latest?.close || 0;
        if (priceMin && price < priceMin) continue;
        if (priceMax && price > priceMax) continue;

        const advDollar = computeAdvDollar(bars);
        if (advDollarMin && advDollar < advDollarMin) continue;

        const avgVolume = computeAvgVolume(bars);
        if (avgShareVolumeMin && avgVolume < avgShareVolumeMin) continue;

        const atr = calcATR(bars, 14);
        const atrPct = atr && price ? (atr / price) * 100 : 0;
        if (atrPctMin && atrPct < atrPctMin) continue;
        if (atrPctMax && atrPct > atrPctMax) continue;

        results.push(symbol);
      }

      if (chunks.length > 1) {
        await sleep(250);
      }
    }

    return results;
  }
}

module.exports = { IexProvider };
