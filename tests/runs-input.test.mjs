import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { RUN_INPUT_LIMITS } from "../lib/runs-input.ts";

const directory = await mkdtemp(resolve(".runs-input-test-")), output = join(directory, "route.mjs");
let api;
const fixture = `
 export const state = {};
 export function reset(){Object.assign(state,{authenticated:true,catalogCalls:0,databaseCalls:0,writes:[],models:Array.from({length:30},(_,i)=>({id:'profile-'+String(i).padStart(3,'0')+'-'.repeat(190),ready:true,provider:'simulation'}))});}
 reset();
 export class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}}
 export async function identity(request){if(!state.authenticated)throw new HttpError('AUTH_REQUIRED',401);if(request.headers.get('origin')!==new URL(request.url).origin)throw new HttpError('ORIGIN',403);return 'fixture-owner';}
 export const fail=e=>Response.json({error:e instanceof HttpError?e.message:'UNAVAILABLE'},{status:e instanceof HttpError?e.status:503});
 export async function availableModels(){state.catalogCalls++;return state.models;}
 export async function modelConfig(id,owner){if(owner!=='fixture-owner')throw Error('wrong owner');return {id,provider:'simulation',model:id};}
 export function database(){state.databaseCalls++;return {prepare(sql){return {bind(...values){return {sql,values,async first(){return {n:0};}};}};},async ownerQuotaBatch(owner,statements){if(owner!=='fixture-owner')throw Error('wrong owner');state.writes.push(...statements);return [{meta:{changes:1}}];}};}
`;
try {
  const bundle = await build({ absWorkingDir: process.cwd(), stdin: { contents: "export {POST} from './app/api/runs/route'; export {state,reset} from 'runs-test-harness';", resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", packages: "external", write: false, tsconfig: resolve("tsconfig.json"), plugins: [{ name: "isolated-run-storage-and-identity", setup(builder) {
    builder.onResolve({ filter: /^(?:@\/lib\/server|runs-test-harness)$/ }, () => ({ path: "fixture", namespace: "runs-test" }));
    builder.onLoad({ filter: /.*/, namespace: "runs-test" }, () => ({ contents: fixture, loader: "ts" }));
  } }] });
  await writeFile(output, bundle.outputFiles[0].text);
  api = await import(pathToFileURL(output).href);
} finally { await unlink(output).catch(error => { if (error.code !== "ENOENT") throw error; }); await rmdir(directory); }
const payload = () => ({ name: "تقييم النماذج", mode: "demo", models: [api.state.models[0].id], categories: ["coding"], count: 4, repeats: 1 });
const request = (body, headers = {}, signal) => new Request("https://hessara.example/api/runs", { method: "POST", headers: { origin: "https://hessara.example", "content-type": "application/json", ...headers }, body: typeof body === "string" || body instanceof Uint8Array || body instanceof ReadableStream ? body : JSON.stringify(body), ...(body instanceof ReadableStream ? { duplex: "half" } : {}), ...(signal ? { signal } : {}) });
const untouched = () => { assert.equal(api.state.catalogCalls, 0); assert.equal(api.state.databaseCalls, 0); assert.equal(api.state.writes.length, 0); };

// These execute the actual route with isolated identity/storage fixtures, not provider or database integration.
test("run creation preserves its largest valid selection, Arabic name and bounded whitespace", async () => {
  api.reset();
  const value = { ...payload(), name: "ع".repeat(80), models: api.state.models.map(model => model.id), categories: ["coding", "logic", "analysis", "retrieval", "instruction", "long"], count: 40, repeats: 3 };
  const serialized = JSON.stringify(value), bytes = Buffer.byteLength(serialized);
  assert.ok(bytes < RUN_INPUT_LIMITS.requestBytes);
  const response = await api.POST(request(serialized + " ".repeat(RUN_INPUT_LIMITS.requestBytes - bytes), { "content-type": "Application/JSON; charset=utf-8" }));
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.run.total, 21600); assert.equal(result.run.name, value.name); assert.equal(api.state.writes.length, 1);
  assert.deepEqual(JSON.parse(result.run.config).models, value.models);
});

test("run transport rejects invalid type, JSON, UTF-8 and declared or actual oversized bytes before catalog/storage", async () => {
  for (const [body, headers, status] of [
    ["{}", { "content-type": "text/plain" }, 415], ["{}", { "content-type": "application/json-untrusted" }, 415],
    ["{", {}, 400], [new Uint8Array([0xff]), {}, 400],
    ["{}", { "content-length": String(RUN_INPUT_LIMITS.requestBytes + 1) }, 413],
    ["{}", { "content-length": "invalid" }, 413], ["{}", { "content-length": "9007199254740992" }, 413],
    [" ".repeat(RUN_INPUT_LIMITS.requestBytes + 1), {}, 413],
    [" ".repeat(RUN_INPUT_LIMITS.requestBytes + 1), { "content-length": "1" }, 413],
  ]) {
    api.reset(); const response = await api.POST(request(body, headers));
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: "INVALID_INPUT" }); untouched();
  }
});

test("run transport counts all streamed chunks and cancels an oversized upload", async () => {
  api.reset(); let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(RUN_INPUT_LIMITS.requestBytes)); controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
  const response = await api.POST(request(stream));
  assert.equal(response.status, 413); assert.equal(cancelled, true); untouched();
});

test("run input bounds raw model/category cardinality before catalog or storage work", async () => {
  for (const changes of [{ models: Array(RUN_INPUT_LIMITS.models + 1).fill(null) }, { categories: Array(RUN_INPUT_LIMITS.categories + 1).fill(null) }]) {
    api.reset(); const response = await api.POST(request({ ...payload(), ...changes }));
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "INVALID_INPUT" }); untouched();
  }
});

test("run body deadline settles even when an upload never closes and cancellation never resolves", async t => {
  api.reset(); t.mock.timers.enable({ apis: ["setTimeout"] }); let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } });
  const pending = api.POST(request(stream));
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(RUN_INPUT_LIMITS.timeoutMs);
  const response = await pending;
  assert.equal(response.status, 408); assert.deepEqual(await response.json(), { error: "REQUEST_TIMEOUT" }); assert.equal(cancelled, true); untouched();
});

test("aborted run uploads are rejected without downstream work", async () => {
  api.reset(); const controller = new AbortController(); controller.abort();
  const response = await api.POST(request(payload(), {}, controller.signal));
  assert.equal(response.status, 499); assert.deepEqual(await response.json(), { error: "REQUEST_ABORTED" }); untouched();
});

test("authentication and origin checks still precede body parsing", async () => {
  api.reset(); api.state.authenticated = false;
  assert.equal((await api.POST(request("{"))).status, 401); untouched();
  api.reset(); assert.equal((await api.POST(request("{", { origin: "https://untrusted.example" }))).status, 403); untouched();
});
