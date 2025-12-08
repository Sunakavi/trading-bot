// binanceClient.js (API and Exchange Logic)

const axios = require("axios");
const crypto = require("crypto");
const { log } = require("./log");
const { COLORS } = require("./config");
const { parseKlines } = require("./utils");

class BinanceClient {
  constructor(baseURL, apiKey, apiSecret) {
    this.baseURL = baseURL;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  // --- API REQUESTS ---

  async signedRequest(method, path, params = {}) {
    const timestamp = Date.now();
    const query = new URLSearchParams({
      ...params,
      timestamp: String(timestamp),
    }).toString();

    const signature = crypto
      .createHmac("sha256", this.apiSecret)
      .update(query)
      .digest("hex");

    const url = `${this.baseURL}${path}?${query}&signature=${signature}`;

    try {
      const res = await axios({
        method,
        url,
        headers: { "X-MBX-APIKEY": this.apiKey },
      });
      return res.data;
    } catch (err) {
  const details = err.response?.data || err.message || err;

  log(
    COLORS.RED + `[API] Signed Request Error (${path}):` + COLORS.RESET,
    typeof details === "object" ? JSON.stringify(details) : details
  );

  throw err;
}

  }

  async publicRequest(path, params = {}) {
    const url = `${this.baseURL}${path}`;
    try {
      const res = await axios.get(url, { params });
      return res.data;
    } catch (err) {
      log(
        COLORS.RED + `[API] Public Request Error (${path}):` + COLORS.RESET,
        err.response?.data || err.message
      );
      throw err; 
    }
  }

  // --- MARKET DATA ---

  async fetchKlines(symbol, interval, limit) {
    const data = await this.publicRequest("/api/v3/klines", {
      symbol,
      interval,
      limit,
    });
    return parseKlines(data);
  }

  async fetchTopSymbols(config) {
    const tickers = await this.publicRequest("/api/v3/ticker/24hr");

    const usdtTickers = tickers
      .filter((t) => this.symbolEndsWithQuote(t.symbol, config.QUOTE))
      .filter((t) => !this.isExcludedSymbol(t.symbol, config.EXCLUDE_KEYWORDS))
      .filter((t) =>
        !this.isStableOrFiatSymbol(
          t.symbol,
          config.QUOTE,
          config.STABLE_BASES,
          config.FIAT_BASES
        )
      );

    usdtTickers.sort(
      (a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume)
    );

    const top = usdtTickers.slice(0, config.MAX_SYMBOLS);
    const symbols = top.map((t) => t.symbol);

    log("=== TOP SYMBOLS (by quoteVolume USDT) ===");
    top.forEach((t, i) => {
      log(
        `${i + 1}. ${t.symbol} | quoteVol=${parseFloat(
          t.quoteVolume
        ).toFixed(0)}`
      );
    });
    log("========================================");

    return symbols;
  }

  // --- ACCOUNT/BALANCE ---

  async getAccount() {
    return await this.signedRequest("GET", "/api/v3/account");
  }

  findBalance(accountData, asset) {
    const bal = accountData.balances.find((b) => b.asset === asset);
    if (!bal) return { free: 0, locked: 0 };
    return {
      free: parseFloat(bal.free),
      locked: parseFloat(bal.locked),
    };
  }

  // --- TRADING OPERATIONS ---

async buyMarket(symbol, quote, quoteOrderFraction) {
  // 1. Get balance
  const account = await this.getAccount();
  const usdtBalance = account.balances.find((b) => b.asset === quote);
  const freeUSDT = usdtBalance ? parseFloat(usdtBalance.free) : 0;

  if (freeUSDT <= 0) {
    log(
      `[${symbol}] אין ${quote} פנוי (free=${freeUSDT.toFixed(2)}) – לא קונה`
    );
    return null;
  }

  // 2. Calculate quote amount
  const quoteQty = freeUSDT * quoteOrderFraction;

  // הגנה: אם סכום קטן מדי – לא לנסות
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

  // 3. Get price & LOT_SIZE filter
  const priceData = await this.publicRequest("/api/v3/ticker/price", {
    symbol,
  });
  const price = parseFloat(priceData.price);

  const symbolInfo = await this.fetchSymbolInfo(symbol);
  const { minQty, stepSize } = this.getLotSizeFilter(symbolInfo);

  // 4. Calculate base quantity from quoteQty
  let baseQty = quoteQty / price;

  // 5. Adjust quantity to stepSize
  const steps = Math.floor(baseQty / stepSize);
  baseQty = steps * stepSize;

  if (baseQty < minQty || baseQty <= 0) {
    log(
      COLORS.YELLOW +
        `[${symbol}] Calculated baseQty=${baseQty} < minQty=${minQty} → SKIP (LOT_SIZE)` +
        COLORS.RESET
    );
    return null;
  }

  const finalQty = parseFloat(baseQty.toFixed(8)); // קצת רזולוציה

  log(
    COLORS.PURPLE +
      `→ BUY ${symbol} qty=${finalQty} (~${quoteQty.toFixed(
        2
      )} ${quote} @ price=${price.toFixed(6)})` +
      COLORS.RESET
  );

  // 6. Send order with quantity (לא quoteOrderQty)
  const res = await this.signedRequest("POST", "/api/v3/order", {
    symbol,
    side: "BUY",
    type: "MARKET",
    quantity: finalQty,
    newClientOrderId: `BUY_${symbol}_${Date.now()}`,
  });

  const executedQty = parseFloat(res.executedQty);
  const avgPrice = parseFloat(res.cummulativeQuoteQty) / executedQty;

  log(
    COLORS.PURPLE + "   BUY ORDER:" + COLORS.RESET,
    JSON.stringify({ symbol, orderId: res.orderId, executedQty, avgPrice })
  );

  return { executedQty, avgPrice };
}


  async sellMarketAll(symbol, quote) {
    const baseAsset = symbol.replace(quote, "");

    const account = await this.getAccount();
    const { free } = this.findBalance(account, baseAsset);
    if (free <= 0.000001) {
      log(`[${symbol}] NOTHING TO SELL ${baseAsset}`);
      return null;
    }

    const qty = Number(free.toFixed(6));

    log(
      COLORS.GREEN + `→ SELL ${symbol} amount ${qty}` + COLORS.RESET
    );

    const res = await this.signedRequest("POST", "/api/v3/order", {
      symbol,
      side: "SELL",
      type: "MARKET",
      quantity: qty,
      newClientOrderId: `SELL_${symbol}_${Date.now()}`,
    });

    const executedQty = parseFloat(res.executedQty || "0");
    const cumQuote = parseFloat(res.cummulativeQuoteQty || "0");
    let avgPrice = 0;
    if (executedQty > 0) {
      avgPrice = cumQuote / executedQty;
    }

    log(
      COLORS.GREEN + "   SELL ORDER:" + COLORS.RESET,
      JSON.stringify({ symbol, orderId: res.orderId, executedQty, avgPrice })
    );

    return { executedQty, avgPrice };
  }
  async fetchSymbolInfo(symbol) {
    const data = await this.publicRequest("/api/v3/exchangeInfo", { symbol });
    if (!data.symbols || !data.symbols.length) {
      throw new Error(`No exchangeInfo for ${symbol}`);
    }
    return data.symbols[0];
  }

  getLotSizeFilter(symbolInfo) {
    const f = symbolInfo.filters.find((f) => f.filterType === "LOT_SIZE");
    if (!f) {
      throw new Error(`No LOT_SIZE filter for ${symbolInfo.symbol}`);
    }
    return {
      minQty: parseFloat(f.minQty),
      stepSize: parseFloat(f.stepSize),
    };
  }

  // --- FILTERS ---

  symbolEndsWithQuote(sym, quote) {
    return sym.endsWith(quote);
  }

  isExcludedSymbol(sym, excludeKeywords) {
    return excludeKeywords.some((kw) => sym.includes(kw));
  }

  isStableOrFiatSymbol(sym, quote, stableBases, fiatBases) {
    if (!sym.endsWith(quote)) return false;
    const base = sym.replace(quote, "");
    return stableBases.includes(base) || fiatBases.includes(base);
  }
}

module.exports = { BinanceClient };