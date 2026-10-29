# HESSARA isolated reverse-engineering workers

Last reviewed: 2026-10-18. This directory contains executable integration code,
not evidence of installed or operational engines. **All seven engines are disabled.**
The current Windows environment has no Docker runtime or dedicated Linux server.
No uploaded artifact or native tool was executed on the application server or this
host. A real REA end-to-end run and per-engine benchmarks remain pending. The
platform continues to work when this supervisor is absent.

## Execution boundary

```text
Next.js authenticated API + existing Postgres queue + private object storage
              | HTTPS claim / lease heartbeat / complete / fail
Dedicated Linux host: trusted Python supervisor (one slot)
              | Docker create/start/rm with fixed argument arrays
One disposable non-root engine container, read-only input, NO network
              | bounded JSON observations; no platform token or Docker socket
Existing results/evidence/report persistence and paginated web workspace
```

The supervisor never parses ZIP, ASAR or executable structures. It downloads only
from an explicit HTTPS storage-host allowlist, rejects redirects, verifies byte
length and SHA-256, then mounts a generated fixed filename read-only. All format
inspection/decompression occurs inside the resource-constrained engine container.

Each container has: UID/GID 10001, all Linux capabilities dropped, no-new-privileges,
network none, read-only root, bounded noexec/nodev/nosuid tmpfs, memory+swap equal,
CPU quota, PID/open-file/core limits and a hard external wall-clock deadline.
No target is launched natively. The only symbolic execution lane is explicit,
bounded angr simulation. There is no arbitrary command/MCP/shell API.

The dedicated supervisor's Docker group can control that dedicated host. Keep the
application/DB and unrelated workloads off it. Enable a current patched kernel,
Docker seccomp/AppArmor and rootless Docker or user namespace remapping where
supported. Containers share a kernel: this is not a claim of VM-grade isolation.
For public untrusted workloads, validate a gVisor/Kata runtime before rollout and
add its approved `--runtime` option to the trusted supervisor configuration.

## Verified upstream interfaces and implementation scope

| Engine | Implemented real invocation | Current adapter limits |
| --- | --- | --- |
| REA | `rea analyze-javascript-application /work/application --json`, or supplied ASAR | Static JS archive/ASAR only; no browser/device/PTY/native agent tools or model credentials. CLI evidence is preserved as a bounded view. |
| Ghidra | `support/analyzeHeadless` + our `HessaraExport.java` post-script | ELF/PE/Mach-O supported by installed loaders. Functions, original strings, external libraries and at most 40 decompiled C views. |
| MobSF | Fresh container-local API: `/api/v1/upload`, `/api/v1/scan`, `/api/v1/report_json` | APK static scan only; ephemeral SQLite is tool-internal scratch, not a second platform DB. API binds loopback, no published ports; no network intelligence, device or dynamic analysis. |
| JADX | `jadx --no-res --threads-count 1 --output-dir /work/jadx /input/artifact` | APK/DEX/JAR/AAB; Java source/file navigation, bounded heuristic method-line navigation, no runtime execution. |
| Rizin | Fixed `ij`, `aaa;aflj`, `isj`, `izj`, `iij` JSON queries | ELF/PE/Mach-O/DEX; metadata, functions, symbols, original strings/imports. No user commands, debugger or decompiler plugin. |
| angr | Python `Project(auto_load_libs=False)`, `CFGFast`, optional `simulation_manager.step` | ELF/PE; <=50 steps, <=8 retained states, 32 instructions/step, strict outer timeout. Coverage is explicitly incomplete. |
| radare2 | Same fixed JSON-query set using `r2` | ELF/PE/Mach-O/DEX; no debugger, scripts, user command text, plugins or target execution. |

Static tools can be vulnerable while parsing malicious inputs. These constraints
are enforced even for static-only jobs. ZIP policy: <=10,000 members, <=64 MiB per
member, <=256 MiB expanded total, <=100:1 expansion; no traversal, Windows absolute
paths, symlinks, duplicates or encrypted members. No automatic dependency installs
or package scripts occur during a job.

Result JSON is capped below 2 MiB with <=1,000 records/collection. Code views are
<=64 KiB/file; JADX exports at most 100 files / 1 MiB. Large output causes an honest
limit error or explicitly labelled truncation, never a complete-coverage claim.
The API persists only bounded metadata; large retained codebases need the separate
object-storage upload extension before increasing these view budgets.

## Build on the future dedicated Linux host

No images are downloaded, built, published or activated automatically. Build
arguments intentionally have no implicit `latest` version. The operator must pin
base images by SHA-256, exact upstream release versions/source commits and release
ZIP hashes. Review advisories and licenses for that specific distribution first.
Examples use shell variables the operator fills from verified release metadata.

```sh
# From this directory. BASE must be a compatible approved image@sha256:digest.
docker build -f containers/rea.Dockerfile --build-arg NODE_BASE="$NODE_BASE" --build-arg REA_VERSION="$REA_VERSION" -t hessara-rea:reviewed .
docker build -f containers/ghidra.Dockerfile --build-arg JAVA_BASE="$JAVA_BASE" --build-arg GHIDRA_RELEASE_TAG="$GHIDRA_RELEASE_TAG" --build-arg GHIDRA_ARCHIVE="$GHIDRA_ARCHIVE" --build-arg GHIDRA_SHA256="$GHIDRA_SHA256" -t hessara-ghidra:reviewed .
docker build -f containers/jadx.Dockerfile --build-arg JAVA_BASE="$JAVA_BASE" --build-arg JADX_VERSION="$JADX_VERSION" --build-arg JADX_SHA256="$JADX_SHA256" -t hessara-jadx:reviewed .
docker build -f containers/rizin.Dockerfile --build-arg PYTHON_BASE="$PYTHON_BASE" --build-arg SOURCE_COMMIT="$RIZIN_COMMIT" -t hessara-rizin:reviewed .
docker build -f containers/radare2.Dockerfile --build-arg PYTHON_BASE="$PYTHON_BASE" --build-arg SOURCE_COMMIT="$RADARE2_COMMIT" -t hessara-radare2:reviewed .
docker build -f containers/angr.Dockerfile --build-arg PYTHON_BASE="$PYTHON_BASE" --build-arg ANGR_VERSION="$ANGR_VERSION" -t hessara-angr:reviewed .
docker build -f containers/mobsf.Dockerfile --build-arg MOBSF_BASE="$MOBSF_BASE" -t hessara-mobsf:reviewed .
```

REA requires Node >=22.19/24.11 according to the current upstream package. Current
Ghidra development docs require JDK25; select the JDK required by the exact release
chosen, rather than assuming all Ghidra releases accept the same JDK. JADX needs a
compatible Java runtime. Rizin/radare2 build stages need network access to obtain
source/subdependencies; runtime containers do not. MobSF's read-only offline
startup and its bundled tool locations must pass the test gate for the chosen
image. If startup attempts downloads or writes outside tmpfs, retain unavailable
status and fix the image during build, never relax runtime network/filesystem policy.

Package managers install upstream dependencies during image construction. These
Dockerfiles are deployment recipes, not a locked reproducible supply-chain proof.
Capture full npm/pip/transitive locks, an SBOM, scanner report, build provenance,
source archive and final image digest before promoting a build. Do not distribute
container images while the applicable attribution/source obligations are unresolved.

## Deployment and activation gates

1. Provision an already-authorized dedicated Linux host; no host was purchased or
   provisioned by this implementation. Start with one worker slot globally. Reserve
   at least 1 GiB RAM beyond the selected engine's memory cap and >=1 GiB free
   artifact spool disk. The supervisor rejects work when these observed resources
   are unavailable. These are conservative policy limits, not benchmark results.
2. Build/test one engine at a time. Start REA with `fixtures/make_safe_sample.py`
   (our own source, no external download) and Ghidra with a small binary compiled
   from code owned by the operator. Validate all observations against that source.
   Use the `hardening()` argument builder for test containers as well. No test may
   run the submitted target as a host executable.
3. Record p50/p95 runtime, CPU utilization, peak RAM, queue wait, scratch/storage
   usage, restart count and failure rate for each pinned digest. Verify real
   cancellation, timeout, OOM, output/disk exhaustion, corrupt archives, forced
   worker restart, lost lease/control connection, duplicate job and queue saturation.
   Confirm terminal jobs release containers and storage, and platform health stays
   responsive while workers fail. No measured values are available yet.
4. Copy `.env.example` to `/etc/hessara-re-worker.env`, permissions0600. Supply the
   shared server worker token, exact platform origin and storage host allowlist.
   Keep platform bearer and any service-role/AI credentials off engine containers.
5. Copy `engines.json` to `/etc/hessara-re-engines.json`. For the first verified
   engine only, set its final `repository@sha256:digest`, `benchmarkApproved:true`
   and `enabled:true`. Config is operator-owned0600; no uploaded artifact can edit
   it. Set its owner to the dedicated service user `hessara-re` (or provide an
   equivalent restricted readable group); a root-owned `0600` config cannot be
   read by the service's non-root user. The root-owned `0600` environment file is
   read by systemd itself. Confirm `/opt/.../engine.py --health` inside the hardened image returns an
   actual version. Health probes are cached for60seconds.
6. Install `hessara-re-worker.service`, set the dedicated service account's minimum
   Docker access and start it. Supervisor polls the persistent API queue. An engine
   must also be enabled by the platform administrator feature flag; a worker never
   enables a platform flag. Leave job intake closed until the operator is ready
   for the controlled first E2E test; an administrator must then enable that one
   engine and briefly open intake so the test job can actually be created.
7. Verify an authorized user's actual upload → persisted queued job → real container
   → findings/evidence → report, a second user's denied access and browser refresh
   recovery. Close intake again immediately if the test fails. After it passes,
   keep only that engine enabled for a limited rollout. Repeat for Ghidra,
   MobSF/JADX, Rizin/radare2, finally angr.

The systemd unit caps the trusted supervisor to512MiB/50%CPU; Docker engine cgroups
are separate and each job has its own limits. The engine process cannot access the
Docker socket. Docker's default log driver is disabled for job containers to avoid
unbounded daemon log files; both stdout/stderr are drained under byte caps. Every
job's container is forcibly removed before terminal completion/failure is reported.
Unverified cleanup stops the supervisor. Startup removes only its own labelled
orphan containers. Three control failures open a circuit with bounded backoff and
jitter; analysis itself is never blindly retried.

## Worker API contract

All calls: `POST /api/reverse-engineering/worker`, Bearer
`HESSARA_RE_WORKER_TOKEN`. HTTPS only; redirects forbidden.

- `claim`: `{workerId,engines:[{id,version?,healthy,enabled,capacity,capabilities,reason?}],capacity:{slots:1,cpuCount,availableMemoryMb,diskFreeMb}}`
  → `{job:null}` or `{job:{id,engineId,artifact:{id,downloadUrl,sha256,sizeBytes,format,name},options,timeoutSeconds},leaseToken,leaseSeconds}`.
- `heartbeat`: `{workerId,jobId,leaseToken,stage,metrics,logs?}` → `{cancelRequested}`.
- `complete`: `{workerId,jobId,leaseToken,result:{engineId,engineVersion,summary,findings,evidence,functions,strings,dependencies,files,limitations,metrics}}`.
- `fail`: `{workerId,jobId,leaseToken,code,message,retryable:false}`.

The API, not the worker, is authoritative for ownership, flags, quotas, idempotency,
queue admission, lease/deadline fencing, retries/dead-letter states and persistence.
Only a server-signed artifact URL is added to a claimed job. The worker sends no
platform credentials with that storage request. Stage updates are real stages,
never invented percentages. A heartbeat failure terminates the current container.

## Tests and actual status

```sh
python3 -B -m unittest discover -s tests -v
python3 supervisor.py --once
```

2026-10-18: **32 unit/contract/security tests passed** on Python3.14 Windows.
They exercise content detection, unsafe/corrupt/expansion archives, HTTPS origin
policy, digest/size mismatch, immutable image requirement, hardening, literal
subprocess arguments, cancellation/timeout, output/result caps and fixed adapter
commands and the Ghidra string-publication option. Tool output in adapter contract tests is an explicitly mocked fixture.
`supervisor.py --once` correctly refused this unsupported host. Python syntax
compilation passed. **No Docker image build, real engine execution, integration
benchmark, OOM/load test, or production-readiness claim has been made.**

## Official references and redistribution review

| Project | Primary documentation studied | License review for packaging |
| --- | --- | --- |
| REA | [repository](https://github.com/morluto/rea), [CLI](https://github.com/morluto/rea/blob/main/docs/cli.md), [MCP contracts](https://github.com/morluto/rea/blob/main/docs/mcp-contracts.md), package metadata | MIT authored code; retain LICENSE and [third-party notices](https://github.com/morluto/rea/blob/main/THIRD_PARTY_NOTICES.md). Commercial native providers are not bundled or licensed by this integration. |
| Ghidra | [repository/JDK requirements](https://github.com/NationalSecurityAgency/ghidra), [headless analysis docs](https://github.com/NationalSecurityAgency/ghidra/blob/master/Ghidra/RuntimeScripts/Common/support/analyzeHeadlessREADME.html) | [Apache2.0](https://github.com/NationalSecurityAgency/ghidra/blob/master/LICENSE); retain notices and bundled component licenses in the chosen release. |
| MobSF | [repository](https://github.com/MobSF/Mobile-Security-Framework-MobSF), [documented API routes](https://github.com/MobSF/Mobile-Security-Framework-MobSF/blob/master/mobsf/MobSF/urls.py), API views, Dockerfile/startup/settings | [GPL 3](https://github.com/MobSF/Mobile-Security-Framework-MobSF/blob/master/LICENSE); preserve license/source obligations for distributed images plus bundled component terms. |
| JADX | [repository/CLI](https://github.com/skylot/jadx) | [Apache2.0](https://github.com/skylot/jadx/blob/master/LICENSE); retain license/notices of distribution and dependencies. |
| Rizin | [repository/build/formats](https://github.com/rizinorg/rizin), [book](https://book.rizin.re) | [LGPL 3](https://github.com/rizinorg/rizin/blob/dev/COPYING.LESSER) plus [GPL 3](https://github.com/rizinorg/rizin/blob/dev/COPYING) components; preserve both and review per-file/dependency terms for the pinned build. |
| angr | [repository](https://github.com/angr/angr), [simulation manager](https://docs.angr.io/en/latest/core-concepts/pathgroups.html) | [BSD2-Clause](https://github.com/angr/angr/blob/master/LICENSE); retain notices; separate dependencies such as solver/VEX have their own terms. |
| radare2 | [repository/build/JSON capabilities](https://github.com/radareorg/radare2), [usage](https://github.com/radareorg/radare2/blob/master/USAGE.md) | [LGPL 3 with per-plugin exceptions](https://github.com/radareorg/radare2/blob/master/COPYING.md); inspect bundled plugin licenses; no optional plugin packages are installed. |

No upstream binaries or new container images are distributed in this repository.
This compatibility record is a technical source inventory, not a blanket license
clearance for future image contents. Revalidate the exact dependency inventory
when choosing image digests.

## Successful sample analysis is now a separate activation requirement

`--health`, a nonblank version and `benchmarkApproved:true` cannot by themselves
make an engine available. Each enabled engine needs `verificationReport` set to
an absolute operator-owned JSON path. The report must match the immutable image,
the current CLI version and a successful real analysis assertion profile. It is
rechecked when accepting a lease. The API captures the verified version/image at
claim time and rejects completion from a different version. Reports are trusted
operator records, not protection against a compromised administrator/worker.

On the isolated Linux Docker host, after building the pinned image:

```sh
# Bundled deterministic, harmless JavaScript application; never executes its code.
python3 -B verify_engine.py --engine rea --config /etc/hessara-re/engines.json --output /var/lib/hessara-re/rea-verification.json

# Other engines require your own authorized safe fixture and a known symbol,
# recovered class, or application package expected in the actual result.
python3 -B verify_engine.py --engine rizin --config /etc/hessara-re/engines.json --fixture /opt/hessara-fixtures/owned-sample.elf --format elf --expect-name main --authorization-confirmed --output /var/lib/hessara-re/rizin-verification.json
```

The command supports all seven engine adapters, bounded execution, expected
result assertions and verified container removal before writing a passed report.
It does not enable an engine, overwrite a prior report or approve throughput.
For Ghidra/angr/radare2 use a small owned native fixture; for JADX/MobSF use an
owned Android fixture with a known class/package. Format detection remains inside
the container. Every format/option advertised for a rollout needs its own coverage;
one passing sample is not a production, load, OOM or cancellation certification.
Keep benchmark approval and platform flags closed until those separate gates pass.

Host CPU/RAM/disk observations now accompany each execution heartbeat. An old
worker that omits measurements can maintain its lease, but advertises no spare
capacity. Public engine health returns stable reason codes and aggregate running
counts, never another user's identifiers or private registry names.

## Optional Vercel Sandbox path — real host preflight only

See [the isolated Sandbox controller](sandbox/README.md). A real Hobby-plan
preflight on 2026-10-18 created one nonpersistent 1-vCPU/2-GB Linux VM with no
ports, no controller credentials and deny-all networking, then successfully
stopped it. The egress test failed as expected and the memory cgroup limit was
2,147,483,648 bytes. **Docker was absent**, so the existing Docker supervisor
could not execute an engine there. No analysis or engine activation occurred.

Sandbox supports a future trusted Docker bootstrap/custom image, but that path
still needs daemon/cgroup hardening verification, immutable engine images,
durable dispatch and lifecycle/resource benchmarks. This preflight does not
replace those requirements or establish remaining account quota. No paid plan
or resource upgrade was made. The ordinary Vercel application functions remain
control-plane endpoints and never execute uploaded applications.

## 24 October 2026: precise readiness and upstream REA scope

Run `python3 -B doctor.py` on the proposed worker to obtain a read-only prerequisite report. It never starts Docker or an artifact, emits no secret/URL/private image/report path, and cannot certify analysis readiness. Exit1 means prerequisites are missing; currentWindows correctly reports Linux/Docker and configuration gates.

Platform availability now retains only allowlisted worker blockers such as IMAGE_UNPINNED/BENCHMARK_REQUIRED instead of replacing every missing-version observation with VERSION_UNVERIFIED. The tools UI gives localized administrator-resolution disclosures without weakening activation gates.

REA 6.7.0 produced genuine local static evidence for an owned developer fixture on 24 October, with explicit partial graph/semantic coverage. This is not an isolated platform job or verificationReport. The adapter now preserves upstream limitations and separate coverage evidence even if its raw 64 KiB view truncates, classifies derived/partial findings as inference, and rejects malformed/empty output.43 Python worker contracts and7 Node availability checks passed. See `../docs/RE-INTEGRATION-REPAIR-2026-10-24.md` for actual evidence and all remaining external gates. No engine was enabled.
