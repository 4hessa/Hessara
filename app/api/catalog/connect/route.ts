import { z } from "zod";
import catalog from "@/lib/catalog/models.json";
import {
  identity,
  database,
  availableModels,
  fail,
  HttpError,
} from "@/lib/server";
import { vaultReady, encryptSecret } from "@/lib/vault";
const input = z
  .object({
    ids: z.array(z.string()).min(1).max(30),
    apiKey: z.string().trim().min(10).max(4096),
  })
  .strict();
export async function POST(request: Request) {
  try {
    const owner = await identity(request);
    if (!vaultReady()) throw new HttpError("VAULT", 503);
    const parsed = input.safeParse(await request.json());
    if (!parsed.success) throw new HttpError("INVALID_INPUT");
    const { ids, apiKey } = parsed.data;
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => !catalog.some((m) => m.id === id))
    )
      throw new HttpError("INVALID_INPUT");
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new HttpError("UNAVAILABLE", 503);
    const live = (await response.json()) as {
      data: { id: string; pricing: { prompt: string; completion: string } }[];
    };
    if (ids.some((id) => !live.data.some((m) => m.id === id)))
      throw new HttpError("NOT_READY", 409);
    const db = database();
    const n = await db
      .prepare("SELECT count(*) AS n FROM model_profiles WHERE owner=?")
      .bind(owner)
      .first<{ n: number }>();
    if ((n?.n ?? 0) + ids.length > 100) throw new HttpError("LIMIT", 429);
    const created = await Promise.all(
      ids.map(async (model) => {
        const id = crypto.randomUUID(),
          m = catalog.find((m) => m.id === model)!,
          current = live.data.find((m) => m.id === model)!;
        const cipher = await encryptSecret(apiKey, `${owner}:${id}`);
        const price = (v: string) =>
          Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) * 1e6 : null;
        return {
          id,
          statement: db
            .prepare(
              "INSERT INTO model_profiles(id,owner,name,provider,model,key_cipher,input_price,output_price,created_at) SELECT ?,?,?,'openrouter',?,?,?,?,? WHERE (SELECT count(*) FROM model_profiles WHERE owner=?)<100",
            )
            .bind(
              id,
              owner,
              m.name,
              model,
              cipher,
              price(current.pricing.prompt),
              price(current.pricing.completion),
              new Date().toISOString(),
              owner,
            ),
        };
      }),
    );
    const results = await db.batch(created.map((x) => x.statement));
    const connectedIds = created
      .filter((_, i) => results[i].meta.changes === 1)
      .map((x) => x.id);
    if (!connectedIds.length) throw new HttpError("LIMIT", 429);
    return Response.json(
      {
        ids: connectedIds,
        models: await availableModels(owner),
        vaultReady: true,
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return fail(e instanceof SyntaxError ? new HttpError("INVALID_INPUT") : e);
  }
}
