require('dotenv').config();
const emailService = require('./backend/emailService');

async function test() {
    console.log("Testing email service...");
    console.log("EMAIL_USER:", process.env.EMAIL_USER);
    console.log("SEND_EMAIL_ON_TRADE:", process.env.SEND_EMAIL_ON_TRADE);
    
    const trade = {
        action: 'BUY',
        entryPrice: 50000,
        quantity: 0.01,
        sl: 49000,
        tp1: 52000,
        score: 8,
        notes: 'Test trade'
    };
    
    const result = await emailService.sendTradeNotification(trade, 'AUTO BUY');
    console.log("Email result:", result);
}
test();
