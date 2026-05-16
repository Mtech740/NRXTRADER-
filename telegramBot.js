const TelegramBot = require('node-telegram-bot-api');
const pool = require('./config/db');

// Replace with your bot token from BotFather
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Store user's subscription status locally (or fetch from DB)
// We'll use DB for persistence.

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString();
    
    // Check if user exists in DB via telegram_id
    const user = await pool.query('SELECT id, subscription_plan FROM users WHERE telegram_id = $1', [telegramId]);
    if (user.rows.length === 0) {
        // Ask user to link account: provide website link with login
        const websiteUrl = 'https://trader.nrxproject.com';
        bot.sendMessage(chatId, `Welcome to SYNA! Please log in at ${websiteUrl} and link your Telegram ID in your profile. Then I'll send you signals based on your plan.`);
    } else {
        const plan = user.rows[0].subscription_plan || 'free';
        bot.sendMessage(chatId, `You are subscribed to ${plan} plan. You'll receive signals here.`);
    }
});

// Function to send signal to a specific user
async function sendSignalToTelegram(userId, signalText) {
    const user = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [userId]);
    if (user.rows.length && user.rows[0].telegram_id) {
        const telegramId = user.rows[0].telegram_id;
        try {
            await bot.sendMessage(telegramId, signalText);
            return true;
        } catch (err) {
            console.error('Failed to send Telegram message:', err);
            return false;
        }
    }
    return false;
}

module.exports = { bot, sendSignalToTelegram };
