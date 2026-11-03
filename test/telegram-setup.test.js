import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverChats, sendTest, telegramRequest } from '../src/telegram-setup.js';

test('chat discovery does not print messages or acknowledge updates', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const method = new URL(url).pathname.split('/').pop();
    const body = JSON.parse(options.body);
    if (method === 'getMe') return Response.json({ok: true, result: {username: 'test_bot'}});
    if (method === 'getWebhookInfo') return Response.json({ok: true, result: {url: ''}});
    assert.equal(method, 'getUpdates');
    assert.equal(body.offset, undefined);assert.equal(body.allowed_updates, undefined);
    return Response.json({ok: true, result: [{message: {chat: {id: 123, type: 'private', username: 'tester'}, text: 'private message'}}]});
  });
  const previous = process.env.TELEGRAM_BOT_TOKEN;process.env.TELEGRAM_BOT_TOKEN = 'fixture-secret';
  try {
    const result = await discoverChats();
    assert.deepEqual(result, {bot: 'test_bot', chats: [{id: 123, username: 'tester'}]});
    assert.ok(!JSON.stringify(result).includes('private message'));
  } finally { if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = previous; }
});

test('connection errors never echo token-bearing URLs', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('https://api.telegram.org/botSECRET/getMe'); });
  const previous=process.env.TELEGRAM_BOT_TOKEN;process.env.TELEGRAM_BOT_TOKEN='SECRET';
  try { await assert.rejects(telegramRequest('getMe'), e => !e.message.includes('SECRET') && !e.message.includes('https://')); }
  finally { if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN=previous; }
});

test('test notification is clearly not an availability or booking confirmation', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body=JSON.parse(options.body);
    assert.match(body.text,/NOT an availability alert/);
    assert.match(body.text,/2027-07-21 → 2027-07-22/);
    assert.equal(body.chat_id,'123');
    return Response.json({ok:true,result:{message_id:1}});
  });
  const token=process.env.TELEGRAM_BOT_TOKEN, chat=process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN='fixture-secret';process.env.TELEGRAM_CHAT_ID='123';
  try { await sendTest({checkIn:'2027-07-21',checkOut:'2027-07-22',guests:2}); }
  finally {
    if (token === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN=token;
    if (chat === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID=chat;
  }
});
