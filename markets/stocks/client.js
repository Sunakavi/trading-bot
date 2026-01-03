// stockClient.js (Alpaca market data + paper trading)
const axios = require("axios");
const { log } = require("../../log");
const { COLORS } = require("../../config");

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

function joinBaseUrl(baseUrl, apiPath) {
  const cleanBase =
    typeof baseUrl === "string" ? baseUrl.replace(/\/+$/, "") : "";
  const normalizedPath = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  if (!cleanBase) return normalizedPath;

  const versionMatch = normalizedPath.match(/^\/(v\d+(?:beta\d+)?)\//);
  if (versionMatch) {
    const versionSegment = `/${versionMatch[1]}`;
    if (cleanBase.endsWith(versionSegment)) {
      return cleanBase + normalizedPath.slice(versionSegment.length);
    }
  }

  return cleanBase + normalizedPath;
}

class StockClient {
  constructor({
    quote = "USD",
    apiKey = "",
    apiSecret = "",
    tradingBaseUrl = DEFAULT_TRADING_URL,
    dataBaseUrl = DEFAULT_DATA_URL,
    dataFeed = "iex",
    logger = log,
  }) {
    this.quote = quote;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.tradingBaseUrl = tradingBaseUrl;
    this.dataBaseUrl = dataBaseUrl;
    this.dataFeed = dataFeed;
    this.log = logger;
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

    this.log(
      COLORS.RED + `[ALPACA] ${label} failed:` + COLORS.RESET,
      lastErr?.response?.data || lastErr?.message
    );
    throw lastErr;
  }

  async dataRequest(method, path, params = {}) {
    const url = joinBaseUrl(this.dataBaseUrl, path);
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
    const url = joinBaseUrl(this.tradingBaseUrl, path);
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
      const symbols = await this.fetchMostActiveSymbols();
      const symbolsWithBars = await this.filterSymbolsWithBars(
        symbols,
        config.INTERVAL
      );

      const topSymbols = symbolsWithBars.slice(0, config.MAX_SYMBOLS);
      this.log("=== TOP STOCKS (Most Actives) ===");
      topSymbols.forEach((sym, i) => {
        this.log(`${i + 1}. ${sym}`);
      });
      this.log("=================================");

      return topSymbols;
    } catch (err) {
      this.log(
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
    const filtered = symbols.filter((symbol) => {
      const series = bars[symbol] || [];
      return Array.isArray(series) && series.length > 0;
    });
    this.log(`[STOCKS] Bars filter count=${filtered.length}`);
    return filtered;
  }

  async fetchMostActiveSymbols() {
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
    this.log(`[STOCKS] Most-actives raw count=${candidates.length}`);
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

    if (skipCounts.notTradable || skipCounts.otc || skipCounts.halted) {
      this.log(
        `[STOCKS] Skipped symbols: notTradable=${skipCounts.notTradable}, otc=${skipCounts.otc}, halted=${skipCounts.halted}`
      );
    }
    this.log(`[STOCKS] Most-actives tradable count=${filtered.length}`);

    return filtered.map((item) => item.symbol);
  }

  async fetchSplits(symbols = [], date = new Date()) {
    if (!symbols.length) return [];
    const day = date.toISOString().slice(0, 10);
    try {
      const res = await this.tradingRequest("GET", "/v2/corporate_actions/announcements", {
        ca_types: "split",
        symbols: symbols.join(","),
        start: day,
        end: day,
      });
      const rows = res.data?.announcements || res.data?.data || [];
      return Array.isArray(rows)
        ? rows.map((row) => row?.symbol).filter(Boolean)
        : [];
    } catch (err) {
      this.log(
        COLORS.YELLOW + "[STOCKS] Split check failed:" + COLORS.RESET,
        err.response?.data || err.message
      );
      return [];
    }
  }

  async fetchDailyBarsBatch(symbols, limit = 20) {
    if (!symbols.length) return {};
    const res = await this.dataRequest("GET", "/v2/stocks/bars", {
      symbols: symbols.join(","),
      timeframe: "1Day",
      limit,
      feed: this.dataFeed,
    });

    const bars = res.data?.bars || {};
    const normalized = {};
    Object.keys(bars).forEach((symbol) => {
      normalized[symbol] = bars[symbol]
        .map((bar) => ({
          open: Number(bar.o),
          high: Number(bar.h),
          low: Number(bar.l),
          close: Number(bar.c),
          volume: Number(bar.v) || 0,
          time: bar.t,
          ts: bar.t ? Date.parse(bar.t) : null,
        }))
        .filter((candle) =>
          [candle.open, candle.high, candle.low, candle.close].every((value) =>
            Number.isFinite(value)
          )
        );
    });

    return normalized;
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
        time: bar.t,
        ts: bar.t ? Date.parse(bar.t) : null,
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

  async fetchQuote(symbol) {
    const res = await this.dataRequest("GET", "/v2/stocks/bars", {
      symbols: symbol,
      timeframe: "1Min",
      limit: 1,
      feed: this.dataFeed,
    });
    const bars = res.data?.bars?.[symbol] || [];
    if (!bars.length) {
      throw new Error(`No quote for ${symbol}`);
    }
    const last = bars[bars.length - 1];
    return {
      price: Number(last.c),
      time: last.t,
    };
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

  async getPositions() {
    const res = await this.tradingRequest("GET", "/v2/positions");
    return Array.isArray(res.data) ? res.data : [];
  }

  async placeOrder({ symbol, side, qty, timeInForce = "day", type = "market" }) {
    if (!symbol || !side || !qty) return null;
    const res = await this.tradingRequest("POST", "/v2/orders", undefined, {
      symbol,
      side,
      type,
      time_in_force: timeInForce,
      qty: String(qty),
      client_order_id: `${side.toUpperCase()}_${symbol}_${Date.now()}`,
    });
    return res.data;
  }

  async cancelOrder(orderId) {
    if (!orderId) return null;
    const res = await this.tradingRequest("DELETE", `/v2/orders/${orderId}`);
    return res.data;
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
      this.log(
        `[${symbol}] NO ${quote} BALANCE (free=${freeCash.toFixed(2)}) => SKIP`
      );
      return null;
    }

    const budget = freeCash * quoteOrderFraction;
    const price = await this.fetchLastPrice(symbol);
    const qty = Math.floor(budget / price);

    if (qty < 1) {
      this.log(
        COLORS.YELLOW +
          `[STOCKS][${symbol}] budget=${budget.toFixed(2)} price=${price.toFixed(
            2
          )} => shares=0 SKIP` +
          COLORS.RESET
      );
      return null;
    }

    this.log(
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

    this.log(
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

      this.log(
        COLORS.GREEN +
          `SELL ${symbol} qty=${executedQty || "ALL"}` +
          COLORS.RESET
      );

      this.log(
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
        this.log(`[${symbol}] NOTHING TO SELL ${symbol}`);
        return null;
      }
      this.log(
        COLORS.RED + `[${symbol}] SELL ERROR:` + COLORS.RESET,
        err.response?.data || err.message
      );
      throw err;
    }
  }
}

module.exports = { StockClient };

function createStockClient({
  quote = "USD",
  apiKey = "",
  apiSecret = "",
  tradingBaseUrl,
  dataBaseUrl,
  dataFeed,
  logger,
} = {}) {
  const client = new StockClient({
    quote,
    apiKey,
    apiSecret,
    tradingBaseUrl,
    dataBaseUrl,
    dataFeed,
    logger,
  });

  if (typeof client.getBars !== "function") {
    client.getBars = async (symbol, timeframe, limit) =>
      client.fetchKlines(symbol, timeframe, limit);
  }

  if (typeof client.closePosition !== "function") {
    client.closePosition = async (symbol) => client.sellMarketAll(symbol);
  }

  if (typeof client.isMarketOpen !== "function") {
    client.isMarketOpen = async () => {
      try {
        return await client.isMarketOpen();
      } catch (err) {
        return false;
      }
    };
  }

  return client;
}

module.exports.createStockClient = createStockClient;
