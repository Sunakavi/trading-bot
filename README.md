Crypto Trading Bot (Binance Testnet + Alpaca Paper Stocks)

Automated algorithmic trading bot for Binance Testnet and an Alpaca-backed
stocks paper-trading mode. Built with Node.js, a custom exchange client, a
multi-strategy engine, JSON persistence, trailing stops, RSI logic, candle-based
exit confirmation, a web dashboard, and real-time keyboard controls.

Features
- Multi-market support: crypto (Binance Testnet) or stocks (Alpaca Paper)
- Strategy models with live switching (IDs 1, 2, 3, 101-108)
- Dynamic exits: SL/TP, trailing stop, candle confirmation
- Runtime controls: loop interval, kill switch, reset funds, strategy changes
- State + performance persistence (state.json, performance.json, history)
- Web dashboard + REST API for live control and monitoring

Strategy Models (Entry IDs)
The engine supports the following strategy IDs. IDs 101-108 map to Strategy 2 or
3 entry logic in code and are used by the dashboard for preset labeling/pairing.

- 1: Golden Cross (SMA FAST_MA / SLOW_MA)
- 2: Trend + Pullback + RSI (FAST_MA, SLOW_MA, RSI_MIN/MAX, candle pattern)
- 3: EMA 9/21 + ATR body filter (ATR 14, body > 0.7 * ATR)

Preset IDs that map to Strategy 2 (Trend/Pullback/RSI):
- 101: Conservative Trend Entry
- 102: Aggressive Trend Entry
- 104: Deep Pullback Entry
- 107: MA Slope Entry

Preset IDs that map to Strategy 3 (EMA + ATR Momentum):
- 103: Scalping Mode
- 105: Breakout Entry
- 106: Volatility Adaptive Entry (ATR-Based)
- 108: EMA + ATR Core (Enhanced)

Exit Models and Options
Exit logic is shared across all strategies and can be updated live via the API
or the dashboard.

- SL_PCT: Stop-loss percent (default 0.012 = 1.2%)
- TP_PCT: Take-profit percent (default 0.024 = 2.4%)
- TRAIL_START_PCT: Start trailing after this gain (default 0.012)
- TRAIL_DISTANCE_PCT: Trailing stop distance (default 0.006)
- CANDLE_EXIT_ENABLED: Require candle confirmation for exit (default false)
- CANDLE_RED_TRIGGER_PCT: Red candle body >= % of previous body (default 0.4)

Runtime Options (Live)
- loopIntervalMs: 60000, 300000, 900000 (1m, 5m, 15m)
- activeStrategyId: any ID listed above
- Exit configuration fields listed in the section above

Core Config Options
Defined in config.js and applied at runtime.

- MARKET_TYPE: crypto or stocks
- QUOTE_ORDER_FRACTION: fraction of quote balance per trade (default 0.5)
- MAX_SYMBOLS: number of symbols to scan (default 10)
- INTERVAL: candle interval (default 15m)
- KLINES_LIMIT: candle lookback (default 250)
- FAST_MA / SLOW_MA: MA periods for Strategy 1 and 2
- RSI_PERIOD / RSI_MIN / RSI_MAX: RSI filter for Strategy 2
- REQUIRE_CANDLE_PATTERN: enable candle pattern filter for Strategy 2

Settings (.env + settings.json)
settings.json is created/updated by the dashboard and mirrors .env keys.

- binanceApiKey
- binanceApiSecret
- binanceBaseUrl (default https://testnet.binance.vision)
- tradingViewWebhookUrl (optional)
- marketType: crypto or stocks
- alpacaApiKey
- alpacaApiSecret
- alpacaTradingBaseUrl (default https://paper-api.alpaca.markets)
- alpacaDataBaseUrl (default https://data.alpaca.markets)
- alpacaDataFeed (default iex)

For stocks mode, the bot uses Alpaca data and paper trading with USD as
the quote currency. Crypto mode uses Binance Testnet.

Data Persistence on Railway
Railway containers have ephemeral disks. To persist settings/state/trades across
deploys, set a persistent volume and point the bot at it:
- Set `DATA_DIR` (or `RAILWAY_VOLUME_MOUNT_PATH`) to the mounted path.
- Files persisted there: `settings.json`, `state.json`, `performance.json`,
  `state/history.json`.

Real-Time Controls
Keyboard shortcuts (terminal):
- Shift + S: Emergency SELL (close all positions)
- Shift + R: SELL ALL + Reset PNL baseline
- 1 / 2 / 3: Switch between base strategies
- Ctrl + C: Exit bot

REST API (server.js)
- GET  /api/status
- GET  /api/logs
- GET  /api/logs/list
- GET  /api/logs/download?file=YYYY-MM-DD.log
- POST /api/kill
- POST /api/bot/start
- POST /api/bot/stop
- POST /api/resetFunds
- GET  /api/config
- POST /api/config
- GET  /api/settings
- POST /api/settings

Web Dashboard
The web UI is served from public/ when you run the bot.
- Open http://localhost:3000
- Live control over strategy, interval, exits, kill switch, and settings

State Persistence
The bot stores:
- Active positions
- Selected strategy and runtime config
- Last update timestamp
- Trade history
- Performance samples

Files:
- state.json
- settings.json
- performance.json
- state/history.json
- logs/

Project Structure
trading-bot/
- index.js                # Main loop + server startup
- server.js               # REST API + dashboard
- config.js               # Global config + strategy params
- binanceClient.js        # Binance Testnet API wrapper
- stockClient.js          # Alpaca paper-trading client
- utils.js                # Technical indicators
- strategy.js             # Strategy engine + execution
- input.js                # Keyboard listener
- settingsManager.js      # Load/save settings
- stateManager.js         # Load/save state + performance
- tradeHistory.js         # Per-trade tracking & stats
- log.js                  # Logging helpers
- public/                 # Web dashboard
- logs/                   # Daily log files
- state/                  # Trade history persistence
- performance.json        # Equity timeline
- state.json              # Last bot state
- settings.json           # Persisted settings (generated)
- .env                    # API keys (ignored by Git)
- .gitignore
- package.json

Installation
1. Clone the repository
   git clone https://github.com/Sunakavi/trading-bot.git
   cd trading-bot

2. Install dependencies
   npm install

3. Create .env file (not committed to Git)
   BINANCE_API_KEY=your_key_here
   BINANCE_API_SECRET=your_secret_here
   BINANCE_BASE_URL=https://testnet.binance.vision
   MARKET_TYPE=crypto
   ALPACA_API_KEY=your_key_here
   ALPACA_API_SECRET=your_secret_here
   ALPACA_TRADING_BASE_URL=https://paper-api.alpaca.markets
   ALPACA_DATA_BASE_URL=https://data.alpaca.markets
   ALPACA_DATA_FEED=iex

Running the Bot
node index.js

The bot will:
- Fetch top symbols by volume
- Run the chosen strategy
- Execute BUY/SELL operations
- Log everything under logs/
- Persist state and performance in JSON files

Disclaimer
This project is for educational and testing use only. Trading cryptocurrency
involves high financial risk. Use only on Binance Testnet unless fully validated.
The authors take no responsibility for financial gains or losses.

Future Enhancements
- Web dashboard (React/Next.js)
- Strategy optimization engine
- ML/AI signal module
- Multi-timeframe analysis
- Docker deployment
- Railway.cloud auto-deploy
