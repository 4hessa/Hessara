'use client';
import {useEffect,useRef,useState} from 'react';
import type {Locale} from '@/lib/i18n';
import type {LabPreferences,LabPreferencesResponse,LabTaskType} from '@/lib/lab-preferences';
import {labCopy} from '@/lib/lab-copy';
import {advisorCopy} from '@/lib/advisor-copy';
import {evaluationCopy} from '@/lib/lab-evaluation-copy';
import {labExtras} from '@/lib/lab-extras-copy';

export function LabPreferencesPanel({locale,taskType,onApply}:{locale:Locale;taskType:LabTaskType;onApply?:(preferences:LabPreferences)=>void}) {
 const c=labCopy(locale),a=advisorCopy(locale),x=labExtras(locale),e=evaluationCopy(locale);
 const [open,setOpen]=useState(false),[data,setData]=useState<LabPreferencesResponse|null>(null);
 const [preferences,setPreferences]=useState<LabPreferences>({taskTypes:[],priority:'balanced',audience:'beginner',allowHistory:false});
 const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false),[saved,setSaved]=useState(false);
 const readController=useRef<AbortController|null>(null);
 const generation=useRef(0);
 useEffect(()=>{
   if(!open)return;
   const controller=new AbortController();
   readController.current=controller;
   const current=++generation.current;
   fetch(`/api/lab/preferences?taskType=${taskType}`,{cache:'no-store',signal:controller.signal}).then(async response=>{
     if(!response.ok)throw Error(); const result=await response.json() as LabPreferencesResponse;
     if(!controller.signal.aborted&&current===generation.current){setData(result); if(result.preferences)setPreferences(result.preferences);setError(false);}
   }).catch(()=>{if(!controller.signal.aborted)setError(true);});
   return ()=>controller.abort();
 },[open,taskType]);
 useEffect(()=>()=>{generation.current++;readController.current?.abort();},[]);
 async function save(remove=false){
   if(busy||(!remove&&!consent))return;
   readController.current?.abort();
   const current=++generation.current;
   setBusy(true);setError(false);setSaved(false);
   try{
     const response=await fetch('/api/lab/preferences',{method:remove?'DELETE':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(remove?{consent:true}:{consent:true,preferences:{taskTypes:preferences.taskTypes,priority:preferences.priority,audience:preferences.audience,allowHistory:preferences.allowHistory}})});
     if(!response.ok)throw Error();const result=await response.json() as LabPreferencesResponse;
     if(current!==generation.current)return;
     setData(result);setConsent(false);setSaved(!remove);
     if(remove)setPreferences({taskTypes:[],priority:'balanced',audience:'beginner',allowHistory:false});
     else {
       const updated=await fetch(`/api/lab/preferences?taskType=${taskType}`,{cache:'no-store'});
       if(!updated.ok)throw Error();const refreshed=await updated.json() as LabPreferencesResponse;
       if(current===generation.current)setData(refreshed);
     }
   }catch{if(current===generation.current)setError(true);}finally{setBusy(false);}
 }
 const num=(n:number)=>new Intl.NumberFormat(locale).format(n);
 return <details className="lab-preferences" onToggle={event=>setOpen(event.currentTarget.open)}><summary>{x.prefs}</summary>
 {error&&<p role="alert" className="lab-alert">{c.requestFailed}</p>}
 {!data&&!error&&open&&<p role="status">{c.loading}</p>}
 {data&&<>
 <fieldset className="lab-fields-reset" disabled={busy}>
 <div className="lab-fields"><label>{a.audience}<select value={preferences.audience} onChange={event=>{setSaved(false);setPreferences({...preferences,audience:event.target.value as LabPreferences['audience']});}}>{(['beginner','student','technical'] as const).map(v=><option value={v} key={v}>{a[v]}</option>)}</select></label>
 <label>{a.priority}<select value={preferences.priority} onChange={event=>{setSaved(false);setPreferences({...preferences,priority:event.target.value as LabPreferences['priority']});}}>{(['balanced','cost','speed'] as const).map(v=><option value={v} key={v}>{a[v==='speed'?'speedPriority':v]}</option>)}</select></label></div>
 <fieldset className="lab-pref-tasks"><legend>{c.task}</legend>{(['general','study','research','coding','writing','analysis','images','reasoning'] as const).map(v=><label className="lab-consent" key={v}><input type="checkbox" checked={preferences.taskTypes.includes(v)} onChange={event=>{setSaved(false);setPreferences({...preferences,taskTypes:event.target.checked?[...preferences.taskTypes,v]:preferences.taskTypes.filter(t=>t!==v)});}}/>{c[v]}</label>)}</fieldset>
 <label className="lab-consent"><input type="checkbox" checked={preferences.allowHistory} onChange={event=>{setSaved(false);setPreferences({...preferences,allowHistory:event.target.checked});}}/>{x.historyConsent}</label>
 <label className="lab-consent"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/>{x.prefsConsent}</label>
 <div className="lab-actions"><button type="button" className="primary" disabled={!consent} onClick={()=>void save()}>{busy?c.saving:x.savePrefs}</button>{data.preferences&&<button type="button" className="secondary" onClick={()=>void save(true)}>{x.deletePrefs}</button>}{data.preferences&&onApply&&<button type="button" className="secondary" onClick={()=>onApply(data.preferences!)}>{x.loadPrefs}</button>}</div>
 </fieldset>{saved&&<p role="status" className="lab-notice">{x.remembered}</p>}
 <section className="lab-past-evidence"><h3>{x.evidence}</h3><p className="lab-muted">{x.evidenceNote}</p>{!data.evidence.length?<p>{x.noEvidence}</p>:data.evidence.map(run=><details key={run.runId}><summary><bdi>{run.name}</bdi> · {new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(new Date(run.createdAt))}</summary>
 <p>{c.task}: {c[run.taskType]} · {c.questionCount}: {num(run.caseCount)}</p>
 <div className="table-scroll" role="region" aria-label={x.evidence} tabIndex={0}><table><thead><tr><th>{c.modelSelection}</th><th>{e.checkScore}</th><th>{e.coverage}</th></tr></thead><tbody>{run.models.map(model=><tr key={model.id}><th><bdi>{model.name}</bdi><small dir="ltr">{model.requestedModel}</small></th><td>{model.measuredChecks?`${num(model.passedChecks)} / ${num(model.measuredChecks)}`:c.notMeasured}</td><td>{num(model.measuredChecks)} / {num(model.configuredChecks)}</td></tr>)}</tbody></table></div>
 {run.cases.map(item=><details key={item.id}><summary>{item.title||c.prompt}</summary><pre className="lab-prompt" dir="auto">{item.prompt}</pre>{item.checks.map((check,i)=><p key={i}>{c[check.kind]}: <bdi>{check.value}</bdi></p>)}</details>)}<details><summary>{c.savedSettings}</summary><pre dir="ltr" className="lab-prompt">{JSON.stringify(run.settings,null,2)}</pre></details>
 </details>)}</section></>}
 </details>;
}
