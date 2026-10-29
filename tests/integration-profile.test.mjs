import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationServerEnvironment, integrationListenHost } from '../scripts/integration-dev.mjs';
test('private integration profile clears inherited provider/DB values and dotenv fallbacks',()=>{
 const profile={DATABASE_URL:'test-only-db',NEXT_PUBLIC_SUPABASE_URL:'test-only-auth',HESSARA_SITE_URL:'http://127.0.0.1:5174'};
 const inherited={PATH:'system-path',DATABASE_URL:'production-db',POSTGRES_URL:'production-fallback',DATABASE_SSL_CA:'production-ca',OPENAI_API_KEY:'production-provider',PAPERCLIP_API_KEY:'production-integration',HESSARA_ENCRYPTION_KEY:'production-vault',NODE_ENV:'production'};
 const env=integrationServerEnvironment(profile,inherited,['OTHER_PROVIDER_KEY=production-other\nOPENAI_API_KEY=production-file']);
 assert.equal(env.DATABASE_URL,profile.DATABASE_URL); assert.equal(env.POSTGRES_URL,'');assert.equal(env.DATABASE_SSL_CA,'');assert.equal(env.OPENAI_API_KEY,'');assert.equal(env.PAPERCLIP_API_KEY,'');assert.equal(env.HESSARA_ENCRYPTION_KEY,'');assert.equal(env.OTHER_PROVIDER_KEY,'');assert.equal(env.PATH,'system-path');assert.equal(env.NODE_ENV,'development');assert.equal(inherited.DATABASE_URL,'production-db');
});
test('integration launcher rejects hosted contexts and preserves only explicit test secrets',()=>{
 assert.throws(()=>integrationServerEnvironment({}, {VERCEL:'1'}),/INTEGRATION_LOCAL_ONLY/);
 assert.throws(()=>integrationServerEnvironment({VERCEL:'1'}, {}),/INTEGRATION_LOCAL_ONLY/);
 assert.equal(integrationServerEnvironment({HESSARA_ENCRYPTION_KEY:'test-vault'},{}).HESSARA_ENCRYPTION_KEY,'test-vault');
});
test('integration launcher supports IPv4, localhost and unbracketed IPv6 listen hosts',()=>{
 assert.equal(integrationListenHost('http://[::1]:5174'),'::1');assert.equal(integrationListenHost('http://127.0.0.1:5174'),'127.0.0.1');assert.equal(integrationListenHost('http://localhost:5174'),'localhost');
});
