"""Validate synthetic CSV encoding with Python's independent CSV reader, not Excel."""
import csv
import io
import json
import sys
import zipfile
from pathlib import Path

fixtures = Path(__file__).parent / "runtime-fixtures"
target = Path(sys.argv[1]) if len(sys.argv) > 1 else None
expected = json.loads((fixtures / "csv-expected.json").read_text())
checks = 0


def check(condition):
    global checks
    checks += 1
    if not condition:
        raise ValueError(f"CSV contract check {checks} failed")


try:
    if target is not None:
        raw = target.read_bytes()
    else:
        with zipfile.ZipFile(fixtures / "excel-safety-synthetic.csv.zip") as archive:
            check(archive.namelist() == ["excel-safety-synthetic.csv"])
            raw = archive.read("excel-safety-synthetic.csv")
    check(raw.startswith(b"\xef\xbb\xbf"))
    check(b"\r\n" in raw)
    rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"), newline="")))
    check(len(rows) == len(expected["cases"]) + 1)
    check(len(rows[0]) == expected["columns"])
    for row, case in zip(rows[1:], expected["cases"]):
        check(len(row) == expected["columns"])
        value = ("'" if case["protected"] else "") + case["value"]
        check(row[1] == value)
        check(row[2] == value)
        check(row[3:6] == expected["expectedNumericCells"])
    print(json.dumps({
        "status": "passed", "scope": "independent-python-csv-reader",
        "checks": checks, "rows": len(rows) - 1, "columns": expected["columns"],
        "actualExcel": "not-run",
    }))
except Exception:
    print(json.dumps({"status": "failed", "failedCheck": checks}), file=sys.stderr)
    sys.exit(1)
