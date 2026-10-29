import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(resolve(".model-verify-test-"));
let route;
try {
  const bundle = await build({ entryPoints: ["app/api/models/verify/route.ts"], absWorkingDir: process.cwd(), bundle: true, platform: "node", format: "esm", packages: "external", write: false, tsconfig: resolve("tsconfig.json"), plugins: [{ name: "probe-test-boundaries", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/server$/ }, () => ({ path: "fixture", namespace: "probe-test" }));
    builder.onLoad({ filter: /.*/, namespace: "probe-test" }, () => ({ contents: `
      export class HttpError extends Error { constructor(message,status=400){super(message);this.status=status;} }
      export async function identity(){return "owner";}
      export function fail(error){return Response.json({error:error instanceof HttpError?error.message:"UNAVAILABLE"},{status:error instanceof HttpError?error.status:503});}
      export function database(){throw Error("Invalid input reached storage");}
      export function availableModels(){throw Error("Invalid input reached models");}
      export function modelConfig(){throw Error("Invalid input reached configuration");}
      export function invokeModel(){throw Error("Invalid input reached provider");}
    ` }));
  } }] });
  const path = join(directory, "route.mjs");
  await writeFile(path, bundle.outputFiles[0].text);
  route = await import(pathToFileURL(path).href);
} finally {
  assert.ok(directory.startsWith(resolve(".model-verify-test-")));
  await rm(directory, { recursive: true, force: true });
}

test("model verification preserves JSON validation HTTP status before any provider call", async () => {
  const request = (body, type = "application/json") => new Request("https://hessara.test/api/models/verify", { method: "POST", headers: { "content-type": type }, body });
  for (const [body, type, expected] of [["{", "application/json", 400], ["{}", "text/plain", 415], ["x".repeat(40001), "application/json", 413], [new Uint8Array([0xff]), "application/json", 400]]) {
    const response = await route.POST(request(body, type));
    assert.equal(response.status, expected);
    assert.equal((await response.json()).error, "INVALID_INPUT");
  }
});
