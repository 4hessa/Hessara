import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Exercise the real component's handlers with persistent hook state. No browser,
// database, or AI provider is needed for changing the interface language.
const directory = await mkdtemp(resolve('.evaluation-ui-test-'));
const output = join(directory, 'evaluation.mjs');
let ui;
try {
  const bundled = await build({
    absWorkingDir: process.cwd(),
    stdin: { contents: `
      export { LabEvaluationPanel } from './app/lab-evaluation-panel';
      export { evaluationCopy } from './lib/lab-evaluation-copy';
      export { LANGUAGES } from './lib/i18n';
      export { begin, reset } from 'evaluation-test-hooks';
    `, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, platform: 'node', format: 'esm', write: false,
    packages: 'external', jsx: 'automatic', tsconfig: resolve('tsconfig.json'),
    plugins: [{ name: 'evaluation-test-hooks', setup(builder) {
      builder.onResolve({ filter: /^(react|evaluation-test-hooks)$/ }, args => {
        if (args.path === 'evaluation-test-hooks' || /lab-evaluation-panel\.tsx$/.test(args.importer)) return { path: 'hooks', namespace: 'test-hooks' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'test-hooks' }, () => ({ contents: `
        let values = [], cursor = 0;
        export function begin() { cursor = 0; }
        export function reset() { values = []; cursor = 0; }
        export function useState(initial) {
          const index = cursor++;
          if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
          return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }];
        }
        export function useRef(initial) { return useState(() => ({current: initial}))[0]; }
      `, loader: 'js' }));
    } }],
  });
  await writeFile(output, bundled.outputFiles[0].text);
  ui = await import(pathToFileURL(output).href);
} finally {
  await unlink(output).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(directory);
}

const props = {
  item: { id: 'case', checks: [] },
  trial: { id: 'trial', task_id: 'case', model: 'answer-model', status: 'done', output: 'Example response', error: null, metadataData: {} },
  models: [], runId: 'run',
};
function render(locale) { ui.begin(); return ui.LabEvaluationPanel({ ...props, locale }); }
function elements(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
function content(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(content).join('');
  return typeof node === 'object' ? content(node.props?.children) : String(node);
}
const settle = () => new Promise(resolve => setImmediate(resolve));

for (const [result, expected] of [['saved', 'saved'], ['UNAVAILABLE', 'error'], ['SAME_EVALUATOR', 'sameEvaluator'], ['LIMIT_OR_CONFLICT', 'limit']]) {
  test(`an existing ${expected} evaluation notice changes across every locale without repeating the operation`, async t => {
    ui.reset();
    const fetch = t.mock.method(globalThis, 'fetch', async (_url, options) => options?.method === 'POST'
      ? { ok: result === 'saved', json: async () => result === 'saved' ? {} : { error: result } }
      : { ok: true, json: async () => ({ reviews: {}, judgements: [] }) });
    render('ar').props.onToggle({ currentTarget: { open: true } });
    await settle();
    const save = elements(render('ar')).find(node => node.type === 'button' && content(node) === ui.evaluationCopy('ar').save);
    assert.ok(save, 'the real manual-review save control is present');
    save.props.onClick();
    await settle();
    const calls = fetch.mock.callCount();
    assert.equal(calls, 2, 'one read and one review mutation');
    for (const [locale] of ui.LANGUAGES) {
      const notice = elements(render(locale)).find(node => node.type === 'p' && node.props.role === 'status');
      assert.equal(content(notice), ui.evaluationCopy(locale)[expected], locale);
      assert.equal(fetch.mock.callCount(), calls, 'language switching must not send a new request');
    }
  });
}
