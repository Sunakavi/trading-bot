const readline = require("readline");
const { log } = require("./log");
const { COLORS } = require("./config");

function setupKeypressListener(keyHandler, strategyChangeHandler) {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on("keypress", (str, key) => {
    if (!key) return;

    // קודם – מקשים מיוחדים שהבוט מטפל בהם (SELL_SWITCH וכו')
    if (keyHandler && keyHandler(key)) {
      return;
    }

    // בחירת אסטרטגיה ידנית: 1 / 2 / 3
    if (strategyChangeHandler && !key.ctrl && !key.meta) {
      if (key.name === "1") {
        strategyChangeHandler(1);
        log(
          COLORS.PURPLE +
            "[SYSTEM] Strategy changed to 1 (Golden Cross)" +
            COLORS.RESET
        );
        return;
      }
      if (key.name === "2") {
        strategyChangeHandler(2);
        log(
          COLORS.PURPLE +
            "[SYSTEM] Strategy changed to 2 (Trend/Pullback/RSI)" +
            COLORS.RESET
        );
        return;
      }
      if (key.name === "3") {
        strategyChangeHandler(3);
        log(
          COLORS.PURPLE +
            "[SYSTEM] Strategy changed to 3 (EMA+ATR)" +
            COLORS.RESET
        );
        return;
      }
    }

    // יציאה ב־Ctrl+C
    if (key.ctrl && key.name === "c") {
      log(COLORS.PURPLE + "[SYSTEM] Exit." + COLORS.RESET);
      process.exit();
    }
  });
}

module.exports = { setupKeypressListener };
