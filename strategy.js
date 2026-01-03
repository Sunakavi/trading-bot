// strategy.js

const {
  runSymbolStrategy: runCryptoStrategy,
  initPositions: initCryptoPositions,
} = require("./strategy.crypto");
const {
  runSymbolStrategy: runStocksStrategy,
  initPositions: initStocksPositions,
} = require("./strategy.stocks");

function resolveMarketKey(market) {
  return market === "stocks" ? "stocks" : "crypto";
}

function runSymbolStrategy(...args) {
  const market = args[11];
  const key = resolveMarketKey(market);
  if (key === "stocks") {
    return runStocksStrategy(...args);
  }
  return runCryptoStrategy(...args);
}

function initPositions(symbols, market) {
  const key = resolveMarketKey(market);
  if (key === "stocks") {
    return initStocksPositions(symbols);
  }
  return initCryptoPositions(symbols);
}

module.exports = {
  runSymbolStrategy,
  initPositions,
};
