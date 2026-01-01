// session/marketSessionGate.js

class MarketSessionGate {
  constructor({ dataProvider, cacheMs = 60000 } = {}) {
    this.dataProvider = dataProvider;
    this.cacheMs = cacheMs;
    this.lastFetchTs = 0;
    this.cached = null;
  }

  async getSession() {
    const now = Date.now();
    if (this.cached && now - this.lastFetchTs < this.cacheMs) {
      return this.cached;
    }

    const calendar = await this.dataProvider.getMarketCalendar();
    const session = {
      isOpen: Boolean(calendar?.is_open || calendar?.isOpen),
      nextOpen: calendar?.next_open || calendar?.nextOpen || null,
      nextClose: calendar?.next_close || calendar?.nextClose || null,
    };

    this.cached = session;
    this.lastFetchTs = now;
    return session;
  }
}

module.exports = { MarketSessionGate };
