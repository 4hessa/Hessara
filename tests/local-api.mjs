import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { NVIDIA_MODELS } from '../lib/nvidia.ts';
import { validateIntegrationTarget, createIntegrationChallenge, verifyIntegrationAttestation } from '../scripts/integration-target.mjs';
const ENV_KEYS = ['HESSARA_TEST_URL', 'HESSARA_TEST_PROJECT_REF', 'HESSARA_TEST_ISOLATED', 'HESSARA_TEST_ATTESTATION_KEY', 'HESSARA_TEST_EMAIL_A', 'HESSARA_TEST_PASSWORD_A', 'HESSARA_TEST_EMAIL_B', 'HESSARA_TEST_PASSWORD_B'];
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
class IntegrationFailure extends Error {
    constructor(code, blocked = false) { super(code); this.code = code; this.blocked = blocked; }
}
export async function loadIntegrationEnvironment(cwd = process.cwd(), caller = process.env) {
    let values = {};
    try {
        values = parseEnv(await readFile(resolve(cwd, '.env.integration.local'), 'utf8'));
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw new IntegrationFailure('PRIVATE_TEST_ENV_INVALID', true);
    }
    return Object.fromEntries(ENV_KEYS.filter(key => caller[key] !== undefined || values[key] !== undefined).map(key => [key, caller[key] ?? values[key]]));
}
function cookieJar() {
    const values = new Map();
    return { update(headers) { for (const line of headers.getSetCookie()) {
            const first = line.split(';', 1)[0], index = first.indexOf('=');
            if (index <= 0)
                continue;
            const name = first.slice(0, index), value = first.slice(index + 1);
            if (/(?:^|;)\s*max-age\s*=\s*0\s*(?:;|$)/i.test(line) || !value)
                values.delete(name);
            else
                values.set(name, value);
        } }, header() { return [...values].map(([name, value]) => `${name}=${value}`).join('; '); }, names() { return [...values.keys()]; }, clear() { values.clear(); } };
}
async function boundedJson(response, signal) {
    const reader = response.body?.getReader();
    if (!reader)
        throw new IntegrationFailure('RESPONSE_BODY_MISSING');
    const chunks = [];
    let size = 0;
    const abort = () => { void reader.cancel().catch(() => { }); };
    signal.addEventListener('abort', abort, { once: true });
    try {
        while (true) {
            if (signal.aborted)
                throw new IntegrationFailure('REQUEST_TIMEOUT');
            const part = await reader.read();
            if (part.done)
                break;
            size += part.value.byteLength;
            if (size > 8000000)
                throw new IntegrationFailure('RESPONSE_TOO_LARGE');
            chunks.push(part.value);
        }
        if (signal.aborted)
            throw new IntegrationFailure('REQUEST_TIMEOUT');
        return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks)));
    }
    finally {
        signal.removeEventListener('abort', abort);
        void reader.cancel().catch(() => { });
        reader.releaseLock();
    }
}
/** Default is configuration-only. Only an attested, explicitly approved test target may mutate. */
export async function runLocalApi({ env, run = false, fetcher = fetch, reportPath = resolve('work/api-test-result.json'), invalidArguments = false } = {}) {
    const stamp = new Date().toISOString(), tag = randomBytes(8).toString('hex'), prefix = `[HESSARA E2E ${tag}]`;
    const report = { format: 'hessara-isolated-integration/1', runTag: tag, startedAt: stamp, finishedAt: null, mode: run ? 'integration' : 'preflight', status: 'pending', passed: false, phase: 'configuration', target: null, preflight: null, attestation: { verified: false }, checks: [], requests: [], resources: { profiles: [], runs: [], attempts: [] }, cleanup: { automaticResourceDeletion: false, reason: 'The application has no run/profile DELETE API; exact created IDs are retained for the isolated test operator.', signout: [], leftovers: [] }, limits: ['Simulation-only evaluation, no inference dispatch or real provider connection verification.', 'Existing dedicated test accounts only; no account signup, guest creation or OAuth automation.', 'A loopback frontend alone is not proof of an isolated backend. Server HMAC attestation must succeed before sign-in.'] };
    let writes = Promise.resolve();
    const save = () => {
        const snapshot = JSON.stringify(report, null, 2) + '\n';
        writes = writes.then(() => writeFile(reportPath, snapshot));
        return writes;
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await save();
    const jars = { A: cookieJar(), B: cookieJar() };
    let configuration, attested = false, deadline;
    const phase = name => { report.phase = name; };
    const complete = name => report.checks.push({ name, passed: true });
    const attempt = (kind, name) => { const entry = { kind, name, id: null, outcome: 'pending' }; report.resources.attempts.push(entry); return entry; };
    const record = (entry, id) => { assert.ok(idPattern.test(id), 'Created resource must return a UUID'); entry.id = id; entry.outcome = 'created'; report.resources[entry.kind === 'run' ? 'runs' : 'profiles'].push({ id, name: entry.name }); };
    let http;
    try {
        if (invalidArguments)
            throw new IntegrationFailure('UNSUPPORTED_ARGUMENT', true);
        configuration = env ?? await loadIntegrationEnvironment();
        const checked = validateIntegrationTarget(configuration);
        report.preflight = checked;
        report.target = checked.target;
        if (!checked.configured)
            throw new IntegrationFailure('CONFIGURATION_REQUIRED', true);
        if (!run) {
            report.status = 'preflight_ready';
            return report;
        }
        const { origin, projectRef } = checked.target;
        deadline = AbortSignal.timeout(600000);
        http = async (path, { method = 'GET', body, jar, headers = {}, cleanup = false } = {}) => {
            const target = new URL(path, origin);
            if (target.origin !== origin || target.username || target.password || target.hash)
                throw new IntegrationFailure('REQUEST_TARGET_INVALID');
            const signal = cleanup ? AbortSignal.timeout(10000) : AbortSignal.any([deadline, AbortSignal.timeout(30000)]);
            // Persist pending fixture attempts before a request can create a resource.
            await save();
            const response = await fetcher(target, { method, redirect: 'error', signal, headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(jar?.header() ? { cookie: jar.header() } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            report.requests.push({ method, path: target.pathname + target.search, status: response.status });
            jar?.update(response.headers);
            const data = await boundedJson(response, signal);
            await save();
            return { status: response.status, data };
        };
        phase('server-attestation');
        const challenge = createIntegrationChallenge(checked.target, configuration.HESSARA_TEST_ATTESTATION_KEY);
        let health;
        try {
            health = await http('/api/health', { headers: challenge.headers });
        }
        catch {
            throw new IntegrationFailure('SERVER_ATTESTATION_UNAVAILABLE', true);
        }
        if (health.status !== 200 || health.data?.status !== 'ready')
            throw new IntegrationFailure('SERVER_NOT_READY', true);
        if (!verifyIntegrationAttestation(health.data, checked.target, configuration.HESSARA_TEST_ATTESTATION_KEY, challenge.nonce))
            throw new IntegrationFailure('SERVER_ATTESTATION_FAILED', true);
        attested = true;
        report.attestation = { verified: true, projectRef, origin };
        complete('isolated-server-attestation');
        phase('unauthenticated-guards');
        assert.equal((await http('/api/runs')).status, 401);
        assert.equal((await http('/api/catalog/nvidia', { method: 'POST', body: { ids: [NVIDIA_MODELS[0].id], apiKey: 'test-only-no-network' } })).status, 401);
        assert.equal((await http('/api/runs', { headers: { 'oai-authenticated-user-id': 'test-forged-user' } })).status, 401);
        complete('unauthenticated-and-forged-header-rejection');
        phase('test-account-signin');
        for (const account of ['A', 'B']) {
            const signed = await http('/api/auth', { method: 'POST', jar: jars[account], body: { action: 'signin', email: configuration['HESSARA_TEST_EMAIL_' + account], password: configuration['HESSARA_TEST_PASSWORD_' + account], remember: false, next: '/' } });
            assert.equal(signed.status, 200);
            assert.ok(jars[account].names().some(name => name.startsWith(`sb-${projectRef}-auth-token`)), 'Sign-in must return a session for the expected test project');
        }
        complete('two-existing-password-test-accounts');
        const request = (path, body, extra = {}) => http('/api/' + path, { method: body === undefined ? 'GET' : 'POST', body, jar: jars.A, headers: extra });
        phase('storage-and-simulation-readiness');
        let check = await request('models');
        assert.equal(check.status, 200);
        assert.equal(check.data.vaultReady, true);
        for (const id of ['sim-atlas', 'sim-prism'])
            assert.ok(check.data.models.some(model => model.id === id && model.provider === 'simulation' && model.ready === true));
        assert.equal((await http('/api/models', { jar: jars.B })).status, 200);
        complete('authenticated-vault-and-demo-readiness');
        phase('input-origin-and-disabled-agent-validation');
        assert.equal((await request('runs', { name: 'invalid', mode: 'demo', models: ['sim-atlas'], categories: ['logic'], count: 999, repeats: 1 })).status, 400);
        assert.equal((await request('runs', { name: 'invalid' }, { origin: 'https://invalid.example' })).status, 403);
        assert.equal((await http('/api/decisions', { method: 'POST', body: { engine: 'jev', state: 'A sufficiently long test request' } })).status, 401);
        // This direct helper override intentionally supplies no Origin, testing the API's CSRF gate.
        const absentOrigin = await fetcher(new URL('/api/decisions', origin), { method: 'POST', redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(30000)]), headers: { cookie: jars.A.header(), 'content-type': 'application/json' }, body: JSON.stringify({ engine: 'jev', state: 'A sufficiently long test request' }) });
        report.requests.push({ method: 'POST', path: '/api/decisions (no Origin)', status: absentOrigin.status });
        assert.equal(absentOrigin.status, 403);
        void absentOrigin.body?.cancel().catch(() => { });
        assert.equal((await request('decisions', { engine: 'laya', state: 'Retrieve an item from a long document', endpoint: 'https://127.0.0.1/v1/systemone' })).status, 409);
        complete('validation-origin-and-private-endpoint-rejection');
        phase('encrypted-profile-response');
        const profile = attempt('profile', `${prefix} encrypted profile`);
        const connection = await request('models', { name: profile.name, provider: 'openai', model: 'test-only-no-provider-calls', apiKey: 'test-only-not-a-real-api-key', inputPrice: null, outputPrice: null });
        assert.equal(connection.status, 201);
        assert.ok(!JSON.stringify(connection.data).includes('test-only-not-a-real-api-key'));
        assert.ok(!JSON.stringify(connection.data).includes('key_cipher'));
        record(profile, connection.data.models.find(item => item.name === profile.name)?.id);
        const modelId = profile.id;
        complete('encrypted-profile-response-redaction');
        phase('240-simulation-trials');
        const firstRun = attempt('run', `${prefix} 240 simulation trials`);
        const created = await request('runs', { name: firstRun.name, mode: 'demo', models: ['sim-atlas'], categories: ['coding', 'logic', 'analysis', 'retrieval', 'instruction', 'long'], count: 40, repeats: 1 });
        assert.equal(created.status, 201);
        assert.equal(created.data.run.total, 240);
        record(firstRun, created.data.run.id);
        const id = firstRun.id;
        let step = await request('runs/' + id, { action: 'step' });
        assert.equal(step.status, 200);
        assert.equal(step.data.trials.length, 24);
        const reloaded = await request('runs/' + id);
        assert.equal(reloaded.data.trials.length, 24);
        const concurrent = await Promise.all([request('runs/' + id, { action: 'step' }), request('runs/' + id, { action: 'step' })]);
        assert.ok(concurrent.every(value => [200, 409].includes(value.status)));
        for (let i = 0; i < 20; i++) {
            step = await request('runs/' + id, { action: 'step' });
            assert.equal(step.status, 200);
            if (step.data.run.status === 'completed')
                break;
        }
        assert.equal(step.data.run.status, 'completed');
        assert.equal(step.data.trials.length, 240);
        assert.equal(step.data.pagination.total, 240);
        assert.equal(step.data.pagination.nextOffset, null);
        assert.equal(step.data.run.done, 240);
        assert.equal(new Set(step.data.trials.map(item => item.id)).size, 240);
        assert.ok(step.data.trials.every(item => item.status === 'done' && item.metadata.includes('simulation')));
        const firstPage = await request('runs/' + id + '?offset=0&limit=37'), secondPage = await request('runs/' + id + '?offset=37&limit=37');
        assert.equal(firstPage.status, 200);
        assert.equal(secondPage.status, 200);
        assert.equal(firstPage.data.trials.length, 37);
        assert.equal(secondPage.data.trials.length, 37);
        assert.equal(firstPage.data.pagination.nextOffset, 37);
        assert.equal(secondPage.data.pagination.nextOffset, 74);
        assert.equal(firstPage.data.run.done, 240);
        assert.equal(secondPage.data.run.done, 240);
        assert.equal(new Set([...firstPage.data.trials, ...secondPage.data.trials].map(item => item.id)).size, 74);
        assert.equal((await request('runs/' + id + '?offset=-1')).status, 400);
        const again = await request('runs/' + id, { action: 'step' });
        assert.equal(again.data.trials.length, 240);
        complete('simulation-persistence-resume-concurrency-pagination-idempotency');
        phase('432-simulation-pagination');
        const secondRun = attempt('run', `${prefix} 432 paginated trials`);
        const bigger = await request('runs', { name: secondRun.name, mode: 'demo', models: ['sim-atlas', 'sim-prism'], categories: ['coding', 'logic', 'analysis', 'retrieval', 'instruction', 'long'], count: 12, repeats: 3 });
        assert.equal(bigger.status, 201);
        assert.equal(bigger.data.run.total, 432);
        record(secondRun, bigger.data.run.id);
        let larger;
        for (let i = 0; i < 20; i++) {
            larger = await request('runs/' + secondRun.id, { action: 'step' });
            assert.equal(larger.status, 200);
            if (larger.data.run.status === 'completed')
                break;
        }
        assert.equal(larger.data.run.status, 'completed');
        assert.equal(larger.data.run.done, 432);
        assert.equal(larger.data.trials.length, 250);
        assert.equal(larger.data.pagination.nextOffset, 250);
        const remaining = await request('runs/' + secondRun.id + '?offset=250');
        assert.equal(remaining.status, 200);
        assert.equal(remaining.data.trials.length, 182);
        assert.equal(remaining.data.pagination.nextOffset, null);
        assert.equal(new Set([...larger.data.trials, ...remaining.data.trials].map(item => item.id)).size, 432);
        complete('large-simulation-pagination');
        phase('owner-isolation');
        assert.equal((await http('/api/runs/' + id)).status, 401);
        assert.equal((await http('/api/runs/' + id, { jar: jars.B })).status, 404);
        const other = await http('/api/models', { jar: jars.B });
        assert.equal(other.status, 200);
        assert.ok(!other.data.models.some(item => item.id === modelId));
        complete('two-account-experiment-and-profile-isolation');
        phase('offline-paperclip-draft');
        const paperclip = await request('integrations/paperclip');
        assert.equal(paperclip.status, 200);
        assert.equal(paperclip.data.ready, false, 'Test target must not configure Paperclip dispatch');
        const draft = await request('integrations/paperclip', { runId: id, action: 'download' });
        assert.equal(draft.status, 200);
        assert.equal(draft.data.issue.status, 'backlog');
        assert.equal(draft.data.issue.assigneeAgentId, undefined);
        assert.ok(draft.data.issue.description.includes(id));
        assert.ok(!JSON.stringify(draft.data).includes('test-only-not-a-real-api-key'));
        assert.equal((await request('integrations/paperclip', { runId: id, action: 'send' })).status, 409);
        complete('paperclip-offline-draft-and-disabled-send');
        phase('invalid-catalog-and-custom-profile');
        const unknown = 'hessara-test/not-in-catalog-' + tag;
        assert.ok(!NVIDIA_MODELS.some(item => item.id === unknown));
        const registry = JSON.parse(await readFile(new URL('../lib/catalog/models.json', import.meta.url), 'utf8'));
        assert.ok(!registry.some(item => item.id === unknown));
        assert.equal((await request('catalog/connect', { ids: [unknown], apiKey: 'test-only-not-a-real-api-key' })).status, 400);
        assert.equal((await request('catalog/nvidia', { ids: [unknown], apiKey: 'test-only-not-a-real-api-key' })).status, 400);
        const customEntry = attempt('profile', `${prefix} custom OpenRouter`);
        const custom = await request('models', { name: customEntry.name, provider: 'openrouter', model: 'custom/unlisted-model', apiKey: 'test-only-not-a-real-api-key', inputPrice: null, outputPrice: null });
        assert.equal(custom.status, 201);
        assert.ok(custom.data.models.some(item => item.label === 'custom/unlisted-model'));
        record(customEntry, custom.data.models.find(item => item.name === customEntry.name)?.id);
        complete('unknown-catalog-rejection-and-custom-profile-storage');
        report.status = 'success';
        report.passed = true;
        phase('completed');
    }
    catch (error) {
        report.status = error instanceof IntegrationFailure && error.blocked ? 'blocked' : 'failure';
        report.passed = false;
        report.error = error instanceof IntegrationFailure ? error.code : error?.code === 'ERR_ASSERTION' ? 'CONTRACT_ASSERTION_FAILED' : 'REQUEST_OR_RESPONSE_FAILED';
    }
    finally {
        for (const entry of report.resources.attempts)
            if (entry.outcome === 'pending')
                entry.outcome = 'unknown';
        if (attested && http) {
            for (const account of ['A', 'B'])
                if (jars[account].header()) {
                    try {
                        const result = await http('/api/auth', { method: 'POST', jar: jars[account], body: { action: 'signout' }, cleanup: true });
                        report.cleanup.signout.push({ account, status: result.status, passed: result.status === 200 });
                        if (result.status !== 200 && report.passed) {
                            report.passed = false;
                            report.status = 'failure';
                            report.error = 'SIGNOUT_FAILED';
                        }
                    }
                    catch {
                        report.cleanup.signout.push({ account, passed: false, error: 'SIGNOUT_FAILED' });
                        if (report.passed) {
                            report.passed = false;
                            report.status = 'failure';
                            report.error = 'SIGNOUT_FAILED';
                        }
                    }
                    finally {
                        jars[account].clear();
                    }
                }
        }
        report.cleanup.leftovers = report.resources.attempts.filter(entry => ['created', 'unknown'].includes(entry.outcome)).map(entry => ({ ...entry }));
        report.finishedAt = new Date().toISOString();
        await save();
    }
    return report;
}
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const args = process.argv.slice(2);
    runLocalApi({ run: args.includes('--run'), invalidArguments: args.some(value => value !== '--run') }).then(report => { console.log(JSON.stringify({ status: report.status, passed: report.passed, mode: report.mode, target: report.target, issues: report.preflight?.issues ?? [], error: report.error ?? null, checks: report.checks.length, report: 'work/api-test-result.json' }, null, 2)); process.exitCode = report.status === 'preflight_ready' ? 0 : report.passed ? 0 : report.status === 'blocked' ? 2 : 1; }).catch(() => { console.error(JSON.stringify({ status: 'failure', passed: false, error: 'REPORT_WRITE_FAILED' })); process.exitCode = 1; });
}
