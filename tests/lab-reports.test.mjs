import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createDatabase} from '../lib/postgres-database.ts';
import {createLabReportService,buildLabReport,labReportActionSchema,LAB_REPORT_LIMITS} from '../lib/lab-reports.ts';
import {removeLabExperiment} from '../lib/lab-history.ts';

function fixture(owner='alice',id='a') {
  const model={id:'m',name:'Model',provider:'openai',model:'versioned-id',inputPrice:null,outputPrice:null,apiKey:'SECRET_KEY'};
  const settings={max_output_tokens:512,timeout_ms:55000,sampling:'provider defaults',reasoning_effort:'provider default',retries:0};
  return {run:{id,owner,name:'Private research',status:'completed',mode:'custom',created_at:'2026-10-11T00:00:00.000Z',total:2,
    configData:{version:'hessara-custom/1',taskType:'research',locale:'en',maxOutputTokens:512,created_at:'2026-10-11T00:00:00.000Z',pricing_recorded_at:'2026-10-11T00:00:00.000Z',modelSnapshots:[model],providerPolicies:{m:settings},cases:[{id:'c',title:'Case',prompt:'Explain',checks:[{kind:'contains',value:'Evidence'}]}]}},
    trials:[{id:'t'+id,run_id:id,task_id:'c',model:'m',status:'done',output:'Evidence <script>alert(1)</script>',error:null,cost:null,latency:20,input_tokens:1,output_tokens:4,metadata:'SECRET_METADATA',metadataData:{started_at:'2026-10-11T00:00:01Z',finished_at:'2026-10-11T00:00:02Z',requested_model:'versioned-id',resolved_model:null,settings,apiKey:'SECRET_KEY',url:'https://secret.example'}}]};
}
const emptyReviews={reviews:{},judgements:[]};
test('report uses explicit data allowlists, keeps unknowns and provenance, and rejects oversized exports',()=>{
  const report=buildLabReport(fixture(),emptyReviews),text=JSON.stringify(report);
  assert.ok(!text.includes('SECRET'));assert.ok(!text.includes('alice'));assert.ok(!text.includes('secret.example'));
  assert.equal(report.trials[0].measurements.estimatedUSD,null);assert.equal(report.trials[0].resolvedModel,null);
  assert.equal(report.trials[0].evaluation.score,100);assert.equal(report.trials[0].evaluation.scoreBasis,'passed_configured_checks_only');
  assert.equal(report.methodology.automatedFactVerification,false);
  assert.match(report.trials[0].output,/<script>/,'keep exact output as data; consumer must use text rendering');
  const tooLarge=fixture();tooLarge.trials[0].output='a'.repeat(LAB_REPORT_LIMITS.bytes+1);
  assert.throws(()=>buildLabReport(tooLarge,emptyReviews),/REPORT_TOO_LARGE/);
  assert.equal(labReportActionSchema.safeParse({action:'publish',previewHash:'a'.repeat(64),consent:false}).success,false);
  assert.equal(labReportActionSchema.safeParse({action:'publish',previewHash:'a'.repeat(64),consent:true,snapshot:{}}).success,false);
});

test('capability reports require a reviewed snapshot, enforce RLS, remain immutable and revoke/expire safely',async()=>{
  const pg=new PGlite();
  try{
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    for(const path of ['supabase/migrations/202609290001_hessara.sql','supabase/runtime-role.sql','supabase/migrations/20261009104943_lab_evaluations.sql','supabase/migrations/20261009161418_lab_reports.sql']) await pg.exec(await readFile(new URL('../'+path,import.meta.url),'utf8'));
    await pg.exec("INSERT INTO runs(id,owner,name,mode,status,created_at,config,total) VALUES('a','alice','test','custom','completed','2026-10-11','{}',1),('b','bob','test','custom','completed','2026-10-11','{}',1); SET ROLE hessara_runtime;");
    const execute=client=>async(sql,values)=>{const result=await client.query(sql,values);return{rows:result.rows,count:result.affectedRows??result.rows.length};};
    const db=createDatabase(execute(pg),work=>pg.transaction(tx=>work(execute(tx))));
    let data=fixture();
    const getRun=async(owner,id)=>{const found=await db.prepare('SELECT id FROM runs WHERE owner=? AND id=?').bind(owner,id).first();if(!found)throw Error('NOT_FOUND');return owner==='alice'?data:fixture('bob','b');};
    const service=createLabReportService({db,getRun,getReviews:async()=>emptyReviews});
    const preview=await service.read('alice','a');
    await assert.rejects(service.read('bob','a'),/NOT_FOUND/);
    await assert.rejects(service.publish('alice','a',preview.previewHash,false));
    data.trials[0].output='Changed after preview';
    await assert.rejects(service.publish('alice','a',preview.previewHash,true),/REPORT_CHANGED/);
    const fresh=await service.read('alice','a');
    const shared=await service.publish('alice','a',fresh.previewHash,true);
    assert.match(shared.token,/^[A-Za-z0-9_-]{43}$/);assert.match(shared.share.createdAt,/T/);
    assert.equal(Date.parse(shared.share.expiresAt)-Date.parse(shared.share.createdAt),30*86400000);
    assert.equal((await service.shared(shared.token)).report.trials[0].output,'Changed after preview');
    data.trials[0].output='Changed after publishing';
    assert.equal((await service.shared(shared.token)).report.trials[0].output,'Changed after preview');
    assert.equal((await service.read('alice','a')).shares.length,1);
    const stored=(await db.scopedBatch('alice',[db.prepare('SELECT * FROM lab_reports')]))[0].results[0];
    assert.equal(stored.token_hash,createHash('sha256').update(shared.token).digest('hex'));
    assert.ok(!JSON.stringify(stored).includes(shared.token));
    assert.equal((await db.prepare('SELECT * FROM lab_reports').all()).results.length,0,'pooled context must not leak');
    assert.equal((await db.scopedBatch('bob',[db.prepare('SELECT * FROM lab_reports')]))[0].results.length,0);
    await assert.rejects(service.shared('A'.repeat(43)),/NOT_FOUND/);
    await assert.rejects(service.shared('malformed'),/NOT_FOUND/);
    await assert.rejects(service.revoke('bob','b',shared.share.id),/NOT_FOUND/);
    const hash=createHash('sha256').update(shared.token).digest('hex');
    const publicUpdate=await db.scopedBatch('',[db.prepare('UPDATE lab_reports SET revoked_at=now() RETURNING id')],hash);
    assert.equal(publicUpdate[0].results.length,0,'capability readers cannot mutate');
    await assert.rejects(db.scopedBatch('alice',[db.prepare("UPDATE lab_reports SET snapshot='{}'::jsonb")]),error=>error.code==='42501');
    await assert.rejects(db.scopedBatch('alice',[db.prepare("INSERT INTO lab_reports(id,run_id,owner,token_hash,preview_hash,snapshot,created_at,expires_at) VALUES(?::uuid,'b','alice',?,?,'{}',now(),now()+interval '1 day')").bind(randomUUID(),'c'.repeat(64),'d'.repeat(64))]),error=>error.code==='42501');
    await service.revoke('alice','a',shared.share.id);await service.revoke('alice','a',shared.share.id);
    await assert.rejects(service.shared(shared.token),/NOT_FOUND/);
    const current=await service.read('alice','a');
    const expiredService=createLabReportService({db,getRun,getReviews:async()=>emptyReviews,now:()=>new Date(Date.now()-31*86400000)});
    const expired=await expiredService.publish('alice','a',current.previewHash,true);
    await assert.rejects(service.shared(expired.token),/NOT_FOUND/);
    for(let index=0;index<20;index++)await service.publish('alice','a',current.previewHash,true);
    await assert.rejects(service.publish('alice','a',current.previewHash,true),/SHARE_LIMIT/);
    assert.equal((await service.read('alice','a')).shares.length,20,'expired snapshots are pruned before enforcing active owner quota');
    await pg.query("INSERT INTO trials(id,run_id,model,task_id,repeat,status,output) VALUES('ta','a','m','c',0,'done','answer'),('tb','b','m','c',0,'done','Bob answer')");
    await pg.query("INSERT INTO integration_exports(id,owner,run_id,destination,status,created_at) VALUES('export-a','alice','a','test','done','2026-10-12'),('export-b','bob','b','test','done','2026-10-12')");
    await db.scopedBatch('alice',[
      db.prepare("INSERT INTO lab_reviews(trial_id,run_id,owner,review) VALUES('ta','a','alice','{}')"),
      db.prepare("INSERT INTO lab_judgements(id,trial_id,run_id,owner,status,model_snapshot) VALUES(?::uuid,'ta','a','alice','completed','{}')").bind(randomUUID()),
    ]);
    await assert.rejects(removeLabExperiment(db,'bob','a'),/NOT_FOUND/);
    await pg.query("UPDATE runs SET status='running' WHERE id='a'");
    await assert.rejects(removeLabExperiment(db,'alice','a'),/BUSY/);
    await pg.query("UPDATE runs SET status='completed',locked_until=$1 WHERE id='a'",[Date.now()+120000]);
    await assert.rejects(removeLabExperiment(db,'alice','a'),/BUSY/);
    await pg.query("UPDATE runs SET locked_until=0 WHERE id='a'");
    await db.scopedBatch('alice',[db.prepare("UPDATE lab_judgements SET status='running',created_at=now() WHERE run_id='a'")]);
    await assert.rejects(removeLabExperiment(db,'alice','a'),/BUSY/);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM trials WHERE run_id='a'").first()).n,1,'blocked deletion preserves trials');
    assert.equal((await service.read('alice','a')).shares.length,20,'blocked deletion preserves reports');
    await db.scopedBatch('alice',[db.prepare("UPDATE lab_judgements SET status='completed' WHERE run_id='a'")]);
    await removeLabExperiment(db,'alice','a');
    assert.equal((await db.scopedBatch('alice',[db.prepare('SELECT * FROM lab_reports')]))[0].results.length,0,'history deletion cascades shared reports');
    assert.equal((await db.scopedBatch('alice',[db.prepare('SELECT * FROM lab_reviews')]))[0].results.length,0,'history deletion cascades reviews');
    assert.equal((await db.scopedBatch('alice',[db.prepare('SELECT * FROM lab_judgements')]))[0].results.length,0,'history deletion cascades model assessments');
    assert.equal((await db.prepare("SELECT count(*) AS n FROM trials WHERE run_id='a'").first()).n,0);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM integration_exports WHERE run_id='a'").first()).n,0);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM runs WHERE owner='bob'").first()).n,1);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM trials WHERE run_id='b'").first()).n,1);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM integration_exports WHERE run_id='b'").first()).n,1);
    await assert.rejects(service.shared(shared.token),/NOT_FOUND/);
    await pg.exec('RESET ROLE; SET ROLE anon;');
    await assert.rejects(pg.query('SELECT snapshot FROM lab_reports'),error=>error.code==='42501');
    await pg.exec('RESET ROLE; SET ROLE authenticated;');
    await assert.rejects(pg.query('SELECT snapshot FROM lab_reports'),error=>error.code==='42501');
  }finally{await pg.close();}
});
