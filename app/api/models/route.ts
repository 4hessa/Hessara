import { z } from "zod";
import {
  identity,
  database,
  availableModels,
  fail,
  HttpError,
} from "@/lib/server";
import { vaultReady, encryptSecret } from "@/lib/vault";
const schema = z
  .object({
    name: z.string().trim().min(1).max(80),
    provider: z.enum(["openai", "anthropic", "gemini", "openrouter", "nvidia"]),
    model: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-zA-Z0-9._:/-]+$/),
    apiKey: z.string().trim().min(10).max(4096),
    inputPrice: z.number().finite().nonnegative().max(10000).nullable(),
    outputPrice: z.number().finite().nonnegative().max(10000).nullable(),
  })
  .strict();
export async function GET() {
  try {
    const owner = await identity();
    return Response.json(
      { models: await availableModels(owner), vaultReady: vaultReady() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    const owner = await identity(request);
    if (!vaultReady()) throw new HttpError("VAULT", 503);
    const value = schema.safeParse(await request.json());
    if (!value.success) throw new HttpError("INVALID_INPUT");
    const c = value.data,
      id = crypto.randomUUID();
    const cipher = await encryptSecret(c.apiKey, `${owner}:${id}`);
    const db = database();
    const statement = db
      .prepare(
        "INSERT INTO model_profiles(id,owner,name,provider,model,key_cipher,input_price,output_price,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM model_profiles WHERE owner=?)<100",
      )
      .bind(
        id,
        owner,
        c.name,
        c.provider,
        c.model,
        cipher,
        c.inputPrice,
        c.outputPrice,
        new Date().toISOString(),
        owner,
      );
    const [inserted] = await db.ownerQuotaBatch(owner, [statement]);
    if (inserted.meta.changes !== 1) throw new HttpError("LIMIT", 429);
    return Response.json(
      { models: await availableModels(owner) },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof SyntaxError) return fail(new HttpError("INVALID_INPUT"));
    return fail(e);
  }
}
