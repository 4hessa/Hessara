"use client";

import { useId } from 'react';
import { ArrowUpRight, ChevronDown, KeyRound, RefreshCw } from 'lucide-react';
import { isRTL, type Locale } from '@/lib/i18n';
import { modelConnectionCopy } from '@/lib/model-connection-copy';
import './model-connection-status.css';

export type ConnectionProvider = 'openai'|'anthropic'|'gemini'|'nvidia'|'openrouter';
/** Console destinations checked against their providers' official documentation. */
const providers:{id:ConnectionProvider;name:string;url:string}[] = [
  {id:'openai',name:'OpenAI',url:'https://platform.openai.com/api-keys'},
  {id:'anthropic',name:'Claude · Anthropic',url:'https://platform.claude.com/settings/keys'},
  {id:'gemini',name:'Gemini · Google',url:'https://aistudio.google.com/apikey'},
  {id:'nvidia',name:'NVIDIA',url:'https://build.nvidia.com/settings/api-keys'},
  {id:'openrouter',name:'OpenRouter',url:'https://openrouter.ai/settings/keys'},
];
export function ModelConnectionStatus({locale,connectedCount,platformCount=0,loading=false,refreshing=false,onConnect,onRefresh}:{
  locale:Locale;connectedCount:number;platformCount?:number;loading?:boolean;refreshing?:boolean;
  onConnect:(provider:ConnectionProvider)=>void;onRefresh:()=>void;
}) {
  const c=modelConnectionCopy(locale), heading=useId();
  const count=Number.isSafeInteger(connectedCount)&&connectedCount>0?connectedCount:0;
  const included=Number.isSafeInteger(platformCount)&&platformCount>0?platformCount:0;
  return <section className="model-connection-status" lang={locale} dir={isRTL(locale)?'rtl':'ltr'} aria-labelledby={heading} aria-busy={loading||refreshing}>
    <header><div><h3 id={heading}>{loading?c.loading:count?c.ready:included?c.platformReady:c.empty}</h3>{!loading&&count>0&&<p className="model-connection-count"><strong>{new Intl.NumberFormat(locale).format(count)}</strong> {c.saved}</p>}{!loading&&included>0&&<><p className="model-connection-count"><strong>{new Intl.NumberFormat(locale).format(included)}</strong> {c.platform}</p><p className="model-connection-subscription">{c.platformAllowance}</p></>}</div><button className="model-connection-refresh" type="button" onClick={onRefresh} disabled={loading||refreshing}><RefreshCw size={16} aria-hidden="true" />{refreshing?c.refreshing:c.refresh}</button></header>
    {!loading&&<>
      {!count&&!included&&<><p className="model-connection-definition">{c.definition}</p><p className="model-connection-subscription">{c.subscription}</p><button className="model-connection-start" type="button" onClick={()=>onConnect('nvidia')}><KeyRound size={17} aria-hidden="true" />{c.start}<ArrowUpRight size={16} aria-hidden="true" /></button><div className="model-connection-steps"><h4>{c.steps}</h4><ol><li>{c.stepOne}</li><li>{c.stepTwo}</li><li>{c.stepThree}</li></ol></div></>}
      <details className="model-connection-providers"><summary>{c.other}<ChevronDown size={16} aria-hidden="true" /></summary><div role="group" aria-label={c.providerHeading}>{providers.map(provider=><div className="model-connection-provider" key={provider.id}><strong lang="en" dir="ltr">{provider.name}</strong><button type="button" onClick={()=>onConnect(provider.id)} aria-label={`${c.setup}: ${provider.name}`}>{c.setup}</button><a href={provider.url} target="_blank" rel="noopener noreferrer" aria-label={`${c.keys}: ${provider.name}`}>{c.keys}<ArrowUpRight size={14} aria-hidden="true" /></a></div>)}</div></details>
      {count>0&&<p className="model-connection-saved-note">{c.unverified}</p>}
    </>}
  </section>;
}
