"use client";
import { useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, SlidersHorizontal } from 'lucide-react';
import { ADVISOR_TASKS, analyzeTask, recommendModels, type TaskIntent, type AdvisorModel, type AdvisorRecommendation } from '@/lib/advisor';
import { advisorSnapshot } from '@/lib/advisor-snapshot';
import { advisorCopy, type AdvisorCopyKey } from '@/lib/advisor-copy';
import { type Locale } from '@/lib/i18n';
import { displayName } from '@/lib/display-names';
import './model-advisor.css';
import {LabPreferencesPanel} from './lab-preferences-panel';

const taskKey = (task: TaskIntent['task']): AdvisorCopyKey => task === 'reasoning' ? 'reasoningTask' : task;
const priorityKey = (priority: TaskIntent['priority']): AdvisorCopyKey => priority === 'context' ? 'contextPriority' : priority === 'speed' ? 'speedPriority' : priority;

export function ModelAdvisor({ locale, onCompare }: { locale: Locale; onCompare: (ids: string[]) => void }) {
  const c = advisorCopy(locale);
  const [text, setText] = useState('');
  const [intent, setIntent] = useState<TaskIntent | null>(null);
  const [context, setContext] = useState('0');
  const [recommendation, setRecommendation] = useState<AdvisorRecommendation | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [error, setError] = useState<AdvisorCopyKey | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const fmt = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(n);
  const date = (value: string | null) => value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z')) : c.unknown;
  function review(event: React.FormEvent) {
    event.preventDefault();
    if (text.trim().length < 12) { setError('descriptionShort'); return; }
    const analysis = analyzeTask(text);
    setIntent(analysis.intent); setContext(String(analysis.intent.minContext));
    setRecommendation(null); setSelection([]); setError(null); setDownloaded(false);
    requestAnimationFrame(() => reviewHeading.current?.focus());
  }
  function updateIntent(update: Partial<TaskIntent>) {
    setIntent(current => current ? { ...current, ...update } : current);
    setRecommendation(null); setSelection([]); setDownloaded(false); setError(null);
  }
  function recommend(event: React.FormEvent) {
    event.preventDefault();
    if (!intent) return;
    const amount = context.trim() === '' ? 0 : Number(context);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 10000000) { setError('invalidContext'); return; }
    const reviewed = { ...intent, minContext: amount };
    const result = recommendModels(reviewed, advisorSnapshot, { limit: 4 });
    setIntent(reviewed); setRecommendation(result); setSelection(result.candidates.slice(0, 3).map(item => item.model.id)); setError(null);
    requestAnimationFrame(() => resultHeading.current?.focus());
  }
  function download() {
    if (!recommendation || !intent) return;
    const data = { format: 'hessara-recommendation/1', createdAt: new Date().toISOString(), locale, intent, recommendation, snapshot: advisorSnapshot, explanation: { method: c.guided_analysis, notices: recommendation.notices.map(key => c[key]), candidates: recommendation.candidates.map(item => ({ id: item.model.id, reasons: item.reasons.map(key => c[key]), limitations: item.limitations.map(key => c[key]) })) } };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'hessara-recommendation.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setDownloaded(true);
  }
  return <section className="model-advisor" aria-labelledby="advisor-title">
    <header className="advisor-heading"><span className="advisor-mark" aria-hidden="true"><SlidersHorizontal size={22} /></span><div><h2 id="advisor-title">{c.title}</h2><p>{c.intro}</p></div></header>
    <form onSubmit={review} className="advisor-description">
      <label htmlFor="advisor-description">{c.prompt}</label>
      <textarea id="advisor-description" value={text} maxLength={4000} rows={3} placeholder={c.placeholder} onChange={event => { setText(event.target.value); setIntent(null); setRecommendation(null); setError(null); setDownloaded(false); }} aria-describedby="advisor-privacy" dir="auto" />
      <div className="advisor-form-footer"><p id="advisor-privacy">{c.privacy}</p><button className="primary" type="submit">{c.analyze}<ArrowUpRight size={17} aria-hidden="true" /></button></div>
    </form>
    {error && <p className="advisor-alert" role="alert">{c[error]}</p>}
    {intent && <form className="advisor-review" onSubmit={recommend}>
      <h3 tabIndex={-1} ref={reviewHeading}>{c.review}</h3><p className="advisor-muted">{c.reviewNote}</p>
      {intent.task === 'general' && <p className="advisor-alert">{c.clarify}</p>}
      <div className="advisor-fields">
        <label>{c.audience}<select value={intent.audience} onChange={event => updateIntent({ audience: event.target.value as TaskIntent['audience'] })}>{(['beginner', 'student', 'technical'] as const).map(value => <option value={value} key={value}>{c[value]}</option>)}</select></label>
        <label>{c.task}<select value={intent.task} onChange={event => updateIntent({ task: event.target.value as TaskIntent['task'] })}>{ADVISOR_TASKS.map(value => <option value={value} key={value}>{c[taskKey(value)]}</option>)}</select></label>
        <label>{c.priority}<select value={intent.priority} onChange={event => updateIntent({ priority: event.target.value as TaskIntent['priority'] })}>{(['balanced', 'cost', 'context', 'speed'] as const).map(value => <option value={value} key={value}>{c[priorityKey(value)]}</option>)}</select></label>
      </div>
      <LabPreferencesPanel locale={locale} taskType={intent.task} onApply={preferences=>updateIntent({audience:preferences.audience,priority:preferences.priority})}/>
      {intent.priority === 'cost' && <p className="advisor-muted">{c.policy}: {c.inputPrice} + {c.outputPrice}. {c.cost_estimate_only}</p>}
      {intent.audience === 'student' && <><div className="advisor-fields advisor-fields-two"><label>{c.stage}<input value={intent.stage ?? ''} maxLength={100} onChange={event => updateIntent({ stage: event.target.value })} /></label><label>{c.subject}<input value={intent.subject ?? ''} maxLength={100} onChange={event => updateIntent({ subject: event.target.value })} /></label></div><p className="advisor-muted">{c.studentNote}</p></>}
      <fieldset className="advisor-needs"><legend>{c.needs}</legend>{(['imageInput','fileInput','toolUse'] as const).map(key => <label key={key}><input type="checkbox" checked={intent[key]} onChange={event => updateIntent({ [key]: event.target.checked })} />{c[key]}</label>)}</fieldset>
      <details className="advisor-advanced"><summary>{c.context}</summary><label>{c.minContext}<input type="number" min="0" max="10000000" step="1" value={context} onChange={event => { setContext(event.target.value); setRecommendation(null); setDownloaded(false); }} aria-describedby="advisor-context-hint" /></label><p id="advisor-context-hint" className="advisor-muted">{c.contextHint}</p></details>
      <button className="primary" type="submit" disabled={intent.task === 'general'}>{c.recommend}<ArrowUpRight size={17} aria-hidden="true" /></button>
    </form>}
    {recommendation && <div className="advisor-results">
      <h3 tabIndex={-1} ref={resultHeading}>{c.results}</h3><p>{c.resultsNote}</p>
      {recommendation.notices.filter(key => ['speed_not_ranked','app_text_only'].includes(key)).map(key => <p className="advisor-alert" key={key}>{c[key]}</p>)}
      {!recommendation.candidates.length && <p role="status" className="advisor-alert">{c.noMatch}</p>}
      <div className="advisor-candidates">{recommendation.candidates.map(candidate => <article className="advisor-candidate" key={candidate.model.id}>
        <div className="advisor-candidate-top"><span>{displayName(candidate.model.publisher, locale)}</span><label className="advisor-pick"><input type="checkbox" checked={selection.includes(candidate.model.id)} onChange={event => setSelection(current => event.target.checked ? [...current, candidate.model.id].slice(0,4) : current.filter(id => id !== candidate.model.id))} aria-label={`${c.select}: ${displayName(candidate.model.name, locale)}`} />{c.select}</label></div>
        <h4 dir="auto">{displayName(candidate.model.name, locale)}</h4>
        <p className="advisor-confidence">{c.evidence}: {c[candidate.evidenceStrength]}</p>
        <h5>{c.why}</h5><ul>{candidate.reasons.map(reason => <li key={reason}>{c[reason]}</li>)}</ul>
        <details><summary>{c.details}</summary><p className="advisor-muted">{c.evidenceHelp}</p><dl className="advisor-facts"><div><dt>{c.context}</dt><dd>{candidate.model.context === null ? c.unknown : fmt(candidate.model.context)}</dd></div><div><dt>{c.inputPrice}</dt><dd>{candidate.model.inputPrice === null ? c.unknown : '$' + fmt(candidate.model.inputPrice)}</dd></div><div><dt>{c.outputPrice}</dt><dd>{candidate.model.outputPrice === null ? c.unknown : '$' + fmt(candidate.model.outputPrice)}</dd></div><div><dt>{c.checked}</dt><dd>{date(candidate.model.checkedAt)}</dd></div></dl><p className="advisor-muted">{c.priceNote}</p><h5>{c.limits}</h5><ul>{candidate.limitations.map(limit => <li key={limit}>{c[limit]}</li>)}</ul>{candidate.model.source && <a className="external-link" href={candidate.model.source} target="_blank" rel="noopener noreferrer">{c.source}<ArrowUpRight size={15} aria-hidden="true" /></a>}</details>
      </article>)}</div>
      {recommendation.candidates.length > 0 && <><p className="advisor-muted">{c.selectionHint}</p><div className="advisor-actions"><button className="primary" type="button" disabled={selection.length < 2} onClick={() => onCompare(selection)}>{c.compare} · {fmt(selection.length)}</button><button className="secondary" type="button" onClick={download}><ArrowDownToLine size={16} aria-hidden="true" />{c.download}</button></div><p className="advisor-muted">{c.downloadNote}</p>{downloaded && <p role="status"><Check size={16} aria-hidden="true" /> {c.saved}</p>}</>}
    </div>}
  </section>;
}

export function ModelEvidenceComparison({ locale, models }: { locale: Locale; models: readonly AdvisorModel[] }) {
  const c = advisorCopy(locale);
  const number = (n: number | null) => n === null ? c.unknown : new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(n);
  const support = (value: boolean | null) => value === null ? c.unknown : value ? c.available : c.notListed;
  const rows: { label: string; value: (model: AdvisorModel) => string }[] = [
    { label: c.context, value: model => number(model.context) }, { label: c.inputPrice, value: model => model.inputPrice === null ? c.unknown : '$' + number(model.inputPrice) }, { label: c.outputPrice, value: model => model.outputPrice === null ? c.unknown : '$' + number(model.outputPrice) },
    { label: c.imageInput, value: model => support(model.inputModalities === null ? null : model.inputModalities.includes('image')) }, { label: c.fileInput, value: model => support(model.inputModalities === null ? null : model.inputModalities.includes('file')) }, { label: c.toolUse, value: model => support(model.tools) }, { label: c.reasoning, value: model => support(model.reasoning) },
  ];
  return <section id="model-evidence-comparison" className="spec-comparison advisor-comparison" aria-labelledby="evidence-comparison-heading"><h3 id="evidence-comparison-heading" tabIndex={-1}>{c.compare}</h3><p>{c.provenance}</p><div className="table-scroll" role="region" aria-label={c.compare} tabIndex={0}><table><caption>{c.priceNote}</caption><thead><tr><th scope="col">{c.capabilities}</th>{models.map(model => <th scope="col" key={model.id}>{displayName(model.name, locale)}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th>{models.map(model => <td key={model.id}>{row.value(model)}</td>)}</tr>)}<tr><th scope="row">{c.source}</th>{models.map(model => <td key={model.id}>{model.source ? <a href={model.source} target="_blank" rel="noopener noreferrer">OpenRouter</a> : c.unknown}<br />{model.checkedAt ? new Intl.DateTimeFormat(locale, { dateStyle:'medium', timeZone:'UTC' }).format(new Date(model.checkedAt + 'T00:00:00Z')) : c.unknown}</td>)}</tr><tr className="advisor-measurement-heading"><th colSpan={models.length + 1}>{c.measured}</th></tr>{[c.quality,c.speed].map(label => <tr key={label}><th scope="row">{label}</th>{models.map(model => <td key={model.id}>{c.unmeasured}</td>)}</tr>)}</tbody></table></div><p className="advisor-muted">{c.connector_text_only} {c.tools_not_search} {c.reasoning_not_quality}</p></section>;
}
