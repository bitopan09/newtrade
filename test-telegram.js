require('dotenv').config();
const notificationService = require('./backend/emailService');

async function test() {
    console.log('Testing Telegram notification service...');
    console.log('TELEGRAM_BOT_TOKEN configured:', Boolean(process.env.TELEGRAM_BOT_TOKEN));
    console.log('TELEGRAM_CHAT_ID configured:', Boolean(process.env.TELEGRAM_CHAT_ID));
    console.log('Initial status:', notificationService.getStatus());

    await notificationService.verifyConnection();
    console.log('Verified status:', notificationService.getStatus());

    const result = await notificationService.sendAlert(
        'Local Telegram Test',
        'This is a local Telegram notification test from the trading bot.',
        'INFO'
    );
    console.log('Telegram result:', result);
    console.log('Final status:', notificationService.getStatus());
}

test().catch(error => {
    console.error(error);
    process.exit(1);
});
