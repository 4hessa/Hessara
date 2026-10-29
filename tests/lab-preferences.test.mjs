import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createDatabase } from '../lib/postgres-database.ts';
import { createLabPreferencesService, labPreferencesSaveSchema } from '../lib/lab-preferences.ts';

const preferences = { taskTypes: ['study'], priority: 'cost', audience: 'student', allowHistory: true };
test('preferences require explicit consent and accept only bounded known fields', () => {
  assert.equal(labPreferencesSaveSchema.safeParse({ consent: false, preferences }).success, false);
  assert.equal(labPreferencesSaveSchema.safeParse({ consent: true, owner: 'bob', preferences }).success, false);
  assert.equal(labPreferencesSaveSchema.safeParse({ consent: true, preferences: { ...preferences, taskTypes: ['study', 'study'] } }).success, false);
  assert.equal(labPreferencesSaveSchema.safeParse({ consent: true, preferences: { ...preferences, priority: 'quality' } }).success, false);
  const withoutHistory = { taskTypes: preferences.taskTypes, priority: preferences.priority, audience: preferences.audience };
  assert.equal(labPreferencesSaveSchema.parse({ consent: true, preferences: withoutHistory }).preferences.allowHistory, false);
});

test('private preferences, consent withdrawal, bounded matching history, and literal evidence are isolated', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    for (const path of ['supabase/migrations/202609290001_hessara.sql', 'supabase/runtime-role.sql', 'supabase/migrations/20261011181222_lab_preferences.sql'])
      await pg.exec(await readFile(new URL('../' + path, import.meta.url), 'utf8'));
    const models = [{ id: 'author1', name: 'First', model: 'first-v1', provider: 'openai' }, { id: 'author2', name: 'Second', model: 'second-v2', provider: 'nvidia' }];
    const config = {
      kind: 'custom', version: 'hessara-custom/1', taskType: 'study',
      cases: [{ id: 'case1', title: 'Cite the term', prompt: 'Explain oxygen', checks: [{ kind: 'contains', value: 'oxygen' }] }],
      modelSnapshots: models, maxOutputTokens: 1024,
      providerPolicies: Object.fromEntries(models.map(model => [model.id, { max_output_tokens: 1024, timeout_ms: 55000, sampling: 'provider defaults', reasoning_effort: 'provider default', retries: 0 }])),
    };
    async function insert(id, owner, at, { taskType = 'study', mode = 'custom', status = 'completed', output1 = 'oxygen is present', metadata1 = {}, error1 = null } = {}) {
      await pg.query('INSERT INTO runs(id,owner,name,mode,status,created_at,config,total) VALUES($1,$2,$1,$3,$4,$5,$6,2)', [id, owner, mode, status, at, JSON.stringify({ ...config, taskType })]);
      for (const [index, model] of models.entries()) await pg.query('INSERT INTO trials(id,run_id,model,task_id,repeat,status,output,metadata,error) VALUES($1,$2,$3,\'case1\',0,$4,$5,$6,$7)', [`${id}:${model.id}`, id, model.id, error1 && !index ? 'error' : 'done', index ? 'Not measured as correct' : output1, JSON.stringify(index ? {} : metadata1), index ? null : error1]);
    }
    await insert('a', 'alice', '2026-10-09T12:00:00.000Z', { metadata1: { resolved_model: 'first-2026' } });
    await insert('b', 'bob', '2026-10-09T13:00:00.000Z');
    await insert('other-task', 'alice', '2026-10-10T12:00:00.000Z', { taskType: 'coding' });
    await insert('demo', 'alice', '2026-10-10T12:00:00.000Z', { mode: 'demo' });
    await insert('running', 'alice', '2026-10-10T12:00:00.000Z', { status: 'running' });
    await pg.exec('SET ROLE hessara_runtime;');
    const execute = client => async (sql, values) => { const r = await client.query(sql, values); return { rows: r.rows, count: r.affectedRows ?? r.rows.length }; };
    const db = createDatabase(execute(pg), work => pg.transaction(tx => work(execute(tx))));
    const service = createLabPreferencesService({ db, now: () => Date.parse('2026-10-11T12:00:00.000Z') });
    assert.deepEqual(await service.read('alice', 'study'), { preferences: null, evidence: [], historyEnabled: false });
    await assert.rejects(service.save('alice', { consent: false, preferences }), /INVALID_INPUT/);
    await assert.rejects(service.read('', 'study'), /UNAUTHENTICATED/);
    await assert.rejects(service.read('alice', 'invented'), /INVALID_INPUT/);
    const saved = await service.save('alice', { consent: true, preferences });
    assert.equal(saved.preferences.consentedAt, '2026-10-11T12:00:00.000Z');
    assert.equal(saved.preferences.version, 'hessara-preferences/1');
    assert.equal(saved.historyEnabled, true);
    assert.deepEqual(saved.evidence, []);
    assert.deepEqual((await service.read('alice')).evidence, [], 'A task type must be explicitly selected before personalization');
    assert.deepEqual((await service.read('bob', 'study')).evidence, []);
    const history = await service.read('alice', 'study');
    assert.equal(history.evidence.length, 1);
    const first = history.evidence[0];
    assert.equal(first.runId, 'a');
    assert.equal(first.scope, 'within_run_only');
    assert.equal(first.provenance, 'personal_deterministic_checks');
    assert.equal(first.models[0].passedChecks, 1);
    assert.equal(first.models[0].measuredChecks, 1);
    assert.equal(first.models[1].passedChecks, 0);
    assert.equal(first.models[1].measuredChecks, 1);
    assert.deepEqual(first.models[0].versions, ['first-2026']);
    assert.deepEqual(first.models[1].versions, []);
    assert.equal(first.models[0].score, undefined, 'There is no invented overall quality score');
    assert.equal(first.cases[0].prompt, 'Explain oxygen');
    assert.equal(first.settings.maxOutputTokens, 1024);
    assert.equal(JSON.stringify(history).includes('oxygen is present'), false, 'Answer bodies are not returned by the history evidence API');
    assert.equal((await db.prepare('SELECT * FROM lab_preferences').all()).results.length, 0, 'Transaction context must not leak');
    assert.equal((await db.scopedBatch('bob', [db.prepare('SELECT * FROM lab_preferences')]))[0].results.length, 0);
    await assert.rejects(db.scopedBatch('bob', [db.prepare("INSERT INTO lab_preferences(owner,preferences,consent_version,consented_at,updated_at) VALUES('alice','{}','hessara-preferences/1',now(),now())")]), error => error.code === '42501');
    await assert.rejects(db.scopedBatch('alice', [db.prepare("UPDATE lab_preferences SET owner='bob'")]), error => error.code === '42501');
    await service.save('alice', { consent: true, preferences: { ...preferences, allowHistory: false } });
    assert.deepEqual((await service.read('alice', 'study')).evidence, []);
    await assert.rejects(service.remove('alice', {}), /INVALID_INPUT/);
    await service.remove('alice', { consent: true });
    assert.deepEqual(await service.read('alice', 'study'), { preferences: null, evidence: [], historyEnabled: false });
    assert.ok(await db.prepare("SELECT id FROM runs WHERE id='a' AND owner='alice'").first(), 'Withdrawing personalization must not silently delete experiments');
    await pg.exec('RESET ROLE;');
    await insert('truncated', 'alice', '2026-10-11T12:00:00.000Z', { metadata1: { finish_reason: 'length' } });
    await insert('oversized', 'alice', '2026-10-11T13:00:00.000Z', { output1: 'oxygen '.repeat(8000) });
    for (let i = 0; i < 24; i++) await insert('bounded' + i, 'alice', `2026-09-${String(i + 1).padStart(2, '0')}T12:00:00.000Z`);
    await pg.exec('SET ROLE hessara_runtime;');
    await service.save('alice', { consent: true, preferences });
    const bounded = (await service.read('alice', 'study')).evidence;
    assert.equal(bounded.length, 20);
    for (const id of ['truncated', 'oversized']) {
      const model = bounded.find(run => run.runId === id).models[0];
      assert.equal(model.successfulTrials, 0);
      assert.equal(model.measuredChecks, 0, 'An incomplete response must never be treated as evaluated');
      assert.equal(model.configuredChecks, 1);
    }
    await pg.exec('RESET ROLE; SET ROLE anon;');
    await assert.rejects(pg.query('SELECT * FROM lab_preferences'), error => error.code === '42501');
    await pg.exec('RESET ROLE; SET ROLE authenticated;');
    await assert.rejects(pg.query('SELECT * FROM lab_preferences'), error => error.code === '42501');
  } finally { await pg.close(); }
});
