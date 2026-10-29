import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validateIntegrationTarget, createIntegrationChallenge, verifyIntegrationAttestation, APPROVED_TEST_PROJECT_REF, PRODUCTION_PROJECT_REF } from '../scripts/integration-target.mjs';
const env = { HESSARA_TEST_URL: 'http://127.0.0.1:5174', HESSARA_TEST_PROJECT_REF: APPROVED_TEST_PROJECT_REF, HESSARA_TEST_ISOLATED: 'true', HESSARA_TEST_ATTESTATION_KEY: 'fixture-key-'.repeat(4), HESSARA_TEST_EMAIL_A: 'test-a@example.test', HESSARA_TEST_PASSWORD_A: 'fixture password A', HESSARA_TEST_EMAIL_B: 'test-b@example.test', HESSARA_TEST_PASSWORD_B: 'fixture password B' };
const target = validateIntegrationTarget(env).target, key = env.HESSARA_TEST_ATTESTATION_KEY, nonce = 'a'.repeat(64), now = 1800000000000;
function proof(issuedAt = new Date(now).toISOString()) { const value = { version: 1, nonce, origin: target.origin, projectRef: target.projectRef, issuedAt }; return { status: 'ready', integration: { ...value, proof: createHmac('sha256', key).update(`hessara-integration-response-v1\n${nonce}\n${target.origin}\n${target.projectRef}\n${issuedAt}`).digest('hex') } }; }
test('isolated target policy requires the explicitly approved project and distinct configured accounts', () => {
    assert.deepEqual(validateIntegrationTarget(env), { configured: true, issues: [], target });
    for (const host of ['localhost:5174', '127.0.0.1:5174', '[::1]:5174'])
        assert.equal(validateIntegrationTarget({ ...env, HESSARA_TEST_URL: 'http://' + host }).configured, true);
    for (const [name, value, issue] of [['HESSARA_TEST_PROJECT_REF', PRODUCTION_PROJECT_REF, 'PRODUCTION_PROJECT_FORBIDDEN'], ['HESSARA_TEST_PROJECT_REF', 'x'.repeat(20), 'TEST_PROJECT_NOT_APPROVED'], ['HESSARA_TEST_PROJECT_REF', 'bad', 'TEST_PROJECT_INVALID'], ['HESSARA_TEST_ISOLATED', 'false', 'ISOLATION_ACK_REQUIRED'], ['HESSARA_TEST_ATTESTATION_KEY', 'short', 'ATTESTATION_KEY_REQUIRED'], ['HESSARA_TEST_EMAIL_B', 'TEST-A@example.test', 'TEST_ACCOUNTS_MUST_DIFFER']])
        assert.ok(validateIntegrationTarget({ ...env, [name]: value }).issues.includes(issue), issue);
    for (const name of Object.keys(env)) {
        const changed = { ...env };
        delete changed[name];
        assert.equal(validateIntegrationTarget(changed).configured, false, name);
    }
});
test('target parsing rejects non-loopback origins, credentials and non-root URL shapes without reflecting values', () => {
    for (const url of ['https://127.0.0.1:5174', 'http://10.0.0.1:5174', 'http://192.168.0.2', 'http://169.254.169.254', 'http://localhost.evil.example', 'http://user:private-value@localhost:5174', 'http://localhost:5174/path', 'http://localhost:5174?secret=private-value', 'http://localhost:5174#fragment', 'not a URL']) {
        const result = validateIntegrationTarget({ ...env, HESSARA_TEST_URL: url });
        assert.equal(result.configured, false, url);
        assert.ok(result.issues.includes('TEST_URL_INVALID'));
        assert.ok(!JSON.stringify(result).includes('private-value'));
    }
    const result = JSON.stringify(validateIntegrationTarget(env));
    for (const secret of [key, env.HESSARA_TEST_PASSWORD_A, env.HESSARA_TEST_PASSWORD_B, env.HESSARA_TEST_EMAIL_A])
        assert.ok(!result.includes(secret));
});
test('challenge signs the exact origin/project/nonce contract without transmitting its key', () => {
    const result = createIntegrationChallenge(target, key, nonce);
    assert.equal(result.nonce, nonce);
    assert.equal(result.headers['x-hessara-test-auth'], createHmac('sha256', key).update(`hessara-integration-request-v1\n${nonce}\n${target.origin}\n${target.projectRef}`).digest('hex'));
    assert.ok(!JSON.stringify(result).includes(key));
    for (const changed of [{ ...target, projectRef: PRODUCTION_PROJECT_REF }, { ...target, origin: 'https://remote.example' }])
        assert.throws(() => createIntegrationChallenge(changed, key, nonce), /INVALID_INTEGRATION_CHALLENGE/);
    assert.throws(() => createIntegrationChallenge(target, 'short', nonce), /INVALID_INTEGRATION_CHALLENGE/);
    assert.throws(() => createIntegrationChallenge(target, key, 'bad'), /INVALID_INTEGRATION_CHALLENGE/);
});
test('attestation verifies fresh exact fields and rejects stale, future, changed or replayed proofs', () => {
    assert.equal(verifyIntegrationAttestation(proof(), target, key, nonce, now), true);
    assert.equal(verifyIntegrationAttestation(proof(new Date(now - 30000).toISOString()), target, key, nonce, now), true);
    for (const delta of [-30001, 5001])
        assert.equal(verifyIntegrationAttestation(proof(new Date(now + delta).toISOString()), target, key, nonce, now), false);
    for (const changed of [null, {}, [], { status: 'setup_required', integration: proof().integration }, { ...proof(), extra: true }, { ...proof(), integration: { ...proof().integration, extra: true } }, { ...proof(), integration: { ...proof().integration, proof: '0'.repeat(64) } }, { ...proof(), integration: { ...proof().integration, projectRef: PRODUCTION_PROJECT_REF } }, { ...proof(), integration: { ...proof().integration, version: 2 } }])
        assert.equal(verifyIntegrationAttestation(changed, target, key, nonce, now), false);
    assert.equal(verifyIntegrationAttestation(proof(), target, key, 'b'.repeat(64), now), false);
    assert.equal(verifyIntegrationAttestation(proof(), target, 'different-key-'.repeat(4), nonce, now), false);
    assert.equal(verifyIntegrationAttestation(proof(), { ...target, origin: 'http://localhost:5174' }, key, nonce, now), false);
});
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { runLocalApi, loadIntegrationEnvironment } from './local-api.mjs';
async function temporaryReport(t) {
    const folder = await mkdtemp(join(tmpdir(), 'hessara-integration-guards-'));
    t.after(async () => { const exact = resolve(folder); assert.equal(dirname(exact), resolve(tmpdir())); assert.ok(basename(exact).startsWith('hessara-integration-guards-')); await rm(exact, { recursive: true, force: true }); });
    return { folder, path: join(folder, 'api-test-result.json') };
}
function signedHealth(headers) {
    const requestNonce = new Headers(headers).get('x-hessara-test-nonce'), issuedAt = new Date().toISOString();
    return { status: 'ready', integration: { version: 1, nonce: requestNonce, origin: target.origin, projectRef: target.projectRef, issuedAt, proof: createHmac('sha256', key).update(`hessara-integration-response-v1\n${requestNonce}\n${target.origin}\n${target.projectRef}\n${issuedAt}`).digest('hex') } };
}
function assertNoSecrets(value) { for (const secret of [key, env.HESSARA_TEST_EMAIL_A, env.HESSARA_TEST_EMAIL_B, env.HESSARA_TEST_PASSWORD_A, env.HESSARA_TEST_PASSWORD_B])
    assert.ok(!JSON.stringify(value).includes(secret)); }
test('default invocation performs configuration-only preflight with zero HTTP and replaces stale success', async (t) => {
    const temp = await temporaryReport(t);
    await writeFile(temp.path, JSON.stringify({ status: 'success', passed: true, stale: true }));
    let requests = 0;
    const result = await runLocalApi({ env, reportPath: temp.path, fetcher: async () => { requests++; throw Error('No HTTP is allowed'); } });
    assert.equal(requests, 0);
    assert.equal(result.status, 'preflight_ready');
    assert.equal(result.passed, false);
    assert.equal(result.mode, 'preflight');
    assert.equal(result.attestation.verified, false);
    assert.deepEqual(result.requests, []);
    assert.ok(result.finishedAt);
    assert.deepEqual(result.resources.runs, []);
    const saved = JSON.parse(await readFile(temp.path, 'utf8'));
    assert.deepEqual(saved, result);
    assert.equal(saved.stale, undefined);
    assertNoSecrets(saved);
});
test('run mode fails closed before HTTP for missing configuration, production project and unsupported arguments', async (t) => {
    const temp = await temporaryReport(t);
    let requests = 0;
    const fetcher = async () => { requests++; throw Error('Forbidden HTTP'); };
    for (const options of [{ env: {} }, { env: { ...env, HESSARA_TEST_PROJECT_REF: PRODUCTION_PROJECT_REF } }, { env: { ...env, HESSARA_TEST_ISOLATED: 'false' } }, { env, invalidArguments: true }]) {
        await writeFile(temp.path, JSON.stringify({ status: 'success', passed: true }));
        const result = await runLocalApi({ ...options, run: true, fetcher, reportPath: temp.path });
        assert.equal(result.status, 'blocked');
        assert.equal(result.passed, false);
        assert.deepEqual(result.requests, []);
        assert.equal(JSON.parse(await readFile(temp.path, 'utf8')).passed, false);
        assertNoSecrets(result);
    }
    assert.equal(requests, 0);
});
test('run sends only a bounded nonredirecting health challenge when proof is absent, changed or server is not ready', async (t) => {
    const temp = await temporaryReport(t);
    for (const variant of ['missing', 'bad-proof', 'wrong-project', 'not-ready', 'bad-json', 'network-failure']) {
        const seen = [];
        const result = await runLocalApi({ env, run: true, reportPath: temp.path, fetcher: async (url, options) => {
                seen.push({ url: String(url), options });
                assert.equal(new URL(url).pathname, '/api/health');
                assert.equal(new URL(url).search, '');
                assert.equal(options.method, 'GET');
                assert.equal(options.redirect, 'error');
                assert.ok(options.signal instanceof AbortSignal);
                assert.equal(new Headers(options.headers).has('cookie'), false);
                assert.equal(options.body, undefined);
                const actual = new Headers(options.headers);
                assert.match(actual.get('x-hessara-test-nonce'), /^[a-f0-9]{64}$/);
                assert.equal(actual.get('x-hessara-test-auth'), createHmac('sha256', key).update(`hessara-integration-request-v1\n${actual.get('x-hessara-test-nonce')}\n${target.origin}\n${target.projectRef}`).digest('hex'));
                if (variant === 'network-failure')
                    throw Error('Untrusted remote error ' + key);
                if (variant === 'bad-json')
                    return new Response('not json', { status: 200 });
                const body = variant === 'missing' ? { status: 'ready' } : signedHealth(options.headers);
                if (variant === 'bad-proof')
                    body.integration.proof = '0'.repeat(64);
                if (variant === 'wrong-project')
                    body.integration.projectRef = PRODUCTION_PROJECT_REF;
                return Response.json(body, { status: variant === 'not-ready' ? 503 : 200 });
            } });
        assert.equal(result.status, 'blocked', variant);
        assert.equal(result.passed, false);
        assert.equal(result.attestation.verified, false);
        assert.equal(seen.length, 1);
        assert.equal(result.requests.some(item => item.path === '/api/auth'), false);
        assertNoSecrets(result);
    }
});
test('supported password sign-in is attempted only after valid attestation and never stores credentials or error bodies', async (t) => {
    const temp = await temporaryReport(t), seen = [];
    const result = await runLocalApi({ env, run: true, reportPath: temp.path, fetcher: async (url, options) => {
            const path = new URL(url).pathname;
            seen.push(path);
            assert.equal(new URL(url).origin, target.origin);
            assert.equal(options.redirect, 'error');
            assert.ok(options.signal instanceof AbortSignal);
            if (path === '/api/health')
                return Response.json(signedHealth(options.headers));
            if (path === '/api/auth') {
                assert.equal(seen[0], '/api/health');
                assert.deepEqual(JSON.parse(options.body), { action: 'signin', email: env.HESSARA_TEST_EMAIL_A, password: env.HESSARA_TEST_PASSWORD_A, remember: false, next: '/' });
                return Response.json({ error: 'Sensitive response body ' + key }, { status: 401 });
            }
            assert.ok(['/api/runs', '/api/catalog/nvidia'].includes(path));
            return Response.json({ code: 'AUTH_REQUIRED' }, { status: 401 });
        } });
    assert.deepEqual(seen, ['/api/health', '/api/runs', '/api/catalog/nvidia', '/api/runs', '/api/auth']);
    assert.equal(result.attestation.verified, true);
    assert.equal(result.status, 'failure');
    assert.equal(result.error, 'CONTRACT_ASSERTION_FAILED');
    assert.deepEqual(result.cleanup.leftovers, []);
    assertNoSecrets(result);
    assertNoSecrets(JSON.parse(await readFile(temp.path, 'utf8')));
});
test('only explicitly named private integration variables are loaded, with caller precedence', async (t) => {
    const temp = await temporaryReport(t);
    await writeFile(join(temp.folder, '.env.integration.local'), 'HESSARA_TEST_URL=http://localhost:5174\nHESSARA_TEST_PROJECT_REF=' + APPROVED_TEST_PROJECT_REF + '\nHESSARA_TEST_EMAIL_A=private-fixture@example.test\nDATABASE_URL=must-never-be-loaded\nOPENAI_API_KEY=must-never-be-loaded\n');
    assert.deepEqual(await loadIntegrationEnvironment(temp.folder, { HESSARA_TEST_URL: 'http://127.0.0.1:5174', UNRELATED_SECRET: 'must-never-be-loaded' }), { HESSARA_TEST_URL: 'http://127.0.0.1:5174', HESSARA_TEST_PROJECT_REF: APPROVED_TEST_PROJECT_REF, HESSARA_TEST_EMAIL_A: 'private-fixture@example.test' });
    assert.deepEqual(await loadIntegrationEnvironment(join(temp.folder, 'missing'), {}), {});
});
test('partial runs retain an exact fixture ledger and sign out both sessions without persisting cookies', async (t) => {
    const temp = await temporaryReport(t), profileId = '11111111-1111-4111-8111-111111111111', signouts = [];
    let createdProfile;
    const models = () => ({ vaultReady: true, models: [{ id: 'sim-atlas', provider: 'simulation', ready: true }, { id: 'sim-prism', provider: 'simulation', ready: true }, ...(createdProfile ? [createdProfile] : [])] });
    const result = await runLocalApi({ env, run: true, reportPath: temp.path, fetcher: async (url, options) => {
            const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : null, headers = new Headers(options.headers);
            assert.equal(options.redirect, 'error');
            assert.equal(new URL(url).origin, target.origin);
            if (path === '/api/health')
                return Response.json(signedHealth(options.headers));
            if (path === '/api/auth') {
                if (body.action === 'signout') {
                    signouts.push(headers.get('cookie'));
                    return Response.json({ redirect: '/' }, { headers: { 'set-cookie': `sb-${APPROVED_TEST_PROJECT_REF}-auth-token=; Max-Age=0; Path=/` } });
                }
                assert.equal(body.action, 'signin');
                const account = body.email === env.HESSARA_TEST_EMAIL_A ? 'a' : 'b';
                return Response.json({ redirect: '/' }, { headers: { 'set-cookie': `sb-${APPROVED_TEST_PROJECT_REF}-auth-token=private-cookie-${account}; HttpOnly; Path=/` } });
            }
            if (!headers.has('cookie'))
                return Response.json({ code: 'AUTH_REQUIRED' }, { status: 401 });
            if (path === '/api/models') {
                if (body) {
                    assert.equal(body.provider, 'openai');
                    assert.equal(body.model, 'test-only-no-provider-calls');
                    const pending = JSON.parse(await readFile(temp.path, 'utf8'));
                    assert.ok(pending.resources.attempts.some(entry => entry.kind === 'profile' && entry.name === body.name && entry.outcome === 'pending'));
                    createdProfile = { id: profileId, name: body.name };
                    return Response.json(models(), { status: 201 });
                }
                return Response.json(models());
            }
            if (path === '/api/decisions')
                return Response.json({ code: 'NOT_READY' }, { status: headers.has('origin') ? 409 : 403 });
            if (path === '/api/runs') {
                if (headers.get('origin') !== target.origin)
                    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
                if (body.count === 999)
                    return Response.json({ code: 'INVALID_INPUT' }, { status: 400 });
                const pending = JSON.parse(await readFile(temp.path, 'utf8'));
                assert.ok(pending.resources.attempts.some(entry => entry.kind === 'run' && entry.name === body.name && entry.outcome === 'pending'));
                assert.equal(body.mode, 'demo');
                assert.deepEqual(body.models, ['sim-atlas']);
                return Response.json({ error: 'Fixture interrupted after request receipt' }, { status: 503 });
            }
            throw Error('Unexpected fixture path');
        } });
    assert.equal(result.status, 'failure');
    assert.equal(result.passed, false);
    assert.equal(result.error, 'CONTRACT_ASSERTION_FAILED');
    assert.equal(signouts.length, 2);
    assert.deepEqual(result.cleanup.signout, [{ account: 'A', status: 200, passed: true }, { account: 'B', status: 200, passed: true }]);
    assert.equal(result.resources.profiles.length, 1);
    assert.equal(result.resources.profiles[0].id, profileId);
    assert.equal(result.resources.runs.length, 0);
    assert.equal(result.cleanup.leftovers.length, 2);
    assert.deepEqual(result.cleanup.leftovers.map(item => ({ kind: item.kind, id: item.id, outcome: item.outcome })), [{ kind: 'profile', id: profileId, outcome: 'created' }, { kind: 'run', id: null, outcome: 'unknown' }]);
    for (const item of result.cleanup.leftovers)
        assert.ok(item.name.startsWith(`[HESSARA E2E ${result.runTag}]`));
    assertNoSecrets(result);
    assert.ok(!JSON.stringify(result).includes('private-cookie'));
    assert.ok(!JSON.stringify(result).includes('Fixture interrupted'));
});
