import {lstat,open} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {APPROVED_PROFILE_PROJECT,checkIntegrationDatabase,configureIntegrationDatabase,integrationProfilePath} from './configure-integration-profile.mjs';
import {runtimeScramVerifier} from './provision-integration-runtime.mjs';

export const RUNTIME_PLAN_FILE='.env.integration.runtime.local';
const DATABASE_BACKUP='.env.integration.database.backup.local';
const verifierPattern=/^SCRAM-SHA-256\$4096:([A-Za-z0-9+/]{22}==)\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/;
const knownErrors=new Set(['LOCAL_CONFIGURATION_ONLY','PRIVATE_PROFILE_PATH_INVALID','PRIVATE_PROFILE_UNAVAILABLE','PRIVATE_PROFILE_UNSAFE','PRIVATE_PROFILE_INVALID','PRIVATE_PROFILE_CHANGED','PRIVATE_PROFILE_WRITE_FAILED','PRIVATE_BACKUP_ALREADY_EXISTS','PRIVATE_BACKUP_FAILED','PROFILE_BASE_INVALID','PROFILE_DATABASE_ALREADY_CONFIGURED','PROFILE_SERIALIZATION_UNSUPPORTED','PROFILE_DATABASE_INVALID','CONFIGURATION_INPUT_INVALID','DATABASE_PASSWORD_INVALID','DATABASE_PASSWORD_ASCII_REQUIRED','RUNTIME_PASSWORD_ASCII_REQUIRED','PRIVATE_RUNTIME_PLAN_UNSAFE','PRIVATE_RUNTIME_PLAN_INVALID','PRIVATE_RUNTIME_PLAN_CHANGED','PRIVATE_RUNTIME_PLAN_ALREADY_EXISTS','PRIVATE_RUNTIME_PLAN_ORPHANED','PRIVATE_RUNTIME_PLAN_MISMATCH','PRIVATE_RUNTIME_PLAN_WRITE_FAILED','PREPARATION_ARGUMENT_INVALID']);
class PreparationError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new PreparationError(code);};
const safeError=error=>knownErrors.has(error?.code)?error.code:'RUNTIME_PREPARATION_FAILED';
function localOnly(environment){if(environment.VERCEL)fail('LOCAL_CONFIGURATION_ONLY');}
async function presentFile(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function readPrivate(path,max,kind){
 let before,handle,bytes;
 try{
  before=await lstat(path);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>max)fail('PRIVATE_'+kind+'_UNSAFE');
  handle=await open(path,'r');const opened=await handle.stat();
  if(!opened.isFile()||opened.nlink!==1||opened.dev!==before.dev||opened.ino!==before.ino||opened.size>max)fail('PRIVATE_'+kind+'_CHANGED');
  bytes=Buffer.alloc(max+1);let size=0;
  while(size<bytes.length){const chunk=await handle.read(bytes,size,bytes.length-size,size);if(!chunk.bytesRead)break;size+=chunk.bytesRead;}
  const after=await lstat(path);
  if(size!==opened.size||size>max||after.isSymbolicLink()||after.nlink!==1||after.dev!==opened.dev||after.ino!==opened.ino||after.size!==opened.size||after.mtimeMs!==before.mtimeMs)fail('PRIVATE_'+kind+'_CHANGED');
  try{
   const text=new TextDecoder('utf8',{fatal:true}).decode(bytes.subarray(0,size)),values=parseEnv(text);
   if(kind==='RUNTIME_PLAN'&&text!==serializePlan(readPlan(values)))fail('PRIVATE_RUNTIME_PLAN_INVALID');
   return values;
  }catch{fail('PRIVATE_'+kind+'_INVALID');}
 }finally{bytes?.fill(0);await handle?.close().catch(()=>{});}
}
function serializePlan(verifier){return "HESSARA_TEST_PROJECT_REF='"+APPROVED_PROFILE_PROJECT+"'\nHESSARA_RUNTIME_SCRAM_VERIFIER='"+verifier+"'\n";}
function readPlan(values){
 if(Object.keys(values).sort().join(',')!=='HESSARA_RUNTIME_SCRAM_VERIFIER,HESSARA_TEST_PROJECT_REF'||values.HESSARA_TEST_PROJECT_REF!==APPROVED_PROFILE_PROJECT||!verifierPattern.test(values.HESSARA_RUNTIME_SCRAM_VERIFIER??''))fail('PRIVATE_RUNTIME_PLAN_INVALID');
 return values.HESSARA_RUNTIME_SCRAM_VERIFIER;
}
const state=()=>({status:'needs_preparation',prepared:false,configured:false,verified:false,networkTested:false,projectRef:APPROVED_PROFILE_PROJECT,databaseConfigured:false,runtimePlanPresent:false,recoveryRequired:false});

/** Read-only local plan consistency, not a database login or Auth readiness check. */
export async function checkPreparedIntegrationRuntime({profilePath=resolve('.env.integration.local'),environment=process.env}={}){
 const result=state();
 try{
  localOnly(environment);profilePath=await integrationProfilePath(profilePath);
  const database=await checkIntegrationDatabase({profilePath,environment});
  result.databaseConfigured=database.databaseConfigured;result.missingAuthFields=database.missingAuthFields;
  if(database.issues.length){result.status='blocked';result.issues=database.issues;return result;}
  const planPath=join(dirname(profilePath),RUNTIME_PLAN_FILE),metadata=await presentFile(planPath);
  result.runtimePlanPresent=!!metadata;
  if(!metadata){result.status=database.databaseConfigured?'needs_runtime_plan':'needs_preparation';return result;}
  const verifier=readPlan(await readPrivate(planPath,4096,'RUNTIME_PLAN'));
  if(!database.databaseConfigured)fail('PRIVATE_RUNTIME_PLAN_ORPHANED');
  const profile=await readPrivate(profilePath,65536,'PROFILE');
  const password=decodeURIComponent(new URL(profile.DATABASE_URL).password);
  const salt=Buffer.from(verifierPattern.exec(verifier)[1],'base64');
  const expected=runtimeScramVerifier(password,salt),left=Buffer.from(expected),right=Buffer.from(verifier);
  try{if(left.length!==right.length||!timingSafeEqual(left,right))fail('PRIVATE_RUNTIME_PLAN_MISMATCH');}
  finally{salt.fill(0);left.fill(0);right.fill(0);}
  result.status='prepared';result.prepared=true;result.requiresRuntimeVerification=true;result.remoteRoleState='not_checked';
 }catch(error){result.status='blocked';result.error=safeError(error);result.recoveryRequired=result.runtimePlanPresent;}
 if(result.recoveryRequired)result.recovery='Do not apply an inconsistent plan; review the private profile and database-stage backup before retrying.';
 return result;
}

/** Explicit private staging only: no remote SQL, Auth account creation or connection. */
export async function prepareIntegrationRuntime({profilePath=resolve('.env.integration.local'),environment=process.env,configureDatabase=configureIntegrationDatabase}={}){
 const result={...state(),runtimePlan:'not_created',databaseProfile:'unchanged'};let password;
 try{
  localOnly(environment);profilePath=await integrationProfilePath(profilePath);
  const database=await checkIntegrationDatabase({profilePath,environment});
  result.missingAuthFields=database.missingAuthFields;result.databaseConfigured=database.databaseConfigured;
  if(database.issues.length)fail('PROFILE_BASE_INVALID');
  const planPath=join(dirname(profilePath),RUNTIME_PLAN_FILE);
  if(await presentFile(planPath)){result.runtimePlanPresent=true;fail('PRIVATE_RUNTIME_PLAN_ALREADY_EXISTS');}
  if(database.databaseConfigured)fail('PROFILE_DATABASE_ALREADY_CONFIGURED');
  if(await presentFile(join(dirname(profilePath),DATABASE_BACKUP)))fail('PRIVATE_BACKUP_ALREADY_EXISTS');
  const entropy=randomBytes(48);try{password=entropy.toString('base64url');}finally{entropy.fill(0);}
  const verifier=runtimeScramVerifier(password);
  const plan=serializePlan(verifier);
  let handle;
  try{
   handle=await open(planPath,'wx',0o600);result.runtimePlan='unknown';result.runtimePlanPresent=true;
   const metadata=await handle.stat();if(!metadata.isFile()||metadata.nlink!==1)fail('PRIVATE_RUNTIME_PLAN_UNSAFE');
   await handle.writeFile(plan,'utf8');await handle.sync();result.runtimePlan='created';
  }catch(error){if(error.code==='EEXIST')fail('PRIVATE_RUNTIME_PLAN_ALREADY_EXISTS');if(error instanceof PreparationError)throw error;fail('PRIVATE_RUNTIME_PLAN_WRITE_FAILED');}
  finally{await handle?.close().catch(()=>{});}
  result.databaseProfile='unknown';result.databaseConfigured=null;
  await configureDatabase({databasePassword:password},{profilePath,environment});
  const checked=await checkPreparedIntegrationRuntime({profilePath,environment});
  result.databaseConfigured=checked.databaseConfigured;
  if(!checked.prepared){result.error=checked.error??'RUNTIME_PREPARATION_FAILED';result.status='incomplete';result.recoveryRequired=true;result.recovery='Do not apply an inconsistent plan; review the private profile and database-stage backup before retrying.';return result;}
  result.databaseProfile='updated';result.status='prepared';result.prepared=true;result.requiresRuntimeVerification=true;result.remoteRoleState='not_checked';
 }catch(error){result.status=result.runtimePlan!=='not_created'?'incomplete':'blocked';result.error=safeError(error);result.recoveryRequired=result.runtimePlanPresent;}
 finally{password=undefined;}
 if(result.recoveryRequired)result.recovery='Do not apply an inconsistent plan; review the private profile and database-stage backup before retrying.';
 return result;
}
export async function runPrepareRuntimeCli({args=process.argv.slice(2),profilePath=resolve('.env.integration.local'),environment=process.env}={}){
 if(args.length>1||(args.length&&!['--check','--prepare'].includes(args[0])))return{result:{...state(),status:'blocked',error:'PREPARATION_ARGUMENT_INVALID'},exitCode:2};
 const result=args[0]==='--prepare'?await prepareIntegrationRuntime({profilePath,environment}):await checkPreparedIntegrationRuntime({profilePath,environment});
 return{result,exitCode:result.prepared?0:2};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {result,exitCode}=await runPrepareRuntimeCli();process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=exitCode;
}
