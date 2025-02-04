const request = require('request');
require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
let lastNotificationTime = 0;
let firstNotificationSent = false;

init();

async function fetchPrice(url) {
    return new Promise((resolve, reject) => {
        request({ url, method: 'GET' }, (err, res, body) => {
            if (err) {
                return reject(`Request failed: ${err.message}`);
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
    const rows = await fetchPrice('https://tw.rter.info/capi.php');
    return Number(rows.USDTWD.Exrate);
}

async function getMaxPrice() {
    const rows = await fetchPrice('https://max-api.maicoin.com/api/v3/wallet/m/index_prices');
    return Number(rows.usdttwd);
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
        const [capiPrice, maxPrice] = await Promise.all([getCapiPrice(), getMaxPrice()]);
        const spread = ((maxPrice / capiPrice) - 1) * 100;

        console.log(`台銀: ${capiPrice.toFixed(2)} Max匯率: ${maxPrice.toFixed(2)} 價差: ${spread.toFixed(4)}%`);

        const currentTime = Date.now();
        if (spread >= 0.5) {
            if (!firstNotificationSent) {
                firstNotificationSent = true;
                lastNotificationTime = currentTime;
                await sendTelegramNotification(`台銀: ${capiPrice.toFixed(2)} Max匯率: ${maxPrice.toFixed(2)} 價差: ${spread.toFixed(4)}%`);
            }
            else if ((currentTime - lastNotificationTime) >= 5 * 60 * 1000) {
                lastNotificationTime = currentTime;
                await sendTelegramNotification(`台銀: ${capiPrice.toFixed(2)} Max匯率: ${maxPrice.toFixed(2)} 價差: ${spread.toFixed(4)}%`);
            }
        } else {
            firstNotificationSent = false;
        }

    } catch (err) {
        console.error(err);

    }
}

setInterval(init, 5000);
setInterval(() => request.get('https://ExchangeRateAlert.onrender.com/'), 300000);