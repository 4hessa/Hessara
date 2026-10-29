import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { fetchLayaDecision, isPublicLayaIPv4 } from '../lib/laya-fetch.ts';
import { decisionQuestion, parseDecision } from '../lib/decisions.ts';

const endpoint = 'https://models.example.org/v1/systemone';
const payload = JSON.stringify({ state: 'A dummy research task', questions: decisionQuestion });
const answer = JSON.stringify({ model: 'fixture-laya', answers: { benchmark: { choice: 'coding', answer_confidence: 0.8 } } });
const flush = () => Promise.resolve().then(() => Promise.resolve());

// Only in-memory DNS/HTTPS doubles are used. This suite never opens a socket or
// resolves a domain, including the public addresses used to exercise pinning.
function transport(t, { addresses = [{ address: '93.184.216.34', family: 4 }], status = 200, headers = {}, chunks = [Buffer.from(answer)], complete = true, pending = false, pendingBody = false, error = null } = {}) {
  const calls = [];
  const lookup = t.mock.method(dns, 'lookup', async () => addresses);
  const request = t.mock.method(https, 'request', (url, options) => {
    const outgoing = new EventEmitter();
    outgoing.destroyed = false;
    outgoing.destroy = () => { outgoing.destroyed = true; return outgoing; };
    outgoing.end = body => {
      const call = { url, options, body, outgoing };
      calls.push(call);
      queueMicrotask(() => {
        if (pending) return;
        if (error) { outgoing.emit('error', error); return; }
        const incoming = new EventEmitter();
        incoming.statusCode = status; incoming.headers = headers; incoming.complete = false;
        incoming.destroyed = false; incoming.destroy = () => { incoming.destroyed = true; return incoming; };
        call.incoming = incoming;
        outgoing.emit('response', incoming);
        for (const chunk of chunks) if (!incoming.destroyed) incoming.emit('data', chunk);
        if (!incoming.destroyed && !pendingBody) {
          incoming.complete = complete;
          incoming.emit('end');
        }
      });
    };
    return outgoing;
  });
  return { calls, lookup, request };
}

test('only non-special IPv4 addresses can be Laya connection targets', () => {
  for (const value of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '100.63.255.255', '100.128.0.1', '172.15.255.255', '172.32.0.1', '223.255.255.254']) assert.equal(isPublicLayaIPv4(value), true, value);
  for (const value of [
    '0.0.0.0', '0.255.255.255', '10.0.0.1', '127.0.0.1', '127.255.255.255',
    '100.64.0.1', '100.127.255.255', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.0.0.1', '192.0.0.9', '192.0.2.1', '192.31.196.1', '192.52.193.1', '192.88.99.1',
    '192.168.0.1', '192.175.48.1', '198.18.0.1', '198.19.255.255', '198.51.100.1', '203.0.113.1',
    '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255', '168.63.129.16',
    '::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', 'fe80::1', 'fc00::1', '2001:4860:4860::8888',
    '010.0.0.1', '2130706433', '127.1', '0x7f000001', '', '93.184.216.34.example.org',
  ]) assert.equal(isPublicLayaIPv4(value), false, value);
});

test('a successful Laya request preserves its body and credential, pins DNS, and retains TLS identity checks', async t => {
  const fake = transport(t);
  const response = await fetchLayaDecision(endpoint, payload, 'dummy-fixture-key');
  assert.equal(response.status, 200);
  assert.deepEqual(parseDecision(await response.json()), { category: 'coding', confidence: 0.8, model: 'fixture-laya' });
  assert.equal(fake.lookup.mock.callCount(), 1);
  assert.deepEqual(fake.lookup.mock.calls[0].arguments, ['models.example.org', { family: 4, all: true, verbatim: true }]);
  const { url, options, body } = fake.calls[0];
  assert.equal(url.href, endpoint); assert.equal(body, payload);
  assert.equal(options.method, 'POST'); assert.equal(options.agent, false);
  assert.equal(options.family, 4); assert.equal(options.autoSelectFamily, false);
  assert.equal(options.servername, 'models.example.org'); assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.checkServerIdentity, undefined, 'preserve Node certificate hostname verification');
  assert.equal(options.headers.authorization, 'Bearer dummy-fixture-key');
  assert.equal(options.headers['content-length'], Buffer.byteLength(payload));
  const pinned = [];
  options.lookup('models.example.org', {}, (...args) => pinned.push(args));
  options.lookup('models.example.org', { all: true }, (...args) => pinned.push(args));
  assert.deepEqual(pinned, [[null, '93.184.216.34', 4], [null, [{ address: '93.184.216.34', family: 4 }]]]);
  assert.equal(fake.lookup.mock.callCount(), 1, 'TLS lookup cannot repeat DNS and rebind to a private address');
  options.lookup('different.example.org', {}, error => assert.equal(error.message, 'PROVIDER_UNAVAILABLE'));
});

for (const addresses of [[], [{ address: '127.0.0.1', family: 4 }], [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.2', family: 4 }], [{ address: '2001:4860:4860::8888', family: 6 }], [{ address: '::ffff:127.0.0.1', family: 6 }], Array(65).fill({ address: '8.8.8.8', family: 4 })]) {
  test(`unsafe, mixed, unsupported or excessive DNS answers never create an HTTPS request (${JSON.stringify(addresses.slice(0, 2))}; ${addresses.length})`, async t => {
    const fake = transport(t, { addresses });
    await assert.rejects(fetchLayaDecision(endpoint, payload), { message: 'PROVIDER_UNAVAILABLE' });
    assert.equal(fake.request.mock.callCount(), 0);
  });
}

test('invalid endpoints and oversized UTF-8 request bodies are rejected before DNS', async t => {
  const fake = transport(t);
  for (const url of ['http://models.example.org/v1/systemone', 'https://127.0.0.1/v1/systemone', 'https://[::1]/v1/systemone', 'https://models.example.org/private', 'https://user:pass@models.example.org/v1/systemone']) await assert.rejects(fetchLayaDecision(url, payload));
  await assert.rejects(fetchLayaDecision(endpoint, 'ش'.repeat(16_001)));
  assert.equal(fake.lookup.mock.callCount(), 0); assert.equal(fake.request.mock.callCount(), 0);
});

for (const scenario of [
  { status: 302, headers: { location: 'https://private.internal/' } },
  { headers: { 'content-length': '128001' } },
  { headers: { 'content-encoding': 'gzip' } },
  { chunks: [Buffer.alloc(64_001), Buffer.alloc(64_000)] },
]) test('redirected, compressed or oversized responses are rejected and destroyed: ' + JSON.stringify(scenario.headers ?? 'stream'), async t => {
  const fake = transport(t, scenario);
  await assert.rejects(fetchLayaDecision(endpoint, payload), { message: 'PROVIDER_RESPONSE' });
  assert.equal(fake.calls.length, 1); assert.equal(fake.calls[0].outgoing.destroyed, true);
  assert.equal(fake.calls[0].incoming.destroyed, true);
});

test('upstream errors retain only the status while transport failures expose no diagnostics', async t => {
  const fake = transport(t, { status: 401, chunks: [Buffer.from('private upstream diagnostic')] });
  const response = await fetchLayaDecision(endpoint, payload);
  assert.equal(response.status, 401); assert.equal(await response.text(), '');
  assert.equal(fake.calls.length, 1);
});

test('connection and incomplete response failures are masked', async t => {
  transport(t, { error: new Error('secret-private-host-diagnostic') });
  await assert.rejects(fetchLayaDecision(endpoint, payload), { message: 'PROVIDER_UNAVAILABLE' });
});

test('incomplete response cannot produce a successful result', async t => {
  transport(t, { complete: false });
  await assert.rejects(fetchLayaDecision(endpoint, payload), { message: 'PROVIDER_UNAVAILABLE' });
});

test('one 20-second deadline covers stalled DNS and prevents a late request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = transport(t);
  let resolveDNS;
  fake.lookup.mock.mockImplementation(() => new Promise(resolve => { resolveDNS = resolve; }));
  const pending = assert.rejects(fetchLayaDecision(endpoint, payload), { message: 'PROVIDER_UNAVAILABLE' });
  t.mock.timers.tick(20_000); await pending;
  resolveDNS([{ address: '8.8.8.8', family: 4 }]); await flush();
  assert.equal(fake.request.mock.callCount(), 0);
});

test('the same deadline destroys stalled connections', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = transport(t, { pending: true });
  const pending = assert.rejects(fetchLayaDecision(endpoint, payload), { message: 'PROVIDER_UNAVAILABLE' });
  await flush(); assert.equal(fake.calls.length, 1);
  t.mock.timers.tick(20_000); await pending;
  assert.equal(fake.calls[0].outgoing.destroyed, true);
});

test('the same deadline destroys a response stalled midway through its body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = transport(t, { chunks: [Buffer.from('{"answers":')], pendingBody: true });
  const pending = assert.rejects(fetchLayaDecision(endpoint, payload), { message: 'PROVIDER_UNAVAILABLE' });
  await flush();
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].incoming.statusCode, 200, 'headers and partial body have arrived');
  assert.equal(fake.calls[0].incoming.destroyed, false);
  t.mock.timers.tick(20_000); await pending;
  assert.equal(fake.calls[0].incoming.destroyed, true);
  assert.equal(fake.calls[0].outgoing.destroyed, true);
});
