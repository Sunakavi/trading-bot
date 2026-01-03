// brokers/alpacaBroker.js
const { BrokerAdapter } = require("./brokerAdapter");

class AlpacaBroker extends BrokerAdapter {
  constructor({ tradingClient }) {
    super();
    this.tradingClient = tradingClient;
  }

  async placeOrder({ symbol, side, qty, timeInForce = "day", type = "market" }) {
    return await this.tradingClient.placeOrder({
      symbol,
      side,
      qty,
      timeInForce,
      type,
    });
  }

  async buyMarket(symbol, quote, orderFraction) {
    if (typeof this.tradingClient.buyMarket === "function") {
      return await this.tradingClient.buyMarket(symbol, quote, orderFraction);
    }
    return null;
  }

  async sellMarketAll(symbol, quote) {
    if (typeof this.tradingClient.sellMarketAll === "function") {
      return await this.tradingClient.sellMarketAll(symbol, quote);
    }
    return null;
  }

  async cancelOrder(orderId) {
    if (!orderId) return null;
    return await this.tradingClient.cancelOrder(orderId);
  }

  async getPositions() {
    return await this.tradingClient.getPositions();
  }

  async getAccount() {
    return await this.tradingClient.getAccount();
  }

  findBalance(accountData, asset) {
    if (typeof this.tradingClient?.findBalance === "function") {
      return this.tradingClient.findBalance(accountData, asset);
    }
    return { free: 0, locked: 0 };
  }

  getTradingBaseUrl() {
    return this.tradingClient?.tradingBaseUrl;
  }
}

module.exports = { AlpacaBroker };
