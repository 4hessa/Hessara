import { z } from "zod";
import { NVIDIA_MODELS, invokeNvidia, readNvidiaAvailability } from "@/lib/nvidia";
import { identity, database, availableModels, fail, HttpError } from "@/lib/server";
import { encryptSecret, vaultReady } from "@/lib/vault";
import { readJsonRequest, RequestJsonError } from "@/lib/request-json";
import { configurationHash, recordVerification } from "@/lib/model-verification";
export const maxDuration = 120;
const schema = z.object({ ids: z.array(z.string()).min(1).max(4), apiKey: z.string().trim().min(10).max(4096) }).strict();
export async function GET() {
  try {
    const availability = await readNvidiaAvailability();
    return Response.json({
      models: NVIDIA_MODELS.map(model => ({ ...model, available: availability.ids.has(model.id) })),
      checkedAt: availability.checkedAt, catalogStatus: "checked", purpose: "evaluation", requiresOwnKey: true,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // The preset list remains usable as metadata, but no availability is invented.
    return Response.json({ models: NVIDIA_MODELS.map(model => ({ ...model, available: null })), checkedAt: null,
      catalogStatus: "unavailable", error: "PROVIDER_CATALOG_UNAVAILABLE", purpose: "evaluation", requiresOwnKey: true,
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
export async function POST(request: Request) {
  try {
    const owner = await identity(request);
    if (!vaultReady()) throw new HttpError("VAULT", 503);
    const parsed = schema.safeParse(await readJsonRequest(request));
    if (!parsed.success) throw new HttpError("INVALID_INPUT");
    const { ids, apiKey } = parsed.data;
    if (new Set(ids).size !== ids.length || ids.some(id => !NVIDIA_MODELS.some(model => model.id === id))) throw new HttpError("INVALID_INPUT");
    const db = database();
    const count = await db.prepare("SELECT count(*) AS n FROM model_profiles WHERE owner=?").bind(owner).first<{ n: number }>();
    if ((count?.n ?? 0) + ids.length > 100) throw new HttpError("LIMIT", 429);
    let availability: Awaited<ReturnType<typeof readNvidiaAvailability>>;
    try { availability = await readNvidiaAvailability(); }
    catch { throw new HttpError("PROVIDER_CATALOG_UNAVAILABLE", 503); }
    if (ids.some(id => !availability.ids.has(id))) throw new HttpError("NOT_READY", 409);
    // One explicitly disclosed, bounded probe. HTTP 200 alone is not inference success.
    const check = await invokeNvidia("Reply with the single word READY.", { model: ids[0], inputPrice: null, outputPrice: null }, apiKey, fetch, { maxOutputTokens: 128 });
    if (check.httpStatus === 401 || check.httpStatus === 403) throw new HttpError("PROVIDER_AUTH", 400);
    if (check.httpStatus === 429) throw new HttpError("PROVIDER_QUOTA", 429);
    if (check.httpStatus !== 200 || check.error || !check.output.trim()) throw new HttpError("PROVIDER_UNAVAILABLE", 503);
    const created = await Promise.all(ids.map(async model => {
      const id = crypto.randomUUID(), cipher = await encryptSecret(apiKey, `${owner}:${id}`);
      return { id, model, cipher, statement: db.prepare("INSERT INTO model_profiles(id,owner,name,provider,model,key_cipher,input_price,output_price,created_at) SELECT ?,?,?,'nvidia',?,?,NULL,NULL,? WHERE (SELECT count(*) FROM model_profiles WHERE owner=?)<100")
        .bind(id, owner, NVIDIA_MODELS.find(item => item.id === model)!.name, model, cipher, new Date().toISOString(), owner) };
    }));
    const result = await db.ownerQuotaBatch(owner, created.map(item => item.statement));
    const connected = created.filter((_, index) => result[index].meta.changes === 1).map(item => item.id);
    if (!connected.length) throw new HttpError("LIMIT", 429);
    const tested = created.find(item => item.model === ids[0] && connected.includes(item.id));
    if (tested) {
      try { await recordVerification(db, tested.id, true, { owner, fingerprint: configurationHash("nvidia", tested.model, tested.cipher) }); }
      catch { console.error("Model verification storage unavailable"); }
    }
    return Response.json({ ids: connected, models: await availableModels(owner), vaultReady: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error instanceof RequestJsonError ? new HttpError(error.message, error.status) : error instanceof SyntaxError ? new HttpError("INVALID_INPUT") : error);
  }
}

