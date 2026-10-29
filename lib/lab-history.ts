import type {createDatabase} from './postgres-database';
import {LabError} from './custom-lab.ts';

/** Delete only settled, privately owned experiments. Row locks serialize starts. */
export async function removeLabExperiment(db:ReturnType<typeof createDatabase>,owner:string,id:string,now=Date.now()) {
  const eligible="SELECT r.id FROM runs r WHERE r.id=? AND r.owner=? AND r.mode='custom' AND r.status<>'running' AND r.locked_until<=? AND NOT EXISTS(SELECT 1 FROM lab_judgements j WHERE j.run_id=r.id AND j.owner=r.owner AND j.status='running' AND j.created_at>now()-interval '3 minutes')";
  const result=await db.scopedBatch(owner,[
    db.prepare("SELECT id FROM runs WHERE id=? AND owner=? AND mode='custom' FOR UPDATE").bind(id,owner),
    db.prepare(`DELETE FROM integration_exports WHERE owner=? AND run_id IN (${eligible})`).bind(owner,id,owner,now),
    db.prepare(`DELETE FROM trials WHERE run_id IN (${eligible})`).bind(id,owner,now),
    db.prepare(`DELETE FROM runs WHERE id IN (${eligible}) RETURNING id`).bind(id,owner,now),
  ]);
  if(!result[0].results.length) throw new LabError('NOT_FOUND',404);
  if(result[3].meta.changes!==1) throw new LabError('BUSY',409);
}
