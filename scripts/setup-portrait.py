"""Install the pinned local portrait engine. No portraits/audio leave this machine."""

import concurrent.futures
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import urllib.request
import zipfile


PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT / ".state/portrait-runtime"
SPEC = json.loads((PROJECT / "config/portrait-runtime.json").read_text())


def sha(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            result.update(block)
    return result.hexdigest()


def download(item):
    path = ROOT / "checkpoints" / item["path"]
    if path.is_file() and path.stat().st_size == item["size"] and sha(path) == item["sha256"]:
        print(f"Verified {item['path']}", flush=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    url = f"https://huggingface.co/{SPEC['modelRepository']}/resolve/{SPEC['modelRevision']}/{item['path']}"
    temporary = path.with_suffix(path.suffix + ".download")
    print(f"Downloading {item['path']} ({item['size'] / 1e6:.1f} MB)", flush=True)
    with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as output:
        while block := response.read(1024 * 1024):
            output.write(block)
    if temporary.stat().st_size != item["size"] or sha(temporary) != item["sha256"]:
        temporary.unlink(missing_ok=True)
        raise ValueError(f"Downloaded model checksum failed: {item['path']}")
    temporary.replace(path)
    print(f"Verified {item['path']}", flush=True)


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    url = f"https://codeload.github.com/antgroup/ditto-talkinghead/zip/{SPEC['sourceCommit']}"
    archive = urllib.request.urlopen(url, timeout=60).read()
    if hashlib.sha256(archive).hexdigest() != SPEC["sourceArchiveSha256"]:
        raise ValueError("Portrait engine source checksum failed")
    prefix = f"ditto-talkinghead-{SPEC['sourceCommit']}/"
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        for item in bundle.infolist():
            if item.is_dir():
                continue
            if not item.filename.startswith(prefix):
                raise ValueError("Unexpected portrait engine archive entry")
            relative = PurePosixPath(item.filename[len(prefix):])
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("Unsafe portrait engine archive entry")
            path = ROOT / "source" / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(bundle.read(item))
    if not (ROOT / "venv/bin/python").exists():
        subprocess.run(["uv", "venv", "--python", "3.12", str(ROOT / "venv")], check=True)
    subprocess.run([
        "uv", "pip", "install", "--python", str(ROOT / "venv/bin/python"),
        "-r", str(PROJECT / "config/portrait-requirements.txt"),
    ], check=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(download, SPEC["files"]))
    # Ready is written only after the runner can load the complete model stack.
    subprocess.run([
        str(ROOT / "venv/bin/python"), str(PROJECT / "src/media/portrait-runner.py"),
        "verify", str(ROOT),
    ], check=True)


if __name__ == "__main__":
    main()
