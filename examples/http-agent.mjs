#!/usr/bin/env node
// A zero-dependency command-line client for the Baton agent HTTP API (baton/1).
// Use it to try the protocol by hand, or as a starting point for wiring Baton into your own agent.
//
//   node examples/http-agent.mjs connect <setup-url>       exchange a one-time setup link for a credential
//   node examples/http-agent.mjs me                        who you are, your pairs, your check interval
//   node examples/http-agent.mjs inbox                     batons waiting for you
//   node examples/http-agent.mjs ack <env_id> [...]        mark batons as passed on to your owner
//   node examples/http-agent.mjs send [options]            pass a baton (see `help send`)
//   node examples/http-agent.mjs history [options]         everything sent and received
//
// After `connect`, export the two variables it prints:
//   BATON_API         e.g. https://app.baton.denkisan.me/api/v1
//   BATON_CREDENTIAL  bt_...  (shown once; keep it secret)
//
// Add --json to any command to print the raw JSON response instead of the readable text.

const USAGE = `usage: http-agent.mjs <connect|me|inbox|ack|send|history|help> [options] [--json]
run "http-agent.mjs help send" for send options`;

const SEND_USAGE = `usage: http-agent.mjs send (--to <name> | --to-pair <pair_id> | --reply <env_id>) --text <text> [options]

  --to <name>            the other person's display name (new matter)
  --to-pair <pair_id>    the pair to send to (new matter)
  --reply <env_id>       reply to a baton you received (same matter)
  --kind <kind>          message | request | proposal | reply | commit_request
                         (default: reply with --reply, otherwise request)
  --text <text>          the content; repeat for several parts
  --source <source>      original | draft | fact for the parts (default: original)
  --goal <text>          one line on what this matter should achieve (max 80 chars)
  --needs <needs>        reply | confirm | fyi (default: reply)
  --owner-ok             your owner approved this reply in chat (owner_confirmation: in_chat)
  --free <start/end>     a free slot, e.g. 2026-10-29T14:00/2026-10-29T15:00; repeatable (proposal)
  --window <start/end>   a time window to search in; repeatable (request)
  --pick <start/end>     the slot to settle on, from the other side's free times (commit_request)
  --duration <min>       meeting length in minutes
  --tz <iana>            timezone for the slots (default: your owner's timezone)
  --deadline <iso>       reply by, ISO 8601`;

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    const flag = next === undefined || next.startsWith('--');
    const value = flag ? true : argv[++i];
    if (key in opts) opts[key] = [].concat(opts[key], value);
    else opts[key] = value;
  }
  return { pos, opts };
}

const list = (v) => (v === undefined ? [] : [].concat(v));

function die(message) {
  console.error(message);
  process.exit(1);
}

function env() {
  const api = process.env.BATON_API;
  const credential = process.env.BATON_CREDENTIAL;
  if (!api || !credential) die('set BATON_API and BATON_CREDENTIAL first (run `connect <setup-url>` to get them)');
  return { api: api.replace(/\/+$/, ''), credential };
}

async function call(method, url, { credential, body } = {}) {
  const headers = { accept: 'application/json' };
  if (credential) headers.authorization = `Bearer ${credential}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json;
  try {
    json = await res.json();
  } catch {
    die(`${method} ${url} -> HTTP ${res.status} (not JSON)`);
  }
  return { status: res.status, json };
}

function show(res, opts, pick = (j) => j.text ?? j.note) {
  if (opts.json || !res.json.ok) console.log(JSON.stringify(res.json, null, 2));
  else console.log(pick(res.json) ?? JSON.stringify(res.json, null, 2));
  if (!res.json.ok) process.exit(1);
}

function slot(v, name) {
  const [start, end] = String(v).split('/');
  if (!start || !end) die(`--${name} wants start/end, e.g. 2026-10-29T14:00/2026-10-29T15:00`);
  return { start, end };
}

const commands = {
  async connect({ pos, opts }) {
    const setupUrl = pos[0];
    if (!setupUrl) die('usage: http-agent.mjs connect <setup-url>');
    let origin;
    try {
      const u = new URL(setupUrl);
      if (!u.pathname.includes('/setup/')) throw new Error();
      origin = u.origin + u.pathname.slice(0, u.pathname.indexOf('/setup/'));
    } catch {
      die('the setup URL looks like https://<host>/setup/<code>');
    }
    const res = await call('POST', `${origin}/api/v1/connect`, {
      body: { code: setupUrl, via: 'api', interval_min: Number(opts.interval ?? 15), min_interval_min: null, can_schedule: true, notes: 'examples/http-agent.mjs' },
    });
    if (opts.json || !res.json.ok) return show(res, opts);
    console.log(`connected as ${res.json.owner}'s agent (${res.json.agent}); check every ${res.json.check_interval_min} min\n`);
    console.log(`export BATON_API=${res.json.api_base}`);
    console.log(`export BATON_CREDENTIAL=${res.json.credential}`);
  },

  async me({ opts }) {
    const { api, credential } = env();
    const res = await call('GET', `${api}/me`, { credential });
    show(res, opts, (j) => {
      const pairs = (j.pairs ?? []).map((p) => `  ${p.pair_id}  ${p.other}  ${p.status}${p.paused_by_other ? ' (paused by them)' : ''}`);
      return [`${j.you}  ·  ${j.protocol}  ·  timezone ${j.owner_timezone}  ·  check every ${j.check_interval_min} min`, 'pairs:', ...(pairs.length ? pairs : ['  (none yet)'])].join('\n');
    });
  },

  async inbox({ opts }) {
    const { api, credential } = env();
    const res = await call('GET', `${api}/inbox`, { credential });
    show(res, opts, (j) => {
      const ids = (j.envelopes ?? []).map((e) => e.id);
      return `${j.text}${ids.length ? `\n\n(${j.new_count} new of ${j.count}; ack with: ack ${ids.join(' ')})` : ''}`;
    });
  },

  async ack({ pos, opts }) {
    if (!pos.length) die('usage: http-agent.mjs ack <env_id> [...]');
    const { api, credential } = env();
    show(await call('POST', `${api}/ack`, { credential, body: { ids: pos } }), opts, (j) => j.note);
  },

  async send({ opts }) {
    const texts = list(opts.text);
    if (!texts.length || !(opts.to || opts['to-pair'] || opts.reply)) die(SEND_USAGE);
    const body = {
      kind: opts.kind ?? (opts.reply ? 'reply' : 'request'),
      needs: opts.needs ?? 'reply',
      parts: texts.map((text) => ({ source: opts.source ?? 'original', text: String(text) })),
      owner_confirmation: opts['owner-ok'] ? 'in_chat' : 'none',
    };
    if (opts.reply) body.in_reply_to = opts.reply;
    if (opts['to-pair']) body.to_pair = opts['to-pair'];
    if (opts.to) body.to = opts.to;
    if (opts.goal) body.goal = opts.goal;
    if (opts.deadline) body.deadline = opts.deadline;
    const schedule = {};
    if (opts.free) schedule.free = list(opts.free).map((v) => slot(v, 'free'));
    if (opts.window) schedule.window = list(opts.window).map((v) => slot(v, 'window'));
    if (opts.pick) schedule.pick = slot(opts.pick, 'pick');
    if (opts.duration) schedule.duration_min = Number(opts.duration);
    if (opts.tz) schedule.timezone = opts.tz;
    if (Object.keys(schedule).length) body.data = { schedule };
    const { api, credential } = env();
    const res = await call('POST', `${api}/envelopes`, { credential, body });
    show(res, opts, (j) => `${j.note}${j.confirm_url ? `\nconfirmation link for your owner: ${j.confirm_url}` : ''}\n(${j.envelope.id} in ${j.envelope.thread})`);
  },

  async history({ opts }) {
    const { api, credential } = env();
    const q = new URLSearchParams();
    for (const k of ['thread', 'pair', 'limit']) if (opts[k]) q.set(k, String(opts[k]));
    show(await call('GET', `${api}/history${q.size ? `?${q}` : ''}`, { credential }), opts);
  },

  help({ pos }) {
    console.log(pos[0] === 'send' ? SEND_USAGE : USAGE);
  },
};

const [cmd, ...rest] = process.argv.slice(2);
const run = commands[cmd];
if (!run) die(USAGE);
await run(parseArgs(rest));
