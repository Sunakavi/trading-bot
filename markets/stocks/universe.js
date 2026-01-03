const { IexProvider } = require("../../providers/iexProvider");
const { StrategyPortfolioConfig } = require("../../strategyPortfolio.config");

function createUniverseProvider({ dataClient, config, logger } = {}) {
  return new IexProvider({
    dataClient,
    config: config || StrategyPortfolioConfig,
    logger,
  });
}

module.exports = { createUniverseProvider };
