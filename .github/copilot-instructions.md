<!-- Copilot / AI agent instructions for the Crypto Trading Bot repo -->
# Quick orientation

This Node.js trading bot runs a single-process loop in `index.js` that fetches market data, evaluates strategies, and executes trades through a market client (`binanceClient.js` for crypto or `stockClient.js` for stocks). A REST API + web dashboard in `server.js` provides live control.

# Project goals

- Provide a safe testnet/paper trading bot for crypto (Binance Testnet) and stocks (Alpaca paper).
- Allow live strategy switching and exit tuning without restarting.
- Persist state/performance/settings to JSON files for resumable runs.
- Offer a web dashboard + REST API for control and monitoring.

# Features (current)

- Multi-market support: crypto (Binance Testnet) and stocks (Alpaca paper).
- Strategy IDs: base 1/2/3 with preset IDs 101-108 (mapped in `strategy.js` and UI).
- Exit models: SL/TP, trailing stop, candle confirmation.
- Runtime controls: start/stop/kill, loop interval, reset funds, strategy/exit config.
- State, performance, settings, and trade-history persistence (JSON files).
- Web dashboard served from `public/` and REST endpoints in `server.js`.
- Regime + portfolio layer logic (`marketRegimeEngine.js`, `strategyPortfolio.config.js`).

# Key files and responsibilities

- `index.js`: main loop, market selection, strategy evaluation, and trade execution.
- `server.js`: REST API + dashboard, runtime config updates, start/stop/kill/reset.
- `strategy.js`: entry logic and shared exit handling.
- `strategyRegistry.js`: strategy metadata/preset registration.
- `exitPresetRegistry.js`: exit preset definitions.
- `marketRegimeEngine.js` / `regimeDetector.js`: regime classification logic.
- `strategyPortfolio.config.js`: portfolio layers and regime-to-strategy mapping.
- `config.js`: static defaults (MA/RSI/intervals, exit defaults, env settings).
- `settingsManager.js`: load/save normalized settings (`settings.json`).
- `stateManager.js`: load/save state and performance snapshots.
- `tradeHistory.js`: trade history retention in `state/history*.json`.
- `dataDir.js`: data root selection (local or `DATA_DIR`/`RAILWAY_VOLUME_MOUNT_PATH`).
- `binanceClient.js` / `stockClient.js`: exchange client adapters.
- `utils.js`: indicators and helpers.
- `input.js`: keyboard shortcuts.
- `log.js`: log routing and file output.

# Core objects and data shapes

- Position: `{ hasPosition: boolean, entryPrice: number, qty: number, maxPrice: number }`
- State snapshot: `{ positions: { [symbol]: Position }, activeStrategyId: number, runtimeConfig?: {...}, settings?: {...}, lastUpdateTs: number }`
- Runtime config (server + loop): `{ activeStrategyId, loopIntervalMs, SL_PCT, TP_PCT, TRAIL_START_PCT, TRAIL_DISTANCE_PCT, CANDLE_EXIT_ENABLED, CANDLE_RED_TRIGGER_PCT }`
- Settings (from `settingsManager.js`): exchange keys/URLs, `marketType`, portfolio layers, regime rules/engine.

# Persistence files (dataDir-rooted)

`dataDir.js` resolves paths to either repo root or a mounted volume.

- `settings.json`
- `state.json` / `state.stocks.json`
- `performance.json` / `performance.stocks.json`
- `state/history.json` / `state/history.stocks.json`
- `logs/` (per-market daily logs)

# Safe-edit checklist for agents

- If changing strategy logic, update `strategy.js` and keep preset IDs in sync with `server.js`.
- When touching runtime config or exits, update `buildRuntimeConfigSnapshot()` in `server.js`.
- Do not change persisted filenames or paths without updating `dataDir.js`, `stateManager.js`, and `tradeHistory.js`.
- Keep CommonJS style (`require` / `module.exports`) across new files.
- Preserve user safety: avoid modifying `.env` or committing secrets.

# References

- Main loop: [index.js](index.js)
- API + UI: [server.js](server.js)
- Strategy engine: [strategy.js](strategy.js)
- Strategy presets: [strategyRegistry.js](strategyRegistry.js)
- Exit presets: [exitPresetRegistry.js](exitPresetRegistry.js)
- Settings + state: [settingsManager.js](settingsManager.js), [stateManager.js](stateManager.js)
- Trade history: [tradeHistory.js](tradeHistory.js)
- README: [README.md](README.md)
