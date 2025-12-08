# 📈 Crypto Trading Bot (Binance Testnet)

Automated algorithmic trading bot for Binance Testnet using  
**Node.js, custom Binance API client, multi-strategy engine, state persistence, trailing-stop logic, RSI filters, candle-pattern exits, and real-time keyboard controls.**

---

## 🚀 Features

### **Core Trading Engine**
- Multi-strategy support:
  - **Strategy 1:** SMA Golden Cross  
  - **Strategy 2:** Trend + Pullback + RSI  
  - **Strategy 3:** EMA9/21 + ATR Volatility Filter  
- Automatic selection of top-volume symbols.
- Smart trailing-stop system.
- Candle-red exit confirmation logic.
- Trade history tracking with PNL per position.
- JSON-state persistence for crash-safe recovery.

---

## 🎮 Real-Time Controls

| Key | Action |
|-----|--------|
| **Shift + S** | Emergency SELL SWITCH – close all positions |
| **Shift + R** | Sell all + reset PNL baseline |
| **1 / 2 / 3** | Switch strategy |
| **Ctrl + C** | Exit bot |

---

## 🗂 Project Structure
crypto-bot-testnet/
│
├── index.js # Main loop & orchestrator
├── config.js # Configuration & strategy parameters
├── binanceClient.js # Binance API (public + signed)
├── utils.js # Indicators: SMA, EMA, RSI, ATR
├── strategy.js # Strategy logic + entry/exit engine
├── input.js # Keyboard shortcuts
├── stateManager.js # Saves/loads state + performance
├── tradeHistory.js # Tracks all trades (entry/exit/PNL)
│
├── logs/ # Daily log files
├── state/ # trade history JSON
├── performance.json # Equity timeline
├── state.json # Last known bot state
│
├── .env # Binance API keys (ignored by Git)
├── .gitignore
├── package.json


---

## ⚙️ Installation

### **1. Clone**
```bash
git clone https://github.com/Sunakavi/trading-bot.git
cd trading-bot

2. Install dependencies
npm install

3. Create .env file
BINANCE_API_KEY=your_key_here
BINANCE_API_SECRET=your_secret_here
BINANCE_BASE_URL=https://testnet.binance.vision

▶️ Running the Bot
node index.js


On startup the bot will:

Fetch top USDT symbols by volume

Select active symbols

Run selected strategy (default Strategy 2)

Execute BUY/SELL orders

Log everything under logs/

Persist state so it can resume after restart

📊 Performance Tracking

Performance data is stored in:

performance.json


Includes:

Equity over time

PNL % from initial capital

Time series samples

Resettable baseline (Shift+R)

Perfect for analytics, dashboards, and ML models.

⚠️ Disclaimer

This bot is for educational and testnet use only.
Crypto trading involves high risk.
Do not use with real funds unless fully validated.

🛠 Future Enhancements (Optional)

Web dashboard (React / Next.js)

Optimization engine for strategies

Multi-timeframe signals

Dockerization

Railway auto-deploy

Telegram alerts
