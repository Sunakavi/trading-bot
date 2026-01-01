// stockClient.js (Alpaca market data + paper trading)
const axios = require("axios");
const { log } = require("./log");
const { COLORS } = require("./config");

const DEFAULT_TRADING_URL = "https://paper-api.alpaca.markets";
const DEFAULT_DATA_URL = "https://data.alpaca.markets";

const INTERVAL_MAP = {
  "1m": "1Min",
  "5m": "5Min",
  "15m": "15Min",
  "30m": "30Min",
  "1h": "1Hour",
  "4h": "4Hour",
  "1d": "1Day",
};

const RETRY_CONFIG = {
  attempts: 3,
  baseDelayMs: 500,
};

class StockClient {
  constructor({
    quote = "USD",
    apiKey = "",
    apiSecret = "",
    tradingBaseUrl = DEFAULT_TRADING_URL,
    dataBaseUrl = DEFAULT_DATA_URL,
    dataFeed = "iex",
  }) {
    this.quote = quote;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.tradingBaseUrl = tradingBaseUrl;
    this.dataBaseUrl = dataBaseUrl;
    this.dataFeed = dataFeed;
  }

  setCredentials({ apiKey, apiSecret, tradingBaseUrl, dataBaseUrl, dataFeed }) {
    if (typeof apiKey === "string") this.apiKey = apiKey;
    if (typeof apiSecret === "string") this.apiSecret = apiSecret;
    if (typeof tradingBaseUrl === "string" && tradingBaseUrl) {
      this.tradingBaseUrl = tradingBaseUrl;
    }
    if (typeof dataBaseUrl === "string" && dataBaseUrl) {
      this.dataBaseUrl = dataBaseUrl;
    }
    if (typeof dataFeed === "string" && dataFeed) {
      this.dataFeed = dataFeed;
    }
  }

  getAuthHeaders() {
    return {
      "APCA-API-KEY-ID": this.apiKey,
      "APCA-API-SECRET-KEY": this.apiSecret,
    };
  }

  async requestWithRetry(fn, label) {
    let attempt = 0;
    let lastErr;
    while (attempt < RETRY_CONFIG.attempts) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const status = err.response?.status;
        const shouldRetry =
          status === 429 || (status && status >= 500 && status <= 599);
        if (!shouldRetry || attempt === RETRY_CONFIG.attempts - 1) {
          break;
        }
        const delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt += 1;
      }
    }

    log(
      COLORS.RED + `[ALPACA] ${label} failed:` + COLORS.RESET,
      lastErr?.response?.data || lastErr?.message
    );
    throw lastErr;
  }

  async dataRequest(method, path, params = {}) {
    const url = `${this.dataBaseUrl}${path}`;
    return await this.requestWithRetry(
      async () =>
        await axios({
          method,
          url,
          params,
          headers: this.getAuthHeaders(),
        }),
      `Data ${method} ${path}`
    );
  }

  async tradingRequest(method, path, params = {}, data = undefined) {
    const url = `${this.tradingBaseUrl}${path}`;
    const res = await axios({
      method,
      url,
      params,
      data,
      headers: this.getAuthHeaders(),
    });
    return res;
  }

  async getClock() {
    const res = await this.tradingRequest("GET", "/v2/clock");
    return res.data;
  }

  async isMarketOpen() {
    const clock = await this.getClock();
    return Boolean(clock?.is_open);
  }

  async fetchTopSymbols(config) {
    try {
      const res = await this.dataRequest(
        "GET",
        "/v1beta1/screener/stocks/most-actives"
      );

      const raw =
        res.data?.most_actives ||
        res.data?.mostActives ||
        res.data?.data ||
        res.data?.results ||
        [];

      const candidates = raw.filter((item) => item?.symbol);
      const skipCounts = { notTradable: 0, otc: 0, halted: 0 };
      const filtered = candidates.filter((item) => {
        if (item.is_tradable === false) {
          skipCounts.notTradable += 1;
          return false;
        }
        if (item.is_otc === true || item.otc === true) {
          skipCounts.otc += 1;
          return false;
        }
        if (item.is_halted === true || item.halted === true) {
          skipCounts.halted += 1;
          return false;
        }
        return true;
      });

      const maxCandidates = filtered.slice(0, Math.max(config.MAX_SYMBOLS * 4, 50));
      const symbols = maxCandidates.map((item) => item.symbol);
      const symbolsWithBars = await this.filterSymbolsWithBars(
        symbols,
        config.INTERVAL
      );

      const topSymbols = symbolsWithBars.slice(0, config.MAX_SYMBOLS);
      if (skipCounts.notTradable || skipCounts.otc || skipCounts.halted) {
        log(
          `[STOCKS] Skipped symbols: notTradable=${skipCounts.notTradable}, otc=${skipCounts.otc}, halted=${skipCounts.halted}`
        );
      }

      log("=== TOP STOCKS (Most Actives) ===");
      topSymbols.forEach((sym, i) => {
        log(`${i + 1}. ${sym}`);
      });
      log("=================================");

      return topSymbols;
    } catch (err) {
      log(
        COLORS.RED + "[STOCKS] Failed to fetch top symbols:" + COLORS.RESET,
        err.response?.data || err.message
      );
      return [];
    }
  }

  async filterSymbolsWithBars(symbols, interval) {
    if (!symbols.length) return [];
    const timeframe = INTERVAL_MAP[interval] || INTERVAL_MAP["15m"];
    const res = await this.dataRequest("GET", "/v2/stocks/bars", {
      symbols: symbols.join(","),
      timeframe,
      limit: 1,
      feed: this.dataFeed,
    });

    const bars = res.data?.bars || {};
    return symbols.filter((symbol) => {
      const series = bars[symbol] || [];
      return Array.isArray(series) && series.length > 0;
    });
  }

  async fetchKlines(symbol, interval, limit) {
    const timeframe = INTERVAL_MAP[interval] || INTERVAL_MAP["15m"];
    const res = await this.dataRequest("GET", "/v2/stocks/bars", {
      symbols: symbol,
      timeframe,
      limit,
      feed: this.dataFeed,
    });

    const bars = res.data?.bars?.[symbol] || [];
    return bars
      .map((bar) => ({
        open: Number(bar.o),
        high: Number(bar.h),
        low: Number(bar.l),
        close: Number(bar.c),
        volume: Number(bar.v) || 0,
      }))
      .filter((candle) =>
        [candle.open, candle.high, candle.low, candle.close].every((value) =>
          Number.isFinite(value)
        )
      );
  }

  async fetchLastPrice(symbol) {
    const res = await this.dataRequest("GET", "/v2/stocks/bars", {
      symbols: symbol,
      timeframe: "1Min",
      limit: 1,
      feed: this.dataFeed,
    });
    const bars = res.data?.bars?.[symbol] || [];
    if (!bars.length) {
      throw new Error(`No price for ${symbol}`);
    }
    const close = Number(bars[bars.length - 1].c);
    if (!Number.isFinite(close)) {
      throw new Error(`Invalid price for ${symbol}`);
    }
    return close;
  }

  async getAccount() {
    const [accountRes, positionsRes] = await Promise.all([
      this.tradingRequest("GET", "/v2/account"),
      this.tradingRequest("GET", "/v2/positions"),
    ]);

    const cash = parseFloat(accountRes.data?.cash || "0");
    const balances = [{ asset: this.quote, free: cash, locked: 0 }];

    const positions = Array.isArray(positionsRes.data) ? positionsRes.data : [];
    positions.forEach((pos) => {
      const qty = parseFloat(pos.qty || "0");
      if (qty > 0) {
        balances.push({ asset: pos.symbol, free: qty, locked: 0 });
      }
    });

    return { balances, account: accountRes.data, positions };
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
    const accountRes = await this.tradingRequest("GET", "/v2/account");
    const freeCash = parseFloat(accountRes.data?.cash || "0");

    if (freeCash <= 0) {
      log(
        `[${symbol}] NO ${quote} BALANCE (free=${freeCash.toFixed(2)}) => SKIP`
      );
      return null;
    }

    const budget = freeCash * quoteOrderFraction;
    const price = await this.fetchLastPrice(symbol);
    const qty = Math.floor(budget / price);

    if (qty < 1) {
      log(
        COLORS.YELLOW +
          `[${symbol}] budget=${budget.toFixed(2)} < 1 share @ ${price.toFixed(
            2
          )} => SKIP` +
          COLORS.RESET
      );
      return null;
    }

    log(
      COLORS.PURPLE +
        `BUY ${symbol} qty=${qty} (~${(qty * price).toFixed(
          2
        )} ${quote} @ price=${price.toFixed(2)})` +
        COLORS.RESET
    );

    const res = await this.tradingRequest("POST", "/v2/orders", undefined, {
      symbol,
      side: "buy",
      type: "market",
      time_in_force: "day",
      qty: String(qty),
      client_order_id: `BUY_${symbol}_${Date.now()}`,
    });

    const executedQty = parseFloat(res.data?.filled_qty || "0") || qty;
    const avgPrice = parseFloat(res.data?.filled_avg_price || "0") || price;

    log(
      COLORS.PURPLE + "   BUY ORDER:" + COLORS.RESET,
      JSON.stringify({
        symbol,
        orderId: res.data?.id,
        executedQty,
        avgPrice,
      })
    );

    return { executedQty, avgPrice };
  }

  async sellMarketAll(symbol) {
    try {
      const res = await this.tradingRequest(
        "DELETE",
        `/v2/positions/${encodeURIComponent(symbol)}`
      );

      const executedQty = parseFloat(res.data?.filled_qty || "0");
      const avgPrice = parseFloat(res.data?.filled_avg_price || "0");

      log(
        COLORS.GREEN +
          `SELL ${symbol} qty=${executedQty || "ALL"}` +
          COLORS.RESET
      );

      log(
        COLORS.GREEN + "   SELL ORDER:" + COLORS.RESET,
        JSON.stringify({
          symbol,
          orderId: res.data?.id,
          executedQty: executedQty || 0,
          avgPrice: avgPrice || 0,
        })
      );

      return {
        executedQty: executedQty || 0,
        avgPrice: avgPrice || 0,
      };
    } catch (err) {
      if (err.response?.status === 404) {
        log(`[${symbol}] NOTHING TO SELL ${symbol}`);
        return null;
      }
      log(
        COLORS.RED + `[${symbol}] SELL ERROR:` + COLORS.RESET,
        err.response?.data || err.message
      );
      throw err;
    }
  }
}

module.exports = { StockClient };
