// stockClient.js (Yahoo Finance market data + paper trading)
const axios = require("axios");
const { log } = require("./log");
const { COLORS } = require("./config");

const YAHOO_SCREENER_URL =
  "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved";
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

const INTERVAL_MAP = {
  "1m": { interval: "1m", range: "1d" },
  "5m": { interval: "5m", range: "5d" },
  "15m": { interval: "15m", range: "7d" },
  "30m": { interval: "30m", range: "1mo" },
  "1h": { interval: "60m", range: "1mo" },
  "4h": { interval: "60m", range: "3mo" },
  "1d": { interval: "1d", range: "1y" },
};

class StockClient {
  constructor({ quote = "USD", initialCash = 0 }) {
    this.quote = quote;
    this.cashBalance = initialCash;
    this.holdings = {};
  }

  setCredentials() {
    // No-op for stock data client.
  }

  async fetchTopSymbols(config) {
    try {
      const res = await axios.get(YAHOO_SCREENER_URL, {
        params: {
          formatted: "false",
          scrIds: "most_actives",
          count: 200,
          start: 0,
        },
      });

      const quotes =
        res.data?.finance?.result?.[0]?.quotes?.filter((q) => q.symbol) || [];

      quotes.sort(
        (a, b) =>
          (b.regularMarketVolume || 0) - (a.regularMarketVolume || 0)
      );

      const top = quotes.slice(0, config.MAX_SYMBOLS);
      const symbols = top.map((q) => q.symbol);

      log("=== TOP STOCKS (by volume) ===");
      top.forEach((q, i) => {
        log(
          `${i + 1}. ${q.symbol} | volume=${(q.regularMarketVolume || 0).toLocaleString()}`
        );
      });
      log("===============================");

      return symbols;
    } catch (err) {
      log(
        COLORS.RED + "[STOCKS] Failed to fetch top symbols:" + COLORS.RESET,
        err.response?.data || err.message
      );
      return [];
    }
  }

  async fetchKlines(symbol, interval, limit) {
    const { interval: chartInterval, range } =
      INTERVAL_MAP[interval] || INTERVAL_MAP["15m"];

    const res = await axios.get(`${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}`, {
      params: { interval: chartInterval, range },
    });

    const result = res.data?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const quote = result?.indicators?.quote?.[0];

    if (!quote || !timestamps.length) {
      return [];
    }

    const candles = timestamps
      .map((ts, idx) => ({
        open: quote.open?.[idx],
        high: quote.high?.[idx],
        low: quote.low?.[idx],
        close: quote.close?.[idx],
        volume: quote.volume?.[idx],
        ts,
      }))
      .filter((c) =>
        [c.open, c.high, c.low, c.close].every(
          (value) => typeof value === "number" && !Number.isNaN(value)
        )
      )
      .map((c) => ({
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: typeof c.volume === "number" ? c.volume : 0,
      }));

    if (candles.length > limit) {
      return candles.slice(-limit);
    }

    return candles;
  }

  async fetchLastPrice(symbol) {
    const res = await axios.get(`${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}`, {
      params: { interval: "1m", range: "1d" },
    });

    const result = res.data?.chart?.result?.[0];
    const close = result?.indicators?.quote?.[0]?.close;
    if (!close || !close.length) {
      throw new Error(`No price for ${symbol}`);
    }

    return close[close.length - 1];
  }

  async getAccount() {
    const balances = [
      { asset: this.quote, free: this.cashBalance, locked: 0 },
    ];

    Object.entries(this.holdings).forEach(([symbol, qty]) => {
      if (qty > 0) {
        balances.push({ asset: symbol, free: qty, locked: 0 });
      }
    });

    return { balances };
  }

  findBalance(accountData, asset) {
    const bal = accountData.balances.find((b) => b.asset === asset);
    if (!bal) return { free: 0, locked: 0 };
    return {
      free: parseFloat(bal.free),
      locked: parseFloat(bal.locked),
    };
  }

  async buyMarket(symbol, quote, quoteOrderFraction) {
    const freeCash = this.cashBalance;

    if (freeCash <= 0) {
      log(`[${symbol}] אין ${quote} פנוי (free=${freeCash.toFixed(2)}) – לא קונה`);
      return null;
    }

    const quoteQty = freeCash * quoteOrderFraction;

    if (quoteQty < 5) {
      log(
        COLORS.YELLOW +
          `[${symbol}] quoteQty=${quoteQty.toFixed(
            2
          )} < 5 ${quote} → SKIP (min notional)` +
          COLORS.RESET
      );
      return null;
    }

    const price = await this.fetchLastPrice(symbol);
    const qty = quoteQty / price;
    const executedQty = Number(qty.toFixed(4));
    const totalCost = executedQty * price;

    if (executedQty <= 0 || totalCost > this.cashBalance) {
      log(
        COLORS.YELLOW +
          `[${symbol}] Calculated qty=${executedQty} exceeds cash ${this.cashBalance.toFixed(
            2
          )}` +
          COLORS.RESET
      );
      return null;
    }

    this.cashBalance -= totalCost;
    this.holdings[symbol] = (this.holdings[symbol] || 0) + executedQty;

    log(
      COLORS.PURPLE +
        `→ PAPER BUY ${symbol} qty=${executedQty} (~${totalCost.toFixed(
          2
        )} ${quote} @ price=${price.toFixed(4)})` +
        COLORS.RESET
    );

    return { executedQty, avgPrice: price };
  }

  async sellMarketAll(symbol) {
    const qty = this.holdings[symbol] || 0;
    if (qty <= 0) {
      log(`[${symbol}] NOTHING TO SELL ${symbol}`);
      return null;
    }

    const price = await this.fetchLastPrice(symbol);
    const proceeds = qty * price;

    this.cashBalance += proceeds;
    this.holdings[symbol] = 0;

    log(
      COLORS.GREEN + `→ PAPER SELL ${symbol} amount ${qty}` + COLORS.RESET
    );

    return { executedQty: qty, avgPrice: price };
  }
}

module.exports = { StockClient };
