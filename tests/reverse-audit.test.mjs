import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createDatabase} from '../lib/postgres-database.ts';
import {createReverseEngineeringService} from '../lib/reverse-engineering/service.ts';
async function fixture(t){const pg=new PGlite();t.after(()=>pg.close());await pg.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE hessara_runtime NOLOGIN NOINHERIT NOBYPASSRLS;GRANT USAGE ON SCHEMA public TO hessara_runtime;');await pg.exec(await readFile(new URL('../supabase/reverse-engineering-draft.sql',import.meta.url),'utf8'));await pg.exec('SET ROLE hessara_runtime');const execute=c=>async(sql,values)=>{const r=await c.query(sql,values);return{rows:r.rows,count:r.affectedRows??r.rows.length};};const db=createDatabase(execute(pg),work=>pg.transaction(tx=>work(execute(tx))));return{pg,db,service:createReverseEngineeringService(db)};}
const events=async(db,owner)=>(await db.scopedBatch(owner,[db.prepare('SELECT action,entity_id FROM re_audit WHERE owner=? ORDER BY created_at,id').bind(owner)]))[0].results;
test('rejected owner, missing and repeated project mutations never append success audit events',async t=>{
 const{db,service}=await fixture(t),owner='audit-alice',other='audit-bob';const project=await service.createProject(owner,{name:'Local audit fixture'});const missing='00000000-0000-4000-8000-000000000099';
 assert.equal((await events(db,owner)).filter(e=>e.action==='project.create').length,1);
 for(const id of [project.id,missing]){
  await assert.rejects(service.renameProject(other,id,{name:'Must not commit'}),/NOT_FOUND/);
  await assert.rejects(service.deleteProject(other,id),/NOT_FOUND/);
 }
 assert.deepEqual(await events(db,other),[], 'failed other-owner requests must not look successful');
 await service.renameProject(owner,project.id,{name:'تسمية محلية ناجحة'});
 const before=Date.now;Date.now=()=>1800000000000;try{await service.deleteProject(owner,project.id);await assert.rejects(service.deleteProject(owner,project.id),/NOT_FOUND/);}finally{Date.now=before;}
 const own=await events(db,owner);assert.equal(own.filter(e=>e.action==='project.rename').length,1);assert.equal(own.filter(e=>e.action==='project.delete_requested').length,1);
});
test('quota failures and unchanged artifact/report/job mutations do not create audit successes',async t=>{
 const{pg,db,service}=await fixture(t),owner='audit-alice',other='audit-bob';const project=await service.createProject(owner,{name:'Local fixture'}),foreign=await service.createProject(other,{name:'Foreign fixture'});const missing='00000000-0000-4000-8000-000000000098';
 await pg.exec('RESET ROLE;UPDATE re_settings SET max_projects=1 WHERE id=1;SET ROLE hessara_runtime;');const before=await events(db,owner);
 await assert.rejects(service.createProject(owner,{name:'Over quota'}),/PROJECT_QUOTA/);
 await assert.rejects(service.reserveArtifact(owner,{projectId:foreign.id,name:'fixture.elf',sizeBytes:16,storageKey:owner+'/fixture'}),/STORAGE_QUOTA/);
 await assert.rejects(service.completeArtifact(owner,missing,{sha256:'a'.repeat(64),format:'elf'}),/NOT_FOUND/);
 await assert.rejects(service.rejectArtifact(owner,missing,'LOCAL_FIXTURE'),/NOT_FOUND/);
 await assert.rejects(service.deleteArtifact(owner,missing),/ARTIFACT_BUSY_OR_NOT_FOUND/);
 await assert.rejects(service.cancelJob(owner,missing),/NOT_FOUND/);
 await assert.rejects(service.createReport(owner,missing,{format:'json'}),/NOT_FOUND/);
 assert.deepEqual(await events(db,owner),before);
 const artifact=await service.reserveArtifact(owner,{projectId:project.id,name:'fixture.elf',sizeBytes:16,storageKey:owner+'/fixture'});await service.completeArtifact(owner,artifact.id,{sha256:'a'.repeat(64),format:'elf',metadata:{localFixture:true}});await service.deleteArtifact(owner,artifact.id);
 const successful=await events(db,owner);for(const action of ['artifact.reserve','artifact.validated','artifact.delete_requested'])assert.equal(successful.filter(e=>e.action===action).length,1,action);
 const final=await events(db,owner);await assert.rejects(service.deleteArtifact(owner,artifact.id),/ARTIFACT_BUSY_OR_NOT_FOUND/);await assert.rejects(service.completeArtifact(owner,artifact.id,{sha256:'b'.repeat(64),format:'elf'}),/NOT_FOUND/);assert.deepEqual(await events(db,owner),final);
});
test('audit insertion failure still rolls the successful project mutation back atomically',async t=>{
 const{pg,db,service}=await fixture(t),owner='audit-alice';const project=await service.createProject(owner,{name:'Must survive rollback'});
 await pg.exec("RESET ROLE;ALTER TABLE re_audit ADD CONSTRAINT reject_local_rename CHECK(action<>'project.rename');SET ROLE hessara_runtime;");
 await assert.rejects(service.renameProject(owner,project.id,{name:'Must roll back'}),e=>e.code==='23514');
 assert.equal((await service.listProjects(owner))[0].name,'Must survive rollback');assert.deepEqual((await events(db,owner)).map(e=>e.action),['project.create']);
});
