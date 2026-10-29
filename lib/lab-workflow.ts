import { FatalError, sleep } from "workflow";

export async function runLabWorkflow(owner: string, id: string) {
  "use workflow";
  try {
    // At most 32 paid calls. Extra iterations only wait for a competing/stale
    // lease; they never reset the database's durable attempt cursor.
    for (let iteration = 0; iteration < 64; iteration++) {
      const result = await nextLabStep(owner, id);
      if (!result.hasMore) return { status: result.paused ? "paused" : "settled" };
      if (result.busy) await sleep("125s");
    }
  } catch {
    // Do not let provider errors, request bodies or SQL values enter the trace.
  }
  await pauseLabStep(owner, id);
  return { status: "paused" };
}

export async function nextLabStep(owner: string, id: string) {
  "use step";
  try {
    const { executeLabStep } = await import("./lab-service");
    return await executeLabStep(owner, id);
  } catch {
    // A persisted attempt may have an unknown outcome. The user can recover
    // the untouched remainder, but this step must not repeat a paid request.
    throw new FatalError("LAB_EXECUTION_PAUSED");
  }
}

export async function pauseLabStep(owner: string, id: string) {
  "use step";
  try {
    const { markLabWorkflowFailure } = await import("./lab-service");
    await markLabWorkflowFailure(owner, id);
  } catch {
    // Cleanup is idempotent and may use the SDK's ordinary retry policy. Keep
    // database errors and their parameter values out of Workflow event data.
    throw new Error("LAB_PAUSE_PERSISTENCE_FAILED");
  }
}
