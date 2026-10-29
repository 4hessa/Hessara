import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createDatabase} from '../lib/postgres-database.ts';
import {createLabReviewService} from '../lib/lab-reviews.ts';
import {JUDGE_CRITERIA} from '../lib/lab-judge.ts';

test('review persistence enforces owner RLS, relationship integrity, private reads and one paid call per request',async()=>{
  const pg=new PGlite();
  try{
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    for(const path of ['supabase/migrations/202609290001_hessara.sql','supabase/runtime-role.sql','supabase/migrations/20261009104943_lab_evaluations.sql']) await pg.exec(await readFile(new URL('../'+path,import.meta.url),'utf8'));
    await pg.exec("INSERT INTO runs(id,owner,name,mode,status,created_at,config,total) VALUES('a','alice','test','custom','completed','2026-10-09','{}',1),('b','bob','test','custom','completed','2026-10-09','{}',1); INSERT INTO trials(id,run_id,model,task_id,repeat,status,output) VALUES('ta','a','author','ca',0,'done','Evidence quote'),('tb','b','author','cb',0,'done','Private Bob answer'); SET ROLE hessara_runtime;");
    const execute=client=>async(sql,values)=>{const r=await client.query(sql,values);return{rows:r.rows,count:r.affectedRows??r.rows.length};};
    const db=createDatabase(execute(pg),work=>pg.transaction(tx=>work(execute(tx))));
    const author={id:'author',provider:'openai',model:'same',name:'Author',inputPrice:null,outputPrice:null};
    const judge={...author,id:'judge',model:'different',name:'Judge'};
    const getRun=async(owner,id)=>{
      const row=await db.prepare('SELECT * FROM runs WHERE id=? AND owner=?').bind(id,owner).first();if(!row)throw Error('NOT_FOUND');
      return{run:{...row,configData:{locale:'ar',modelSnapshots:[author],cases:[{id:id==='a'?'ca':'cb',prompt:'Explain',checks:[]}]}},trials:[{id:id==='a'?'ta':'tb',run_id:id,task_id:id==='a'?'ca':'cb',model:'author',status:'done',error:null,output:id==='a'?'Evidence quote':'Private Bob answer',metadataData:{}}]};
    };
    let calls=0;
    const service=createLabReviewService({db,getRun,modelConfig:async id=>id==='author'?author:judge,availableModels:async()=>[author,judge].map(x=>({...x,ready:true})),invoke:async()=>{
      calls++;return{output:JSON.stringify({criteria:JUDGE_CRITERIA.map(criterion=>({criterion,rating:4,rationale:'Visible evidence',excerpt:'Evidence quote'})),strengths:['Clear'],weaknesses:[],claims:[],referenceAlignment:null}),error:null,metadata:'{}',cost:null,latency:10,input_tokens:8,output_tokens:30};
    }});
    const review={criteria:[{criterion:'relevance',rating:4,rationale:'Related',evidence:'Evidence quote'}],claims:[],notes:'Private Alice notes'};
    await service.review('alice','a','ta',review);
    assert.equal((await service.read('alice','a')).reviews.ta.provenance,'manual_user');
    await assert.rejects(service.read('bob','a'),/NOT_FOUND/);
    await assert.rejects(service.review('bob','b','ta',review),/NOT_EVALUABLE/);
    assert.equal((await db.prepare('SELECT * FROM lab_reviews').all()).results.length,0,'transaction context must not leak');
    assert.equal((await db.scopedBatch('bob',[db.prepare('SELECT * FROM lab_reviews')]))[0].results.length,0);
    await assert.rejects(db.scopedBatch('bob',[db.prepare("INSERT INTO lab_reviews(trial_id,run_id,owner,review) VALUES('tb','b','alice','{}')")]),error=>error.code==='42501');
    await assert.rejects(db.scopedBatch('alice',[db.prepare("INSERT INTO lab_reviews(trial_id,run_id,owner,review) VALUES('tb','b','alice','{}')")]),error=>error.code==='42501');
    await assert.rejects(service.judge('alice','a','ta','author',randomUUID()),/SAME_EVALUATOR/);
    const id=randomUUID();const saved=await service.judge('alice','a','ta','judge',id);
    assert.equal(saved.status,'completed');assert.equal(saved.result.factVerification,'not_performed');assert.equal(calls,1);
    await service.judge('alice','a','ta','judge',id);assert.equal(calls,1);
    await assert.rejects(service.judge('bob','b','tb','judge',id),/LIMIT_OR_CONFLICT/);assert.equal(calls,1);
    await service.remove('alice','a','ta');assert.deepEqual((await service.read('alice','a')).reviews,{});
    await pg.exec('RESET ROLE; SET ROLE anon;');await assert.rejects(pg.query('SELECT * FROM lab_reviews'),error=>error.code==='42501');
  }finally{await pg.close();}
});
