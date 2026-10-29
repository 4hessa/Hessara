import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { FatalError } from 'workflow';

// These are orchestration unit tests, not a claim of durable SDK integration.
// No provider, database, workflow server, network, or real timer is accessed.
const key = '__hessaraWorkflowUnitTest';
const state = { next: async () => ({ hasMore: false, paused: false }), pause: async () => {}, sleeps: [], calls: [], pauses: [], dispatch: [] };
globalThis[key] = state;
const asModule = source => `data:text/javascript,${encodeURIComponent(source)}`;
const flowPath = new URL('../lib/lab-workflow.ts', import.meta.url).href;
const backgroundPath = new URL('../lib/lab-background.ts', import.meta.url).href;
const workflowMock = asModule(`export { FatalError } from ${JSON.stringify(import.meta.resolve('workflow'))}; export async function sleep(value){ globalThis.${key}.sleeps.push(value); }`);
const serviceMock = asModule(`
  export async function executeLabStep(owner,id){ const s=globalThis.${key}; s.calls.push([owner,id]); return s.next(owner,id); }
  export async function markLabWorkflowFailure(owner,id){ const s=globalThis.${key}; s.pauses.push([owner,id]); return s.pause(owner,id); }
`);
const apiMock = asModule(`export async function start(workflow,args){ globalThis.${key}.dispatch.push({workflow,args}); return {runId:'wrun_test_only'}; }`);
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === flowPath && specifier === 'workflow') return { url: workflowMock, shortCircuit: true };
  if (context.parentURL === flowPath && specifier === './lab-service') return { url: serviceMock, shortCircuit: true };
  if (context.parentURL === backgroundPath) {
    if (specifier === 'server-only') return { url: asModule('export {};'), shortCircuit: true };
    if (specifier === 'workflow/api') return { url: apiMock, shortCircuit: true };
    if (specifier === './lab-workflow') return { url: flowPath, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
after(() => { hooks.deregister(); delete globalThis[key]; });
const { runLabWorkflow, nextLabStep, pauseLabStep } = await import(flowPath);
const { startLabBackground } = await import(backgroundPath);
function reset(next) {
  state.next = next;
  state.pause = async () => {};
  state.sleeps = []; state.calls = []; state.pauses = []; state.dispatch = [];
}

test('workflow dispatch passes opaque identifiers only and returns the execution reference', async () => {
  reset(async () => ({ hasMore: false, paused: false }));
  assert.deepEqual(await startLabBackground('owner-opaque', 'run-opaque'), { executionId: 'wrun_test_only' });
  assert.equal(state.dispatch[0].workflow, runLabWorkflow);
  assert.deepEqual(state.dispatch[0].args, ['owner-opaque', 'run-opaque']);
  assert.equal(state.calls.length, 0, 'Starting the workflow must not execute a paid provider inline');
});
test('workflow waits on contention and continues only while the durable service has remaining work', async () => {
  const outcomes = [{ hasMore: true, paused: false, busy: true }, { hasMore: true, paused: false }, { hasMore: false, paused: false }];
  reset(async () => outcomes.shift());
  assert.deepEqual(await runLabWorkflow('owner', 'run'), { status: 'settled' });
  assert.deepEqual(state.calls, [['owner', 'run'], ['owner', 'run'], ['owner', 'run']]);
  assert.deepEqual(state.sleeps, ['125s']);
  assert.deepEqual(state.pauses, []);
});
test('paused service stops immediately without redispatching provider work', async () => {
  reset(async () => ({ hasMore: false, paused: true }));
  assert.deepEqual(await runLabWorkflow('owner', 'run'), { status: 'paused' });
  assert.equal(state.calls.length, 1);
  assert.deepEqual(state.pauses, []);
});
test('ambiguous failures become a sanitized FatalError and workflow pauses instead of retrying the paid step', async () => {
  reset(async () => { throw new Error('SQL secret value or private prompt'); });
  await assert.rejects(nextLabStep('owner', 'run'), error => error instanceof FatalError && error.message === 'LAB_EXECUTION_PAUSED');
  assert.equal(state.calls.length, 1);
  reset(async () => { throw new Error('SQL secret value or private prompt'); });
  assert.deepEqual(await runLabWorkflow('owner', 'run'), { status: 'paused' });
  assert.equal(state.calls.length, 1);
  assert.deepEqual(state.pauses, [['owner', 'run']]);
});
test('persistent contention is bounded and ends in an explicit pause', async () => {
  reset(async () => ({ hasMore: true, paused: false, busy: true }));
  assert.deepEqual(await runLabWorkflow('owner', 'run'), { status: 'paused' });
  assert.equal(state.calls.length, 64);
  assert.equal(state.sleeps.length, 64);
  assert.ok(state.sleeps.every(value => value === '125s'));
  assert.deepEqual(state.pauses, [['owner', 'run']]);
});
test('idempotent cleanup sanitizes database errors while leaving the SDK able to retry cleanup', async () => {
  reset(async () => ({ hasMore: false, paused: false }));
  state.pause = async () => { throw new Error('Connection password and SQL bindings'); };
  await assert.rejects(pauseLabStep('owner', 'run'), error => !(error instanceof FatalError) && error.message === 'LAB_PAUSE_PERSISTENCE_FAILED');
  assert.deepEqual(state.calls, []);
});
