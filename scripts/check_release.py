#!/usr/bin/env python3
"""Protect the shipped sorting and diagnostics baseline before frontend releases."""

import argparse
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASELINES = (
    "9a88dbfbd1fa8ed79bcb90f68192e937d5e34941",  # Shipped diagnostics frontend.
    "846c64b1f5f414cc38a0b5870529dcebf2c65666",  # Shipped sorting frontend.
)
REQUIRED = {
    "src/features/authFiles/AuthFilesPage.tsx": ("sortAuthFilesPageByQuota(datePageItems", "weeklyRemainingPercent"),
    "src/features/authFiles/logic.ts": ("createdAtMs", "sortAuthFilesPageByQuota"),
    "src/features/quota/QuotaPage.tsx": ("weeklyRemainingPercent", "unloadedQuotaEntries"),
    "src/features/quota/weeklyRemaining.ts": ("weeklyRemainingPercent",),
    "src/features/authFiles/components/AuthFileDetailsSheet.tsx": ("<AuthFileDiagnostics",),
    "src/services/api/authFiles.ts": ("'/auth-files/proxy-test'", "'/auth-files/model-test'", "createdAtMs"),
    "tests/authFileDiagnostics.test.ts": ("testProxy", "testModel"),
    "tests/weeklyRemaining.test.ts": ("sortQuotaEntries",),
    "tests/authFilesListLogic.test.ts": ("sortAuthFilesPageByQuota", "createdAtMs"),
}


def check_source(require_history=False):
    shallow = subprocess.check_output(["git", "rev-parse", "--is-shallow-repository"], cwd=ROOT, text=True).strip() == "true"
    if shallow and require_history:
        raise ValueError("Release ancestry requires a full Git checkout")
    if shallow:
        print("NOTE: shallow CI checkout; checking feature contracts and tests. Release builds require full history.")
    for baseline in () if shallow else BASELINES:
        result = subprocess.run(["git", "merge-base", "--is-ancestor", baseline, "HEAD"], cwd=ROOT)
        if result.returncode:
            raise ValueError("Frontend must inherit both shipped sorting and diagnostics commits")
    for path, markers in REQUIRED.items():
        source = (ROOT / path).read_text()
        if any(marker not in source for marker in markers):
            raise ValueError("Required shipped feature or regression test missing: " + path)


def check_artifact(path):
    html = path.read_text()
    for marker in ("/auth-files/proxy-test", "/auth-files/model-test", "添加时间从新到旧 · 页内周剩余额度降序", "每周剩余额度降序"):
        if marker not in html:
            raise ValueError("Built frontend is missing a shipped feature marker")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", type=Path)
    parser.add_argument("--require-history", action="store_true", help="Require complete Git history for production releases")
    args = parser.parse_args()
    try:
        check_source(args.require_history)
        if args.artifact:
            check_artifact(args.artifact)
    except (OSError, ValueError) as error:
        print("BLOCKED: " + str(error))
        return 1
    print("PASS: shipped frontend ancestry, sorting, diagnostics and regression coverage retained")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
