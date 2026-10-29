import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Generated checkpoints and isolated test bundles are not application sources.
    ".next.*/**",
    ".next-premium/**",
    ".vercel/**",
    ".*-test-*/**",
    ".agents/**",
    "work/**",
    "app/.well-known/workflow/**",
    "**/.cloudflare/types/**",
    "**/.cloudflare/output/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Isolated research has its own verification; do not lint upstream demos as Next.js.
    "research/**",
  ]),
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
