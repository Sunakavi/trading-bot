// providers/marketDataProvider.js

class MarketDataProvider {
  async getBars() {
    throw new Error("getBars not implemented");
  }

  async getQuote() {
    throw new Error("getQuote not implemented");
  }

  async getMarketCalendar() {
    throw new Error("getMarketCalendar not implemented");
  }

  async listUniverse() {
    throw new Error("listUniverse not implemented");
  }
}

module.exports = { MarketDataProvider };
