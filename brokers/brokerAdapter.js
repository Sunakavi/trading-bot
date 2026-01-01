// brokers/brokerAdapter.js

class BrokerAdapter {
  async placeOrder() {
    throw new Error("placeOrder not implemented");
  }

  async cancelOrder() {
    throw new Error("cancelOrder not implemented");
  }

  async getPositions() {
    throw new Error("getPositions not implemented");
  }

  async getAccount() {
    throw new Error("getAccount not implemented");
  }
}

module.exports = { BrokerAdapter };
