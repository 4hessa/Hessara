import test from 'node:test';
import assert from 'node:assert/strict';
import {authMutationReadiness} from '../lib/signin-readiness.ts';
const valid={DATABASE_URL:'postgres://runtime:fixture-only@localhost/hessara',HESSARA_ENCRYPTION_KEY:btoa('k'.repeat(32))};

test('auth writes require durable rate-limit storage and a valid signing key independently from transport',()=>{
 assert.deepEqual(authMutationReadiness(valid),{configured:true,issues:[]});
 assert.deepEqual(authMutationReadiness({}),{configured:false,issues:['database_missing','encryption_key_missing']});
 assert.equal(authMutationReadiness({...valid,DATABASE_URL:undefined,POSTGRES_URL:valid.DATABASE_URL}).configured,true);
 for(const connection of ['not a URL','https://database.example/','postgres:///missing-host'])assert.deepEqual(authMutationReadiness({...valid,DATABASE_URL:connection}).issues,['database_invalid']);
 for(const key of ['not-base64!','',btoa('short'),btoa('x'.repeat(33))])assert.equal(authMutationReadiness({...valid,HESSARA_ENCRYPTION_KEY:key}).configured,false);
 assert.ok(!JSON.stringify(authMutationReadiness(valid)).includes('fixture-only'),'diagnostics never include credentials');
});
