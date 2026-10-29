// Shared, credential-free contract between the UI, authenticated bridge and Worker.
export type CodeFile = { path: string; content: string };
export type CodeTaskStatus = "queued" | "blocked" | "running" | "review" | "failed" | "conflict" | "merged" | "rejected" | "cancelled" | "interrupted";
export type CodeEvent = { id: string; at: string; taskId?: string; kind: string; message: string };
export type CodeChange = { path: string; before: string | null; after: string | null };
export type CodeCommit = { commit: string; parents: string[]; author: string; message: string; at: string | null };
export type CodeTests = { passed: boolean; exitCode: number | null; stdout: string; stderr: string; startedAt: string; endedAt: string; runner: string };
export type CodeTask = {
  id: string; title: string; instruction: string; priority: number; dependencies: string[]; allowedPaths: string[];
  // Legacy tasks without edit metadata are read as revision zero.
  version?: number;
  status: CodeTaskStatus; createdAt: string; startedAt?: string; endedAt?: string; generationStartedAt?: string; generationEndedAt?: string;
  base?: string; commit?: string; repository?: string; model?: string; usage?: Record<string, number>;
  changes?: CodeChange[]; decision?: string; tests?: CodeTests; error?: string;
  review?: { main: string; candidate: string; tests: CodeTests; conflicts: string[]; at: string; changes: CodeChange[] };
};
export type CodeProject = {
  id: string; name: string; repository: string; branch: string; head: string; createdAt: string;
  files: CodeFile[]; branches: string[]; tasks: CodeTask[]; events: CodeEvent[];
  history?: CodeCommit[]; revision?: { commit: string; files: CodeFile[] };
};
export type CodeWorkspaceState = { projects: CodeProject[]; model: string; concurrency: number };
export type CodeWorkspaceReadiness = { configured: boolean; connected: boolean; reason?: string; model?: string; concurrency?: number };
export type CodeWorkspaceAction =
  | { action: "create"; name: string; files: CodeFile[] }
  | { action: "import"; name: string; source: string; branch?: string }
  | { action: "task"; projectId: string; title: string; instruction: string; priority: number; dependencies: string[]; allowedPaths: string[] }
  | { action: "update-task"; projectId: string; taskId: string; expectedVersion: number; title: string; instruction: string; priority: number; dependencies: string[]; allowedPaths: string[] }
  | { action: "start"; projectId: string; consent: true }
  | { action: "cancel" | "review" | "merge" | "reject"; projectId: string; taskId: string }
  | { action: "edit"; projectId: string; expectedHead: string; files: CodeFile[] }
  | { action: "branch"; projectId: string; expectedHead: string; name: string }
  | { action: "switch"; projectId: string; expectedHead: string; name: string }
  | { action: "history"; projectId: string; expectedHead: string }
  | { action: "revision"; projectId: string; expectedHead: string; commit: string };
