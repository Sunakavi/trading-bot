function buildMarketConfig(baseConfig) {
  return {
    ...baseConfig,
    MARKET_TYPE: "crypto",
    QUOTE: baseConfig.CRYPTO_QUOTE,
  };
}

module.exports = { buildMarketConfig };
