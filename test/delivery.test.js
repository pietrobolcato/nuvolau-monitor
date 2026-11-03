import test from 'node:test';
import assert from 'node:assert/strict';
import { stateStore } from '../src/state.js';
import { deliver } from '../src/notify.js';
import { readConfig } from '../src/config.js';

const config = {...await readConfig(), checkIn: '2027-07-21', checkOut: '2027-07-22', guests: 2, sameDorm: false};

test('stato GitHub: primo avvio crea branch, PUT con SHA, lettura e scritture successive', async () => {
  const original = globalThis.fetch;
  const calls = [];
  let stored = null;
  let branch = false;
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.GITHUB_REPOSITORY = 'example/nuvolau';
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({path, method: options.method, body});
    const response = (data, status = 200) => new Response(JSON.stringify(data), {status});
    if (path.endsWith('/contents/state.json') && options.method === 'GET') return stored ? response(stored) : response({}, 404);
    if (path.endsWith('/git/ref/heads/monitor-state')) return branch ? response({object: {sha: 'head'}}) : response({}, 404);
    if (path === '/repos/example/nuvolau') return response({default_branch: 'main'});
    if (path.endsWith('/git/ref/heads/main')) return response({object: {sha: 'main-sha'}});
    if (path.endsWith('/git/refs')) { branch = true; return response(body, 201); }
    if (path.endsWith('/contents/state.json') && options.method === 'PUT') {
      if (stored) assert.equal(body.sha, stored.sha);
      stored = {content: body.content, sha: `sha-${calls.length}`};
      return response({content: {sha: stored.sha}}, 201);
    }
    throw new Error(`Unexpected request ${path}`);
  };
  try {
    const store = stateStore(config, true);
    assert.equal(await store.load(), null);
    await store.save({observedAt: 1000, pending: [{id: 'unsent'}]});
    await store.save({observedAt: 2000, pending: []});
    const fresh = stateStore(config, true);
    assert.deepEqual(await fresh.load(), {observedAt: 2000, pending: []});
    assert.equal(calls.filter((c) => c.path.endsWith('/git/refs')).length, 1);
    assert.ok(calls.filter((c) => c.method === 'PUT').every((c) => c.body.branch === 'monitor-state'));
  } finally { globalThis.fetch = original; }
});

const event = {id: 'evt-123', title: 'Monitor attivo', at: 1000, assessment: {
  status: 'WAITING', totalBeds: 0, sameDormPossible: false, announcements: [], countdowns: [], problems: [],
}};

test('Telegram: verifica risposta del servizio e non incorpora segreti negli errori', async () => {
  const original = globalThis.fetch;
  process.env.TELEGRAM_BOT_TOKEN = 'secret-test-token';
  process.env.TELEGRAM_CHAT_ID = '1234';
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.chat_id, '1234');
    assert.match(body.text, /2027-07-21/);
    assert.match(body.text, /2 persone/);
    return new Response('{"ok":false}', {status: 429});
  };
  try {
    await assert.rejects(deliver('telegram', event, config), (error) => /429/.test(error.message) && !/secret-test-token/.test(error.message));
  } finally { globalThis.fetch = original; }
});

test('GitHub: un evento già creato non genera una seconda issue dopo retry', async () => {
  const original = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (_url, options) => {
    if (options.method !== 'GET') writes++;
    return new Response(JSON.stringify([{body: '<!-- nuvolau-event:evt-123 -->'}]));
  };
  try { await deliver('github', event, config); assert.equal(writes, 0); }
  finally { globalThis.fetch = original; }
});

test('stato illeggibile non viene silenziosamente azzerato', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"message":"forbidden"}', {status: 403});
  try { await assert.rejects(stateStore(config, true).load(), /HTTP 403/); }
  finally { globalThis.fetch = original; }
});
