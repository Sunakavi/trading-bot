const fs = require("fs");
const path = require("path");

const DEFAULT_DATA_DIR = __dirname;
const ENV_DATA_DIR =
  process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || "";

function getDataDir() {
  if (!ENV_DATA_DIR) return DEFAULT_DATA_DIR;
  return path.isAbsolute(ENV_DATA_DIR)
    ? ENV_DATA_DIR
    : path.resolve(DEFAULT_DATA_DIR, ENV_DATA_DIR);
}

function ensureDataDir() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function resolveDataPath(...segments) {
  return path.join(getDataDir(), ...segments);
}

module.exports = {
  getDataDir,
  ensureDataDir,
  resolveDataPath,
};
