# Optional Sandbox control preflight

This standalone tool inspects one isolated host. It is **not** an analysis engine,
does not claim/modify HESSARA jobs, and never changes an engine feature flag.
The main Next.js application has no new dependency on it.

Pinned SDK: `@vercel/sandbox@3.8.0`; its installed declarations/source were checked
for `Sandbox.create`, `runCommand.timeoutMs`, `stop`, OIDC resolution, and bounded
first-page `Sandbox.list`. `package-lock.json` records exact dependency integrity.

## Run contract

From the HESSARA project directory:

```powershell
# Local only. No credentials required and no cloud resource created.
node reverse-engineering-worker/sandbox/bridge.mjs probe

# Read-only first page of Sandbox metadata. No create/resume.
node .npm-cache/_npx/69f9afb961c37556/node_modules/vercel/dist/index.js env run --global-config .vercel/cli --scope hessaalzahranisa-4663s-projects --non-interactive -- node reverse-engineering-worker/sandbox/bridge.mjs list

# Explicitly allocate at most one VM after verifying this target remains Hobby.
node .npm-cache/_npx/69f9afb961c37556/node_modules/vercel/dist/index.js env run --global-config .vercel/cli --scope hessaalzahranisa-4663s-projects --non-interactive -- node reverse-engineering-worker/sandbox/bridge.mjs probe --run --confirmed-plan hobby --save
```

The existing linked project and CLI credentials are used by `vercel env run` to
provide OIDC in memory. No auth-file extraction, environment dump, or token output
is implemented. Do not add `--debug`. Alternatively invoke the Node tool with
server-side `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID`; these must
match the explicit target. The SDK automatically resolves a supplied OIDC token.

The fixed create request is:

```json
{
  "image": "vercel/sandbox/universal",
  "resources": { "vcpus": 1 },
  "timeout": 300000,
  "persistent": false,
  "networkPolicy": "deny-all",
  "ports": [],
  "env": {},
  "tags": { "application": "hessara-re", "purpose": "host-preflight" }
}
```

This requests 2 GB RAM under the documented per-vCPU allocation. Controller
credentials stay outside the VM; no platform/DB/model credentials are sent to it.
Only our fixed Python diagnostic is uploaded. It reads OS, cgroup and storage
metadata; probes Docker binary/daemon availability without starting/installing
anything; and attempts a fixed credential-free request to `https://example.com/`
to observe deny-all behavior. A failed connection alone is not proof of firewall
enforcement. The command has a server-enforced 30-second deadline; the VM always
receives a stop request in `finally` with a bounded control-call timeout. Even
after controller failure, its non-extendable five-minute session deadline remains.

`--save` writes only the sanitized report in ignored `sandbox/reports/`.
`readyForAnalysis` always remains false: a successful host probe is not a Docker
hardening test, engine execution, image attestation, or benchmark. If Docker is
absent/unreachable, stop there and report it; this tool will not relax isolation
or download packages behind the operator’s back.

## Next gates

1. Verify account plan and remaining allowance before creating a VM. Hobby has
   bounded free use and pauses on exhaustion; Pro is usage billed. The command’s
   `--confirmed-plan hobby` is an operator assertion, not a billing query.
2. Test cgroup/tmpfs/PID/network/non-root enforcement using a harmless container
   on a separately reviewed bootstrap host. The default image may lack Docker.
3. Build and pin REA only, retain licensing notices, run the existing safe fixture,
   then test timeout/cancellation/OOM/recovery before enabling one engine.
4. Keep persistent queue/leases, ownership, evidence storage, and reporting in the
   existing platform; do not use an idle Sandbox as a permanent worker daemon.

Read-only CLI account/session checks, using the same explicit scope:

```powershell
node .npm-cache/_npx/69f9afb961c37556/node_modules/vercel/dist/index.js api /v2/teams/team_KWMzPo9tlEHDHXf9GtDWMHjb --method GET --global-config .vercel/cli --scope hessaalzahranisa-4663s-projects --non-interactive
node .npm-cache/_npx/69f9afb961c37556/node_modules/vercel/dist/index.js api '/v2/sandboxes/sessions?project=prj_0BKAEr63mDG1XO2r5vtZP2bcT0tZ&limit=5' --method GET --global-config .vercel/cli --scope hessaalzahranisa-4663s-projects --non-interactive
```

Filter team output to billing plan/status before showing it. These endpoints do
not establish remaining Sandbox quota. No stable documented remaining-quota API
was found in this review; consult the project/team Usage dashboard instead of
inventing a quota value. Listing sessions is not equivalent to total billed use.

Sources: [SDK](https://vercel.com/docs/sandbox/sdk-reference),
[authentication](https://vercel.com/docs/sandbox/concepts/authentication),
[CLI environment execution](https://vercel.com/docs/cli/env#running-commands-with-environment-variables),
[Docker support/security model](https://vercel.com/docs/sandbox/concepts#security-model),
[pricing and quotas](https://vercel.com/docs/sandbox/pricing).

## Actual preflight record: 2026-10-18

The target team was verified as Hobby. An initial stale local OIDC context caused
authentication failure before any VM was created. The authenticated CLI refreshed
credentials into an ignored file (no token output), then the probe succeeded:

```powershell
node .npm-cache/_npx/69f9afb961c37556/node_modules/vercel/dist/index.js env pull .vercel/re-sandbox.env --environment=development --yes --global-config .vercel/cli --scope hessaalzahranisa-4663s-projects --non-interactive
node --env-file=.vercel/re-sandbox.env reverse-engineering-worker/sandbox/bridge.mjs probe --run --confirmed-plan hobby --save
```

Observed: allocated 1 vCPU/2048 MB, Linux x86_64, UID1000, no controller credentials
inside the VM, memory cgroup limit 2147483648 bytes, outbound connection failed,
Docker binary absent and daemon unreachable. The VM was stopped successfully;
a subsequent read-only list confirmed `stopped` and `persistent:false`. No engine
ran, image was installed, job accepted or flag activated. The host preflight is
not evidence of Docker hardening or production analysis capacity. Six controller
tests passed, including safe error classification; production app dependencies
remain unchanged.
