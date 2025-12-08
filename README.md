📈 Crypto Trading Bot (Binance Testnet)

Automated algorithmic trading bot for Binance Testnet using
Node.js, CCXT-like custom client, multi-strategy engine, JSON persistence, trailing-stop, RSI logic, candle-based exits, and real-time keyboard controls.

🚀 Features
Core Trading Engine

Multi-strategy support:

Strategy 1: SMA Golden Cross

Strategy 2: Trend + Pullback + RSI

Strategy 3: EMA9/21 + ATR Volatility Filter

Auto selection of top-volume symbols.

Full live data from Binance Testnet.

Smart trailing stop logic (dynamic).

Candle-pattern exit confirmation.

Real-time performance tracking (performance.json).

Real-Time Controls
Key	Function
Shift + S	Emergency SELL SWITCH – close all open positions
Shift + R	SELL ALL + Reset PNL baseline
1 / 2 / 3	Switch between strategies
Ctrl + C	Exit bot
State Persistence

The bot stores:

Active positions

Selected strategy

Last update timestamp

Trade history

Performance track

Files:

state.json
performance.json
state/history.json
logs/


Even after restart — the bot continues exactly from where it stopped.

🏗 Project Structure
crypto-bot-testnet/
│
├── index.js                # Main loop
├── config.js               # Global config + strategy params
├── binanceClient.js        # API Wrapper (signed + public)
├── utils.js                # Technical indicators
├── strategy.js             # Strategies engine + execution
├── input.js                # Keyboard listener
├── stateManager.js         # Load/save state + performance handling
├── tradeHistory.js         # Per-trade tracking & PNL stats
│
├── logs/                   # Daily log files
├── state/                  # Trade history persistence
├── performance.json        # Equity timeline
├── state.json              # Last bot state
│
├── .env                    # API KEY + SECRET (ignored by Git)
├── .gitignore
├── package.json

⚙️ Installation
1. Clone the repository
git clone https://github.com/Sunakavi/trading-bot.git
cd trading-bot

2. Install dependencies
npm install

3. Create .env file (not committed to Git)
BINANCE_API_KEY=your_key_here
BINANCE_API_SECRET=your_secret_here
BINANCE_BASE_URL=https://testnet.binance.vision

▶️ Running the Bot
node index.js


The bot will:

Fetch top symbols by volume

Run the chosen strategy

Execute BUY/SELL operations

Log everything under logs/

Keep state in JSON files

📊 Performance Tracking

Every loop logs:

Current equity

PNL % from initial capital

Position values

Account balances

Trade statistics

All performance samples are saved automatically to:

performance.json


Perfect for graphing your equity curve later.

⚠️ Disclaimer

This project is for educational and testing use only.
Trading cryptocurrency involves high financial risk.
Use only on Binance Testnet unless fully validated.

The authors take no responsibility for financial gains or losses.

🛠 Future Enhancements

Web dashboard (React/Next.js)

Strategy optimization engine

ML/AI signal module

Multi-timeframe analysis

Docker deployment

Railway.cloud auto-deploy