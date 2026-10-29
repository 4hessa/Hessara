import assert from 'node:assert/strict';
import {mkdir, open, lstat} from 'node:fs/promises';
import {resolve, dirname, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes, randomUUID} from 'node:crypto';
import {loadIntegrationEnvironment} from './local-api.mjs';
import {validateIntegrationTarget, createIntegrationChallenge, verifyIntegrationAttestation} from '../scripts/integration-target.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const engineIds = ['angr', 'ghidra', 'jadx', 'mobsf', 'radare2', 'rea', 'rizin'];
class StoredFlowFailure extends Error {
  constructor(code, blocked = false) { super(code); this.code = code; this.blocked = blocked; }
}
function cookieJar() {
  const cookies = new Map();
  return {
    update(headers) {
      for (const line of headers.getSetCookie()) {
        const first = line.split(';', 1)[0], index = first.indexOf('=');
        if (index < 1) continue;
        const name = first.slice(0, index), value = first.slice(index + 1);
        if (!value || /(?:^|;)\s*max-age\s*=\s*0\s*(?:;|$)/i.test(line)) cookies.delete(name);
        else cookies.set(name, value);
      }
    },
    header: () => [...cookies].map(([name, value]) => name + '=' + value).join('; '),
    hasProject: ref => [...cookies.keys()].some(name => name.startsWith('sb-' + ref + '-auth-token')),
    clear: () => cookies.clear(),
  };
}
async function boundedJson(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw new StoredFlowFailure('RESPONSE_BODY_MISSING');
  const chunks = []; let size = 0, combined;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, {once: true});
  try {
    while (true) {
      if (signal.aborted) throw new StoredFlowFailure('REQUEST_TIMEOUT');
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 2_000_000) throw new StoredFlowFailure('RESPONSE_TOO_LARGE');
      chunks.push(part.value);
    }
    if (signal.aborted) throw new StoredFlowFailure('REQUEST_TIMEOUT');
    combined = Buffer.concat(chunks);
    return JSON.parse(new TextDecoder('utf8', {fatal: true}).decode(combined));
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {}); reader.releaseLock();
    combined?.fill(0); for (const chunk of chunks) chunk.fill(0);
  }
}
async function exclusiveReport(path) {
  await mkdir(dirname(path), {recursive: true});
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch (error) { throw new StoredFlowFailure(error.code === 'EEXIST' ? 'REPORT_ALREADY_EXISTS' : 'REPORT_CREATE_FAILED', true); }
  const original = await handle.stat();
  return {
    async save(report) {
      const current = await lstat(path);
      if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.dev !== original.dev || current.ino !== original.ino) throw new StoredFlowFailure('REPORT_CHANGED');
      const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
      try {
        let offset = 0;
        while (offset < bytes.length) { const result = await handle.write(bytes, offset, bytes.length - offset, offset); if (!result.bytesWritten) throw new StoredFlowFailure('REPORT_WRITE_FAILED'); offset += result.bytesWritten; }
        await handle.truncate(bytes.length); await handle.sync();
      } finally { bytes.fill(0); }
    },
    close: () => handle.close(),
  };
}
const safeCode = error => error instanceof StoredFlowFailure ? error.code : error?.code === 'ERR_ASSERTION' ? 'CONTRACT_ASSERTION_FAILED' : 'REQUEST_OR_RESPONSE_FAILED';

/** Unique CLI evidence paths keep offline preflight and explicit runs independently reviewable. */
export function hostedStoredReportPath({run = false, now = new Date(), tag = randomBytes(8).toString('hex'), cwd = process.cwd()} = {}) {
  if (typeof run !== 'boolean' || !(now instanceof Date) || !Number.isFinite(now.getTime()) || typeof tag !== 'string' || !/^[a-f0-9]{16}$/.test(tag)) throw new StoredFlowFailure('REPORT_PATH_INPUT_INVALID', true);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return resolve(cwd, 'work', 'hosted-stored-flows-' + (run ? 'integration' : 'preflight') + '-' + stamp + '-' + tag + '.json');
}
/** Explicit isolated stored-state tests only. No model generation or analysis execution is dispatched. */
export async function runHostedStoredFlows({env, run = false, fetcher = fetch, reportPath = resolve('work/hosted-stored-flows-result.json'), invalidArguments = false} = {}) {
  const report = {
    format: 'hessara-hosted-stored-flows/1', startedAt: new Date().toISOString(), finishedAt: null,
    mode: run ? 'integration' : 'preflight', status: 'pending', passed: false, phase: 'configuration',
    target: null, preflight: null, attestation: {verified: false}, checks: [], requests: [],
    sections: {reverseEngineering: 'not_started'}, engines: [], storage: null,
    resources: [], cleanup: {signout: [], retained: [], permanentDeletion: false},
    limits: ['Reverse-engineering stored-state contracts only; no provider inference, analysis execution, upload or engine activation.', 'Existing dedicated A/B accounts only; no signup or OAuth.', 'Project DELETE operations are soft deletion; retained IDs remain available for the isolated operator.', 'A pre-existing report is never overwritten. Cleanup requests have independent ten-second budgets.'],
  };
  let recorder, configuration, http, attested = false;
  const jars = {A: cookieJar(), B: cookieJar()}, tag = randomBytes(8).toString('hex');
  const save = () => recorder.save(structuredClone(report));
  const complete = name => report.checks.push({name, passed: true});
  const phase = value => { report.phase = value; };
  const attempt = kind => { const entry = {kind, id: null, outcome: 'pending', state: 'unknown'}; report.resources.push(entry); return entry; };
  async function observe(entry, response, value) {
    if (uuid.test(value?.id ?? '')) { entry.id = value.id; entry.outcome = response.status === 201 ? 'created' : 'observed'; entry.state = 'active'; }
    await save();
  }
  const expect = (response, status, code) => { assert.equal(response.status, status); if (code) assert.equal(response.data?.error, code); return response.data; };
  async function deleteProject(entry, cleanup = false) {
    const data = expect(await http('/api/reverse-engineering/projects/' + entry.id, {method: 'DELETE', slot: 'A', cleanup}), 200);
    assert.equal(data.project?.id, entry.id); assert.ok(Number.isFinite(data.project.deletedAt));
    entry.state = 'soft_deleted'; await save();
  }
  try {
    recorder = await exclusiveReport(reportPath); await save();
    if (invalidArguments) throw new StoredFlowFailure('UNSUPPORTED_ARGUMENT', true);
    configuration = env ?? await loadIntegrationEnvironment();
    const checked = validateIntegrationTarget(configuration); report.preflight = checked; report.target = checked.target;
    if (!checked.configured) throw new StoredFlowFailure('CONFIGURATION_REQUIRED', true);
    if (!run) { report.status = 'preflight_ready'; return report; }
    const {origin, projectRef} = checked.target, deadline = AbortSignal.timeout(600_000);
    http = async (path, {method = 'GET', body, slot, headers = {}, cleanup = false} = {}) => {
      const target = new URL(path, origin);
      if (!path.startsWith('/api/') || target.origin !== origin || target.username || target.password || target.hash) throw new StoredFlowFailure('REQUEST_TARGET_INVALID');
      const signal = cleanup ? AbortSignal.timeout(10_000) : AbortSignal.any([deadline, AbortSignal.timeout(30_000)]), jar = jars[slot];
      const persist = async () => { try { await save(); } catch (error) { if (!cleanup) throw error; report.passed = false; report.status = 'failure'; report.error = 'REPORT_WRITE_FAILED'; } };
      await persist(); // Includes a durable pending resource attempt before creation dispatch.
      const response = await fetcher(target, {method, redirect: 'error', cache: 'no-store', signal,
        headers: {origin, ...(body === undefined ? {} : {'content-type': 'application/json'}), ...(jar?.header() ? {cookie: jar.header()} : {}), ...headers},
        ...(body === undefined ? {} : {body: JSON.stringify(body)})});
      report.requests.push({method, path: target.pathname + target.search, status: response.status}); jar?.update(response.headers);
      const data = await boundedJson(response, signal); await persist(); return {status: response.status, data};
    };
    phase('server-attestation');
    const challenge = createIntegrationChallenge(checked.target, configuration.HESSARA_TEST_ATTESTATION_KEY);
    const health = await http('/api/health', {headers: challenge.headers});
    if (health.status !== 200 || !verifyIntegrationAttestation(health.data, checked.target, configuration.HESSARA_TEST_ATTESTATION_KEY, challenge.nonce)) throw new StoredFlowFailure('SERVER_ATTESTATION_FAILED', true);
    attested = true; report.attestation = {verified: true}; complete('isolated-server-attestation');
    phase('authentication');
    expect(await http('/api/toopee/threads'), 410, 'FEATURE_REMOVED');
    expect(await http('/api/reverse-engineering/projects'), 401, 'AUTH_REQUIRED');
    for (const slot of ['A', 'B']) {
      expect(await http('/api/auth', {method: 'POST', slot, body: {action: 'signin', email: configuration['HESSARA_TEST_EMAIL_' + slot], password: configuration['HESSARA_TEST_PASSWORD_' + slot], remember: false, next: '/'}}), 200);
      assert.ok(jars[slot].hasProject(projectRef));
    }
    complete('existing-account-authentication');
    phase('assistant-retirement');
    expect(await http('/api/toopee', {slot: 'A'}), 410, 'FEATURE_REMOVED');
    expect(await http('/api/toopee/threads', {method: 'POST', slot: 'A', body: {modelId: 'retired', locale: 'ar'}}), 410, 'FEATURE_REMOVED');
    complete('built-in-assistant-retired-without-provider-or-storage-access');
    phase('reverse-engineering-readiness'); report.sections.reverseEngineering = 'running';
    const tools = expect(await http('/api/reverse-engineering/tools', {slot: 'A'}), 200);
    assert.ok(Array.isArray(tools.items)); assert.deepEqual(tools.items.map(item => item.id).sort(), engineIds);
    for (const tool of tools.items) {
      assert.equal(tool.operational, false); assert.equal(tool.available, false);
      assert.ok(['unavailable', 'maintenance', 'error'].includes(tool.operationalStatus)); assert.match(tool.reasonCode ?? '', /^[A-Z_]{1,80}$/);
      report.engines.push({id: tool.id, operational: false, status: tool.operationalStatus, reasonCode: tool.reasonCode});
    }
    const overview = expect(await http('/api/reverse-engineering/overview', {slot: 'A'}), 200);
    assert.equal(overview.stats.availableEngines, 0);
    for (const collection of ['projects', 'jobs', 'reports']) { const page = expect(await http('/api/reverse-engineering/' + collection, {slot: 'A'}), 200); assert.ok(Array.isArray(page.items)); assert.ok(Number.isSafeInteger(page.total) && page.total >= 0); }
    const storage = await http('/api/reverse-engineering/storage', {slot: 'A'});
    if (storage.status === 200) { assert.equal(storage.data.available, true); assert.equal(storage.data.bucket, 'hessara-re-artifacts'); assert.equal(storage.data.malwareScanning, 'unavailable'); report.storage = {healthAvailable: true, uploadVerified: false, scanVerified: false}; }
    else { expect(storage, 503); assert.ok(['STORAGE_NOT_CONFIGURED', 'PRIVATE_STORAGE_UNAVAILABLE'].includes(storage.data.error)); report.storage = {healthAvailable: false, reasonCode: storage.data.error, uploadVerified: false, scanVerified: false}; }
    complete('honest-engine-and-storage-readiness');
    phase('reverse-engineering-project');
    const project = attempt('re_project'), projectResponse = await http('/api/reverse-engineering/projects', {method: 'POST', slot: 'A', body: {name: '[HESSARA E2E ' + tag + '] stored flows', description: 'اختبار تخزين معزول دون تحليل'}});
    await observe(project, projectResponse, projectResponse.data?.project); expect(projectResponse, 201); assert.ok(project.id);
    const projectPath = '/api/reverse-engineering/projects/' + project.id, renamed = 'اختبار مشروع ' + tag;
    assert.equal(expect(await http(projectPath, {method: 'PATCH', slot: 'A', body: {name: renamed}}), 200).project.name, renamed);
    const ownList = expect(await http('/api/reverse-engineering/projects?search=' + tag, {slot: 'A'}), 200); assert.ok(ownList.items.some(item => item.id === project.id));
    assert.ok(!expect(await http('/api/reverse-engineering/projects?search=' + tag, {slot: 'B'}), 200).items.some(item => item.id === project.id));
    expect(await http(projectPath, {method: 'PATCH', slot: 'B', body: {name: 'غير مصرح'}}), 404, 'NOT_FOUND');
    expect(await http(projectPath, {method: 'DELETE', slot: 'B'}), 404, 'NOT_FOUND');
    const foreignArtifacts = expect(await http(projectPath + '/artifacts', {slot: 'B'}), 200); assert.deepEqual(foreignArtifacts.items, []); assert.equal(foreignArtifacts.total, 0);
    assert.deepEqual(expect(await http('/api/reverse-engineering/jobs?projectId=' + project.id, {slot: 'A'}), 200).items, []);
    complete('project-create-rename-and-cross-owner-write-isolation');
    phase('reverse-engineering-rejections');
    const assistant = {projectId: project.id, question: 'فسر الأدلة الموجودة فقط', locale: 'ar'};
    expect(await http('/api/reverse-engineering/assistant', {method: 'POST', slot: 'A', body: assistant}), 403, 'PROVIDER_CONSENT_REQUIRED');
    expect(await http('/api/reverse-engineering/assistant', {method: 'POST', slot: 'A', body: {...assistant, providerConsent: true}}), 409, 'NO_EVIDENCE');
    expect(await http('/api/reverse-engineering/admin', {method: 'POST', slot: 'A', body: {}}), 403, 'ADMIN_REQUIRED');
    expect(await http('/api/reverse-engineering/worker', {method: 'POST', body: {action: 'claim'}}), 401, 'AUTH_REQUIRED');
    expect(await http('/api/reverse-engineering/jobs', {method: 'POST', slot: 'A', body: {projectId: project.id, artifactId: randomUUID(), engineId: 'rea', authorizationConfirmed: true, idempotencyKey: randomUUID()}}), 409, 'ENGINE_UNAVAILABLE_OR_QUEUE_CAPACITY');
    expect(await http('/api/reverse-engineering/reports', {method: 'POST', slot: 'A', body: {jobId: randomUUID(), format: 'json'}}), 404, 'NOT_FOUND');
    expect(await http('/api/reverse-engineering/reports/' + randomUUID(), {slot: 'A'}), 404, 'NOT_FOUND');
    const afterJobs = expect(await http('/api/reverse-engineering/jobs?projectId=' + project.id, {slot: 'A'}), 200); assert.deepEqual(afterJobs.items, []); assert.equal(afterJobs.total, 0);
    complete('unavailable-analysis-no-evidence-report-and-administrative-rejections');
    await deleteProject(project);
    assert.ok(!expect(await http('/api/reverse-engineering/projects?search=' + tag, {slot: 'A'}), 200).items.some(item => item.id === project.id));
    expect(await http(projectPath, {method: 'DELETE', slot: 'A'}), 404, 'NOT_FOUND');
    report.sections.reverseEngineering = 'passed'; complete('project-soft-delete');
    report.status = 'success'; report.passed = report.sections.reverseEngineering === 'passed'; phase('completed');
  } catch (error) {
    report.status = error instanceof StoredFlowFailure && error.blocked ? 'blocked' : 'failure'; report.error = safeCode(error); report.passed = false;
  } finally {
    for (const entry of report.resources) if (entry.outcome === 'pending') entry.outcome = 'unknown';
    if (attested && http) {
      for (const entry of report.resources) if (entry.id && entry.state !== 'soft_deleted') {
        try { await deleteProject(entry, true); }
        catch { entry.state = 'cleanup_unverified'; report.passed = false; report.status = 'failure'; report.error ??= 'RESOURCE_CLEANUP_FAILED'; }
      }
      for (const slot of ['A', 'B']) if (jars[slot].header()) {
        try { const response = await http('/api/auth', {method: 'POST', slot, body: {action: 'signout'}, cleanup: true}); report.cleanup.signout.push({account: slot, passed: response.status === 200, status: response.status}); if (response.status !== 200) throw new StoredFlowFailure('SIGNOUT_FAILED'); }
        catch { if (!report.cleanup.signout.some(item => item.account === slot)) report.cleanup.signout.push({account: slot, passed: false}); report.passed = false; report.status = 'failure'; report.error ??= 'SIGNOUT_FAILED'; }
        finally { jars[slot].clear(); }
      }
    }
    report.cleanup.retained = report.resources.map(entry => ({...entry})); report.finishedAt = new Date().toISOString();
    if (recorder) { try { await save(); } catch { report.passed = false; report.status = 'failure'; report.error = 'REPORT_WRITE_FAILED'; } finally { await recorder.close().catch(() => {}); } }
  }
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const run = args.length === 1 && args[0] === '--run', reportPath = hostedStoredReportPath({run});
  const report = await runHostedStoredFlows({run, reportPath, invalidArguments: args.length > 1 || args.some(arg => arg !== '--run')});
  process.stdout.write(JSON.stringify({status: report.status, passed: report.passed, mode: report.mode, target: report.target, issues: report.preflight?.issues ?? [], error: report.error ?? null, checks: report.checks.length, sections: report.sections, report: relative(process.cwd(), reportPath).split(sep).join('/')}) + '\n');
  process.exitCode = report.status === 'preflight_ready' || report.passed ? 0 : ['blocked', 'skipped'].includes(report.status) ? 2 : 1;
}
