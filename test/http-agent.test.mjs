// Runs examples/http-agent.mjs against a small fake relay and checks the requests it makes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLIENT = fileURLToPath(new URL('../examples/http-agent.mjs', import.meta.url));
const CREDENTIAL = 'bt_test_credential';
const seen = [];
let server;
let base;

const replies = {
  'POST /api/v1/connect': () => ({ ok: true, credential: CREDENTIAL, owner: 'Lin', agent: 'Grok Bot', api_base: `${base}/api/v1`, check_interval_min: 15 }),
  'GET /api/v1/me': () => ({ ok: true, protocol: 'baton/1', you: "Lin's agent", owner_timezone: 'UTC', check_interval_min: 15, pairs: [{ pair_id: 'pair_1', other: 'Jo', status: 'active' }] }),
  'GET /api/v1/inbox': () => ({ ok: true, count: 1, new_count: 1, text: 'card', envelopes: [{ id: 'env_1' }] }),
  'POST /api/v1/ack': () => ({ ok: true, acked: 1, note: 'acked' }),
  'POST /api/v1/envelopes': (body) => (body.kind ? { ok: true, note: 'sent', envelope: { id: 'env_2', thread: 'thr_1' } } : { ok: false, error: 'kind missing' }),
  'GET /api/v1/history': () => ({ ok: true, count: 0, text: 'no history', items: [] }),
};

before(async () => {
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://x');
    const body = raw ? JSON.parse(raw) : undefined;
    seen.push({ method: req.method, path: url.pathname, query: url.search, auth: req.headers.authorization, body });
    const reply = replies[`${req.method} ${url.pathname}`];
    res.writeHead(reply ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply ? reply(body ?? {}) : { ok: false, error: 'no such endpoint' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function run(args, env = { BATON_API: `${base}/api/v1`, BATON_CREDENTIAL: CREDENTIAL }) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLIENT, ...args], { env: { PATH: process.env.PATH, ...env } }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

const last = () => seen[seen.length - 1];

test('connect posts the setup URL and prints the variables to export', async () => {
  const r = await run(['connect', `${base}/setup/abc123`], {});
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual([last().method, last().path, last().auth], ['POST', '/api/v1/connect', undefined]);
  assert.equal(last().body.code, `${base}/setup/abc123`);
  assert.equal(last().body.via, 'api');
  assert.match(r.stdout, new RegExp(`export BATON_API=${base}/api/v1`));
  assert.match(r.stdout, /export BATON_CREDENTIAL=bt_test_credential/);
});

test('connect rejects something that is not a setup URL', async () => {
  const r = await run(['connect', 'https://example.com/nope'], {});
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /setup/);
});

test('commands without credentials say how to get them', async () => {
  const r = await run(['inbox'], {});
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /BATON_API and BATON_CREDENTIAL/);
});

test('me, inbox and history send the bearer credential', async () => {
  for (const [cmd, path] of [['me', '/api/v1/me'], ['inbox', '/api/v1/inbox'], ['history', '/api/v1/history']]) {
    const r = await run([cmd]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(last().path, path);
    assert.equal(last().auth, `Bearer ${CREDENTIAL}`);
  }
});

test('inbox prints the cards and the ids to acknowledge', async () => {
  const r = await run(['inbox']);
  assert.match(r.stdout, /card/);
  assert.match(r.stdout, /ack env_1/);
});

test('history passes its filters as query parameters', async () => {
  await run(['history', '--thread', 'thr_1', '--limit', '5']);
  assert.equal(last().query, '?thread=thr_1&limit=5');
});

test('ack sends the ids', async () => {
  const r = await run(['ack', 'env_1', 'env_2']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(last().body, { ids: ['env_1', 'env_2'] });
});

test('send builds a new request with a goal and a schedule window', async () => {
  const r = await run(['send', '--to', 'Jo', '--goal', 'Coffee', '--text', 'Coffee next week?', '--window', '2026-10-27T13:00/2026-10-30T18:00', '--duration', '60']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(last().body, {
    kind: 'request',
    needs: 'reply',
    parts: [{ source: 'original', text: 'Coffee next week?' }],
    owner_confirmation: 'none',
    to: 'Jo',
    goal: 'Coffee',
    data: { schedule: { window: [{ start: '2026-10-27T13:00', end: '2026-10-30T18:00' }], duration_min: 60 } },
  });
});

test('send builds a proposal reply with several free slots and owner approval', async () => {
  await run(['send', '--reply', 'env_1', '--kind', 'proposal', '--source', 'draft', '--owner-ok', '--text', 'Thu works', '--free', '2026-10-29T14:00/2026-10-29T15:00', '--free', '2026-10-30T10:00/2026-10-30T11:00', '--tz', 'Asia/Shanghai']);
  const b = last().body;
  assert.equal(b.kind, 'proposal');
  assert.equal(b.in_reply_to, 'env_1');
  assert.equal(b.owner_confirmation, 'in_chat');
  assert.equal(b.parts[0].source, 'draft');
  assert.equal(b.data.schedule.free.length, 2);
  assert.equal(b.data.schedule.timezone, 'Asia/Shanghai');
});

test('send never sends owner_confirmation: link', async () => {
  await run(['send', '--reply', 'env_1', '--kind', 'commit_request', '--text', 'ok', '--pick', '2026-10-29T14:00/2026-10-29T15:00']);
  assert.notEqual(last().body.owner_confirmation, 'link');
  assert.deepEqual(last().body.data.schedule.pick, { start: '2026-10-29T14:00', end: '2026-10-29T15:00' });
});

test('send without a target or text prints usage and sends nothing', async () => {
  const before = seen.length;
  const r = await run(['send', '--text', 'hi']);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /--to-pair/);
  assert.equal(seen.length, before);
});

test('errors from the relay are printed as JSON and exit non-zero', async () => {
  replies['POST /api/v1/ack'] = () => ({ ok: false, error: 'bad ids' });
  const r = await run(['ack', 'x']);
  assert.notEqual(r.code, 0);
  assert.match(r.stdout, /bad ids/);
});
