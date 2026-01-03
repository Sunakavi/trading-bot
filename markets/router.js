const { config } = require("../config");
const { AlpacaBroker } = require("../brokers/alpacaBroker");
const { loadSettings } = require("../settingsManager");
const { StrategyPortfolioConfig } = require("../strategyPortfolio.config");
const { createCryptoClient } = require("./crypto/client");
const { createStockClient } = require("./stocks/client");
const { buildMarketConfig: buildCryptoConfig } = require("./crypto/config");
const { buildMarketConfig: buildStocksConfig } = require("./stocks/config");
const { createRuntime: createCryptoRuntime } = require("./crypto/runtime");
const { createRuntime: createStocksRuntime } = require("./stocks/runtime");
const { createUniverseProvider } = require("./stocks/universe");

function resolveMarketKey(value) {
  return value === "stocks" ? "stocks" : "crypto";
}

function createMarketAdapters({ loggers } = {}) {
  const cryptoClient = createCryptoClient({
    baseUrl: config.BINANCE_BASE_URL,
    apiKey: config.BINANCE_API_KEY,
    apiSecret: config.BINANCE_API_SECRET,
    logger: loggers?.crypto,
  });

  const stocksClient = createStockClient({
    quote: config.STOCK_QUOTE,
    apiKey: config.ALPACA_API_KEY,
    apiSecret: config.ALPACA_API_SECRET,
    tradingBaseUrl: config.ALPACA_TRADING_BASE_URL,
    dataBaseUrl: config.ALPACA_DATA_BASE_URL,
    dataFeed: config.ALPACA_DATA_FEED,
    logger: loggers?.stocks,
  });

  const stocksUniverse = createUniverseProvider({
    dataClient: stocksClient,
    config: StrategyPortfolioConfig,
    logger: loggers?.stocks,
  });

  const stocksBroker = new AlpacaBroker({ tradingClient: stocksClient });

  const cryptoAdapter = {
    key: "crypto",
    client: cryptoClient,
    dataProvider: cryptoClient,
    broker: cryptoClient,
    config: buildCryptoConfig(config),
    runtime: createCryptoRuntime(),
    universe: null,
  };

  const stocksAdapter = {
    key: "stocks",
    client: stocksClient,
    dataProvider: stocksUniverse,
    broker: stocksBroker,
    config: buildStocksConfig(config),
    runtime: createStocksRuntime({
      dataProvider: stocksUniverse,
      sessionConfig: StrategyPortfolioConfig.session,
    }),
    universe: stocksUniverse,
  };

  return {
    crypto: cryptoAdapter,
    stocks: stocksAdapter,
  };
}

module.exports = {
  createMarketAdapters,
  resolveMarketKey,
  createMarketRouter,
};

function getMarketTypeFromSettings() {
  const settings = loadSettings()?.settings || {};
  return resolveMarketKey(settings.marketType);
}

function createMarketRouter({ loggers } = {}) {
  const adapters = createMarketAdapters({ loggers });
  const marketKey = getMarketTypeFromSettings();
  const active = adapters[marketKey];

  return {
    marketKey,
    dataProvider: active.dataProvider,
    broker: active.broker,
    runtime: active.runtime,
    universe: active.universe,
    client: active.client,
    config: active.config,
    adapters,
  };
}
