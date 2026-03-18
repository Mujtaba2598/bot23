const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Health check for Render
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Bot is running on Render' });
});

// Database
const database = {
    sessions: {},
    activeTrades: {}
};

// AI Trading Engine
class AITradingEngine {
    constructor() {
        this.performance = { totalTrades: 0, successfulTrades: 0, totalProfit: 0 };
    }

    analyzeMarket(symbol, marketData) {
        const { price = 0, volume24h = 0, priceChange24h = 0, high24h = 0, low24h = 0 } = marketData;
        
        const volatility = Math.abs(priceChange24h) / 100 || 0.01;
        const volumeRatio = volume24h / 1000000;
        const pricePosition = high24h > low24h ? (price - low24h) / (high24h - low24h) : 0.5;
        
        let confidence = 0.5;
        if (volumeRatio > 1.5) confidence += 0.1;
        if (volumeRatio > 2.0) confidence += 0.15;
        if (priceChange24h > 5) confidence += 0.15;
        if (priceChange24h > 10) confidence += 0.2;
        if (pricePosition < 0.3) confidence += 0.1;
        if (pricePosition > 0.7) confidence += 0.1;
        
        confidence = Math.min(confidence, 0.95);
        
        const action = (pricePosition < 0.3 && priceChange24h > -5 && volumeRatio > 1.2) ? 'BUY' :
                      (pricePosition > 0.7 && priceChange24h > 5 && volumeRatio > 1.2) ? 'SELL' : 
                      (Math.random() > 0.3 ? 'BUY' : 'SELL');
        
        return { symbol, price, confidence, action };
    }

    calculatePositionSize(initialInvestment, currentProfit, targetProfit, timeElapsed, timeLimit, confidence) {
        const timeRemaining = Math.max(0.1, (timeLimit - timeElapsed) / timeLimit);
        const remainingProfit = Math.max(1, targetProfit - currentProfit);
        const baseSize = Math.max(5, initialInvestment * 0.15);
        const timePressure = 1 / timeRemaining;
        const targetPressure = remainingProfit / (initialInvestment * 5);
        
        let positionSize = baseSize * timePressure * targetPressure * confidence;
        const maxPosition = initialInvestment * 2;
        positionSize = Math.min(positionSize, maxPosition);
        positionSize = Math.max(positionSize, 5);
        
        return positionSize;
    }
}

// Binance API with fallback for Render
class BinanceAPI {
    static baseUrl = 'https://api.binance.com';
    
    static async signRequest(queryString, secret) {
        return crypto
            .createHmac('sha256', secret)
            .update(queryString)
            .digest('hex');
    }

    static async makeRequest(endpoint, method, apiKey, secret, params = {}) {
        try {
            const timestamp = Date.now();
            const queryParams = { ...params, timestamp };
            const queryString = Object.keys(queryParams)
                .map(key => `${key}=${queryParams[key]}`)
                .join('&');
            
            const signature = await this.signRequest(queryString, secret);
            const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
            
            const response = await axios({
                method,
                url,
                headers: { 'X-MBX-APIKEY': apiKey },
                timeout: 10000
            });
            
            return response.data;
        } catch (error) {
            console.error('Binance API Error:', error.message);
            throw error;
        }
    }

    static async getAccountBalance(apiKey, secret) {
        try {
            const data = await this.makeRequest('/api/v3/account', 'GET', apiKey, secret);
            const usdtBalance = data.balances.find(b => b.asset === 'USDT');
            return {
                success: true,
                free: parseFloat(usdtBalance?.free || 0),
                locked: parseFloat(usdtBalance?.locked || 0),
                total: parseFloat(usdtBalance?.free || 0) + parseFloat(usdtBalance?.locked || 0)
            };
        } catch (error) {
            // Return mock data for demo when API fails (Render IP might be blocked)
            return {
                success: true,
                free: 1000,
                locked: 0,
                total: 1000,
                demo: true
            };
        }
    }

    static async getTicker(symbol) {
        try {
            const response = await axios.get(`${this.baseUrl}/api/v3/ticker/24hr?symbol=${symbol}`, { timeout: 5000 });
            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            // Mock data for demo
            return {
                success: true,
                data: {
                    symbol: symbol,
                    lastPrice: (Math.random() * 50000 + 20000).toString(),
                    volume: (Math.random() * 1000000).toString(),
                    priceChangePercent: (Math.random() * 10 - 2).toString(),
                    highPrice: (Math.random() * 60000 + 20000).toString(),
                    lowPrice: (Math.random() * 40000 + 10000).toString()
                }
            };
        }
    }

    static async placeMarketOrder(apiKey, secret, symbol, side, quoteOrderQty) {
        // Mock order for demo
        return {
            success: true,
            orderId: 'order_' + Date.now(),
            executedQty: (quoteOrderQty / 45000).toFixed(6),
            price: (45000 + (Math.random() * 100 - 50)).toFixed(2),
            data: {}
        };
    }

    static async verifyApiKey(apiKey, secret) {
        try {
            const data = await this.makeRequest('/api/v3/account', 'GET', apiKey, secret);
            return {
                success: true,
                permissions: data.permissions,
                canTrade: data.canTrade,
                canWithdraw: data.canWithdraw,
                canDeposit: data.canDeposit
            };
        } catch (error) {
            // Accept any key for demo
            return {
                success: true,
                canTrade: true,
                demo: true
            };
        }
    }
}

const aiEngine = new AITradingEngine();

// API Routes
app.post('/api/connect', async (req, res) => {
    const { email, accountNumber, apiKey, secretKey } = req.body;
    
    if (!apiKey || !secretKey) {
        return res.status(400).json({
            success: false,
            message: 'API key and secret are required'
        });
    }
    
    try {
        const verification = await BinanceAPI.verifyApiKey(apiKey, secretKey);
        
        const balance = await BinanceAPI.getAccountBalance(apiKey, secretKey);
        const sessionId = 'session_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
        
        database.sessions[sessionId] = {
            id: sessionId,
            email,
            accountNumber,
            apiKey,
            secretKey,
            connectedAt: new Date(),
            isActive: true,
            balance: balance.total || 1000
        };
        
        res.json({ 
            success: true, 
            sessionId,
            balance: balance.total || 1000,
            accountInfo: { 
                balance: balance.total || 1000,
                canTrade: true
            },
            message: '✅ Connected to Binance (Demo Mode)'
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Connection failed: ' + error.message
        });
    }
});

app.post('/api/startTrading', (req, res) => {
    const { sessionId, initialInvestment, targetProfit, timeLimit, riskLevel, tradingPairs } = req.body;
    
    const botId = 'bot_' + Date.now();
    database.activeTrades[botId] = {
        id: botId,
        sessionId,
        initialInvestment: parseFloat(initialInvestment) || 10,
        targetProfit: parseFloat(targetProfit) || 100,
        timeLimit: parseFloat(timeLimit) || 1,
        riskLevel: riskLevel || 'medium',
        tradingPairs: tradingPairs || ['BTCUSDT', 'ETHUSDT'],
        startedAt: new Date(),
        isRunning: true,
        currentProfit: 0,
        trades: []
    };
    
    const session = database.sessions[sessionId];
    if (session) {
        session.activeBot = botId;
    }
    
    res.json({ 
        success: true, 
        botId, 
        message: `🔥 TRADING ACTIVE! Target: $${parseFloat(targetProfit).toLocaleString()}`
    });
});

app.post('/api/stopTrading', (req, res) => {
    const { sessionId } = req.body;
    const session = database.sessions[sessionId];
    if (session?.activeBot) {
        database.activeTrades[session.activeBot].isRunning = false;
        session.activeBot = null;
    }
    res.json({ success: true, message: 'Trading stopped' });
});

app.post('/api/tradingUpdate', async (req, res) => {
    const { sessionId } = req.body;
    
    const session = database.sessions[sessionId];
    if (!session?.activeBot) {
        return res.json({ success: true, currentProfit: 0, newTrades: [] });
    }
    
    const trade = database.activeTrades[session.activeBot];
    if (!trade || !trade.isRunning) {
        return res.json({ success: true, currentProfit: trade?.currentProfit || 0, newTrades: [] });
    }
    
    const newTrades = [];
    const now = Date.now();
    
    const timeElapsed = (now - trade.startedAt) / (1000 * 60 * 60);
    const timeRemaining = Math.max(0, trade.timeLimit - timeElapsed);
    
    // Generate trades
    if (timeRemaining > 0 && Math.random() > 0.4) {
        const symbol = trade.tradingPairs[Math.floor(Math.random() * trade.tradingPairs.length)] || 'BTCUSDT';
        
        const tickerData = await BinanceAPI.getTicker(symbol);
        
        if (tickerData.success) {
            const marketPrice = parseFloat(tickerData.data.lastPrice);
            
            const confidence = 0.5 + Math.random() * 0.4;
            const positionSize = aiEngine.calculatePositionSize(
                trade.initialInvestment,
                trade.currentProfit,
                trade.targetProfit,
                timeElapsed,
                trade.timeLimit,
                confidence
            );
            
            const isWin = Math.random() > 0.3;
            const profitMultiplier = isWin ? (0.1 + Math.random() * 0.2) : -(0.05 + Math.random() * 0.1);
            const profit = positionSize * profitMultiplier;
            
            trade.currentProfit += profit;
            
            newTrades.push({
                symbol: symbol,
                side: isWin ? 'BUY' : 'SELL',
                quantity: (positionSize / marketPrice).toFixed(6),
                price: marketPrice.toFixed(2),
                profit: profit,
                size: '$' + positionSize.toFixed(2),
                confidence: (confidence * 100).toFixed(0) + '%',
                timestamp: new Date().toISOString()
            });
            
            trade.trades.unshift(...newTrades);
            
            if (trade.currentProfit >= trade.targetProfit) {
                trade.targetReached = true;
                trade.isRunning = false;
            }
        }
    }
    
    if (timeElapsed >= trade.timeLimit) {
        trade.timeExceeded = true;
        trade.isRunning = false;
    }
    
    if (trade.trades.length > 50) {
        trade.trades = trade.trades.slice(0, 50);
    }
    
    res.json({ 
        success: true, 
        currentProfit: trade.currentProfit || 0,
        timeElapsed: timeElapsed.toFixed(2),
        timeRemaining: timeRemaining.toFixed(2),
        targetReached: trade.targetReached || false,
        timeExceeded: trade.timeExceeded || false,
        newTrades: newTrades
    });
});

app.post('/api/balance', async (req, res) => {
    const { sessionId } = req.body;
    
    const session = database.sessions[sessionId];
    if (!session) {
        return res.status(401).json({ success: false, message: 'Invalid session' });
    }
    
    const balance = await BinanceAPI.getAccountBalance(session.apiKey, session.secretKey);
    
    res.json({
        success: balance.success,
        balance: balance.free,
        error: balance.error
    });
});

// Serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log('🌙 HALAL AI TRADING BOT - RENDER DEPLOYMENT');
    console.log('='.repeat(50));
    console.log(`✅ Server running on port: ${PORT}`);
    console.log(`✅ Bot URL: http://localhost:${PORT}`);
    console.log('='.repeat(50) + '\n');
});
