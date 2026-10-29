export const engineIds = ["rea", "ghidra", "mobsf", "jadx", "rizin", "angr", "radare2"] as const;
export type EngineId = typeof engineIds[number];
export const artifactFormats = ["elf", "pe", "macho", "apk", "dex", "jar", "aab", "zip", "asar", "javascript"] as const;
export type ArtifactFormat = typeof artifactFormats[number];
export const jobStatuses = ["queued", "validating", "running", "completed", "failed", "cancelled", "timed_out"] as const;
export type JobStatus = typeof jobStatuses[number];
export type Pagination = { limit?: number; offset?: number; search?: string };
export type EvidenceKind = "finding" | "code" | "function" | "symbol" | "string" | "dependency" | "metadata" | "log" | "path";
export type AnalysisOptions = { decompile?: boolean; strings?: boolean; symbols?: boolean; symbolicExecution?: boolean; maxPaths?: number; maxSteps?: number; timeoutSeconds?: number };
export type AnalysisArtifact = { id: string; projectId: string; name: string; sizeBytes: number; sha256: string | null; format: ArtifactFormat | null; storageKey: string; status: string; metadata: Record<string, unknown>; createdAt: number; retentionUntil: number };
export type AnalysisJob = { id: string; projectId: string; artifactId: string; engineId: EngineId; status: JobStatus; stage: string; options: AnalysisOptions; createdAt: number; startedAt: number | null; finishedAt: number | null; errorCode: string | null; errorMessage: string | null; cancelRequested: boolean; attempt: number; timeoutSeconds: number; summary: string | null; metadata: Record<string, unknown> };
export type AnalysisFinding = { id?: string; title: string; description: string; severity?: "info" | "low" | "medium" | "high" | "critical"; confidence?: "confirmed" | "inference" | "unknown"; evidenceIds?: string[]; location?: string; category?: string };
export type AnalysisEvidence = { id?: string; kind: EvidenceKind; name: string; content?: string; location?: string; metadata?: Record<string, unknown>; storageKey?: string };
export type AnalysisResult = { engineId: EngineId; engineVersion: string; summary: string; findings?: AnalysisFinding[]; evidence?: AnalysisEvidence[]; functions?: Record<string, unknown>[]; strings?: (string | Record<string, unknown>)[]; dependencies?: Record<string, unknown>[]; files?: Record<string, unknown>[]; limitations?: string[]; metrics?: { memoryMb?: number; cpuSeconds?: number; durationMs?: number } };
export type WorkerVerification = { imageDigest: string; engineVersion: string; artifactSha256: string; verifiedAt: number; passed: true };
export type WorkerEngine = { id: EngineId; version?: string | null; healthy: boolean; enabled?: boolean; capacity: number; capabilities?: string[]; reason?: string; reasonCode?: string; verification?: WorkerVerification | null };
export type WorkerRegistration = { workerId: string; engines: WorkerEngine[]; capacity: { slots: number; cpuCount?: number; availableMemoryMb?: number; diskFreeMb?: number } };
export type WorkerLease = { workerId: string; jobId: string; leaseToken: string };
export type WorkerHeartbeat = WorkerLease & { stage?: string; metrics?: { memoryMb?: number; cpuSeconds?: number; cpuPercent?: number }; capacity?: WorkerRegistration["capacity"]; logs?: { level: string; message: string; at?: string }[] };
export type EngineDefinition = { id: EngineId; name: string; description: string; repository: string; license: string; formats: readonly ArtifactFormat[]; capabilities: readonly string[]; timeoutSeconds: number; memoryMb: number; cpuCount: number; diskMb: number; limitation: string };
export class ReError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  constructor(code: string, status = 400, details?: Record<string, unknown>) { super(code); this.name = "ReError"; this.code = code; this.status = status; this.details = details; }
}
