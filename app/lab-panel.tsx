'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, FlaskConical, Plus, RefreshCw, X } from 'lucide-react';
import type { CustomLabInput, LabCase, LabCheck, LabRun, LabRunDetail, LabTrial, LabRunSummary } from '@/lib/custom-lab';
import type { Model } from '@/lib/benchmarks';
import type { Locale } from '@/lib/i18n';
import { labCopy, type LabCopy, type LabCopyKey } from '@/lib/lab-copy';
import './lab-panel.css';
import {LabEvaluationPanel} from './lab-evaluation-panel';
import {LabPreferencesPanel} from './lab-preferences-panel';
import {LabReportPanel} from './lab-report-panel';
import {labExtras} from '@/lib/lab-extras-copy';
import {analyzeTask} from '@/lib/advisor';
import { ThinkingOrb } from './thinking-orb';

const taskTypes: CustomLabInput['taskType'][] = ['general', 'study', 'research', 'coding', 'writing', 'analysis', 'images', 'reasoning'];
const blankCase = (): LabCase => ({ id: crypto.randomUUID(), title: '', prompt: '', reference: '', checks: [] });
type LabIndex = { runs: LabRunSummary[]; models: Model[] };
type Action = 'start' | 'resume' | 'cancel';
type Props = { locale: Locale; sessionMode: 'guest' | 'account' | 'none'; onConnect: () => void; initialModels?:string[]; connectionPanel?:ReactNode };

async function labRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'REQUEST_FAILED');
  return data as T;
}

function errorKey(error: unknown): LabCopyKey {
  const code = error instanceof Error ? error.message : '';
  if (code === 'AUTH_REQUIRED') return 'authError';
  if (code === 'INVALID_INPUT') return 'invalidInput';
  if (code === 'NOT_READY') return 'notReady';
  if (['LIMIT_OR_CONFLICT', 'ID_CONFLICT'].includes(code)) return 'limitError';
  if (['BUSY', 'INVALID_STATE', 'VERSION'].includes(code)) return 'stateError';
  if (code === 'NOT_FOUND') return 'notFound';
  return error instanceof TypeError ? 'networkError' : 'requestFailed';
}

export function LabPanel({ locale, sessionMode, onConnect, initialModels=[], connectionPanel }: Props) {
  const c = labCopy(locale);
  const x = labExtras(locale);
  const formId = useId();
  const [index, setIndex] = useState<LabIndex | null>(null);
  const [indexRefresh, setIndexRefresh] = useState(0);
  const [detailRefresh, setDetailRefresh] = useState(0);
  const [detail, setDetail] = useState<LabRunDetail | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [composer, setComposer] = useState(true);
  const [name, setName] = useState('');
  const [taskType, setTaskType] = useState<CustomLabInput['taskType']>('general');
  const [cases, setCases] = useState<LabCase[]>(() => [blankCase()]);
  const [selectedModels, setSelectedModels] = useState<string[]>(initialModels.slice(0,4));
  const [topic,setTopic]=useState('');
  const [deleteConsent,setDeleteConsent]=useState(false);
  const [maxOutputTokens, setMaxOutputTokens] = useState<CustomLabInput['maxOutputTokens']>(1024);
  const usesPlatformModels = !!index?.models.some(model => selectedModels.includes(model.id) && model.provider === 'cloudflare');
  const effectiveOutputTokens = usesPlatformModels ? 512 : maxOutputTokens;
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LabCopyKey | null>(null);
  const [notice, setNotice] = useState<LabCopyKey | null>(null);
  const draftId = useRef<string | null>(null);
  const pollingController = useRef<AbortController | null>(null);
  const mutationController = useRef<AbortController | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const number = (value: number, digits = 2) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  const date = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : c.unknown;

  useEffect(() => {
    if (sessionMode === 'none') return;
    const controller = new AbortController();
    labRequest<LabIndex>('/api/lab', { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setIndex(data); setError(null); }
    }).catch(cause => { if (!controller.signal.aborted) setError(errorKey(cause)); });
    return () => controller.abort();
  }, [sessionMode, indexRefresh]);

  useEffect(() => {
    if (!viewId || sessionMode === 'none') return;
    const controller = new AbortController();
    pollingController.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let keepPolling = true;
    async function refresh() {
      if (controller.signal.aborted || inFlight) return;
      if (document.hidden) return;
      inFlight = true;
      try {
        const data = await labRequest<LabRunDetail>(`/api/lab/${encodeURIComponent(viewId!)}`, { signal: controller.signal });
        if (!controller.signal.aborted) {
          setDetail(data);
          setIndex(previous => previous ? { ...previous, runs: [data.run, ...previous.runs.filter(run => run.id !== data.run.id)] } : previous);
          keepPolling = data.run.status === 'running';
        }
      } catch (cause) { if (!controller.signal.aborted) setError(errorKey(cause)); }
      finally {
        inFlight = false;
        if (!controller.signal.aborted && keepPolling) timer = setTimeout(refresh, 4000);
      }
    }
    const onVisibility = () => { if (!document.hidden) { clearTimeout(timer); void refresh(); } };
    void refresh();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [viewId, sessionMode, detailRefresh]);

  useEffect(() => () => { mutationController.current?.abort(); }, []);

  function changed() { draftId.current = null; setError(null); setNotice(null); }
  function updateCase(index: number, update: Partial<LabCase>) { changed(); setCases(previous => previous.map((item, i) => i === index ? { ...item, ...update } : item)); }
  function updateCheck(caseIndex: number, checkIndex: number, update: Partial<LabCheck>) {
    updateCase(caseIndex, { checks: cases[caseIndex].checks?.map((check, i) => i === checkIndex ? { ...check, ...update } : check) });
  }
  function newExperiment(copy?: LabRun) {
    pollingController.current?.abort();
    setViewId(null); setDetail(null); setConsent(false); setDeleteConsent(false); setComposer(true); changed();
    setName(copy ? copy.name.slice(0, 80) : '');
    setTaskType(copy?.configData.taskType ?? 'general');
    setCases(copy ? copy.configData.cases.map(item => ({ ...item, id: crypto.randomUUID(), checks: item.checks?.map(check => ({ ...check })) })) : [blankCase()]);
    setSelectedModels(copy ? copy.configData.models.filter(id => index?.models.some(model => model.id === id)) : []);
    setMaxOutputTokens(copy?.configData.maxOutputTokens ?? 1024);
    requestAnimationFrame(() => formHeading.current?.focus());
  }
  function chooseRun(run: LabRunSummary) {
    pollingController.current?.abort();
    setError(null); setNotice(null); setConsent(false); setDeleteConsent(false); setComposer(false); setDetail(null); setViewId(run.id);
    setDetailRefresh(value => value + 1);
    requestAnimationFrame(() => resultHeading.current?.focus());
  }
  function acceptDetail(data: LabRunDetail) {
    setDetail(data); setViewId(data.run.id); setComposer(false);
    setIndex(previous => previous ? { ...previous, runs: [data.run, ...previous.runs.filter(run => run.id !== data.run.id)] } : previous);
    setDetailRefresh(value => value + 1);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim() || selectedModels.length < 2 || selectedModels.length > 4 || cases.some(item => !item.prompt.trim())) { setError('invalidInput'); return; }
    draftId.current ??= crypto.randomUUID();
    const payload: CustomLabInput = { requestId: draftId.current, name, taskType, locale, models: selectedModels, cases, maxOutputTokens: effectiveOutputTokens };
    const controller = new AbortController(); mutationController.current = controller;
    setBusy(true); setError(null); setNotice(null); pollingController.current?.abort();
    try {
      const data = await labRequest<LabRunDetail>('/api/lab', { method: 'POST', body: JSON.stringify(payload), signal: controller.signal });
      if (!controller.signal.aborted) { acceptDetail(data); setNotice('saved'); setConsent(false); requestAnimationFrame(() => resultHeading.current?.focus()); }
    } catch (cause) { if (!controller.signal.aborted) setError(errorKey(cause)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function act(action: Action) {
    if (!detail || busy || ((action === 'start' || action === 'resume') && !consent)) return;
    const controller = new AbortController(); mutationController.current = controller;
    setBusy(true); setError(null); setNotice(null); pollingController.current?.abort();
    try {
      const data = await labRequest<LabRunDetail>(`/api/lab/${encodeURIComponent(detail.run.id)}`, { method: 'POST', body: JSON.stringify({ action }), signal: controller.signal });
      if (!controller.signal.aborted) { acceptDetail(data); setConsent(false); }
    } catch (cause) {
      if (!controller.signal.aborted) { setError(errorKey(cause)); setDetailRefresh(value => value + 1); }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function suggestCases(){
    if(topic.trim().length<12)return;
    const retained=cases.filter(item=>item.prompt.trim());
    const suggestions=[x.simplePrompt,x.appliedPrompt,x.boundaryPrompt].slice(0,8-retained.length).map(prompt=>({...blankCase(),prompt:`${prompt}\n\n${topic.trim()}`}));
    changed();setCases([...retained,...suggestions]);setTaskType(analyzeTask(topic).intent.task);
    if(!name.trim())setName(topic.trim().slice(0,80));
  }
  async function removeRun(){
    if(!detail||busy||!deleteConsent)return;
    setBusy(true);setError(null);pollingController.current?.abort();
    try{await labRequest(`/api/lab/${detail.run.id}`,{method:'DELETE',body:JSON.stringify({consent:true})});setIndex(previous=>previous?{...previous,runs:previous.runs.filter(run=>run.id!==detail.run.id)}:previous);newExperiment();}
    catch(cause){setError(errorKey(cause));setDetailRefresh(v=>v+1);}finally{setBusy(false);}
  }

  const readyModels = index?.models.filter(model => model.ready && model.provider !== 'simulation') ?? [];
  const run = detail?.run;
  return <section className="lab-panel" aria-labelledby={`${formId}-title`}>
    <header className="lab-header"><span className="lab-mark" aria-hidden="true"><FlaskConical size={24} /></span><div><h1 id={`${formId}-title`}>{c.title}</h1><p>{c.intro}</p></div></header>
    {connectionPanel}
    <div className="lab-toolbar"><button type="button" className="primary" onClick={() => newExperiment()} disabled={busy}><Plus size={17} aria-hidden="true" />{c.newRun}</button><button type="button" className="secondary" onClick={() => { setIndexRefresh(value => value + 1); setDetailRefresh(value => value + 1); }} disabled={busy}><RefreshCw size={16} aria-hidden="true" />{c.refresh}</button><button className="secondary" type="button" onClick={onConnect} disabled={busy}>{c.connect}<ArrowUpRight size={16} aria-hidden="true" /></button></div>
    {error && <p className="lab-alert" role="alert">{c[error]}</p>}
    {notice && <p className="lab-notice" role="status">{c[notice]}</p>}
    {sessionMode === 'none' ? <p className="lab-alert">{c.signIn}</p> : <>
      {!index && !error && <p role="status"><ThinkingOrb />{c.loading}</p>}
      <LabPreferencesPanel locale={locale} taskType={run?.configData.taskType??taskType}/>
      <div className="lab-layout">
        <aside className="lab-history" aria-label={c.history}><h2>{c.history}</h2>{index?.runs.length ? <ul>{index.runs.map(item => <li key={item.id}><button type="button" aria-current={item.id === viewId ? 'true' : undefined} disabled={busy} onClick={() => chooseRun(item)}><strong dir="auto">{item.name}</strong><span>{c[item.status]} · {date(item.created_at)}</span></button></li>)}</ul> : <p>{c.noHistory}</p>}</aside>
        <div className="lab-content">
          {composer ? <form className="lab-composer" onSubmit={save}>
            <h2 tabIndex={-1} ref={formHeading}>{c.newRun}</h2>
            <fieldset disabled={busy} className="lab-fields-reset">
              <div className="lab-fields"><label>{c.name}<input value={name} onChange={event => { changed(); setName(event.target.value); }} maxLength={80} required placeholder={c.namePlaceholder} dir="auto" /></label><label>{c.task}<select value={taskType} onChange={event => { changed(); setTaskType(event.target.value as CustomLabInput['taskType']); }}>{taskTypes.map(type => <option value={type} key={type}>{c[type]}</option>)}</select></label></div>
              <p className="lab-muted">{c.textOnly}</p>
              <details className="lab-suggestions"><summary>{x.suggest}</summary><label>{x.topic}<textarea value={topic} maxLength={1000} rows={3} dir="auto" onChange={event=>setTopic(event.target.value)}/></label><p className="lab-muted">{x.templateNote}</p><button type="button" className="secondary" disabled={topic.trim().length<12||cases.filter(item=>item.prompt.trim()).length>=8} onClick={suggestCases}>{x.suggest}</button></details>
              <fieldset className="lab-cases"><legend>{c.cases}</legend>{cases.map((item, caseIndex) => <section className="lab-question" key={item.id} aria-label={`${c.cases} ${number(caseIndex + 1, 0)}`}>
                <div className="lab-question-top"><span className="lab-number" aria-hidden="true">{number(caseIndex + 1, 0)}</span>{cases.length > 1 && <button type="button" className="lab-icon-button" onClick={() => { changed(); setCases(previous => previous.filter((_, i) => i !== caseIndex)); }} aria-label={`${c.removeCase} ${number(caseIndex + 1, 0)}`}><X size={18} /></button>}</div>
                <label>{c.caseTitle}<input value={item.title} maxLength={100} onChange={event => updateCase(caseIndex, { title: event.target.value })} dir="auto" /></label>
                <label>{c.prompt}<textarea value={item.prompt} onChange={event => updateCase(caseIndex, { prompt: event.target.value })} maxLength={8000} rows={5} required placeholder={c.promptPlaceholder} dir="auto" /></label>
                <details><summary>{c.advanced}</summary><p className="lab-muted">{c.referenceNote}</p><label>{c.reference}<textarea value={item.reference ?? ''} onChange={event => updateCase(caseIndex, { reference: event.target.value })} maxLength={4000} rows={3} dir="auto" /></label>
                  <fieldset className="lab-checks"><legend>{c.checks}</legend>{item.checks?.map((check, checkIndex) => <div className="lab-check" key={checkIndex}><label>{c.checkKind}<select value={check.kind} onChange={event => updateCheck(caseIndex, checkIndex, { kind: event.target.value as LabCheck['kind'], value: event.target.value === 'json' ? '' : check.value })}>{(['contains', 'excludes', 'exact', 'json'] as const).map(kind => <option value={kind} key={kind}>{c[kind]}</option>)}</select></label>{check.kind !== 'json' && <label>{c.checkValue}<input value={check.value} onChange={event => updateCheck(caseIndex, checkIndex, { value: event.target.value })} maxLength={1000} dir="auto" /></label>}<button type="button" className="lab-icon-button" aria-label={c.removeCheck} onClick={() => updateCase(caseIndex, { checks: item.checks?.filter((_, i) => i !== checkIndex) })}><X size={17} /></button></div>)}<button type="button" className="secondary" disabled={(item.checks?.length ?? 0) >= 8} onClick={() => updateCase(caseIndex, { checks: [...(item.checks ?? []), { kind: 'contains', value: '' }] })}><Plus size={16} aria-hidden="true" />{c.addCheck}</button></fieldset>
                </details>
              </section>)}<button type="button" className="secondary" disabled={cases.length >= 8} onClick={() => { changed(); setCases(previous => [...previous, blankCase()]); }}><Plus size={16} aria-hidden="true" />{c.addCase}</button></fieldset>
              <fieldset className="lab-models"><legend>{c.models}</legend>{readyModels.length < 2 && <p className="lab-alert">{c.needModels}</p>}<div className="lab-model-grid">{readyModels.map(model => <label className="lab-model-option" key={model.id}><input type="checkbox" checked={selectedModels.includes(model.id)} disabled={!selectedModels.includes(model.id) && selectedModels.length >= 4} onChange={event => { changed(); setSelectedModels(previous => event.target.checked ? [...previous, model.id] : previous.filter(id => id !== model.id)); }} /><span><strong dir="auto">{model.name}</strong><small dir="ltr">{model.label}</small></span></label>)}</div></fieldset>
              <details className="lab-settings"><summary>{c.settings}</summary><label>{c.maxTokens}<select value={effectiveOutputTokens} disabled={usesPlatformModels} onChange={event => { changed(); setMaxOutputTokens(Number(event.target.value) as CustomLabInput['maxOutputTokens']); }}>{([512, 1024, 2048] as const).map(value => <option key={value} value={value}>{number(value, 0)}</option>)}</select></label>{usesPlatformModels && <p className="lab-muted">Cloudflare · {c.maxTokens}: {number(512, 0)}</p>}<p className="lab-muted">{c.settingsNote}</p></details>
              <p className="lab-muted">{sessionMode === 'account' ? c.accountPrivacy : c.guestPrivacy}</p><div className="lab-actions"><button className="primary" type="submit" disabled={busy || selectedModels.length < 2 || readyModels.length < 2}>{busy ? c.saving : c.save}</button><span className="lab-muted">{c.draftNote}</span></div>
            </fieldset>
          </form> : !run ? <p role="status"><ThinkingOrb />{c.loading}</p> : <section className="lab-run" aria-labelledby={`${formId}-run-title`}>
            <header className="lab-run-heading"><div><span className="lab-status">{c[run.status]}</span><h2 id={`${formId}-run-title`} ref={resultHeading} tabIndex={-1} dir="auto">{run.name}</h2><p className="lab-muted">{c.createdAt}: {date(run.created_at)}</p></div><button type="button" className="secondary" disabled={busy} onClick={() => newExperiment(run)}>{c.editCopy}</button></header>
            <dl className="lab-stats"><div><dt>{c.questionCount}</dt><dd>{number(run.configData.cases.length, 0)}</dd></div><div><dt>{c.modelCount}</dt><dd>{number(run.configData.models.length, 0)}</dd></div><div><dt>{c.calls}</dt><dd>{number(run.total, 0)}</dd></div><div><dt>{c.progress}</dt><dd>{number(run.done, 0)} / {number(run.total, 0)}</dd></div></dl>
            <div role="status" className="lab-progress-label">{c[run.status]} · {c.progress}: {number(run.done, 0)} / {number(run.total, 0)}</div><progress max={run.total || 1} value={run.done} aria-label={c.progress} />
            {(run.status === 'draft' || run.status === 'paused') && <div className="lab-launch"><h3>{c.review}</h3><p>{c.providerNotice}</p><p className="lab-muted">{run.status === 'paused' ? c.resumeNote : c.settingsNote}</p><label className="lab-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} />{c.consent}</label><button type="button" className="primary" disabled={!consent || busy} onClick={() => void act(run.status === 'draft' ? 'start' : 'resume')}>{busy ? c.working : run.status === 'draft' ? c.start : c.resume}</button></div>}
            {run.status === 'running' && <p className="lab-notice">{c.runningNote}</p>}
            {(['draft', 'running', 'paused'] as const).some(status => status === run.status) && <div className="lab-cancel"><p className="lab-muted">{c.cancelNote}</p><button type="button" className="secondary" onClick={() => void act('cancel')} disabled={busy}>{c.cancel}</button></div>}
            <h3 className="lab-results-title">{c.results}</h3><p className="lab-muted">{c.qualityNote}</p><p className="lab-muted">{c.costNote}</p>
            <LabReportPanel key={run.id} locale={locale} runId={run.id}/>
            {run.configData.cases.map((item, caseIndex) => <section className="lab-result-case" key={item.id} aria-labelledby={`${formId}-case-${caseIndex}`}><h4 id={`${formId}-case-${caseIndex}`} dir="auto">{item.title || `${c.cases} ${number(caseIndex + 1, 0)}`}</h4><details open={run.status === 'draft'}><summary>{c.prompt}</summary><pre className="lab-prompt" dir="auto">{item.prompt}</pre></details>
              {(item.reference || item.checks?.length) ? <details><summary>{c.savedReference}</summary><p className="lab-muted">{c.referenceNote}</p>{item.reference && <pre className="lab-prompt" dir="auto">{item.reference}</pre>}{item.checks?.map((check, i) => <p key={i}>{c[check.kind]}{check.value ? <>: <bdi>{check.value}</bdi></> : null}</p>)}</details> : null}
              <div className="lab-answers">{run.configData.modelSnapshots.map(model => <TrialCard key={model.id} modelName={model.name} requestedModel={model.model} trial={detail.trials.find(trial => trial.model === model.id && trial.task_id === item.id)} locale={locale} c={c} item={item} models={readyModels} runId={run.id} />)}</div>
            </section>)}
            <details className="lab-run-details"><summary>{c.details}</summary><p className="lab-muted">{c.settingsNote}</p><pre dir="ltr">{JSON.stringify({ policy: run.configData.version, taskType: run.configData.taskType, locale: run.configData.locale, providerPolicies: run.configData.providerPolicies, pricingRecordedAt: run.configData.pricing_recorded_at }, null, 2)}</pre>{run.status === 'running' && <div className="lab-recover"><p>{c.recoverNote}</p><label className="lab-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} />{c.consent}</label><button type="button" className="secondary" disabled={busy || !consent} onClick={() => void act('resume')}>{c.recover}</button></div>}</details>
            {run.status!=='running'&&<details className="lab-delete"><summary>{x.deleteRun}</summary><label className="lab-consent"><input type="checkbox" checked={deleteConsent} disabled={busy} onChange={event=>setDeleteConsent(event.target.checked)}/>{x.deleteConsent}</label><button type="button" className="secondary" disabled={busy||!deleteConsent} onClick={()=>void removeRun()}>{x.deleteRun}</button></details>}
          </section>}
        </div>
      </div>
    </>}
  </section>;
}

function TrialCard({ modelName, requestedModel, trial, locale, c, item, models, runId }: { modelName: string; requestedModel: string; trial?: LabTrial; locale: Locale; c: LabCopy; item:LabCase; models:Model[]; runId:string }) {
  const number = (value: number | null | undefined, digits = 2) => value == null ? c.unknown : new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  const date = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : c.unknown;
  const metadata = trial?.metadataData;
  return <article className="lab-answer"><header><h5 dir="auto">{modelName}</h5><span className="lab-status">{trial ? c[trial.status] : c.waiting}</span></header><p className="lab-model-id" dir="ltr">{requestedModel}</p>
    {trial?.error && <p className="lab-alert">{trial.error === 'interrupted_unknown_outcome' ? c.interrupted : c.transportError}</p>}
    <div className="lab-output" aria-label={c.output} dir="auto">{trial?.output || <span className="lab-muted">{c.noOutput}</span>}</div>
    {metadata?.truncated === true && <p className="lab-muted">{c.truncated}</p>}
    <dl className="lab-answer-facts"><div><dt>{c.latency}</dt><dd>{trial?.latency == null ? c.unknown : `${number(trial.latency / 1000)} ${c.seconds}`}</dd></div><div><dt>{c.cost}</dt><dd>{number(trial?.cost, 8)}</dd></div></dl>
    {trial && trial.status!=='running' && <LabEvaluationPanel key={trial.id} locale={locale} item={item} trial={trial} models={models} runId={runId}/>}
    {trial && <details><summary>{c.details}</summary><dl className="lab-technical"><div><dt>{c.requestedModel}</dt><dd dir="ltr">{metadata?.requested_model || requestedModel}</dd></div><div><dt>{c.resolvedModel}</dt><dd dir="ltr">{metadata?.resolved_model || c.unknown}</dd></div><div><dt>{c.startedAt}</dt><dd>{date(metadata?.started_at)}</dd></div><div><dt>{c.finishedAt}</dt><dd>{date(metadata?.finished_at)}</dd></div><div><dt>{c.inputTokens}</dt><dd>{number(trial.input_tokens, 0)}</dd></div><div><dt>{c.outputTokens}</dt><dd>{number(trial.output_tokens, 0)}</dd></div></dl><p className="lab-muted">{c.versionNote}</p>{trial.error && <p>{c.errorCode}: <code>{trial.error}</code></p>}<h6>{c.savedSettings}</h6><pre dir="ltr">{JSON.stringify(metadata?.settings ?? {}, null, 2)}</pre><h6>{c.rawMetadata}</h6><pre dir="ltr">{JSON.stringify(metadata ?? {}, null, 2)}</pre></details>}
  </article>;
}
