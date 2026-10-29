import postgres from 'postgres';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {databaseTls} from '../lib/postgres-tls.mjs';
import {APPROVED_PROFILE_PROJECT,integrationProfilePath,checkIntegrationDatabase} from './configure-integration-profile.mjs';
import {checkPreparedIntegrationRuntime} from './prepare-integration-runtime.mjs';
import {readPrivateProfile,checkedRuntimeTarget} from './provision-integration-runtime.mjs';
class ProbeError extends Error{constructor(code){super(code);this.code=code;}}
class RollbackProbe extends Error{}
const fail=code=>{throw new ProbeError(code);};
const errorCode=error=>error instanceof ProbeError?error.code:error?.code==='28P01'?'RUNTIME_AUTHENTICATION_FAILED':error?.code==='ENOTFOUND'?'DATABASE_HOST_UNRESOLVED':['EACCES','EPERM'].includes(error?.code)?'NETWORK_ACCESS_DENIED':['SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(error?.code)?'DATABASE_TLS_VERIFICATION_FAILED':['CONNECT_TIMEOUT','ETIMEDOUT','57014','55P03'].includes(error?.code)?'DATABASE_OPERATION_TIMED_OUT':'RUNTIME_DATABASE_VERIFICATION_FAILED';
const expectedRole='hessara_runtime';
/** Explicit --run verifies selected real owner policies using writes that always roll back. */
export async function verifyIntegrationDatabase({profilePath=resolve('.env.integration.local'),environment=process.env,connect=postgres,readProfile=readPrivateProfile}={}){
 const result={projectRef:APPROVED_PROFILE_PROJECT,status:'blocked',verified:false,networkAttempted:false,role:null,sessionRole:null,database:null,schemaRead:false,selectedOwnerPolicies:[],rollbackVerified:false,persistedFixtureRows:null,authVerified:false,connectionClosed:false};
 let sql,timer,timedOut=false;
 try{
  const checked=await checkPreparedIntegrationRuntime({profilePath,environment});if(!checked.prepared)fail('PRIVATE_RUNTIME_NOT_PREPARED');
  profilePath=await integrationProfilePath(profilePath);const profile=await readProfile(profilePath);
  // Revalidate the exact snapshot used for the connection after the staged-plan preflight.
  let target;try{target=checkedRuntimeTarget(profile);}catch{fail('RUNTIME_PROFILE_TARGET_INVALID');}
  const url=target.url.toString();let ssl;try{ssl=databaseTls(url,profile.DATABASE_SSL_CA||'');}catch{fail('DATABASE_TLS_CONFIGURATION_INVALID');}
  result.networkAttempted=true;
  sql=connect(url,{max:1,max_pipeline:1,prepare:false,ssl,connect_timeout:10,idle_timeout:5,max_lifetime:30,debug:false,onnotice:()=>{},connection:{application_name:'hessara-isolated-rollback-check',statement_timeout:'10000',lock_timeout:'5000',idle_in_transaction_session_timeout:'15000'}});
  timer=setTimeout(()=>{timedOut=true;void sql.end({timeout:0}).catch(()=>{});},45000);
  const identities=await sql.unsafe('SELECT current_user AS role,session_user AS session_role,current_database() AS database');
  if(identities.length!==1||identities[0].role!==expectedRole||identities[0].session_role!==expectedRole||identities[0].database!=='postgres')fail('RUNTIME_IDENTITY_INVALID');
  Object.assign(result,{role:expectedRole,sessionRole:expectedRole,database:'postgres'});
  const roles=await sql.unsafe('SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  if(roles.length!==1||roles[0].rolcanlogin!==true||['rolinherit','rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'].some(key=>roles[0][key]!==false))fail('RUNTIME_ROLE_PRIVILEGED');
  await sql.unsafe('SELECT id FROM public.runs LIMIT 0');result.schemaRead=true;
  const ownerA=randomUUID(),ownerB=randomUUID(),projectId=randomUUID(),forbiddenId=randomUUID(),now=Date.now();
  const setOwner=(tx,owner)=>tx.unsafe("SELECT set_config('hessara.owner',$1,true)",[owner]);
  const counts=async tx=>(await tx.unsafe('SELECT count(*)::int AS projects FROM re_projects WHERE id=$1',[projectId]))[0];
  let sawRollback=false;
  try{
   await sql.begin(async tx=>{
    await setOwner(tx,ownerA);
    await tx.unsafe('INSERT INTO re_projects(id,owner,name,description,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)',[projectId,ownerA,'Isolated rollback probe','No persisted application fixture',now]);
    const own=await counts(tx);if(own.projects!==1)fail('OWNER_POLICY_WRITE_FAILED');
    await setOwner(tx,ownerB);const hidden=await counts(tx);if(hidden.projects!==0)fail('OWNER_POLICY_READ_FAILED');
    const changed=await tx.unsafe('UPDATE re_projects SET description=$1 WHERE id=$2 RETURNING id',['Forbidden owned probe',projectId]);if(changed.length)fail('OWNER_POLICY_UPDATE_FAILED');
    let denied=false;
    try{await tx.savepoint(async sp=>{await sp.unsafe('INSERT INTO re_projects(id,owner,name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',[forbiddenId,ownerA,'Forbidden rollback probe',now]);});}
    catch(error){if(error?.code!=='42501')throw error;denied=true;}
    if(!denied)fail('OWNER_POLICY_INSERT_FAILED');
    await setOwner(tx,ownerA);const retained=await counts(tx);if(retained.projects!==1)fail('OWNER_POLICY_RESTORE_FAILED');
    throw new RollbackProbe();
   });
  }catch(error){if(!(error instanceof RollbackProbe))throw error;sawRollback=true;}
  if(!sawRollback)fail('ROLLBACK_NOT_OBSERVED');
  await sql.begin(async tx=>{await setOwner(tx,ownerA);const remaining=await counts(tx);if(remaining.projects!==0)fail('ROLLBACK_VERIFICATION_FAILED');});
  if(timedOut)fail('DATABASE_OPERATION_TIMED_OUT');
  Object.assign(result,{status:'verified',verified:true,selectedOwnerPolicies:['re_projects'],rollbackVerified:true,persistedFixtureRows:0});
 }catch(error){result.status=result.networkAttempted?'failed':'blocked';result.error=timedOut?'DATABASE_OPERATION_TIMED_OUT':errorCode(error);const code=error?.code??error?.cause?.code;result.diagnosticCode=typeof code==='string'&&/^[A-Z0-9_]{2,64}$/.test(code)?code:null;}
 finally{clearTimeout(timer);try{await sql?.end({timeout:5});result.connectionClosed=!!sql;}catch{result.connectionClosed=false;}}
 return result;
}
export async function runDatabaseVerificationCli({args=process.argv.slice(2),...options}={}){
 if(args.length>1||(args.length&&!['--check','--run'].includes(args[0])))return{result:{status:'blocked',verified:false,error:'VERIFICATION_ARGUMENT_INVALID',networkAttempted:false},exitCode:2};
 if(args[0]==='--run'){const result=await verifyIntegrationDatabase(options);return{result,exitCode:result.verified?0:2};}
 try{const checked=await checkIntegrationDatabase(options);return{result:{...checked,verified:false,networkAttempted:false},exitCode:checked.databaseConfigured&&!checked.issues.length?0:2};}
 catch{return{result:{status:'blocked',verified:false,networkAttempted:false,error:'PRIVATE_PROFILE_INVALID'},exitCode:2};}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const{result,exitCode}=await runDatabaseVerificationCli();process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=exitCode;
}
