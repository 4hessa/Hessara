# HESSARA platform update — 2026-10-29

## Summary

This delivery removes the built-in HESSARA Assistant from the product, keeps retired endpoints fail-closed, makes Reverse Engineering readiness explicit, refreshes the verified model/agent/tool catalogs, and records the remaining infrastructure blockers. Catalog entries do not imply that HESSARA can run those products.

## HESSARA Assistant

- Removed the built-in assistant interface, provider/service modules, and assistant-only tests.
- Legacy `/api/toopee*` routes remain as compatibility tombstones and return `410 FEATURE_REMOVED`; they do not parse request bodies or initialize authentication/provider services.
- The migration `supabase/migrations/202610290001_shared_model_verifications_and_assistant_archive.sql` renames old assistant tables to `hessara_retired_assistant_*`, revokes runtime access, and preserves their rows. It also creates a private model-verification store with RLS.
- The migration has **not** been applied to production. Production data/schema were not changed. Apply only through the approved migration process after reviewing the target project and rollback plan.
- Regression coverage confirms old routes fail closed and unrelated agents / Reverse Engineering assistance remain present.

## Reverse Engineering

Seven engines are catalogued: REA, Ghidra, MobSF, JADX, Rizin, angr, and radare2. All seven remain disabled/unavailable because a verified isolated Linux worker is not provisioned: Docker is absent, WSL access is denied on the current Windows host, pinned engine image digests and benchmark approvals are missing, and no deployed worker origin/token/storage allowlist are configured. The UI now states the concrete blockers and remediation steps instead of presenting a false success state.

The worker and sandbox code includes authentication boundaries, file/resource/time limits, isolated engine adapters, and safe-sample verification. It is not production-ready until it is deployed on an isolated Linux host, each image is pinned and verified against real safe samples, and an administrator enables only verified engines. No end-to-end real engine result was produced in this environment.

## Catalog updates

### Models

Five verified entries were added to the 35-model catalog:

| Model | Provider | Release / availability |
| --- | --- | --- |
| GPT‑6.1 Sol | OpenAI | 2026-09-29 |
| GPT‑6.1 Terra | OpenAI | 2026-10-26 |
| Claude Sonnet 5.5 | Anthropic | 2026-09-28 |
| Claude Haiku 5.5 | Anthropic | 2026-10-07 |
| Gemini 4 Argon | Google | Announced 2026-09-30; API generally available 2026-10-13 |

These are catalog/gateway references only. They are not direct integrations or proof that a user key can invoke them. Provider APIs may be paid. The configured OpenAI test key/model passed configuration validation, but an actual inference request was blocked by zero billing balance/inactive billing; no model response is claimed.

Official sources: [OpenAI GPT‑6.1 Sol](https://openai.com/index/introducing-gpt-6-1-sol/), [OpenAI GPT‑6.1 Terra docs](https://developers.openai.com/api/docs/models/gpt-6.1-terra), [Anthropic model releases](https://www.anthropic.com/news/models), [Claude Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5), [Claude Haiku 5.5](https://www.anthropic.com/claude-haiku-5-5), [Google Gemini 4 Argon announcement](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/), and [Gemini API model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon).

### Personal AI products

Added OpenAI dots and Meta Muse as outbound links, explicitly marked as external products; neither is represented as executable inside HESSARA. See [OpenAI dots](https://openai.com/index/introducing-dots/) and [Meta Muse](https://ai.meta.com/muse/).

### Developer tools

Added SkillCorpus (Apache-2.0 repository; individual source skills can carry different licenses). The project requires its own retrieval/setup before it can be used. One candidate, TypeLLM, was deferred because its first public release in the target period could not be verified; its recent update alone did not qualify it as a new project. SkillCorpus references: [repository](https://github.com/EverMind-AI/SkillCorpus), [releases](https://github.com/EverMind-AI/SkillCorpus/releases), [license](https://github.com/EverMind-AI/SkillCorpus/blob/main/LICENSE), and [open release workflow issue](https://github.com/EverMind-AI/SkillCorpus/issues/19).

## Verification

- `npm test`: 559 tests; 554 passed, 0 failed, 5 skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; 26 static pages generated, with application and API routes compiled.
- `npm audit --audit-level=low` and `npm audit --omit=dev --audit-level=low`: both reported 0 registry advisories.
- The separate vendored-code scan still flags a Zod 4.1.11 marker embedded in transitive `@vercel/cli-config@0.3.1` (its source pins that Zod release). The current GitHub-reviewed advisory fixes the oversized-collection denial of service in Zod 4.6.6; however, this package is absent from the complete `.next` output and all server trace manifests, so it is not in this production build. It remains a local tooling dependency to revisit when Vercel publishes a patched bundle. [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [transitive dependency issue](https://github.com/colinhacks/zod/issues/6643).
- Reverse Engineering worker Python tests: 43 passed.
- Reverse Engineering sandbox bridge Node tests: 6 passed.
- Isolated `hessara-test` database verification: passed as `hessara_runtime`; owner-policy probe rolled back and confirmed 0 persisted fixture rows.
- Isolated `hessara-test` hosted stored-flow integration: passed, 7 checks. Authenticated both dedicated test accounts, verified owner isolation and honest RE availability, created and cleaned up its test project, and signed out. Report: `work/hosted-stored-flows-integration-2026-10-29T08-22-40-245Z-566e89aa01ba0b25.json`.
- `git diff --check`: passed (Git reported only configured LF-to-CRLF working-copy notices).
- OpenAI real inference: blocked by provider billing; no response was received.
- Reverse Engineering live execution: not run because the isolated Linux/Docker worker is not available.
- Browser visual smoke test: not completed. The integration server and its Node-based HTTP tests worked, but the in-app browser could not reach the local listener (`Page.navigate` timed out). Build/test results are not presented as visual verification.

## Deployment and remaining actions

Production deployment must only include this reviewed change set. The Supabase archive migration remains unapplied. To make RE engines genuinely available, provision the isolated worker, set its deployment credentials and allowlists, pin images, run real safe-sample benchmarks, and then enable verified engines. To enable OpenAI chat, activate provider billing and run the bounded real inference/integration checks. External product catalog links remain outbound links.
