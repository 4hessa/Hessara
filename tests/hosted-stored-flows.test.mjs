import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm, unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, dirname, basename, join} from 'node:path';
import {createHmac, randomUUID} from 'node:crypto';
import {runHostedStoredFlows, hostedStoredReportPath} from './hosted-stored-flows.mjs';
import {APPROVED_TEST_PROJECT_REF, PRODUCTION_PROJECT_REF} from '../scripts/integration-target.mjs';

const env = {HESSARA_TEST_URL: 'http://127.0.0.1:5174', HESSARA_TEST_PROJECT_REF: APPROVED_TEST_PROJECT_REF, HESSARA_TEST_ISOLATED: 'true', HESSARA_TEST_ATTESTATION_KEY: 'hosted-fixture-only-attestation-'.repeat(3), HESSARA_TEST_EMAIL_A: 'hosted-fixture-a@example.test', HESSARA_TEST_PASSWORD_A: 'fixture-password-A-never-real', HESSARA_TEST_EMAIL_B: 'hosted-fixture-b@example.test', HESSARA_TEST_PASSWORD_B: 'fixture-password-B-never-real'};
const secret = 'raw-fixture-key-must-never-enter-public-report';
async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'hessara-hosted-stored-'));
  t.after(async () => { const target = resolve(folder); assert.equal(dirname(target), resolve(tmpdir())); assert.ok(basename(target).startsWith('hessara-hosted-stored-')); await rm(target, {recursive: true, force: true}); });
  return {folder, reportPath: join(folder, 'result.json')};
}
function noSecrets(report) { const value = JSON.stringify(report); for (const forbidden of [secret, env.HESSARA_TEST_ATTESTATION_KEY, env.HESSARA_TEST_EMAIL_A, env.HESSARA_TEST_EMAIL_B, env.HESSARA_TEST_PASSWORD_A, env.HESSARA_TEST_PASSWORD_B, 'sb-' + APPROVED_TEST_PROJECT_REF + '-auth-token']) assert.ok(!value.includes(forbidden)); }
function health(headers, valid = true) {
  const nonce = new Headers(headers).get('x-hessara-test-nonce'), origin = env.HESSARA_TEST_URL, issuedAt = new Date().toISOString(), projectRef = APPROVED_TEST_PROJECT_REF;
  const proof = createHmac('sha256', env.HESSARA_TEST_ATTESTATION_KEY).update('hessara-integration-response-v1\n' + nonce + '\n' + origin + '\n' + projectRef + '\n' + issuedAt).digest('hex');
  return {status: 'ready', integration: {version: 1, nonce, origin, projectRef, issuedAt, proof: valid ? proof : '0'.repeat(64)}};
}
function driver(reportPath, {failRename = false, ambiguousCreate = false, loseReport = false, failSignout = false} = {}) {
  const calls = [], projects = new Map();
  let renameFailed = false, reportLost = false, pendingVerified = 0;
  const json = (data, status = 200, headers) => Response.json(data, {status, headers});
  const error = (code, status) => json({error: code}, status);
  const page = items => ({items, total: items.length});
  const authCookie = 'sb-' + APPROVED_TEST_PROJECT_REF + '-auth-token';
  async function fetcher(input, options) {
    const url = new URL(input), path = url.pathname, method = options.method, headers = new Headers(options.headers), cookie = headers.get('cookie') ?? '';
    const slot = cookie.includes(authCookie + '=A') ? 'A' : cookie.includes(authCookie + '=B') ? 'B' : null;
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({path, method, slot, action: body?.action});
    assert.equal(url.origin, env.HESSARA_TEST_URL); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); assert.ok(options.signal instanceof AbortSignal);
    if (path === '/api/health') { assert.equal(body, undefined); assert.equal(cookie, ''); return json(health(headers)); }
    if (path === '/api/auth') {
      if (body.action === 'signin') {
        const account = body.email === env.HESSARA_TEST_EMAIL_A ? 'A' : body.email === env.HESSARA_TEST_EMAIL_B ? 'B' : null;
        assert.ok(account); assert.equal(body.password, env['HESSARA_TEST_PASSWORD_' + account]);
        return json({next: '/'}, 200, {'set-cookie': authCookie + '=' + account + '; Path=/; HttpOnly'});
      }
      assert.equal(body.action, 'signout'); assert.ok(slot);
      if (failSignout && slot === 'B') return error('fixture-private-' + secret, 503);
      return json({signedOut: true}, 200, {'set-cookie': authCookie + '=; Max-Age=0; Path=/'});
    }
    if (path === '/api/reverse-engineering/worker') { assert.equal(headers.get('authorization'), null); return error('AUTH_REQUIRED', 401); }
    if (path.startsWith('/api/toopee')) return error('FEATURE_REMOVED', 410);
    if (!slot) return error('AUTH_REQUIRED', 401);
    if (path === '/api/reverse-engineering/tools') return json({items: ['rea', 'ghidra', 'mobsf', 'jadx', 'rizin', 'angr', 'radare2'].map(id => ({id, operational: false, available: false, operationalStatus: 'unavailable', reasonCode: 'NO_WORKER'}))});
    if (path === '/api/reverse-engineering/overview') return json({stats: {availableEngines: 0}});
    if (path === '/api/reverse-engineering/storage') return error('STORAGE_NOT_CONFIGURED', 503);
    if (path === '/api/reverse-engineering/projects') {
      if (method === 'GET') return json(page([...projects.values()].filter(item => slot === 'A' && item.deletedAt === null && (!url.searchParams.get('search') || item.name.includes(url.searchParams.get('search'))))));
      assert.equal(method, 'POST');
      const pending = JSON.parse(await readFile(reportPath, 'utf8')).resources.at(-1); assert.equal(pending.kind, 're_project'); assert.equal(pending.outcome, 'pending'); pendingVerified++;
      const project = {id: randomUUID(), name: body.name, description: body.description, deletedAt: null}; projects.set(project.id, project);
      if (ambiguousCreate) throw Error(secret + ' uncertain create');
      if (loseReport && !reportLost) { reportLost = true; await unlink(reportPath); }
      return json({project}, 201);
    }
    if (path.startsWith('/api/reverse-engineering/projects/')) {
      if (path.endsWith('/artifacts')) return json(page([]));
      const project = projects.get(path.split('/').at(-1)); if (slot !== 'A' || !project || project.deletedAt !== null) return error('NOT_FOUND', 404);
      if (method === 'PATCH') {
        if (failRename && !renameFailed) { renameFailed = true; throw Error(secret + ' rename failure'); }
        project.name = body.name; return json({project});
      }
      assert.equal(method, 'DELETE'); project.deletedAt = Date.now(); return json({project});
    }
    if (path === '/api/reverse-engineering/jobs') return method === 'GET' ? json(page([])) : error('ENGINE_UNAVAILABLE_OR_QUEUE_CAPACITY', 409);
    if (path === '/api/reverse-engineering/reports') return method === 'GET' ? json(page([])) : error('NOT_FOUND', 404);
    if (path.startsWith('/api/reverse-engineering/reports/')) return error('NOT_FOUND', 404);
    if (path === '/api/reverse-engineering/admin') { assert.deepEqual(body, {}); return error('ADMIN_REQUIRED', 403); }
    if (path === '/api/reverse-engineering/assistant') return body.providerConsent === true ? error('NO_EVIDENCE', 409) : error('PROVIDER_CONSENT_REQUIRED', 403);
    throw Error('Unexpected route: ' + secret);
  }
  return {fetcher, calls, projects, pendingCount: () => pendingVerified};
}

test('default is zero-HTTP configuration preflight and never outputs credentials', async t => {
  const f = await fixture(t); let requests = 0;
  const report = await runHostedStoredFlows({...f, env, fetcher: () => { requests++; throw Error(secret); }});
  assert.equal(report.status, 'preflight_ready'); assert.equal(report.passed, false); assert.equal(requests, 0); assert.equal(report.attestation.verified, false);
  assert.deepEqual(report.resources, []); noSecrets(report); assert.deepEqual(JSON.parse(await readFile(f.reportPath, 'utf8')), report);
});
test('invalid or production targets are blocked without HTTP or credentials transmission', async t => {
  for (const changed of [{HESSARA_TEST_PROJECT_REF: PRODUCTION_PROJECT_REF}, {HESSARA_TEST_URL: 'https://production.example'}, {HESSARA_TEST_ISOLATED: 'false'}]) {
    const f = await fixture(t); let requests = 0; const report = await runHostedStoredFlows({...f, env: {...env, ...changed}, run: true, fetcher: () => { requests++; throw Error(secret); }});
    assert.equal(report.status, 'blocked'); assert.equal(report.error, 'CONFIGURATION_REQUIRED'); assert.equal(requests, 0); noSecrets(report);
  }
});
test('an existing report is preserved byte-for-byte and blocks all HTTP', async t => {
  const f = await fixture(t), existing = '{"previousKnownState":"keep exactly"}\n'; await writeFile(f.reportPath, existing);
  let requests = 0; const report = await runHostedStoredFlows({...f, env, run: true, fetcher: () => { requests++; }});
  assert.equal(report.status, 'blocked'); assert.equal(report.error, 'REPORT_ALREADY_EXISTS'); assert.equal(requests, 0); assert.equal(await readFile(f.reportPath, 'utf8'), existing); noSecrets(report);
});
test('failed attestation sends only the unauthenticated challenge and never signs in', async t => {
  const f = await fixture(t), calls = [];
  const report = await runHostedStoredFlows({...f, env, run: true, fetcher: (input, options) => { calls.push(new URL(input).pathname); assert.equal(options.body, undefined); assert.equal(new Headers(options.headers).get('cookie'), null); return Response.json(health(options.headers, false)); }});
  assert.equal(report.status, 'blocked'); assert.equal(report.error, 'SERVER_ATTESTATION_FAILED'); assert.deepEqual(calls, ['/api/health']); assert.deepEqual(report.cleanup.signout, []); noSecrets(report);
});
test('stored flows assert retired assistant routes and journal isolated reverse-engineering projects', async t => {
  const f = await fixture(t), d = driver(f.reportPath); const report = await runHostedStoredFlows({...f, env, run: true, fetcher: d.fetcher});
  assert.equal(report.status, 'success', JSON.stringify(report)); assert.equal(report.passed, true); assert.deepEqual(report.sections, {reverseEngineering: 'passed'});
  assert.equal(d.pendingCount(), 1); assert.equal(d.projects.size, 1);
  assert.equal(report.resources.length, 1); assert.ok(report.resources.every(item => item.kind === 're_project' && item.outcome === 'created' && item.state === 'soft_deleted'));
  assert.deepEqual(new Set(report.resources.map(item => item.id)), new Set(d.projects.keys()));
  assert.ok(d.calls.filter(call => call.path.startsWith('/api/toopee')).every(call => call.method === 'GET' || call.method === 'POST'));
  assert.equal(report.engines.length, 7); assert.ok(report.engines.every(item => item.operational === false && item.reasonCode === 'NO_WORKER'));
  assert.deepEqual(report.storage, {healthAvailable: false, reasonCode: 'STORAGE_NOT_CONFIGURED', uploadVerified: false, scanVerified: false});
  assert.deepEqual(report.cleanup.signout.map(item => [item.account, item.passed]), [['A', true], ['B', true]]); assert.equal(report.cleanup.permanentDeletion, false);
  noSecrets(report); assert.ok(!JSON.stringify(report).includes('اختبار')); assert.deepEqual(JSON.parse(await readFile(f.reportPath, 'utf8')), report);
});
test('failure after creation still soft-deletes known resources, signs out both accounts and redacts raw errors', async t => {
  const f = await fixture(t), d = driver(f.reportPath, {failRename: true}); const report = await runHostedStoredFlows({...f, env, run: true, fetcher: d.fetcher});
  assert.equal(report.status, 'failure'); assert.equal(report.error, 'REQUEST_OR_RESPONSE_FAILED'); assert.equal(report.passed, false);
  assert.equal(report.resources.length, 1); assert.ok(report.resources.every(item => item.state === 'soft_deleted')); assert.equal(report.cleanup.signout.length, 2); assert.ok(report.cleanup.signout.every(item => item.passed)); noSecrets(report);
});
test('ambiguous creation retains unknown side effects and does not pretend to clean an unobserved ID', async t => {
  const f = await fixture(t), d = driver(f.reportPath, {ambiguousCreate: true}); const report = await runHostedStoredFlows({...f, env, run: true, fetcher: d.fetcher});
  assert.equal(report.passed, false); assert.equal(d.projects.size, 1); assert.deepEqual(report.resources, [{kind: 're_project', id: null, outcome: 'unknown', state: 'unknown'}]);
  assert.equal(report.cleanup.retained.length, 1); assert.equal(report.cleanup.signout.length, 2); noSecrets(report);
});
test('report failure cannot suppress account signout after authentication', async t => {
  const f = await fixture(t), d = driver(f.reportPath, {loseReport: true}); const report = await runHostedStoredFlows({...f, env, run: true, fetcher: d.fetcher});
  assert.equal(report.passed, false); assert.equal(report.error, 'REPORT_WRITE_FAILED'); assert.equal(d.calls.filter(call => call.action === 'signout').length, 2); assert.equal(report.cleanup.signout.length, 2); noSecrets(report);
});
test('failed signout is recorded and prevents an overall success claim', async t => {
  const f = await fixture(t), d = driver(f.reportPath, {failSignout: true}); const report = await runHostedStoredFlows({...f, env, run: true, fetcher: d.fetcher});
  assert.equal(report.passed, false); assert.equal(report.status, 'failure'); assert.equal(report.error, 'SIGNOUT_FAILED'); assert.equal(report.cleanup.signout.find(item => item.account === 'B').passed, false); noSecrets(report);
});

test('the retired assistant endpoint consistently reports removal to authenticated clients', async t => {
  const f = await fixture(t), d = driver(f.reportPath); const report = await runHostedStoredFlows({...f, env, run: true, fetcher: d.fetcher});
  assert.equal(report.passed, true); assert.ok(d.calls.filter(call => call.path.startsWith('/api/toopee')).length >= 3); noSecrets(report);
});
test('CLI report paths distinguish preflight and runs with UTC timestamps and independent random tags', () => {
  const now = new Date('2026-10-27T09:30:11.123Z'), cwd = resolve(tmpdir()), tag = '1234567890abcdef';
  const preflight = hostedStoredReportPath({now, cwd, tag}), run = hostedStoredReportPath({now, cwd, tag, run: true});
  assert.equal(dirname(preflight), join(cwd, 'work')); assert.equal(basename(preflight), 'hosted-stored-flows-preflight-2026-10-27T09-30-11-123Z-' + tag + '.json');
  assert.notEqual(run, preflight); assert.match(basename(run), /^hosted-stored-flows-integration-/);
  assert.notEqual(run, hostedStoredReportPath({now, cwd, tag: 'abcdef1234567890', run: true}));
  for (const options of [{now: new Date(NaN)}, {tag: '../unsafe'}, {run: 'true'}]) assert.throws(() => hostedStoredReportPath(options), /REPORT_PATH_INPUT_INVALID/);
});
