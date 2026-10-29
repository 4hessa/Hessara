import "server-only";
import { start } from "workflow/api";
import { runLabWorkflow } from "./lab-workflow";

// The trace holds opaque identifiers only. Prompts, keys and model answers stay
// in the private application database, never in workflow arguments or results.
export async function startLabBackground(owner: string, id: string) {
  const execution = await start(runLabWorkflow, [owner, id]);
  return { executionId: execution.runId };
}
