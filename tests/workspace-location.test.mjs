import test from "node:test";
import assert from "node:assert/strict";
import { WORKSPACE_VIEWS, workspaceHref, workspaceLocation, isPlainNavigation } from "../lib/workspace-location.ts";

const run = "b5fbe2da-4d7a-4485-b20d-c6a816e51933";
const read = href => workspaceLocation(new URL(href, "https://hessara.example").searchParams);

test("every workspace section has a reloadable URL and retains the selected report", () => {
  for (const view of WORKSPACE_VIEWS) {
    const href = workspaceHref(view, `lang=ar&run=${run}&filter=cost`);
    assert.deepEqual(read(href), { view, runId: run });
    assert.equal(new URL(href, "https://hessara.example").searchParams.get("lang"), "ar");
    assert.equal(new URL(href, "https://hessara.example").searchParams.get("filter"), "cost");
  }
});

test("Back/Forward URLs recover the same view and report without an execution action", () => {
  const history = [workspaceHref("overview"), workspaceHref("runs", "lang=en"), workspaceHref("overview", "lang=en", run), workspaceHref("agents", `lang=en&run=${run}`)];
  assert.deepEqual(history.map(read), [
    { view: "overview", runId: null }, { view: "runs", runId: null },
    { view: "overview", runId: run }, { view: "agents", runId: run },
  ]);
  assert.deepEqual(read(history[2]), { view: "overview", runId: run });
  assert.ok(history.every(href => !href.includes("action=") && href.startsWith("/")));
});

test("unknown views and malformed report IDs cannot become paths or hidden panels", () => {
  for (const requested of ["../admin", "https://example.com", "__proto__", "constructor", "OVERVIEW"]) {
    const params = new URLSearchParams({ view: requested, run: "../../other-user" });
    assert.deepEqual(workspaceLocation(params), { view: "overview", runId: null });
    assert.equal(workspaceHref(requested, params.toString()), "/");
  }
});

test("explicit home clears report context and canonicalizes overview without losing locale", () => {
  assert.equal(workspaceHref("overview", `view=agents&run=${run}&lang=ar`, null), "/?lang=ar");
  assert.equal(workspaceHref("overview", "view=overview"), "/");
  assert.deepEqual(read(workspaceHref("overview", "lang=en", run)), { view: "overview", runId: run });
});

test("ordinary clicks use client navigation while modified clicks keep browser behavior", () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  assert.equal(isPlainNavigation(click), true);
  for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey", "defaultPrevented"]) assert.equal(isPlainNavigation({ ...click, [modifier]: true }), false);
  assert.equal(isPlainNavigation({ ...click, button: 1 }), false);
  assert.equal(isPlainNavigation({ ...click, button: 2 }), false);
});
