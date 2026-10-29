'use client';
import {useState} from 'react';
import type {Locale} from '@/lib/i18n';
import type {LabReport,LabReportShare} from '@/lib/lab-reports';
import {labCopy} from '@/lib/lab-copy';
import {advisorCopy} from '@/lib/advisor-copy';
import {labExtras} from '@/lib/lab-extras-copy';
import {LabReportView} from './lab-report-view';
type Preview={report:LabReport;previewHash:string;shares:LabReportShare[]};

export function LabReportPanel({locale,runId}:{locale:Locale;runId:string}){
 const c=labCopy(locale),a=advisorCopy(locale),x=labExtras(locale);
 const [preview,setPreview]=useState<Preview|null>(null),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false),[link,setLink]=useState('');
 async function request<T=Preview>(body?:unknown):Promise<T>{
  const response=await fetch(`/api/lab/${encodeURIComponent(runId)}/reports`,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error();return await response.json() as T;
 }
 async function load(){setBusy(true);setError(false);setConsent(false);try{setPreview(await request());}catch{setError(true);}finally{setBusy(false);}}
 async function publish(){if(!preview||!consent||busy)return;setBusy(true);setError(false);try{const result=await request<{path:string;share:LabReportShare}>({action:'publish',previewHash:preview.previewHash,consent:true});setLink(new URL(result.path,location.origin).href);setPreview({...preview,shares:[result.share,...preview.shares]});setConsent(false);}catch{setError(true);setConsent(false);}finally{setBusy(false);}}
 async function revoke(id:string){setBusy(true);setError(false);try{await request({action:'revoke',shareId:id});setLink('');setPreview(await request());}catch{setError(true);}finally{setBusy(false);}}
 function download(){if(!preview)return;const url=URL.createObjectURL(new Blob([JSON.stringify(preview.report,null,2)],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='hessara-report.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <details className="lab-report-panel"><summary>{x.report}</summary><p>{x.snapshot}</p><button type="button" className="secondary" disabled={busy} onClick={()=>void load()}>{busy?c.loading:x.preview}</button>{error&&<p className="lab-alert" role="alert">{c.requestFailed}</p>}
 {preview&&<><LabReportView report={preview.report} locale={locale}/><div className="lab-actions"><button type="button" className="secondary" onClick={download}>{a.download}</button></div>
 <label className="lab-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/>{x.shareConsent}</label><button type="button" className="primary" disabled={busy||!consent||preview.report.experiment.status==='running'||!preview.report.trials.length||preview.report.trials.some(t=>t.status==='running')} onClick={()=>void publish()}>{x.share}</button>
 {link&&<div className="lab-notice" role="status"><a href={link} target="_blank" rel="noopener noreferrer">{link}</a><p>{x.savedLink}</p></div>}
 {!!preview.shares.length&&<><h3>{x.links}</h3><ul className="lab-share-list">{preview.shares.map(share=><li key={share.id}><span>{c.createdAt}: {new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(share.createdAt))}<br/>{x.expires}: {new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(new Date(share.expiresAt))}</span>{!share.revokedAt&&<button type="button" className="secondary" disabled={busy} onClick={()=>void revoke(share.id)}>{x.revoke}</button>}</li>)}</ul></>}
 </>}
 </details>;
}
