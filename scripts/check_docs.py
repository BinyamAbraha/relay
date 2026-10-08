"""Check repository documentation links, excluding untracked working notes."""

import argparse
import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--include-local", action="store_true", help="Also check local working notes"
)
args = parser.parse_args()
tracked = {
    (root / name).resolve()
    for name in subprocess.check_output(
        ["git", "ls-files", "-z"], cwd=root, text=True
    ).split("\0")
    if name
}
if args.include_local:
    files = [
        root / "README.md",
        root / "AGENTS.md",
        *sorted((root / "docs").rglob("*.md")),
    ]
    files = [
        p for p in files if p.is_file() and "private" not in p.relative_to(root).parts
    ]
else:
    files = sorted(
        p
        for p in tracked
        if p.suffix == ".md" and (p.name == "README.md" or root / "docs" in p.parents)
    )
checked = 0
for source in files:
    for target in re.findall(r"\]\(([^)]+)\)", source.read_text()):
        if "://" in target or target.startswith("#"):
            continue
        destination = (source.parent / target.split("#")[0]).resolve()
        if not destination.exists():
            raise SystemExit(f"Broken link in {source.relative_to(root)}: {target}")
        if (
            not args.include_local
            and destination not in tracked
            and not any(destination in p.parents for p in tracked)
        ):
            raise SystemExit(
                f"Untracked link target in {source.relative_to(root)}: {target}"
            )
        checked += 1
print(f"Validated {checked} relative links across {len(files)} documents.")
