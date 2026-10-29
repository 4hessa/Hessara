'use client';
import {useState} from 'react';
import {analyzeTask,recommendModels,type AdvisorModel,type AdvisorRecommendation} from '@/lib/advisor';
import {advisorSnapshot} from '@/lib/advisor-snapshot';
import {advisorCopy} from '@/lib/advisor-copy';
import {labExtras} from '@/lib/lab-extras-copy';
import type {Locale} from '@/lib/i18n';

/** A focused, sourced task-fit guide. It cannot invent missing model capabilities. */
export function ModelContextHelp({locale,model}:{locale:Locale;model:AdvisorModel}){
 const c=advisorCopy(locale),x=labExtras(locale);
 const [text,setText]=useState(''),[result,setResult]=useState<AdvisorRecommendation|null>(null);
 function analyze(){if(text.trim().length<12)return;const {intent}=analyzeTask(text);setResult(recommendModels(intent,{...advisorSnapshot,models:[model]},{limit:1}));}
 return <details className="model-context-help"><summary>{x.modelHelp}</summary><p>{x.modelHelpNote}</p><label>{c.prompt}<textarea maxLength={4000} value={text} rows={3} dir="auto" onChange={event=>{setText(event.target.value);setResult(null);}}/></label><p>{c.privacy}</p><button className="secondary" type="button" disabled={text.trim().length<12} onClick={analyze}>{c.analyze}</button>
 {result&&<div role="status">{result.candidates.length?<><h4>{c.why}</h4><ul>{result.candidates[0].reasons.map(reason=><li key={reason}>{c[reason]}</li>)}</ul><h4>{c.limits}</h4><ul>{result.candidates[0].limitations.map(limit=><li key={limit}>{c[limit]}</li>)}</ul></>:<p>{c.noMatch}</p>}<p>{c.evidenceHelp}</p>{model.source&&<a href={model.source} target="_blank" rel="noopener noreferrer">{c.source} · OpenRouter</a>}</div>}
 </details>;
}
