import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {resolve,join,dirname,sep} from 'node:path';
import {parseEnv} from 'node:util';
import {rootCertificates,createSecureContext} from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {configureIntegrationDatabaseTls,APPROVED_PROFILE_PROJECT,VERIFIED_PROFILE_POOLER} from '../scripts/configure-integration-profile.mjs';
import {databaseTls} from '../lib/postgres-tls.mjs';

const root=resolve('.'),password='tls-fixture-password-not-a-real-credential-24';
const base={HESSARA_TEST_PROJECT_REF:APPROVED_PROFILE_PROJECT,NEXT_PUBLIC_SUPABASE_URL:`https://${APPROVED_PROFILE_PROJECT}.supabase.co`,HESSARA_TEST_ISOLATED:'true',HESSARA_INTEGRATION_TEST:'true',HESSARA_TEST_URL:'http://127.0.0.1:5174',HESSARA_SITE_URL:'http://127.0.0.1:5174',HESSARA_ENCRYPTION_KEY:Buffer.alloc(32,8).toString('base64'),HESSARA_TEST_ATTESTATION_KEY:'tls-fixture-attestation-key-'.repeat(2),DATABASE_URL:`postgresql://hessara_runtime.${APPROVED_PROFILE_PROJECT}:${password}@${VERIFIED_PROFILE_POOLER}:6543/postgres`,POSTGRES_URL:'',DATABASE_SSL_CA:'',HESSARA_TEST_EMAIL_A:'',HESSARA_TEST_PASSWORD_A:'',HESSARA_TEST_EMAIL_B:'',HESSARA_TEST_PASSWORD_B:'',OTHER_SETTING:'unchanged',MULTILINE_SETTING:'one\ntwo'};
const serialize=values=>Object.entries(values).map(([key,value])=>`${key}='${value}'`).join('\n')+'\n';
async function fixture(t,changes={}){const directory=await mkdtemp(resolve('.integration-tls-stage-test-'));assert.ok(directory.startsWith(root+sep));t.after(async()=>{assert.equal(dirname(resolve(directory)),root);await rm(directory,{recursive:true,force:true});});const profilePath=join(directory,'.env.integration.local'),content=serialize({...base,...changes});await writeFile(profilePath,content,{mode:0o600});return{directory,profilePath,content};}
async function unchanged(f){assert.equal(await readFile(f.profilePath,'utf8'),f.content);assert.deepEqual((await readdir(f.directory)).sort(),['.env.integration.local']);}
function nonCA(){
 const oid=Buffer.from('0603551d13','hex'),constraint=Buffer.from('30030101ff','hex');
 for(const certificate of rootCertificates){const bytes=Buffer.from(new X509Certificate(certificate).raw),index=bytes.indexOf(oid);if(index<0)continue;const flag=bytes.indexOf(constraint,index+oid.length);if(flag<0||flag>index+24)continue;bytes[flag+4]=0;const pem='-----BEGIN CERTIFICATE-----\n'+bytes.toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END CERTIFICATE-----\n';if(!new X509Certificate(pem).ca)return pem;}
 throw Error('Could not construct a parsed non-CA public certificate fixture');
}

test('TLS stage stores a valid public CA with strict verification and an exact independent backup',async t=>{
 const f=await fixture(t);const result=await configureIntegrationDatabaseTls({certificate:rootCertificates[0]},{profilePath:f.profilePath,environment:{}});
 assert.equal(result.tlsConfigured,true);assert.equal(result.rejectUnauthorized,true);assert.equal(result.configured,false);assert.equal(result.verified,false);assert.equal(result.networkTested,false);assert.deepEqual(result.changedFields,['DATABASE_SSL_CA']);
 const values=parseEnv(await readFile(f.profilePath,'utf8'));for(const[key,value]of Object.entries(base))if(key!=='DATABASE_SSL_CA')assert.equal(values[key],value,key);
 assert.equal(values.DATABASE_SSL_CA,rootCertificates[0].trim());assert.equal(await readFile(join(f.directory,'.env.integration.tls.backup.local'),'utf8'),f.content);
 const options=databaseTls(values.DATABASE_URL,values.DATABASE_SSL_CA);assert.equal(options.rejectUnauthorized,true);assert.doesNotThrow(()=>createSecureContext(options));
 const output=JSON.stringify(result);for(const secret of [password,base.HESSARA_ENCRYPTION_KEY,base.HESSARA_TEST_ATTESTATION_KEY,rootCertificates[0]])assert.ok(!output.includes(secret));
});

test('invalid, non-CA, private-key, oversized and policy-changing certificate inputs refuse without writes',async t=>{
 const nonAuthority=nonCA();assert.equal(new X509Certificate(nonAuthority).ca,false);
 for(const input of [{certificate:'invalid'},{certificate:nonAuthority},{certificate:'-----BEGIN PRIVATE KEY-----\nprivate-fixture\n-----END PRIVATE KEY-----'},{certificate:rootCertificates[0]+'\nextra-content'},{certificate:'x'.repeat(32769)},{certificate:''},{certificate:42},{certificate:rootCertificates[0],rejectUnauthorized:false},[]]){
  const f=await fixture(t);await assert.rejects(configureIntegrationDatabaseTls(input,{profilePath:f.profilePath,environment:{}}),error=>/^TLS_CERTIFICATE_(?:INPUT_)?INVALID$/.test(error.code));await unchanged(f);
 }
});

test('existing CA or TLS backup cannot be overwritten and rejected profiles stay byte identical',async t=>{
 for(const value of ['existing-public-fixture',' ']){const f=await fixture(t,{DATABASE_SSL_CA:value});await assert.rejects(configureIntegrationDatabaseTls({certificate:rootCertificates[0]},{profilePath:f.profilePath,environment:{}}),/PROFILE_TLS_ALREADY_CONFIGURED/);await unchanged(f);}
 const f=await fixture(t);await writeFile(join(f.directory,'.env.integration.tls.backup.local'),'earlier-private-backup');await assert.rejects(configureIntegrationDatabaseTls({certificate:rootCertificates[0]},{profilePath:f.profilePath,environment:{}}),/PRIVATE_BACKUP_ALREADY_EXISTS/);assert.equal(await readFile(f.profilePath,'utf8'),f.content);assert.equal(await readFile(join(f.directory,'.env.integration.tls.backup.local'),'utf8'),'earlier-private-backup');
});

test('TLS setup requires the approved project, fixed nonlocal runtime URL and local isolated context',async t=>{
 for(const changes of [{DATABASE_URL:''},{DATABASE_URL:'postgresql://postgres:fixture-password@localhost/postgres'},{DATABASE_URL:base.DATABASE_URL+'?sslmode=disable'},{DATABASE_URL:base.DATABASE_URL.replace(VERIFIED_PROFILE_POOLER,'other.pooler.supabase.com')},{HESSARA_TEST_PROJECT_REF:'waaaxdjymuauknbcxskn'},{NEXT_PUBLIC_SUPABASE_URL:'https://waaaxdjymuauknbcxskn.supabase.co'},{HESSARA_TEST_URL:'http://192.168.1.1:5174'},{POSTGRES_URL:'postgresql://production.invalid/postgres'}]){const f=await fixture(t,changes);await assert.rejects(configureIntegrationDatabaseTls({certificate:rootCertificates[0]},{profilePath:f.profilePath,environment:{}}));await unchanged(f);}
 const f=await fixture(t);await assert.rejects(configureIntegrationDatabaseTls({certificate:rootCertificates[0]},{profilePath:f.profilePath,environment:{VERCEL:'1'}}),/LOCAL_CONFIGURATION_ONLY/);await unchanged(f);
});

test('CA bundles are normalized without affecting later account-stage field preservation',async t=>{
 const f=await fixture(t,{HESSARA_TEST_EMAIL_A:'existing-a@example.test',HESSARA_TEST_PASSWORD_A:'existing-account-password-a',HESSARA_TEST_EMAIL_B:'existing-b@example.test',HESSARA_TEST_PASSWORD_B:'existing-account-password-b'});
 const certificate=(rootCertificates[0]+'\n'+rootCertificates[1]).replaceAll('\n','\\n');await configureIntegrationDatabaseTls({certificate},{profilePath:f.profilePath,environment:{}});
 const values=parseEnv(await readFile(f.profilePath,'utf8'));const options=databaseTls(values.DATABASE_URL,values.DATABASE_SSL_CA);assert.equal(options.rejectUnauthorized,true);assert.ok(options.ca.includes('\n'));assert.equal(values.HESSARA_TEST_EMAIL_A,'existing-a@example.test');assert.equal(values.HESSARA_TEST_PASSWORD_B,'existing-account-password-b');
});
