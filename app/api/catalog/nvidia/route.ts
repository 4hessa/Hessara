import { z } from "zod";
import { NVIDIA_MODELS, invokeNvidia } from "@/lib/nvidia";
import {
  identity,
  database,
  availableModels,
  fail,
  HttpError,
} from "@/lib/server";
import { encryptSecret, vaultReady } from "@/lib/vault";
export const maxDuration = 120;
const schema = z
  .object({
    ids: z.array(z.string()).min(1).max(4),
    apiKey: z.string().trim().min(10).max(4096),
  })
  .strict();
export async function GET() {
  return Response.json(
    {
      models: NVIDIA_MODELS,
      checkedAt: "2026-09-27",
      purpose: "evaluation",
      requiresOwnKey: true,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
export async function POST(request: Request) {
  try {
    const owner = await identity(request);
    if (!vaultReady()) throw new HttpError("VAULT", 503);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) throw new HttpError("INVALID_INPUT");
    const { ids, apiKey } = parsed.data;
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => !NVIDIA_MODELS.some((m) => m.id === id))
    )
      throw new HttpError("INVALID_INPUT");
    const db = database();
    const count = await db
      .prepare("SELECT count(*) AS n FROM model_profiles WHERE owner=?")
      .bind(owner)
      .first<{ n: number }>();
    if ((count?.n ?? 0) + ids.length > 100) throw new HttpError("LIMIT", 429);
    const catalogResponse = await fetch(
      "https://integrate.api.nvidia.com/v1/models",
      { signal: AbortSignal.timeout(15000), redirect: "error" },
    );
    if (!catalogResponse.ok) throw new HttpError("UNAVAILABLE", 503);
    const live = (await catalogResponse.json()) as { data?: { id: string }[] };
    if (ids.some((id) => !live.data?.some((m) => m.id === id)))
      throw new HttpError("NOT_READY", 409);
    // The button explicitly describes this one inference request before saving.
    const check = await invokeNvidia(
      "Reply with the single word READY.",
      { model: ids[0], inputPrice: 0, outputPrice: 0 },
      apiKey,
    );
    if (check.httpStatus === 401 || check.httpStatus === 403)
      throw new HttpError("PROVIDER_AUTH", 400);
    if (check.httpStatus === 429) throw new HttpError("PROVIDER_QUOTA", 429);
    if (check.httpStatus !== 200)
      throw new HttpError("PROVIDER_UNAVAILABLE", 503);
    const created = await Promise.all(
      ids.map(async (model) => {
        const id = crypto.randomUUID();
        const cipher = await encryptSecret(apiKey, `${owner}:${id}`);
        return {
          id,
          statement: db
            .prepare(
              "INSERT INTO model_profiles(id,owner,name,provider,model,key_cipher,input_price,output_price,created_at) SELECT ?,?,?,'nvidia',?,?,0,0,? WHERE (SELECT count(*) FROM model_profiles WHERE owner=?)<100",
            )
            .bind(
              id,
              owner,
              NVIDIA_MODELS.find((m) => m.id === model)!.name,
              model,
              cipher,
              new Date().toISOString(),
              owner,
            ),
        };
      }),
    );
    const result = await db.ownerQuotaBatch(owner, created.map((x) => x.statement));
    const connected = created
      .filter((_, i) => result[i].meta.changes === 1)
      .map((x) => x.id);
    if (!connected.length) throw new HttpError("LIMIT", 429);
    return Response.json(
      {
        ids: connected,
        models: await availableModels(owner),
        vaultReady: true,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e instanceof SyntaxError ? new HttpError("INVALID_INPUT") : e);
  }
}
