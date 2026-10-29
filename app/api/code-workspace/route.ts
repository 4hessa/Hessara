import { identity } from "@/lib/server";
import { createCodeWorkspaceHandlers } from "@/lib/code-workspace-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const handlers = createCodeWorkspaceHandlers({ identity });
export const GET = handlers.GET;
export const POST = handlers.POST;
