'use client';
import {useRef,useState} from 'react';
import type {Locale} from '@/lib/i18n';
import type {Model} from '@/lib/benchmarks';
import type {LabCase,LabTrial} from '@/lib/custom-lab';
import {evaluateLabTrial,LAB_REVIEW_CRITERIA,type LabManualReviewInput} from '@/lib/lab-evaluation';
import type {LabReviews,SavedJudgement} from '@/lib/lab-reviews';
import {evaluationCopy} from '@/lib/lab-evaluation-copy';

const emptyReview=():LabManualReviewInput=>({criteria:[],claims:[],notes:''});
type EvaluationMessage='error'|'saved'|'sameEvaluator'|'limit';
export function LabEvaluationPanel({locale,item,trial,models,runId}:{locale:Locale;item:LabCase;trial:LabTrial;models:Model[];runId:string}){
  const c=evaluationCopy(locale),evaluation=evaluateLabTrial(item,trial);
  const [opened,setOpened]=useState(false),[review,setReview]=useState(emptyReview),[stored,setStored]=useState(false);
  const [judgements,setJudgements]=useState<SavedJudgement[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState<EvaluationMessage|null>(null);
  const [viewedAt,setViewedAt]=useState(0);
  const [modelId,setModelId]=useState(''),[consent,setConsent]=useState(false);
  const requestId=useRef<string|null>(null),loaded=useRef(false);
  const n=(value:number)=>new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value);
  const eligible=models.filter(model=>model.ready && model.provider!=='simulation' && model.id!==trial.model);
  async function call(body?:unknown){
    const response=await fetch(`/api/lab/${encodeURIComponent(runId)}/reviews`,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
    const data:unknown=await response.json();
    if(!response.ok)throw new Error(data && typeof data==='object' && 'error' in data ? String(data.error):'UNAVAILABLE');
    return data;
  }
  async function load(){
    if(busy)return;setBusy(true);setMessage(null);setViewedAt(Date.now());
    try{const value=await call() as LabReviews;const saved=value.reviews[trial.id];setStored(!!saved);setReview(saved?{criteria:saved.criteria,claims:saved.claims,notes:saved.notes}:emptyReview());setJudgements(value.judgements.filter(x=>x.trial_id===trial.id));loaded.current=true;}
    catch{setMessage('error');}finally{setBusy(false);}
  }
  async function mutate(action:'review'|'remove'|'judge'){
    if(busy || (action==='judge' && (!consent || !modelId)))return;
    setBusy(true);setMessage(null);
    try{
      if(action==='judge'){
        requestId.current ??=crypto.randomUUID();
        const value=await call({action,trialId:trial.id,modelId,requestId:requestId.current,consent:true}) as {judgement:SavedJudgement};
        setJudgements(previous=>[value.judgement,...previous.filter(x=>x.id!==value.judgement.id)]);requestId.current=null;setConsent(false);
      }else{
        await call(action==='review'?{action,trialId:trial.id,review}:{action,trialId:trial.id});
        setStored(action==='review');if(action==='remove')setReview(emptyReview());setMessage(action==='review'?'saved':null);
      }
    }catch(cause){setMessage(cause instanceof Error && cause.message==='SAME_EVALUATOR'?'sameEvaluator':cause instanceof Error && cause.message==='LIMIT_OR_CONFLICT'?'limit':'error');}
    finally{setBusy(false);}
  }
  return <details className="lab-evaluation" open={opened} onToggle={event=>{const value=event.currentTarget.open;setOpened(value);if(value&&!loaded.current)void load();}}>
    <summary>{c.title}</summary>
    {opened && <>
      <h6>{c.checks}</h6><p className="lab-muted">{c.basis}</p>
      <p>{c.checkScore}: <strong>{evaluation.score===null?c.not_measured:`${n(evaluation.score)}%`}</strong> · {c.coverage}: {n(evaluation.coverage.measured)} / {n(evaluation.coverage.configured)}</p>
      <ul className="lab-check-results">{evaluation.criteria.map(check=><li key={check.id}><strong>{c[check.status]}</strong><p>{c[check.reason]}</p>{check.expected!==null && <p>{c.expected}: <bdi>{check.expected}</bdi></p>}{check.evidence && <blockquote dir="auto">{check.evidence.excerpt}{check.evidence.clipped?'…':''}</blockquote>}</li>)}</ul>
      {item.reference && <details><summary>{c.reference}</summary><p>{c[evaluation.reference.reason]}</p><p className="lab-muted">{c.referenceNote}</p></details>}
      {message && <p role="status" className="lab-notice">{c[message]}</p>}
      <button type="button" className="secondary" disabled={busy} onClick={()=>void load()}>{c.refresh}</button>
      <details><summary>{c.manual}</summary><p className="lab-muted">{c.manualNote}</p>
        <fieldset disabled={busy} className="lab-fields-reset">
          {LAB_REVIEW_CRITERIA.map(criterion=>{const current=review.criteria.find(x=>x.criterion===criterion);return <details key={criterion}><summary>{c[criterion]}{current?.rating?` · ${n(current.rating)}/5`:''}</summary>
            <label>{c.rating}<select value={current?.rating??''} onChange={event=>{const rating=event.target.value?Number(event.target.value):null;setReview(previous=>({...previous,criteria:rating?[...previous.criteria.filter(x=>x.criterion!==criterion),{criterion,rating,rationale:current?.rationale??'',evidence:current?.evidence??''}]:previous.criteria.filter(x=>x.criterion!==criterion)}));}}><option value="">{c.not_measured}</option>{[1,2,3,4,5].map(x=><option key={x} value={x}>{n(x)}</option>)}</select></label>
            {current && <><label>{c.rationale}<textarea value={current.rationale} maxLength={2000} rows={3} dir="auto" onChange={event=>setReview(previous=>({...previous,criteria:previous.criteria.map(x=>x.criterion===criterion?{...x,rationale:event.target.value}:x)}))}/></label><label>{c.evidence}<textarea value={current.evidence??''} maxLength={2000} rows={2} dir="auto" onChange={event=>setReview(previous=>({...previous,criteria:previous.criteria.map(x=>x.criterion===criterion?{...x,evidence:event.target.value}:x)}))}/></label></>}
          </details>;})}
          <details><summary>{c.claims}</summary><p className="lab-muted">{c.sourceNote}</p>{review.claims.map((claim,i)=><fieldset className="lab-claim" key={i}><legend>{n(i+1)}</legend>
            {(['claim','rationale','sourceURL','sourceTitle','quote'] as const).map(field=><label key={field}>{field==='rationale'?c.claimReason:c[field]}<textarea rows={field==='sourceURL'?1:2} maxLength={field==='quote'?4000:field==='sourceURL'?2048:field==='sourceTitle'?240:2000} dir="auto" value={claim[field]??''} onChange={event=>setReview(previous=>({...previous,claims:previous.claims.map((x,j)=>i===j?{...x,[field]:event.target.value||undefined}:x)}))}/></label>)}
            <label>{c.claimStatus}<select value={claim.status} onChange={event=>setReview(previous=>({...previous,claims:previous.claims.map((x,j)=>i===j?{...x,status:event.target.value as typeof claim.status}:x)}))}>{(['verified','contradicted','unverified','opinion'] as const).map(status=><option value={status} key={status}>{c[status]}</option>)}</select></label>
            <button type="button" className="secondary" onClick={()=>setReview(previous=>({...previous,claims:previous.claims.filter((_,j)=>i!==j)}))}>{c.deleteClaim}</button>
          </fieldset>)}<button type="button" className="secondary" disabled={review.claims.length>=20} onClick={()=>setReview(previous=>({...previous,claims:[...previous.claims,{claim:'',status:'unverified',rationale:''}]}))}>{c.addClaim}</button></details>
          <label>{c.notes}<textarea rows={3} maxLength={4000} dir="auto" value={review.notes??''} onChange={event=>setReview(previous=>({...previous,notes:event.target.value}))}/></label>
          <div className="lab-actions"><button className="primary" type="button" onClick={()=>void mutate('review')}>{busy?c.saving:c.save}</button>{stored&&<button type="button" className="secondary" onClick={()=>void mutate('remove')}>{c.remove}</button>}</div>
        </fieldset>
      </details>
      <details><summary>{c.judge}</summary><p className="lab-muted">{c.judgeNote}</p>
        {eligible.length?<><label>{c.evaluator}<select disabled={busy} value={modelId} onChange={event=>{setModelId(event.target.value);requestId.current=null;setConsent(false);}}><option value="">{c.choose}</option>{eligible.map(model=><option value={model.id} key={model.id}>{model.name} · {model.label}</option>)}</select></label>
        <label className="lab-consent"><input type="checkbox" disabled={busy} checked={consent} onChange={event=>setConsent(event.target.checked)}/>{c.judgeConsent}</label><button type="button" className="primary" disabled={busy||!consent||!modelId||trial.status!=='done'||!!trial.error} onClick={()=>void mutate('judge')}>{busy?c.assessing:c.evaluate}</button></>:<p>{c.noJudge}</p>}
        {judgements.map(judgement=><section className="lab-judgement" key={judgement.id}><h6>{c.assessment} · {judgement.model_snapshot.name}</h6><p className="lab-muted">{c.recordedAt}: {new Date(judgement.created_at).toLocaleString(locale)}</p>
          {judgement.status==='running'?<p>{viewedAt-Date.parse(judgement.created_at)>180000?c.unknownOutcome:c.assessing}</p>:judgement.status==='failed'?<p>{c.judgeFailed}</p>:judgement.result && <>
            <p className="lab-notice">{c.factNote}</p><ul className="lab-check-results">{judgement.result.criteria.map(criterion=><li key={criterion.criterion}><strong>{c[criterion.criterion]} · {criterion.rating===null?c.not_measured:`${n(criterion.rating)}/5`}</strong><p dir="auto">{criterion.rationale}</p>{criterion.excerpt && <blockquote dir="auto">{criterion.excerpt}</blockquote>}</li>)}</ul>
            <h6>{c.strengths}</h6><ul>{judgement.result.strengths.map((x,i)=><li dir="auto" key={i}>{x}</li>)}</ul><h6>{c.weaknesses}</h6><ul>{judgement.result.weaknesses.map((x,i)=><li dir="auto" key={i}>{x}</li>)}</ul>
            {judgement.result.claims.length>0&&<><h6>{c.claims}</h6><ul>{judgement.result.claims.map((x,i)=><li key={i}><bdi>{x.claim}</bdi> · {x.kind==='opinion'?c.opinion:c.unverified}</li>)}</ul></>}
            {judgement.result.referenceAlignment&&<><h6>{c.referenceAlignment}</h6><p dir="auto">{judgement.result.referenceAlignment}</p></>}
          </>}
        </section>)}
      </details>
    </>}
  </details>;
}
