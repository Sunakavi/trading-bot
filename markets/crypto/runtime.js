function createRuntime() {
  return {
    async isMarketOpen() {
      return true;
    },
  };
}

module.exports = { createRuntime };
