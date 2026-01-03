const { MarketSessionGate } = require("../../session/marketSessionGate");

function createRuntime({ dataProvider, cacheMs } = {}) {
  const sessionGate = new MarketSessionGate({ dataProvider, cacheMs });

  return {
    async getSession() {
      return await sessionGate.getSession();
    },
    async isMarketOpen() {
      const session = await sessionGate.getSession();
      return Boolean(session?.isOpen);
    },
  };
}

module.exports = { createRuntime };
