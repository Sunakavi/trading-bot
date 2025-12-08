// log.js

const fs = require("fs");
const path = require("path");
const { COLORS } = require("./config");

const LOG_DIR = "./logs";

function initLogSystem() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogFilePath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `bot_${date}.log`);
}

function writeLine(line) {
  // Use try/catch for file operations for safety
  try {
    fs.appendFileSync(getLogFilePath(), line + "\n", "utf8");
  } catch (e) {
    console.error(COLORS.RED + "[LOG WRITE ERROR]" + COLORS.RESET, e.message);
  }
}

// ******* IMPORTANT *******
// log() MUST NOT call log() inside itself.
function log(...args) {
  const ts = new Date().toISOString();
  // Strip ANSI color codes before writing to file
  const fileLine = `[${ts}] ${args.join(" ")}`.replace(/\x1b\[[0-9;]*m/g, "");

  const consoleLine = `[${ts}] ${args.join(" ")}`;

  console.log(consoleLine);
  writeLine(fileLine);
}

module.exports = { log, initLogSystem };