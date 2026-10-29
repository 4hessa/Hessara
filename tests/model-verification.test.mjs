import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationHash,verificationState,recordVerification,VERIFICATION_LIFETIME_MS} from '../lib/model-verification.ts';
test('availability requires a fresh successful request bound to current model and credential',()=>{
 const now=Date.now(),fingerprint=configurationHash('openai','model-a','encrypted-owner-key');
 assert.equal(verificationState(undefined,fingerprint,now).ready,false);
 const good={fingerprint,success:true,checked_at:now-1000};
 assert.equal(verificationState(good,fingerprint,now).ready,true);
 assert.equal(verificationState(good,configurationHash('openai','model-b','encrypted-owner-key'),now).ready,false);
 assert.equal(verificationState(good,configurationHash('openai','model-a','rotated-key'),now).ready,false);
 assert.equal(verificationState({...good,checked_at:now-VERIFICATION_LIFETIME_MS},fingerprint,now).ready,false);
 assert.equal(verificationState({...good,checked_at:now+10000},fingerprint,now).ready,false);
 assert.equal(verificationState({...good,success:false},fingerprint,now).verification,'failed');
});
test('a delayed reply only certifies the exact configuration used for that request',async()=>{
 const observed={owner:'owner-a',fingerprint:configurationHash('openai','original-model','original-cipher')};
 const writes=[];
 const db={prepare(sql){assert.ok(sql.startsWith('INSERT INTO model_verifications'));return {bind(...args){writes.push(args);return this;}};},async scopedBatch(owner){assert.equal(owner,observed.owner);return [];}};
 // Simulate rotation while the provider request is in flight.
 const rotated=configurationHash('openai','new-model','new-cipher');
 await recordVerification(db,'model-id',true,observed);
 const [owner,id,fingerprint,checked_at,success]=writes[0];
 assert.equal(owner,'owner-a');assert.equal(id,'model-id');
 assert.equal(verificationState({fingerprint,checked_at,success},rotated).ready,false);
 assert.equal(verificationState({fingerprint,checked_at,success},observed.fingerprint).ready,true);
 await recordVerification(db,'model-id',false,null);assert.equal(writes.length,1);
});
