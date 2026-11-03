// Explicit setup commands only. Never print tokens, endpoint URLs or message bodies received from Telegram.
import { pathToFileURL } from 'node:url';
import { readConfig } from './config.js';

export async function telegramRequest(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Add TELEGRAM_BOT_TOKEN to the local .env file first. Do not paste it in chat.');
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body || {}), signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('Telegram connection failed (endpoint and credentials suppressed).');
  }
  if (!response.ok) throw new Error(`Telegram returned HTTP ${response.status}; check token/chat permissions.`);
  let data;
  try { data = await response.json(); } catch { throw new Error('Telegram returned an invalid response.'); }
  if (!data.ok) throw new Error('Telegram rejected the request; check token/chat permissions.');
  return data.result;
}

export async function discoverChats() {
  const bot = await telegramRequest('getMe');
  const webhook = await telegramRequest('getWebhookInfo');
  if (webhook.url) throw new Error('This bot already uses a webhook. Do not disrupt it; use a dedicated bot or supply the known chat ID.');
  // No offset/allowed_updates supplied: do not acknowledge queued updates or change subscriptions.
  const updates = await telegramRequest('getUpdates', {timeout: 0, limit: 100});
  const chats = new Map();
  for (const update of updates) {
    const chat = update.message?.chat;
    if (chat?.type === 'private') chats.set(String(chat.id), {id: chat.id, username: chat.username || null});
  }
  return {bot: bot.username, chats: [...chats.values()]};
}

export async function sendTest(config) {
  if (!process.env.TELEGRAM_CHAT_ID) throw new Error('Add TELEGRAM_CHAT_ID to .env first.');
  await telegramRequest('sendMessage', {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text: `TEST — Nuvolau monitor\n${config.guests} adults: ${config.checkIn} → ${config.checkOut}\nSent from: ${process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions' : 'local setup'}\nThis is a setup test, NOT an availability alert. No booking has been made.\nPlease confirm you received this message.`,
    link_preview_options: {is_disabled: true},
  });
}

async function main() {
  if (process.argv.includes('--discover')) {
    const result = await discoverChats();
    console.log(`Bot: @${result.bot}`);
    if (!result.chats.length) console.log('No private chat found. Open the bot in Telegram, send /start, then retry.');
    for (const chat of result.chats) console.log(`Chat ID: ${chat.id}${chat.username ? ` (@${chat.username})` : ''}`);
    console.log('Choose your own chat ID and save it as TELEGRAM_CHAT_ID in .env. Message contents are never printed.');
  } else if (process.argv.includes('--test')) {
    await sendTest(await readConfig(process.env.MONITOR_CONFIG || 'config.json'));
    console.log('Telegram accepted the labelled test message. Confirm receipt before enabling the monitor.');
  } else throw new Error('Use --discover or --test. No action taken.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
