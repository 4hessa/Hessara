import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { join } from 'node:path';
const origin='http://127.0.0.1:5173';
const forged={'x-hessara-test-nonce':'1'.repeat(64),'x-hessara-test-auth':'0'.repeat(64)};
const report={format:'hessara-integration-health/1',date:new Date().toISOString(),scope:'Unconfigured local production build, integration mode disabled, database/Auth connections explicitly empty; no accounts or provider calls.',checks:[],clientSecretScan:null,passed:false};
try {
 for(const [name,path,headers,status] of [['ordinary-health','/api/health',{},503],['forged-challenge-health','/api/health',forged,503],['retired-assistant-api','/api/toopee/threads',forged,410]]) {
  const response=await fetch(origin+path,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
  const body=await response.json();assert.equal(response.status,status);assert.ok(response.headers.get('cache-control')?.includes('no-store'));
  if(path==='/api/health')assert.deepEqual(body,{status:'setup_required'});else assert.equal(body.error,'FEATURE_REMOVED');
  report.checks.push({name,status:response.status,noStore:true,noIntegrationMetadata:!('integration' in body),passed:true});
 }
 const secrets=[];
 for(const filename of ['.env','.env.local','.env.integration.local']) {
  if(!fs.existsSync(filename))continue;
  const values=parseEnv(fs.readFileSync(filename,'utf8'));
  for(const [key,value] of Object.entries(values))if(/^(HESSARA_ENCRYPTION_KEY|HESSARA_TEST_ATTESTATION_KEY|SUPABASE_AUTH_SECRET_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|PAPERCLIP_API_KEY)$/.test(key)&&value.length>=16)secrets.push({key,value});
 }
 let files=0;const matches=[];
 function scan(folder){if(!fs.existsSync(folder))return;for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const path=join(folder,entry.name);if(entry.isDirectory())scan(path);else if(/\.(js|mjs|css|json|html|map|txt)$/.test(path)){files++;const content=fs.readFileSync(path,'utf8');for(const secret of secrets)if(content.includes(secret.value))matches.push({path,key:secret.key});}}}
 scan('.next/static');scan('public');
 report.clientSecretScan={filesChecked:files,serverSecretValuesChecked:secrets.length,matches,passed:matches.length===0};assert.equal(matches.length,0);report.passed=true;
} finally { fs.writeFileSync('docs/isolated-integration-health-2026-10-26.json',JSON.stringify(report,null,2)+'\n'); }
console.log(JSON.stringify({passed:report.passed,routeChecks:report.checks.length,clientSecretScan:report.clientSecretScan},null,2));
