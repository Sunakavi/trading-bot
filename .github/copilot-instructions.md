<!-- Copilot / AI agent instructions for the Crypto Trading Bot repo -->
# Quick orientation

This Node.js trading bot runs a single-process loop (index.js) that fetches market data, runs a selected strategy from `strategy.js`, and executes trades through a pluggable market client (`binanceClient.js` for crypto or `stockClient.js` for stocks).

- Entry point: index.js — orchestrates the main loop, state persistence and invokes `runSymbolStrategy()` for each symbol.
- HTTP/GUI controller: server.js — exposes runtime control (start/stop/kill/reset/config/settings) and serves `public/` static UI.
- Market abstraction: `BinanceClient` / `StockClient` — required API surface: `fetchKlines()`, `fetchTopSymbols()`, `buyMarket()`, `sellMarketAll()`, `getAccount()`, `findBalance()`.
- Persistent state: `state.json`, `performance.json`, `state/history.json` — read/write via `stateManager.js`.

# Important patterns & conventions

- CommonJS modules across the codebase (use `require` / `module.exports`).
- Runtime control lives in `server.js` as `runtimeConfig` and is synchronized into `index.js` on each loop. Do not bypass this object when changing loop settings or exit thresholds.
- Strategies are selected by numeric ID (allowed IDs in `server.js`): [1,2,3,101..108]. To add variants, update `strategy.js` and `server.js` allowed lists together.
- Position shape (single symbol): `{ hasPosition: boolean, entryPrice: number, qty: number, maxPrice: number }`. Maintain this shape when modifying state logic.
- File-based persistence is the single source of truth between runs. Use `stateManager.updateState()` for small changes and `saveState()` when writing full snapshot.

# Run / dev commands

- Install: `npm install`
- Start bot: `node index.js`
- No tests are present; keep changes small and run locally against Binance Testnet by default (see `.env` and `README.md`).

# Key integration points (safe-edit checklist for agents)

- Modifying trading logic: edit `strategy.js`. Respect existing exit handling in `handleExit()` (SL/TP/trail + optional candle confirmation).
- Changing HTTP control surface: edit `server.js` and update `runtimeConfig`, allowed IDs and allowed intervals. Ensure `shared.interruptNow` is triggered when config changes so the loop re-evaluates immediately.
- Market client changes: maintain the public method names used by `index.js` and `strategy.js` (fetchKlines/fetchTopSymbols/buyMarket/sellMarketAll/getAccount/findBalance).
- State/Performance files: `state.json` and `performance.json` live in the repo root. Avoid renaming — other modules use those exact paths.

# Project-specific gotchas & notes for agents

- `binanceClient.buyMarket()` enforces a minimum `quoteQty` threshold (~5) and adjusts to LOT_SIZE stepSize — altering this affects which BUY orders are attempted.
- `index.js` uses interruptible sleep (chunked sleep) and several flags (`shared.interruptNow`, `shared.killSwitch`, `shared.resetFundsRequested`) — changes to loop control must preserve these flags to keep HTTP/keypress control responsive.
- Many files include Hebrew comments; do not remove them when editing unless cleaning up intentionally.
- `server.js` exposes API endpoints useful for tests: `POST /api/kill`, `POST /api/bot/stop`, `POST /api/bot/start`, `POST /api/resetFunds`, `POST /api/config` (change strategy/interval/exit settings). Use these endpoints in integration tests or when automating scenarios.

# When creating PRs or edits

- Keep changes small, test locally with Testnet credentials in `.env` (never commit secrets).
- If changing runtime parameters (loopIntervalMs, SL/TP/TRAIL), update `buildRuntimeConfigSnapshot()` and ensure `updateState()` is called so UI and saved state remain consistent.
- Document new strategy IDs or API routes in `README.md` and keep UI in `public/` in sync.

# References

- Entry point: [index.js](index.js)
- HTTP + runtime control: [server.js](server.js)
- Strategy/TA: [strategy.js](strategy.js)
- Exchange client: [binanceClient.js](binanceClient.js)
- Persistence helpers: [stateManager.js](stateManager.js)
- Run instructions: [README.md](README.md)

If any section is unclear or you'd like the agent to add examples (API calls, example unit tests, or a short integration test harness), tell me which part to expand. 
