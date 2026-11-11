"""Reproduce schema, local assets, prototype DOM, ID protection and workspace checks."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
from collections import Counter
import csv
import hashlib
import html
import json
import re
import subprocess
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parents[1]
ID_HASH = "bd5e351b64e584eef0260f078d436280bf9bf4bca06a52eb0c69f47bbe86dfd0"


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.links, self.ids = [], set()
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if "id" in values:
            self.ids.add(values["id"])
        self.links += [values[k] for k in ("href", "src") if k in values]


def run(*args):
    return subprocess.run(args, cwd=REPO, check=True, capture_output=True, text=True).stdout.strip()


def main():
    records = []
    try:
        matrix = json.loads((ROOT / "feature-matrix.json").read_text())
        rows = matrix["features"]
        ids = sorted(r["feature_id"] for r in rows)
        assert len(rows) == len(set(ids)) == 311
        assert hashlib.sha256("\n".join(ids).encode()).hexdigest() == ID_HASH
        kinds = {"user-facing", "expert-facing", "internal-capability", "experimental", "compatibility-contract"}
        changes = {"原样保留", "菜单重组", "增强", "错误修复", "内部兼容", "拟删除/降级"}
        assert {r["classification"] for r in rows} == kinds
        assert all(r["change_type"] in changes and r["change_type"] != "拟删除/降级" for r in rows)
        assert all(r["acceptance_method"] and r["acceptance_state"] == "not-run" for r in rows)
        assert matrix["runtime_parity_gate"] == "not-run" and matrix["proposed_removals"] == "NONE"
        assert all("无独立菜单" in r["target_kind"] for r in rows if r["classification"] in {"internal-capability", "compatibility-contract"})
        assert all((REPO / r[key]).is_file() for r in rows for key in ("source", "caller"))
        with (ROOT / "feature-matrix.csv").open(encoding="utf-8-sig", newline="") as stream:
            assert list(csv.DictReader(stream)) == [{k: str(v) for k,v in row.items()} for row in rows]
        records.append({"check": "311-ID/schema/classification/CSV/source-paths", "status": "passed",
                        "classifications": dict(Counter(r["classification"] for r in rows)),
                        "change_types": dict(Counter(r["change_type"] for r in rows)), "id_set_sha256": ID_HASH})
        p0_text = (ROOT / "p0-work-units.md").read_text()
        units = re.findall(r"^## P0-([A-G]) · (.*?)\n(.*?)(?=^## |\Z)", p0_text, re.M | re.S)
        assert [unit[0] for unit in units] == list("ABCDEFG")
        assert {re.search(r"F0[1-7]", unit[1]).group() for unit in units} == {f"F0{i}" for i in range(1, 8)}
        assert all(re.findall(r"^(\d+)\. ", unit[2], re.M) == [str(i) for i in range(1, 11)] for unit in units)
        refs = re.findall(r"`([A-Z][A-Za-z0-9-]+-\d{3})(?:–(\d{3}))?`", p0_text)
        for start, end in refs:
            if end:
                prefix, first = start.rsplit("-", 1)
                assert int(end) >= int(first)
                assert all(f"{prefix}-{i:03}" in ids for i in range(int(first), int(end)+1)), start
            else:
                assert start in ids, start
        records.append({"check": "P0-F01-F07/ten-field-contracts/feature-references", "status": "passed",
                        "units": len(units), "references": len(refs)})
        links = 0
        html_files = list(ROOT.rglob("*.html"))
        for file in html_files:
            page = Page(file.read_text())
            for link in page.links:
                url = urlsplit(link)
                if url.scheme or url.netloc:
                    continue
                target = (file.parent / unquote(url.path)).resolve() if url.path else file
                assert target == ROOT or ROOT in target.parents, (file.name, "outside-delivery")
                # The result file is created at the end of this first verification run.
                assert target.exists() or target == ROOT / "review-checks.json", (file.name, link)
                if url.fragment and target.suffix == ".html":
                    assert url.fragment in Page(target.read_text()).ids, (file.name, link)
                links += 1
        for file in ROOT.rglob("*.md"):
            for link in re.findall(r"\[[^\]]+\]\(([^)]+)\)", file.read_text()):
                url = urlsplit(link)
                if url.scheme or url.netloc:
                    continue
                target = (file.parent / unquote(url.path)).resolve() if url.path else file
                assert target == ROOT or ROOT in target.parents, (file.name, "outside-delivery")
                assert target.is_file(), (file.name, link)
                if url.fragment and target.suffix == ".html":
                    assert url.fragment in Page(target.read_text()).ids, (file.name, link)
                links += 1
        matrix_html = (ROOT / "feature-matrix.html").read_text()
        for row in rows:
            assert f'<td>{row["feature_id"]}</td>' in matrix_html
            search = " ".join(str(v) for v in row.values())
            assert f'data-search="{html.escape(search, quote=True)}"' in matrix_html
        records.append({"check": "local-links/assets/anchors/HTML-matrix-equality", "status": "passed", "links": links})
        run("node", "--check", str(ROOT / "assets/report.js"))
        run("node", "--check", str(ROOT / "prototype/assets/prototype.js"))
        dom = json.loads(run("node", str(ROOT / "assets/verify-dom.cjs")))
        records.append({"check": "matrix-and-prototype-dom", **dom})
        run("git", "diff", "--check")
        run("git", "diff", "--exit-code", matrix["baseline_sha"], "--", ".", ":(exclude)reviews/workbench-v3")
        run("git", "check-ignore", "docs/diagnostic-workbench-design-2026-11-10.md")
        records.append({"check": "production-baseline/whitespace/docs-ignore", "status": "passed",
                        "head": run("git", "rev-parse", "HEAD"), "production_changes": "NONE"})
        files = sorted(p for p in ROOT.rglob("*") if p.is_file() and p.name != "review-checks.json")
        allowed = {".md", ".html", ".css", ".js", ".cjs", ".py", ".json", ".csv"}
        digest = hashlib.sha256()
        for file in files:
            assert file.suffix in allowed
            data = file.read_bytes()
            text = data.decode("utf-8-sig")
            assert not re.search(r"/(?:Users|home)/[A-Za-z0-9._-]+/|file:[/]{3}|context:[/]{2}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", text)
            assert not re.search(r"https?://[^\s<>\"']+\?(?:[^\s<>\"']*&)?(?:token|api_key|password|access_token)=", text, re.I)
            assert all(line == line.rstrip() for line in text.splitlines())
            digest.update(file.relative_to(ROOT).as_posix().encode() + b"\0" + data + b"\0")
        records.append({"check": "public-delivery/file-allowlist/sensitive-patterns/whitespace", "status": "passed",
                        "files": len(files), "payload_sha256": digest.hexdigest(),
                        "boundary": "Synthetic prototype; heuristic scan plus scoped artifact review, not a universal secret detector."})
        status = "passed"
    except Exception as error:
        status = "failed"
        # Only report structural validation errors, never user files or environment values.
        records.append({"check": "verification-stopped", "status": "failed", "error_type": type(error).__name__})
    result = {"checked_at_utc": datetime.now(timezone.utc).isoformat(), "status": status,
              "method": "agent-local-reproduction", "independent_external_review": "not-run", "checks": records,
              "production_tests": "not-run", "real_samples": "not-run", "runtime_c1_parity": "not-run",
              "edge_browser": "not-run", "edge_safe_automation_path": "blocked"}
    (ROOT / "review-checks.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if status != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
