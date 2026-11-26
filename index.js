const request = require('request');
const express = require('express');
const dotenv = require('dotenv').config();
const { Server } = require('socket.io');
const app = express();
const server = app.listen(process.env.PORT || 8080, function () {
    let port = server.address().port;
    console.log("App now running on port", port);
});
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
let lastNotificationTime = 0;
let firstNotificationSent = false;

const io = new Server(server);
app.use(express.static('public'));

app.get('/health', (req, res) => {
    //console.log('Health check at:', new Date().toISOString());
    res.status(200).send('OK');
});

init();
log();

async function fetchPrice(url) {
    const host = new URL(url).hostname;
    
    return new Promise((resolve, reject) => {
        request({
            url, method: 'GET', headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
            }
        }, (err, res, body) => {
            if (err) {
                return reject(`Request failed: ${err.message}`);
            }

            const status = res.statusCode;
            const finalHost = res.request?.uri?.hostname || host;
            const contentType = res.headers['content-type'] || '';
            const mimeType = contentType.split(';', 1)[0].trim().toLowerCase();
            const context = `[fetchPrice] ${host} -> ${finalHost} | HTTP ${status} | Content-Type: ${contentType || '(missing)'}`;

            if (status < 200 || status >= 300) {
                return reject(new Error(`${context} | Upstream HTTP error`));
            }

            if (mimeType !== 'application/json' && !mimeType.endsWith('+json')) {
                return reject(new Error(`${context} | Expected JSON`));
            }
            
            try {
                const rows = JSON.parse(body);
                resolve(rows);
            } catch (parseError) {
                reject(`JSON parse error: ${parseError.message}`);
            }
        });
    });
}

async function getCapiPrice() {
    const rows = await fetchPrice('https://query1.finance.yahoo.com/v8/finance/chart/USDTWD=X');
    return Number(rows.chart.result[0].meta.regularMarketPrice);
}

async function getMaxPrice() {
    const rows = await fetchPrice('https://max-api.maicoin.com/api/v3/wallet/m/index_prices');
    return Number(rows.usdttwd);
}

async function getBitoproPrice() {
    const rows = await fetchPrice('https://api.bitopro.com/v3/tickers/USDT_TWD');
    return Number(rows.data.lastPrice);
}

async function sendTelegramNotification(message) {
    request.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
            form: {
                chat_id: CHAT_ID,
                text: message
            }
        }, (err, res, body) => {
            if (err) {
                console.error(`Failed to send Telegram message: ${err.message}`);
            } else if (res.statusCode !== 200) {
                console.error(`Telegram API error: ${body}`);
            } else {
                console.log('Telegram message sent!');
            }
        });
}

async function init() {
    try {
        const [capiPrice, maxPrice, bitoproPrice] = await Promise.all([
            getCapiPrice(), getMaxPrice(),
            getBitoproPrice().catch(err => {
                console.warn('[BitoPro]', err instanceof Error ? err.message : String(err));
                return null;
            })
        ]);
        const hasBitoproPrice = bitoproPrice !== null;
        const maxSpread = ((maxPrice / capiPrice) - 1) * 100;
        const bitoproSpread = hasBitoproPrice ? ((bitoproPrice / capiPrice) - 1) * 100 : null;
        let notifyPrice, notifySpread, notifySource;
        if (bitoproSpread === null || maxSpread > bitoproSpread) {
            notifyPrice = maxPrice;
            notifySpread = maxSpread;
            notifySource = 'Max';
        } else {
            notifyPrice = bitoproPrice;
            notifySpread = bitoproSpread;
            notifySource = 'Bitopro';
        }

        // 缺 BitoPro 時顯示 N/A，並將「最大價差」改為「可用價差」
        const bitoproPriceText = hasBitoproPrice ? bitoproPrice.toFixed(3) : 'N/A';
        const spreadLabel = hasBitoproPrice ? '最大價差' : '可用價差';
        console.log(`即期: ${capiPrice.toFixed(3)} Max: ${maxPrice.toFixed(3)} Bitopro: ${bitoproPriceText} ${spreadLabel}【${notifySource}】: ${notifySpread.toFixed(3)}%`)
        
        const currentTime = Date.now();
         if (notifySpread >= 2 || (hasBitoproPrice && notifySpread <= -1)) {  // 負價差需兩家報價
            if (!firstNotificationSent) {
                firstNotificationSent = true;
                lastNotificationTime = currentTime;
                await sendTelegramNotification(`即期: ${capiPrice.toFixed(3)} ${notifySource}: ${notifyPrice.toFixed(3)} 價差: ${notifySpread.toFixed(3)}%`);
            }
            else if ((currentTime - lastNotificationTime) >= 5 * 60 * 1000) {
                lastNotificationTime = currentTime;
                await sendTelegramNotification(`即期: ${capiPrice.toFixed(3)} ${notifySource}: ${notifyPrice.toFixed(3)} 價差: ${notifySpread.toFixed(3)}%`);
            }
        } else {
            firstNotificationSent = false;
        }
    } catch (err) {
        console.error(err);
    }
}

function log() {
    const originalLog = console.log;
    console.log = function (...args) {
        const logMessage = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
        io.emit('log', logMessage);
        originalLog.apply(console, args);
    };
}

setInterval(init, 10000);
setInterval(() => request.get('https://ExchangeRateAlert.onrender.com/'), 300000);
