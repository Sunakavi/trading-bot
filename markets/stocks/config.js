function buildMarketConfig(baseConfig) {
  return {
    ...baseConfig,
    MARKET_TYPE: "stocks",
    QUOTE: baseConfig.STOCK_QUOTE,
  };
}

module.exports = { buildMarketConfig };
