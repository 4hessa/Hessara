/** Public workspace destinations. Unknown query values never select hidden panels. */
export const WORKSPACE_VIEWS = [
  "overview", "llms", "personal-lab", "agents", "code-workspace", "runs",
  "tools", "benchmarks", "models", "how", "method",
] as const;
export type WorkspaceView = typeof WORKSPACE_VIEWS[number];

const views = new Set<string>(WORKSPACE_VIEWS);
const runIdPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

export function workspaceLocation(params: Pick<URLSearchParams, "get">): { view: WorkspaceView; runId: string | null } {
  const requested = params.get("view") ?? "overview";
  const run = params.get("run");
  return {
    view: views.has(requested) ? requested as WorkspaceView : "overview",
    runId: run && runIdPattern.test(run) ? run : null,
  };
}

/** Keep locale/other query state; only the selected view and report belong to us. */
export function workspaceHref(view: string, search = "", runId?: string | null): string {
  const params = new URLSearchParams(search);
  const next = views.has(view) ? view : "overview";
  if (next === "overview") params.delete("view"); else params.set("view", next);
  const run = runId === undefined ? workspaceLocation(params).runId : runId;
  if (run && runIdPattern.test(run)) params.set("run", run); else params.delete("run");
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

/** Modified clicks retain native browser behavior, including opening a new tab. */
export function isPlainNavigation(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }): boolean {
  return event.button === 0 && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
