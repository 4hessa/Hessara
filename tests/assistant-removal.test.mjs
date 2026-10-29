import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { resolve } from "node:path";

const routes = [
  "app/api/toopee/route.ts",
  "app/api/toopee/threads/route.ts",
  "app/api/toopee/threads/[threadId]/route.ts",
  "app/api/toopee/generations/[generationId]/cancel/route.ts",
];

test("built-in assistant surfaces are absent while separate agents and reverse-engineering assistance remain", async () => {
  const workspace = await readFile("app/workspace.tsx", "utf8");
  assert.doesNotMatch(workspace, /ToopeeChat|assistantOpen|workspace-assistant|Ask the HESSARA assistant|اسأل مساعد HESSARA/);
  await assert.rejects(readFile("app/toopee-chat.tsx"));
  await assert.rejects(readFile("lib/toopee.ts"));
  assert.equal(await readFile("app/assistant-studio.tsx", "utf8").then(() => true), true);
  assert.equal(await readFile("app/reverse-engineering/assistant/page.tsx", "utf8").then(() => true), true);
});

test("all prior assistant API paths return 410 without reading bodies or touching application services", async () => {
  const imports = routes.map((route, index) => `import * as r${index} from "./${route}";`).join("\n");
  const exports = routes.map((_, index) => `r${index}`).join(",");
  const bundle = await build({
    absWorkingDir: process.cwd(),
    stdin: { contents: `${imports}\nexport const routes=[${exports}];`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    plugins: [{ name: "local-assistant-retirement-route", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/retired-assistant-route$/ }, () => ({ path: resolve("lib/retired-assistant-route.ts") }));
    } }],
  });
  const source = Buffer.from(bundle.outputFiles[0].contents).toString("base64");
  const { routes: actualRoutes } = await import(`data:text/javascript;base64,${source}`);
  for (const route of actualRoutes) {
    for (const method of ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]) {
      const request = new Request("https://hessara.test/api/toopee/threads/example", { method, ...(method === "GET" || method === "OPTIONS" ? {} : { body: "secret" }) });
      const response = await route[method](request);
      assert.equal(response.status, 410);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { error: "FEATURE_REMOVED", feature: "HESSARA_ASSISTANT", message: "This built-in assistant has been removed. Other model and agent workspaces are available in HESSARA." });
      assert.equal(request.bodyUsed, false);
    }
  }
});
