'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Code2, FolderGit2, GitBranch, History, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { isRTL, type Locale } from '@/lib/i18n';
import { codeWorkspaceCopy, type CodeWorkspaceCopy, type CodeWorkspaceCopyKey } from '@/lib/code-workspace-copy';
import { compareCodeLines } from '@/lib/code-diff';
import type { CodeChange, CodeFile, CodeProject, CodeTask, CodeTaskStatus, CodeTests, CodeWorkspaceAction, CodeWorkspaceReadiness, CodeWorkspaceState } from '@/lib/code-workspace-types';
import './code-workspace-panel.css';
import { ThinkingOrb } from './thinking-orb';

type WorkspaceIndex = { readiness: CodeWorkspaceReadiness; state?: CodeWorkspaceState };
type Act = (action: CodeWorkspaceAction) => Promise<CodeWorkspaceState | null>;
type Props = { locale: Locale; sessionMode: 'guest' | 'account' | 'none' };
const blankFile = (): CodeFile => ({ path: '', content: '' });
const testFile = (path: string) => path.endsWith('.test.mjs');
const validPath = (path: string) => path.length <= 200 && /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(path)
  && !path.split('/').some(part => !part || part.startsWith('.'))
  && !/(?:^|\/)(?:node_modules|vendor|secrets?|credentials|private)(?:\/|\.|$)/i.test(path)
  && /\.(?:mjs|cjs|js|jsx|ts|tsx|json|md|css|html|txt)$/.test(path);
const validBranch = (branch: string) => branch.length <= 100 && /^[a-zA-Z0-9][a-zA-Z0-9_/-]*$/.test(branch)
  && !branch.split('/').some(part => !part) && !branch.startsWith('review/');

async function request<T>(method: 'GET' | 'POST', signal: AbortSignal, action?: CodeWorkspaceAction): Promise<T> {
  const response = await fetch('/api/code-workspace', {
    method, signal, cache: 'no-store', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...(action ? { body: JSON.stringify(action) } : {}),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'UNAVAILABLE');
  if (!data || typeof data !== 'object' || (method === 'GET' ? !('readiness' in data) : !('projects' in data))) throw new Error('UNAVAILABLE');
  return data as T;
}

function errorKey(cause: unknown): CodeWorkspaceCopyKey {
  const code = cause instanceof Error ? cause.message : '';
  if (code === 'AUTH_REQUIRED' || code === 'ORIGIN') return 'authError';
  if (code === 'NOT_READY') return 'unavailable';
  if (code === 'INVALID_INPUT') return 'inputError';
  if (code === 'NOT_FOUND') return 'notFound';
  if (code === 'LIMIT') return 'limitError';
  if (code === 'DEPENDENCIES') return 'dependencyError';
  if (code === 'TESTS_FAILED') return 'fail';
  if (code === 'STALE_REVIEW') return 'staleReview';
  if (code === 'CONFLICT') return 'conflicts';
  if (code === 'BUSY' || code === 'INTERRUPTED') return 'stateError';
  return 'networkError';
}

function statusText(status: CodeTaskStatus, c: CodeWorkspaceCopy) {
  return c[status === 'review' ? 'reviewStatus' : status];
}

function validFiles(files: CodeFile[]) {
  const encoder = new TextEncoder();
  return files.length > 0 && files.length <= 128 && new Set(files.map(file => file.path.trim())).size === files.length
    && files.every(file => validPath(file.path.trim()) && !file.content.includes('\0') && encoder.encode(file.content).length <= 32768)
    && files.reduce((size, file) => size + encoder.encode(file.content).length, 0) <= 524288;
}

function FileFields({ files, change, disabled, c, id }: { files: CodeFile[]; change: (files: CodeFile[]) => void; disabled: boolean; c: CodeWorkspaceCopy; id: string }) {
  return <fieldset className="code-files" disabled={disabled}>
    <legend>{c.files}</legend>
    {files.map((file, index) => <div className="code-file" key={index}>
      <div className="code-file-heading">
        <label htmlFor={`${id}-path-${index}`}>{c.path}<span className="code-field-number" aria-hidden="true">{index + 1}</span></label>
        <button className="code-icon-button" type="button" onClick={() => change(files.filter((_, row) => row !== index))} aria-label={`${c.removeFile} ${file.path || index + 1}`}><Trash2 size={17} aria-hidden="true" /></button>
      </div>
      <input id={`${id}-path-${index}`} value={file.path} dir="ltr" spellCheck={false} autoComplete="off" maxLength={200} required onChange={event => change(files.map((row, rowIndex) => rowIndex === index ? { ...row, path: event.target.value } : row))} />
      <label htmlFor={`${id}-content-${index}`}>{c.content}</label>
      <textarea id={`${id}-content-${index}`} value={file.content} dir="ltr" spellCheck={false} rows={6} onChange={event => change(files.map((row, rowIndex) => rowIndex === index ? { ...row, content: event.target.value } : row))} />
    </div>)}
    <button className="secondary" type="button" disabled={files.length >= 128} onClick={() => change([...files, blankFile()])}><Plus size={16} aria-hidden="true" />{c.addFile}</button>
  </fieldset>;
}

function ProjectComposer({ projects, c, act, disabled, onCreated, invalid }: { projects: CodeProject[]; c: CodeWorkspaceCopy; act: Act; disabled: boolean; onCreated: (id: string) => void; invalid: () => void }) {
  const id = useId();
  const [name, setName] = useState('');
  const [files, setFiles] = useState<CodeFile[]>([blankFile()]);
  const [mode, setMode] = useState<'files' | 'import'>('files');
  const [source, setSource] = useState('');
  const [branch, setBranch] = useState('');
  async function create(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    if (!name.trim() || name.trim().length > 80 || (mode === 'files' && !validFiles(files)) || (mode === 'import' && (!/^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/.test(source.trim()) || (branch.trim() && !validBranch(branch.trim()))))) { invalid(); return; }
    const previousIds = new Set(projects.map(project => project.id));
    const state = await act(mode === 'files' ? { action: 'create', name: name.trim(), files: files.map(file => ({ ...file, path: file.path.trim() })) } : { action: 'import', name: name.trim(), source: source.trim(), ...(branch.trim() ? { branch: branch.trim() } : {}) });
    if (state) {
      const project = state.projects.find(project => !previousIds.has(project.id));
      if (project) onCreated(project.id);
      setName(''); setFiles([blankFile()]); setSource(''); setBranch('');
    }
  }
  return <details className="code-card code-composer">
    <summary><FolderGit2 size={18} aria-hidden="true" />{c.newProject}</summary>
    <form onSubmit={create}>
      <fieldset disabled={disabled} className="code-fields-reset">
        <div className="code-actions code-mode">
          <label><input type="radio" name={`${id}-mode`} checked={mode === 'files'} onChange={() => setMode('files')} />{c.files}</label>
          <label><input type="radio" name={`${id}-mode`} checked={mode === 'import'} onChange={() => setMode('import')} />{c.importRepository}</label>
        </div>
        <label className="code-field" htmlFor={`${id}-name`}>{c.name}<input id={`${id}-name`} maxLength={80} required value={name} onChange={event => setName(event.target.value)} /></label>
        {mode === 'files' ? <FileFields id={id} c={c} files={files} change={setFiles} disabled={disabled} /> : <>
          <label className="code-field" htmlFor={`${id}-source`}>{c.source}<input id={`${id}-source`} type="url" required dir="ltr" spellCheck={false} autoComplete="off" value={source} onChange={event => setSource(event.target.value)} /></label>
          <label className="code-field" htmlFor={`${id}-branch`}>{c.importBranch}<input id={`${id}-branch`} dir="ltr" spellCheck={false} value={branch} maxLength={100} onChange={event => setBranch(event.target.value)} /></label>
          <p className="code-muted">{c.importNote}</p>
        </>}
        <div className="code-actions"><button className="primary" type="submit" disabled={!name.trim()}>{mode === 'files' ? c.newProject : c.importRepository}</button></div>
      </fieldset>
    </form>
  </details>;
}

function FileEditor({ project, c, act, disabled, onDirty, invalid }: { project: CodeProject; c: CodeWorkspaceCopy; act: Act; disabled: boolean; onDirty: (dirty: boolean) => void; invalid: () => void }) {
  const id = useId();
  const [draft, setDraft] = useState(() => project.files.map(file => ({ ...file })));
  const [base, setBase] = useState(project.head);
  const [baseBranch, setBaseBranch] = useState(project.branch);
  const [dirty, setDirty] = useState(false);
  const stale = dirty && (base !== project.head || baseBranch !== project.branch);
  function load(files = project.files, head = project.head, branch = project.branch) {
    setDraft(files.map(file => ({ ...file }))); setBase(head); setBaseBranch(branch); setDirty(false); onDirty(false);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (disabled || !dirty || stale) return;
    if (!validFiles(draft)) { invalid(); return; }
    const state = await act({ action: 'edit', projectId: project.id, expectedHead: base, files: draft.map(file => ({ ...file, path: file.path.trim() })) });
    const updated = state?.projects.find(item => item.id === project.id);
    if (updated) load(updated.files, updated.head, updated.branch);
  }
  return <details className="code-card">
    <summary><Code2 size={18} aria-hidden="true" />{c.files}</summary>
    <form onSubmit={save}>
      <p className="code-muted">{c.head}: <bdi className="code-id">{dirty ? base : project.head}</bdi></p>
      {stale && <p className="code-notice" role="status">{c.stale}</p>}
      <FileFields id={id} c={c} files={dirty ? draft : project.files} disabled={disabled} change={files => { if (!dirty) { setBase(project.head); setBaseBranch(project.branch); } setDraft(files); setDirty(true); onDirty(true); }} />
      <div className="code-actions"><button className="primary" type="submit" disabled={disabled || !dirty || stale}>{c.save}</button><button className="secondary" type="button" disabled={disabled || !dirty} onClick={() => load()}>{c.discard}</button></div>
    </form>
  </details>;
}

function Branches({ project, c, act, disabled, dirty, invalid }: { project: CodeProject; c: CodeWorkspaceCopy; act: Act; disabled: boolean; dirty: boolean; invalid: () => void }) {
  const id = useId();
  const [name, setName] = useState('');
  const [choice, setChoice] = useState('');
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || disabled || dirty) return;
    if (!validBranch(name.trim())) { invalid(); return; }
    const state = await act({ action: 'branch', projectId: project.id, expectedHead: project.head, name: name.trim() });
    if (state) setName('');
  }
  return <details className="code-card">
    <summary><GitBranch size={18} aria-hidden="true" />{c.branch}: <bdi>{project.branch}</bdi></summary>
    {dirty && <p className="code-notice">{c.dirty}</p>}
    <div className="code-branch-grid">
      <form onSubmit={create}><label className="code-field" htmlFor={`${id}-name`}>{c.branchName}<input id={`${id}-name`} dir="ltr" spellCheck={false} autoComplete="off" maxLength={100} value={name} disabled={disabled || dirty} onChange={event => setName(event.target.value)} /></label><button type="submit" className="secondary" disabled={disabled || dirty || !name.trim()}>{c.newBranch}</button></form>
      <div><label className="code-field" htmlFor={`${id}-choice`}>{c.switchBranch}<select id={`${id}-choice`} value={choice || project.branch} disabled={disabled || dirty} onChange={event => setChoice(event.target.value)}>{project.branches.map(branch => <option key={branch} value={branch}>{branch}</option>)}</select></label><button type="button" className="secondary" disabled={disabled || dirty || !choice || choice === project.branch} onClick={async () => { if (await act({ action: 'switch', projectId: project.id, expectedHead: project.head, name: choice })) setChoice(''); }}>{c.switchBranch}</button></div>
    </div>
  </details>;
}

function RevisionHistory({ project, c, act, disabled, date }: { project: CodeProject; c: CodeWorkspaceCopy; act: Act; disabled: boolean; date: (value?: string) => string }) {
  return <details className="code-card code-history">
    <summary><History size={18} aria-hidden="true" />{c.history}</summary>
    <p className="code-muted">{c.historyNote}</p>
    <button type="button" className="secondary" disabled={disabled} onClick={() => void act({ action: 'history', projectId: project.id, expectedHead: project.head })}><RefreshCw size={16} aria-hidden="true" />{c.refresh}</button>
    {!project.history && <p className="code-muted">{c.notMeasured}</p>}
    {project.history && <ol className="code-revisions">{project.history.map(entry => <li key={entry.commit}>
      <strong>{entry.message || c.unknown}</strong>
      <span className="code-muted">{entry.author || c.unknown} · <time dateTime={entry.at ?? undefined}>{date(entry.at ?? undefined)}</time></span>
      <bdi className="code-id">{entry.commit}</bdi>
      <button type="button" className="secondary" disabled={disabled} aria-pressed={project.revision?.commit === entry.commit} onClick={() => void act({ action: 'revision', projectId: project.id, expectedHead: project.head, commit: entry.commit })}>{c.previewRevision}</button>
    </li>)}</ol>}
    {project.revision && <section className="code-revision-preview" aria-label={c.readOnlyRevision}>
      <h3>{c.readOnlyRevision}</h3><p className="code-muted">{c.revisionLabel}: <bdi className="code-id">{project.revision.commit}</bdi></p>
      {project.revision.files.map(file => <details className="code-change" key={file.path}><summary><bdi className="code-id">{file.path}</bdi></summary><pre dir="ltr" tabIndex={0}>{file.content}</pre></details>)}
    </section>}
  </details>;
}

function TaskComposer({ project, c, act, disabled, invalid, editingTask }: { project: CodeProject; c: CodeWorkspaceCopy; act: Act; disabled: boolean; invalid: () => void; editingTask?: CodeTask }) {
  const id = useId();
  const [title, setTitle] = useState(editingTask?.title ?? '');
  const [instruction, setInstruction] = useState(editingTask?.instruction ?? '');
  const [priority, setPriority] = useState(editingTask?.priority ?? 2);
  const [dependencies, setDependencies] = useState<string[]>(() => [...(editingTask?.dependencies ?? [])]);
  const [paths, setPaths] = useState<string[]>(() => [...(editingTask?.allowedPaths ?? [])]);
  const permitted = project.files.filter(file => !testFile(file.path));
  const priorTasks = project.tasks.filter(task => task.id !== editingTask?.id && (!['cancelled', 'rejected', 'interrupted'].includes(task.status) || dependencies.includes(task.id)));
  const limited = !editingTask && project.tasks.length >= 12;
  function toggle(items: string[], value: string, checked: boolean) { return checked ? [...items, value] : items.filter(item => item !== value); }
  async function assign(event: FormEvent) {
    event.preventDefault();
    if (disabled || limited) return;
    if (!title.trim() || !instruction.trim() || ![1, 2, 3].includes(priority) || !paths.length || paths.length > 16 || dependencies.length > 11 || dependencies.some(id => !priorTasks.some(task => task.id === id)) || paths.some(path => !permitted.some(file => file.path === path))) { invalid(); return; }
    const definition = { projectId: project.id, title: title.trim(), instruction: instruction.trim(), priority, dependencies, allowedPaths: paths };
    const state = await act(editingTask ? { action: 'update-task', ...definition, taskId: editingTask.id, expectedVersion: editingTask.version ?? 0 } : { action: 'task', ...definition });
    if (state && !editingTask) { setTitle(''); setInstruction(''); setDependencies([]); setPaths([]); }
  }
  return <details className="code-card">
    <summary>{editingTask ? <Pencil size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}{editingTask ? c.editTask : c.newTask}</summary>
    {editingTask && <p className="code-muted">{c.editTaskNote}</p>}
    {limited && <p className="code-notice">{c.limitError}</p>}
    <form onSubmit={assign}><fieldset disabled={disabled || limited} className="code-fields-reset">
      <label className="code-field" htmlFor={`${id}-title`}>{c.taskTitle}<input id={`${id}-title`} required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label className="code-field" htmlFor={`${id}-instruction`}>{c.instruction}<textarea id={`${id}-instruction`} required rows={5} maxLength={4000} value={instruction} onChange={event => setInstruction(event.target.value)} /></label>
      <label className="code-field code-priority" htmlFor={`${id}-priority`}>{c.priority}<select id={`${id}-priority`} value={priority} onChange={event => setPriority(Number(event.target.value))}><option value={3}>{c.high}</option><option value={2}>{c.normal}</option><option value={1}>{c.low}</option></select></label>
      <fieldset className="code-choice-list"><legend>{c.allowedPaths}</legend><p className="code-muted">{c.protectedTests}</p>{permitted.map(file => <label key={file.path}><input type="checkbox" checked={paths.includes(file.path)} disabled={!paths.includes(file.path) && paths.length >= 16} onChange={event => setPaths(toggle(paths, file.path, event.target.checked))} /><bdi className="code-id">{file.path}</bdi></label>)}</fieldset>
      <fieldset className="code-choice-list"><legend>{c.dependencies}</legend>{!priorTasks.length && <p className="code-muted">{c.noDependencies}</p>}{priorTasks.map(task => <label key={task.id}><input type="checkbox" checked={dependencies.includes(task.id)} disabled={!dependencies.includes(task.id) && dependencies.length >= 11} onChange={event => setDependencies(toggle(dependencies, task.id, event.target.checked))} /><span>{task.title} <small>({statusText(task.status, c)})</small></span></label>)}</fieldset>
      <div className="code-actions"><button type="submit" className="primary" disabled={!title.trim() || !instruction.trim() || !paths.length}>{editingTask ? c.saveTask : c.newTask}</button></div>
    </fieldset></form>
  </details>;
}

function Tests({ tests, c, date }: { tests?: CodeTests; c: CodeWorkspaceCopy; date: (value?: string) => string }) {
  if (!tests) return <p className="code-muted">{c.notMeasured}</p>;
  return <div className="code-tests"><p className="code-status">{tests.passed ? c.pass : c.fail}</p><dl className="code-facts"><div><dt>{c.started}</dt><dd>{date(tests.startedAt)}</dd></div><div><dt>{c.finished}</dt><dd>{date(tests.endedAt)}</dd></div><div><dt>{c.exitCode}</dt><dd>{tests.exitCode === null ? c.unknown : tests.exitCode}</dd></div></dl><pre dir="ltr" tabIndex={0}>{tests.runner}{'\n'}{tests.stdout}{tests.stderr ? `\n${tests.stderr}` : ''}</pre></div>;
}

function Change({ change, c }: { change: CodeChange; c: CodeWorkspaceCopy }) {
  const before = change.before === null ? [] : change.before.split('\n');
  const after = change.after === null ? [] : change.after.split('\n');
  const diff = compareCodeLines(before, after);
  return <details className="code-change"><summary><bdi className="code-id">{change.path}</bdi></summary>{!diff.precise && <p className="code-muted">{c.diffUnavailable}</p>}<div className="code-diff">
    {([{ title: c.before, lines: before, kind: 'removed' }, { title: c.after, lines: after, kind: 'added' }] as const).map(side => <section key={side.kind} aria-label={`${side.title}: ${change.path}`}><h5>{side.title}</h5><pre dir="ltr" tabIndex={0}>{side.lines.map((line, index) => <span key={index} className={diff[side.kind].has(index) ? `code-line code-line-${side.kind}` : 'code-line'}><span className="code-line-number" aria-hidden="true">{index + 1}</span><span>{line || ' '}</span>{'\n'}</span>)}</pre></section>)}
  </div></details>;
}

function TaskCard({ task, project, c, act, disabled, dirty, date, invalid = () => {} }: { task: CodeTask; project: CodeProject; c: CodeWorkspaceCopy; act: Act; disabled: boolean; dirty: boolean; date: (value?: string) => string; invalid?: () => void }) {
  const pending = ['queued', 'blocked', 'running'].includes(task.status);
  const editable = ['queued', 'blocked'].includes(task.status) && task.startedAt === undefined && task.generationStartedAt === undefined;
  const reviewable = Boolean(task.commit) && ['review', 'conflict', 'failed'].includes(task.status);
  const currentReview = task.review?.main === project.head;
  const projectRunning = project.tasks.some(item => item.status === 'running');
  const mergeable = task.status === 'review' && currentReview && task.review?.tests.passed && task.review.tests.exitCode === 0 && task.review.conflicts.length === 0 && !projectRunning;
  const changes = task.review?.changes ?? task.changes ?? [];
  return <article className="code-task">
    <header><div><h3>{task.title}</h3><p className="code-muted">{c.priority}: {task.priority}</p></div><span className="code-status" data-status={task.status}>{statusText(task.status, c)}</span></header>
    {task.error && <p className="code-notice" role="status"><bdi className="code-id">{task.error}</bdi></p>}
    <p className="code-instruction">{task.instruction}</p>
    <div className="code-actions">
      {reviewable && <button type="button" className="secondary" disabled={disabled || dirty || projectRunning} onClick={() => void act({ action: 'review', projectId: project.id, taskId: task.id })}>{c.review}</button>}
      {reviewable && <button type="button" className="primary" disabled={disabled || dirty || !mergeable} onClick={() => void act({ action: 'merge', projectId: project.id, taskId: task.id })}>{c.merge}</button>}
      {reviewable && <button type="button" className="secondary" disabled={disabled} onClick={() => void act({ action: 'reject', projectId: project.id, taskId: task.id })}>{c.reject}</button>}
      {pending && <button type="button" className="secondary" disabled={disabled} onClick={() => void act({ action: 'cancel', projectId: project.id, taskId: task.id })}>{c.cancel}</button>}
    </div>
    {editable && <TaskComposer key={`${task.id}-${task.version ?? 0}`} project={project} c={c} act={act} disabled={disabled || dirty} invalid={invalid} editingTask={task} />}
    {task.review && <div className="code-review-note">{!currentReview && <p className="code-notice">{c.staleReview}</p>}{task.review.conflicts.length ? <><p>{c.conflicts}</p><ul>{task.review.conflicts.map(path => <li key={path}><bdi className="code-id">{path}</bdi></li>)}</ul></> : <p className="code-muted">{c.noConflicts}</p>}</div>}
    <details className="code-task-details"><summary>{c.changes} <span>{changes.length}</span></summary>{changes.length ? changes.map(change => <Change key={change.path} change={change} c={c} />) : <p className="code-muted">{c.noChanges}</p>}</details>
    <details className="code-task-details"><summary>{c.tests}</summary><Tests tests={task.review?.tests ?? task.tests} c={c} date={date} /></details>
    <details className="code-task-details"><summary>{c.details}</summary>
      <dl className="code-facts">
        {[[c.repository, task.repository], [c.base, task.base], [c.commit, task.commit], [c.model, task.model]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd><bdi className="code-id">{value || c.unknown}</bdi></dd></div>)}
        <div><dt>{c.created}</dt><dd>{date(task.createdAt)}</dd></div><div><dt>{c.started}</dt><dd>{date(task.startedAt)}</dd></div><div><dt>{c.finished}</dt><dd>{date(task.endedAt)}</dd></div>
        {task.review && <><div><dt>{c.reviewed}</dt><dd>{date(task.review.at)}</dd></div><div><dt>{c.candidate}</dt><dd><bdi className="code-id">{task.review.candidate}</bdi></dd></div></>}
        <div><dt>{c.allowedPaths}</dt><dd>{task.allowedPaths.map(path => <bdi className="code-path" key={path}>{path}</bdi>)}</dd></div>
        <div><dt>{c.dependencies}</dt><dd>{task.dependencies.length ? task.dependencies.map(id => <span className="code-path" key={id}>{project.tasks.find(item => item.id === id)?.title || id}</span>) : '—'}</dd></div>
      </dl>
      {task.decision && <><h4>{c.decision}</h4><p className="code-instruction">{task.decision}</p></>}
      <h4>{c.resources}</h4>{task.usage ? <pre dir="ltr" tabIndex={0}>{JSON.stringify(task.usage, null, 2)}</pre> : <p className="code-muted">{c.unknown}</p>}
    </details>
  </article>;
}

function ProjectView({ project, state, c, act, disabled, locale, onDirty, dirty, invalid }: { project: CodeProject; state: CodeWorkspaceState; c: CodeWorkspaceCopy; act: Act; disabled: boolean; locale: Locale; onDirty: (dirty: boolean) => void; dirty: boolean; invalid: () => void }) {
  const [consent, setConsent] = useState(false);
  const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : c.unknown;
  const queued = project.tasks.some(task => ['queued', 'blocked'].includes(task.status));
  return <div className="code-project">
    <header className="code-project-heading"><h2 tabIndex={-1}>{project.name}</h2><span className="code-status"><GitBranch size={15} aria-hidden="true" /><bdi>{project.branch}</bdi></span></header>
    <dl className="code-project-facts"><div><dt>{c.repository}</dt><dd><bdi>{project.repository}</bdi></dd></div><div><dt>{c.head}</dt><dd><bdi>{project.head}</bdi></dd></div><div><dt>{c.model}</dt><dd><bdi>{state.model}</bdi></dd></div><div><dt>{c.concurrency}</dt><dd>{new Intl.NumberFormat(locale).format(state.concurrency)}</dd></div></dl>
    <div className="code-stats" aria-live="polite" aria-atomic="true">{([['tasks', project.tasks.length], ['running', project.tasks.filter(task => task.status === 'running').length], ['reviewStatus', project.tasks.filter(task => task.status === 'review').length], ['merged', project.tasks.filter(task => task.status === 'merged').length]] as const).map(([label, value]) => <div key={label}><span>{c[label]}</span><strong>{new Intl.NumberFormat(locale).format(value)}</strong></div>)}</div>
    <FileEditor project={project} c={c} act={act} disabled={disabled} onDirty={onDirty} invalid={invalid} />
    <Branches project={project} c={c} act={act} disabled={disabled} dirty={dirty} invalid={invalid} />
    <RevisionHistory project={project} c={c} act={act} disabled={disabled} date={date} />
    <TaskComposer key={project.branch} project={project} c={c} act={act} disabled={disabled || dirty} invalid={invalid} />
    {queued && <div className="code-launch"><label className="code-consent"><input type="checkbox" checked={consent} disabled={disabled || dirty} onChange={event => setConsent(event.target.checked)} /><span>{c.consent}</span></label><button className="primary" type="button" disabled={disabled || dirty || !consent} onClick={async () => { if (await act({ action: 'start', projectId: project.id, consent: true })) setConsent(false); }}>{c.start}</button></div>}
    <h2 className="code-tasks-title">{c.tasks}</h2><p className="code-muted">{c.reviewNotice}</p>
    {!project.tasks.length && <p className="code-empty">{c.noTasks}</p>}
    <div className="code-task-list">{project.tasks.map(task => <TaskCard key={task.id} task={task} project={project} c={c} act={act} disabled={disabled} dirty={dirty} date={date} invalid={invalid} />)}</div>
    <details className="code-card code-event-log"><summary>{c.logs}</summary>{!project.events.length ? <p className="code-muted">{c.noLogs}</p> : <ol>{project.events.map(event => <li key={event.id}><time dateTime={event.at}>{date(event.at)}</time>{event.taskId && <strong>{project.tasks.find(task => task.id === event.taskId)?.title || event.taskId}</strong>}<span className="code-event-kind"><bdi>{event.kind}</bdi></span><p>{event.message}</p></li>)}</ol>}</details>
  </div>;
}

export function CodeWorkspacePanel({ locale, sessionMode }: Props) {
  const c = codeWorkspaceCopy(locale);
  const id = useId();
  const [index, setIndex] = useState<WorkspaceIndex | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(sessionMode !== 'none');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<CodeWorkspaceCopyKey | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const panel = useRef<HTMLElement | null>(null);
  const state = index?.state;
  const project = state?.projects.find(item => item.id === selected) ?? state?.projects[0];
  const connected = Boolean(index?.readiness.configured && index.readiness.connected && !['networkError', 'authError', 'unavailable'].includes(error ?? ''));
  const polling = Boolean(connected && state?.projects.some(item => item.tasks.some(task => task.status === 'running')));

  useEffect(() => {
    let controller: AbortController | undefined;
    let stopped = false;
    let completed = false;
    function load() {
      if (stopped || document.hidden || controller || completed) return;
      const pending = new AbortController();
      controller = pending;
      const observed = generation.current;
      request<WorkspaceIndex>('GET', pending.signal).then(data => {
        if (!pending.signal.aborted && observed === generation.current) { setIndex(data); setError(null); }
      }).catch(cause => { if (!pending.signal.aborted && observed === generation.current) setError(errorKey(cause)); }).finally(() => {
        if (controller === pending) controller = undefined;
        if (!pending.signal.aborted) { completed = true; setLoading(false); }
      });
    }
    const visibility = () => {
      if (document.hidden) { controller?.abort(); controller = undefined; }
      else load();
    };
    load();
    document.addEventListener('visibilitychange', visibility);
    return () => { stopped = true; controller?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [sessionMode, refresh]);

  useEffect(() => {
    if (!polling || sessionMode === 'none') return;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    async function poll() {
      if (stopped || document.hidden) return;
      if (mutation.current || controller) { timer = setTimeout(poll, 4000); return; }
      const pending = new AbortController();
      controller = pending;
      const observed = generation.current;
      try {
        const data = await request<WorkspaceIndex>('GET', pending.signal);
        if (!pending.signal.aborted && observed === generation.current) { setIndex(data); setError(null); }
      } catch (cause) { if (!pending.signal.aborted && observed === generation.current) setError(errorKey(cause)); }
      finally { if (controller === pending) controller = undefined; if (!stopped && !document.hidden && !pending.signal.aborted) timer = setTimeout(poll, 4000); }
    }
    const visibility = () => {
      clearTimeout(timer);
      if (document.hidden) { controller?.abort(); controller = undefined; }
      else void poll();
    };
    timer = setTimeout(poll, 4000);
    document.addEventListener('visibilitychange', visibility);
    return () => { stopped = true; controller?.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [polling, sessionMode]);

  useEffect(() => () => { mutation.current?.abort(); }, []);

  async function act(action: CodeWorkspaceAction) {
    if (mutation.current || !connected || loading || sessionMode === 'none') return null;
    const controller = new AbortController(); mutation.current = controller;
    generation.current++; setBusy(true); setError(null);
    try {
      const data = await request<CodeWorkspaceState>('POST', controller.signal, action);
      if (!controller.signal.aborted) { setIndex(previous => previous ? { ...previous, state: data } : previous); return data; }
    } catch (cause) { if (!controller.signal.aborted) { setError(errorKey(cause)); setRefresh(value => value + 1); } }
    finally { if (mutation.current === controller) mutation.current = null; if (!controller.signal.aborted) setBusy(false); }
    return null;
  }
  function choose(id: string) {
    if (dirty || mutation.current) return;
    setSelected(id); setError(null); setDirty(false);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLHeadingElement>('.code-project-heading h2')?.focus());
  }
  return <section className="code-workspace-panel" dir={isRTL(locale) ? 'rtl' : 'ltr'} lang={locale} aria-labelledby={`${id}-title`} ref={panel} aria-busy={busy || loading}>
    <header className="code-workspace-header"><span className="code-workspace-mark" aria-hidden="true"><Code2 size={24} /></span><div><h1 id={`${id}-title`}>{c.title}</h1><p>{c.intro}</p></div></header>
    {sessionMode === 'none' && index?.readiness.configured === false && <p className="code-notice" role="status">{c.unavailable}</p>}
    {sessionMode === 'none' ? <p className="code-notice"><a href={`/signin?lang=${locale}&next=/`}>{c.signIn}</a></p> : <>
      <div className="code-toolbar"><button className="secondary" type="button" disabled={busy || loading} onClick={() => { setLoading(true); setRefresh(value => value + 1); }}><RefreshCw size={16} aria-hidden="true" />{c.refresh}</button><span className="code-muted" role="status">{(busy || loading) && <ThinkingOrb />}{busy ? c.busy : loading ? c.loading : connected ? c.connected : ''}</span></div>
      {error && <p className="code-alert" role="alert">{c[error]}</p>}
      {sessionMode === 'guest' && <p className="code-muted">{c.guest}</p>}
      {!loading && !connected && <div className="code-notice"><p>{c.unavailable}</p>{index?.readiness.reason && <details><summary>{c.reason}</summary><bdi className="code-id">{index.readiness.reason}</bdi></details>}</div>}
      <details className="code-scope"><summary>{c.scopeTitle}</summary><p>{c.scope}</p><p>{c.fileRules}</p></details>
      <ProjectComposer projects={state?.projects ?? []} c={c} act={act} disabled={!connected || busy || dirty || loading || (state?.projects.length ?? 0) >= 5} onCreated={choose} invalid={() => setError('inputError')} />
      <div className="code-layout"><aside className="code-project-list" aria-labelledby={`${id}-projects`}><h2 id={`${id}-projects`}>{c.projects}</h2>{dirty && <p className="code-muted">{c.dirty}</p>}{!state?.projects.length && <p className="code-muted">{loading ? c.loading : c.noProjects}</p>}<ul>{state?.projects.map(item => <li key={item.id}><button type="button" disabled={busy || dirty || loading} aria-current={item.id === project?.id ? 'true' : undefined} onClick={() => choose(item.id)}><strong>{item.name}</strong><small><bdi>{item.branch}</bdi></small></button></li>)}</ul></aside><div className="code-project-content">{project && state && <ProjectView key={project.id} project={project} state={state} c={c} act={act} disabled={!connected || busy || loading} dirty={dirty} onDirty={setDirty} locale={locale} invalid={() => setError('inputError')} />}</div></div>
    </>}
  </section>;
}
