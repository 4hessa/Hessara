import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // Isolate a local provider test from another preview's production cache.
  ...(process.env.NODE_ENV === 'development' && process.env.HESSARA_LOCAL_OPENAI_TEST_SERVER === '1' && process.env.HESSARA_INTEGRATION_TEST === 'true' && !process.env.VERCEL ? { distDir: '.next.openai-test' } : {}),
  // Keep the actual loopback origin for strict CSRF checks and auth callbacks.
  // NextURL otherwise rewrites 127.0.0.1/::1 to localhost before Proxy runs.
  skipProxyUrlNormalize: true,
  serverExternalPackages: ["pdfkit"],
  outputFileTracingIncludes: { "/api/reverse-engineering/*": ["./public/fonts/font-2.ttf"] },
  // Resolve cookie-based titles before hydration, so streamed metadata cannot
  // overwrite the language restored from an older browser preference.
  htmlLimitedBots: /.*/,
  images: { qualities: [75, 90] },
  poweredByHeader: false,
  // Bound local build concurrency and cache pressure on constrained Windows hosts.
  ...(process.platform === "win32" ? { experimental: {
    cpus: 1,
    webpackMemoryOptimizations: true,
  } } : {}),
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : "") + "; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; worker-src 'self' blob:; media-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" },
    ] }];
  },
};

export default withWorkflow(nextConfig);
