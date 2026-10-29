"""Fixed, non-mutating diagnostic. Never installs tools or starts a daemon."""
import json
import os
import platform
import shutil
import subprocess
from pathlib import Path


def read_value(path):
    try:
        with open(path, encoding="utf-8") as stream:
            return stream.read(4096).strip()
    except OSError:
        return None


def command(arguments, timeout=5):
    try:
        result = subprocess.run(arguments, capture_output=True, timeout=timeout,
                                check=False, env={"PATH": os.environ.get("PATH", "")})
        return {"exitCode": result.returncode,
                "stdout": result.stdout[:8192].decode("utf-8", errors="replace")}
    except (OSError, subprocess.TimeoutExpired):
        return {"exitCode": None, "stdout": ""}


def main():
    docker = shutil.which("docker")
    info = command([docker, "info", "--format", "{{json .}}"], 8) if docker else None
    parsed = {}
    if info and info["exitCode"] == 0:
        try:
            data = json.loads(info["stdout"])
            parsed = {key: data.get(key) for key in (
                "ServerVersion", "CgroupDriver", "CgroupVersion", "SecurityOptions")}
        except (ValueError, TypeError):
            pass
    disk = shutil.disk_usage("/vercel/sandbox")
    memory = read_value("/proc/meminfo") or ""
    mem_total = next((int(line.split()[1]) * 1024 for line in memory.splitlines()
                      if line.startswith("MemTotal:")), None)
    sudo = shutil.which("sudo")
    sudo_result = command([sudo, "-n", "id", "-u"]) if sudo else None
    # Only a fixed public test URL is attempted. No credentials or artifact bytes.
    egress = command([shutil.which("python3") or "python3", "-c",
        "import json,urllib.request,urllib.error\n"
        "try:\n"
        " r=urllib.request.urlopen('https://example.com/',timeout=2)\n"
        " print(json.dumps({'outcome':'http_response','status':r.status}))\n"
        "except urllib.error.HTTPError as e:\n"
        " print(json.dumps({'outcome':'http_error_response','status':e.code}))\n"
        "except Exception:\n"
        " print(json.dumps({'outcome':'connection_failed'}))\n"], 4)
    try:
        network_observation = json.loads(egress["stdout"]) if egress["exitCode"] == 0 else {"outcome": "probe_timed_out_or_failed"}
    except ValueError:
        network_observation = {"outcome": "invalid_probe_response"}
    result = {
        "schemaVersion": 1,
        "operatingSystem": platform.system(),
        "architecture": platform.machine(),
        "kernel": platform.release(),
        "effectiveUid": os.geteuid(),
        "sudoAvailable": bool(sudo_result and sudo_result["exitCode"] == 0 and sudo_result["stdout"].strip() == "0"),
        "memoryTotalBytes": mem_total,
        "diskTotalBytes": disk.total,
        "diskFreeBytes": disk.free,
        "cgroups": {
            "version": 2 if Path("/sys/fs/cgroup/cgroup.controllers").exists() else 1,
            "controllers": read_value("/sys/fs/cgroup/cgroup.controllers"),
            "cpuMax": read_value("/sys/fs/cgroup/cpu.max"),
            "memoryMax": read_value("/sys/fs/cgroup/memory.max"),
            "pidsMax": read_value("/sys/fs/cgroup/pids.max"),
        },
        "docker": {"binaryPresent": bool(docker),
                   "daemonReachable": bool(info and info["exitCode"] == 0),
                   "server": parsed},
        "controllerCredentialsPresent": any(os.environ.get(key) for key in (
            "VERCEL_OIDC_TOKEN", "VERCEL_TOKEN", "HESSARA_RE_WORKER_TOKEN",
            "SUPABASE_AUTH_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY")),
        "expectedNetworkPolicy": "deny-all",
        "networkObservation": network_observation,
        "engineExecutionPerformed": False,
        "containerHardeningVerified": False,
    }
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
