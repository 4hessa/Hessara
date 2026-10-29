import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Render the real initial UI without running effects or contacting the service.
const directory = await mkdtemp(resolve('.code-workspace-ui-test-'));
const output = join(directory, 'workspace.mjs');
let ui;
try {
  const bundled = await build({
    absWorkingDir: process.cwd(),
    stdin: { contents: `
      export { CodeWorkspacePanel, TestTaskCard, TestTaskComposer, TestRevisionHistory } from './app/code-workspace-panel';
      export { codeWorkspaceCopy } from './lib/code-workspace-copy';
      export { LANGUAGES, isRTL } from './lib/i18n';
    `, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, platform: 'node', format: 'esm', write: false,
    packages: 'external', loader: { '.css': 'empty' }, jsx: 'automatic',
    tsconfig: resolve('tsconfig.json'),
    plugins: [{ name: 'test-internal-components', setup(builder) {
      builder.onLoad({ filter: /code-workspace-panel\.tsx$/ }, async ({ path }) => ({
        contents: `${await readFile(path, 'utf8')}\nexport { TaskCard as TestTaskCard, TaskComposer as TestTaskComposer, RevisionHistory as TestRevisionHistory };`,
        loader: 'tsx', resolveDir: dirname(path),
      }));
    } }],
  });
  await writeFile(output, bundled.outputFiles[0].text);
  ui = await import(pathToFileURL(output).href);
} finally {
  await unlink(output).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(directory);
}

test('workspace copy is complete and explicit in every supported language', () => {
  const expectedLocales = ['ar', 'en', 'fr', 'es', 'zh', 'ko', 'ur', 'fa', 'pt', 'it', 'ru', 'de', 'nl'];
  assert.deepEqual(ui.LANGUAGES.map(([locale]) => locale), expectedLocales);
  const english = ui.codeWorkspaceCopy('en');
  for (const locale of expectedLocales) {
    const copy = ui.codeWorkspaceCopy(locale);
    assert.deepEqual(Object.keys(copy), Object.keys(english), `${locale}: complete keys`);
    for (const [key, value] of Object.entries(copy)) {
      assert.equal(typeof value, 'string', `${locale}.${key}`);
      assert.ok(value.trim(), `${locale}.${key}: nonempty`);
    }
    if (locale !== 'en') {
      for (const key of ['title', 'intro', 'consent', 'networkError', 'guest', 'scopeTitle']) {
        assert.notEqual(copy[key], english[key], `${locale}.${key}: explicit translation`);
      }
    }
  }
  assert.throws(() => ui.codeWorkspaceCopy('unsupported'), /Unsupported workspace locale/);
});

test('the guest workspace renders localized copy and direction with mutations disabled before readiness', () => {
  for (const [locale] of ui.LANGUAGES) {
    const copy = ui.codeWorkspaceCopy(locale);
    const markup = renderToStaticMarkup(React.createElement(ui.CodeWorkspacePanel, { locale, sessionMode: 'guest' }));
    assert.ok(markup.includes(`dir="${ui.isRTL(locale) ? 'rtl' : 'ltr'}" lang="${locale}"`), `${locale}: direction`);
    assert.ok(markup.includes(copy.title), `${locale}: title`);
    assert.ok(markup.includes(copy.guest), `${locale}: guest history notice`);
    assert.ok(markup.includes('<fieldset disabled=""'), `${locale}: no mutations before readiness`);
    assert.ok(markup.includes('aria-busy="true"'), `${locale}: loading announced`);
    assert.ok(!markup.includes('class="code-task"'), `${locale}: no invented agent tasks`);
  }
});

test('a workspace without a session provides the localized sign-in action', () => {
  for (const [locale] of ui.LANGUAGES) {
    const markup = renderToStaticMarkup(React.createElement(ui.CodeWorkspacePanel, { locale, sessionMode: 'none' }));
    assert.ok(markup.includes(`/signin?lang=${locale}&amp;next=/`), `${locale}: session link`);
    assert.ok(markup.includes(ui.codeWorkspaceCopy(locale).signIn), `${locale}: action copy`);
    assert.ok(!markup.includes('<form'), `${locale}: session required for project forms`);
  }
});

const head = 'a'.repeat(40);
const passed = { passed: true, exitCode: 0, stdout: 'verified', stderr: '', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:01Z', runner: 'node --test' };
const project = { id: 'project', name: 'Project', branch: 'main', head, repository: 'repository', files: [{ path: 'app.mjs', content: '' }, { path: 'app.test.mjs', content: '' }], branches: ['main'], tasks: [], events: [], createdAt: passed.startedAt };
const task = { id: 'task', title: 'Task', instruction: 'Change app.mjs', priority: 2, dependencies: [], allowedPaths: ['app.mjs'], status: 'review', commit: 'b'.repeat(40), createdAt: passed.startedAt, review: { main: head, candidate: 'c'.repeat(40), tests: passed, conflicts: [], at: passed.endedAt, changes: [] } };
const act = async () => { throw new Error('Rendering must not invoke a mutation'); };
const buttonAttributes = (markup, label) => markup.match(new RegExp(`<button([^>]*)>${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</button>`))?.[1];

test('merge is enabled only for a current passing review without conflicts or an unsaved draft', () => {
  const copy = ui.codeWorkspaceCopy('en');
  const scenarios = [
    { name: 'current passing review', task, dirty: false, disabled: false, enabled: true },
    { name: 'stale base', task: { ...task, review: { ...task.review, main: 'd'.repeat(40) } }, dirty: false, disabled: false, enabled: false },
    { name: 'failed tests', task: { ...task, review: { ...task.review, tests: { ...passed, passed: false, exitCode: 1 } } }, dirty: false, disabled: false, enabled: false },
    { name: 'conflicts', task: { ...task, review: { ...task.review, conflicts: ['app.mjs'] } }, dirty: false, disabled: false, enabled: false },
    { name: 'unsaved draft', task, dirty: true, disabled: false, enabled: false },
    { name: 'disconnected', task, dirty: false, disabled: true, enabled: false },
    { name: 'nonzero exit despite passed flag', task: {...task,review:{...task.review,tests:{...passed,exitCode:1}}}, dirty:false, disabled:false, enabled:false },
    { name: 'another task running', task, project:{...project,tasks:[{...task,id:'other',status:'running'}]}, dirty:false, disabled:false, enabled:false },
  ];
  for (const scenario of scenarios) {
    const markup = renderToStaticMarkup(React.createElement(ui.TestTaskCard, { project, ...scenario, c: copy, act, date: value => value ?? '' }));
    const attributes = buttonAttributes(markup, copy.merge);
    assert.notEqual(attributes, undefined, scenario.name);
    assert.equal(!attributes.includes('disabled=""'), scenario.enabled, scenario.name);
  }
});

test('historical files are readable without write inputs and escape untrusted markup in every locale',()=>{
  const code = '<script>untrusted()</script>';
  const entry = {commit:head,parents:[],author:'Author',message:'Saved change',at:passed.startedAt};
  for(const [locale] of ui.LANGUAGES){
    const copy = ui.codeWorkspaceCopy(locale);
    const markup = renderToStaticMarkup(React.createElement(ui.TestRevisionHistory,{project:{...project,history:[entry],revision:{commit:head,files:[{path:'app.mjs',content:code}]}},c:copy,act,disabled:false,date:value=>value??copy.unknown}));
    assert.ok(markup.includes(copy.readOnlyRevision));
    assert.ok(markup.includes('&lt;script&gt;untrusted()&lt;/script&gt;'));
    assert.ok(!markup.includes('<textarea')&&!markup.includes('<input'));
  }
});

test('an unsaved file draft leaves cancellation available for a real running task', () => {
  const copy = ui.codeWorkspaceCopy('en');
  const markup = renderToStaticMarkup(React.createElement(ui.TestTaskCard, { task: { ...task, status: 'running', review: undefined }, project, c: copy, act, dirty: true, disabled: false, date: value => value ?? '' }));
  assert.ok(!buttonAttributes(markup, copy.cancel).includes('disabled=""'));
});

test('task creation uses priorities 1–3 and protects test files from agent writes', () => {
  const markup = renderToStaticMarkup(React.createElement(ui.TestTaskComposer, { project, c: ui.codeWorkspaceCopy('en'), act, disabled: false, invalid: () => {} }));
  assert.ok(markup.includes('<option value="3">High</option>'));
  assert.ok(markup.includes('<option value="2" selected="">Normal</option>'));
  assert.ok(markup.includes('<option value="1">Low</option>'));
  assert.ok(markup.includes('<bdi class="code-id">app.mjs</bdi>'));
  assert.ok(!markup.includes('<bdi class="code-id">app.test.mjs</bdi>'));
});

test('the reused task editor shows saved settings in all locales and excludes its own dependency at full quota', () => {
  const pending = { ...task, title: 'Self task', instruction: 'Saved instructions', status: 'blocked', version: 4, priority: 3,
    dependencies: ['dependency'], commit: undefined, review: undefined };
  const prior = { ...pending, id: 'dependency', title: 'Required task', dependencies: [], status: 'merged' };
  const fullProject = { ...project, tasks: [pending, prior, ...Array.from({ length: 10 }, (_, i) => ({ ...prior, id: `other${i}`, title: `Other ${i}` }))] };
  for (const [locale] of ui.LANGUAGES) {
    const copy = ui.codeWorkspaceCopy(locale);
    const markup = renderToStaticMarkup(React.createElement(ui.TestTaskComposer, { project: fullProject, c: copy, act, disabled: false, editingTask: pending, invalid: () => {} }));
    assert.ok(markup.includes(copy.editTask), `${locale}: edit label`); assert.ok(markup.includes(copy.saveTask), `${locale}: save label`);
    assert.ok(markup.includes(copy.editTaskNote), `${locale}: execution constraint`);
    assert.ok(markup.includes('value="Self task"')); assert.ok(markup.includes('Saved instructions'));
    assert.ok(markup.includes('<option value="3" selected="">'));
    assert.ok(!markup.includes('<fieldset disabled=""'), `${locale}: quota does not disable edits`);
    const dependencyChoices = markup.slice(markup.indexOf(`<legend>${copy.dependencies}</legend>`));
    assert.ok(dependencyChoices.includes('checked=""') && dependencyChoices.includes('Required task'));
    assert.ok(!dependencyChoices.includes('Self task'), `${locale}: no self dependency`);
    const blocked = renderToStaticMarkup(React.createElement(ui.TestTaskComposer, { project: fullProject, c: copy, act, disabled: true, editingTask: pending, invalid: () => {} }));
    assert.ok(blocked.includes('<fieldset disabled=""'), `${locale}: disconnected editor disabled`);
  }
});

test('task cards expose editing only for queued or blocked tasks that have never begun execution', () => {
  const copy = ui.codeWorkspaceCopy('en');
  for (const status of ['queued', 'blocked', 'running', 'review', 'failed', 'conflict', 'merged', 'rejected', 'cancelled', 'interrupted']) {
    for (const metadata of [{}, { startedAt: passed.startedAt }, { generationStartedAt: passed.startedAt }]) {
      const pending = { ...task, status, ...metadata };
      const markup = renderToStaticMarkup(React.createElement(ui.TestTaskCard, { task: pending, project, c: copy, act, date: value => value ?? '', disabled: false, dirty: false }));
      assert.equal(markup.includes(copy.editTaskNote), ['queued', 'blocked'].includes(status) && !Object.keys(metadata).length, `${status} ${JSON.stringify(metadata)}`);
    }
  }
});
