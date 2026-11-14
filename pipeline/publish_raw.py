"""Publish the untouched NASA PSI experimental tables next to the app.

The web app shows the original NASA row behind any test point ("source receipt"),
so the raw CSVs are copied byte-for-byte into app/public/raw/<PSI-ID>/<file name>.
Run from the project root after harvest.py:  python pipeline/publish_raw.py
"""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "raw" / "tables"
TARGET = ROOT / "app" / "public" / "raw"


def main() -> None:
    if TARGET.exists():
        shutil.rmtree(TARGET)
    TARGET.mkdir(parents=True)
    index = []
    for path in sorted(SOURCE.glob("*/*")):
        if not path.is_file() or path.suffix.lower() not in {".csv", ".txt"}:
            continue
        investigation = path.parent.name
        destination = TARGET / investigation / path.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
        data = path.read_bytes()
        index.append({
            "investigation": investigation,
            "file": path.name,
            "path": f"raw/{investigation}/{path.name}",
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        })
    (TARGET / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
    print(f"Published {len(index)} raw PSI tables to {TARGET.relative_to(ROOT)} ({sum(item['bytes'] for item in index):,} bytes).")


if __name__ == "__main__":
    main()
