import { createHmac } from "node:crypto";
import { z } from "zod";
import { authClient, authConfigured, safeReturnPath } from "@/lib/auth";
import { database } from "@/lib/postgres-database";
import { trustedClientIp } from "@/lib/auth-transport";

export const runtime = "nodejs";
const input = z.object({ action: z.enum(["guest", "email", "signout"]), email: z.string().email().max(254).optional(), next: z.string().max(1000).optional() }).strict();
const reply = (data: object, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function limit(request: Request, action: string) {
  const secret = process.env.HESSARA_ENCRYPTION_KEY;
  if (!secret) throw new Error("Auth limiter is not configured");
  // The same platform-verified IP is used by Supabase and our own hashed limiter.
  const ip = trustedClientIp(request.headers) ?? "local";
  const bucket = createHmac("sha256", secret).update(`${action}:${ip}`).digest("hex");
  const now = Date.now();
  const result = await database().prepare(
    "INSERT INTO auth_limits(bucket,expires_at,used) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET expires_at=CASE WHEN auth_limits.expires_at<? THEN excluded.expires_at ELSE auth_limits.expires_at END,used=CASE WHEN auth_limits.expires_at<? THEN 1 ELSE auth_limits.used+1 END WHERE auth_limits.expires_at<? OR auth_limits.used<? RETURNING used"
  ).bind(bucket, now + 3600000, now, now, now, action === "email" ? 3 : 10).first();
  await database().prepare("DELETE FROM auth_limits WHERE expires_at<?").bind(now - 86400000).run();
  return !!result;
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: "الطلب غير مسموح." }, 403);
  if (!await authConfigured(request.headers)) return reply({ error: "خدمة الدخول قيد التهيئة. يمكنك تصفح المنصة حاليًا." }, 503);
  try {
    const value = input.safeParse(await request.json());
    if (!value.success) return reply({ error: "تحقّق من البيانات وأعد المحاولة." }, 400);
    const { action, email, next } = value.data;
    const client = await authClient();
    if (action === "signout") {
      await client.auth.signOut({ scope: "local" });
      return reply({ redirect: "/" });
    }
    const { data: current } = await client.auth.getUser();
    if (action === "guest" && current.user) return reply({ redirect: safeReturnPath(next) });
    if (action === "guest" && process.env.HESSARA_ALLOW_GUESTS !== "true") return reply({ error: "دخول الضيوف غير متاح حاليًا." }, 403);
    if (action === "email" && (process.env.HESSARA_EMAIL_AUTH_ENABLED !== "true" || !email)) return reply({ error: "الدخول بالبريد غير متاح حاليًا." }, 403);
    if (!await limit(request, action)) return reply({ error: "بلغت حد محاولات الدخول. يرجى المحاولة لاحقًا." }, 429);
    if (action === "guest") {
      const { error } = await client.auth.signInAnonymously();
      if (error) {
        console.error("Anonymous sign-in failed", error.code);
        return reply({ error: "تعذّر بدء الجلسة. يرجى المحاولة لاحقًا." }, 503);
      }
      return reply({ redirect: safeReturnPath(next) });
    }
    const origin = process.env.HESSARA_SITE_URL || new URL(request.url).origin;
    const redirect = new URL("/auth/callback", origin);
    redirect.searchParams.set("next", safeReturnPath(next));
    const result = current.user?.is_anonymous
      ? await client.auth.updateUser({ email: email! }, { emailRedirectTo: redirect.toString() })
      : await client.auth.signInWithOtp({ email: email!, options: { emailRedirectTo: redirect.toString() } });
    if (result.error) {
      console.error("Email sign-in failed", result.error.code);
      return reply({ error: "تعذّر إرسال رابط الدخول. يرجى المحاولة لاحقًا." }, 503);
    }
    return reply({ message: "راجع بريدك الإلكتروني لإكمال الدخول. احتفظ بهذه الصفحة مفتوحة." });
  } catch {
    return reply({ error: "تعذّر إكمال الطلب. يرجى المحاولة لاحقًا." }, 503);
  }
}
