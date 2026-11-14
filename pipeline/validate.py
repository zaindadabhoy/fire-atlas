"""Validate normalized PSI points against their cached raw source rows."""

from __future__ import annotations

import json
import math
import random
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from normalize import RAW, read_table
from units import atm_to_psi, bar_to_psi, fraction_to_percent, mmhg_to_psi, number


ROOT = Path(__file__).resolve().parents[1]
TESTS_FILE = ROOT / "data" / "processed" / "tests.json"
PUBLIC_DATA = ROOT / "app" / "public" / "data"
APP_SRC = ROOT / "app" / "src"
TEAM_CONFIG = APP_SRC / "config.ts"
USER_COPY_JARGON = re.compile(r"task ?0\d|reviewer|project brief|prompt file|TBD", re.IGNORECASE)
SOURCE_TEXT_SUFFIXES = {".css", ".html", ".js", ".jsx", ".json", ".md", ".mjs", ".svg", ".ts", ".tsx", ".txt"}


def json_strings(value: Any, location: str = "$"):
    if isinstance(value, str):
        yield location, value
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from json_strings(item, f"{location}[{index}]")
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from json_strings(item, f"{location}.{key}")


def validate_user_facing_copy() -> None:
    scanned_data_files = 0
    scanned_source_files = 0
    violations: list[str] = []
    for path in sorted(PUBLIC_DATA.rglob("*")):
        if not path.is_file():
            continue
        scanned_data_files += 1
        relative = path.relative_to(ROOT)
        if path.suffix.casefold() == ".json":
            content = json.loads(path.read_text(encoding="utf-8"))
            strings = json_strings(content)
            for location, value in strings:
                match = USER_COPY_JARGON.search(value)
                if match:
                    violations.append(f"{relative}:{location}: {match.group(0)!r}")
        elif path.suffix.casefold() in {".md", ".txt"}:
            for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                match = USER_COPY_JARGON.search(line)
                if match:
                    violations.append(f"{relative}:{line_number}: {match.group(0)!r}")
    for path in sorted(APP_SRC.rglob("*")):
        if not path.is_file() or path.resolve() == TEAM_CONFIG.resolve() or path.suffix.casefold() not in SOURCE_TEXT_SUFFIXES:
            continue
        scanned_source_files += 1
        relative = path.relative_to(ROOT)
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            match = USER_COPY_JARGON.search(line)
            if match:
                violations.append(f"{relative}:{line_number}: {match.group(0)!r}")
    assert not violations, "Internal wording found in user-facing data/source:\n  " + "\n  ".join(violations)
    print(f"User-copy jargon check passed: {scanned_data_files} public-data files and {scanned_source_files} source files scanned; team-name config excluded.")


def keyed(row: dict[str, Any]) -> dict[str, Any]:
    return {" ".join(str(name).strip().casefold().split()): value for name, value in row.items()}


def raw_cell(row: dict[str, Any], name: str) -> Any:
    return keyed(row).get(" ".join(name.strip().casefold().split()))


def numeric(row: dict[str, Any], name: str) -> float | None:
    return number(raw_cell(row, name))


def expected_o2_and_pressure(point: dict[str, Any], row: dict[str, Any]) -> tuple[float | None, float | None]:
    investigation = point["investigation"]
    table_key = point["table_key"]
    if investigation == "PSI-159":
        oxygen = numeric(row, "XO2" if table_key == "inverse" else "XO2 before test")
        pressure = numeric(row, "approx p (bar)")
        return (None if oxygen is None else fraction_to_percent(oxygen), None if pressure is None else bar_to_psi(pressure))
    if investigation == "PSI-10":
        oxygen = numeric(row, "XO2" if table_key == "inverse" else "XO2 (init)")
        pressure = numeric(row, "pmean (atm)")
        return (None if oxygen is None else fraction_to_percent(oxygen), None if pressure is None else atm_to_psi(pressure))
    if investigation == "PSI-69":
        oxygen = numeric(row, "O initial ambient composition; mole fraction")
        pressure = numeric(row, "Ambient pressure; mmHg")
        return (None if oxygen is None else fraction_to_percent(oxygen), None if pressure is None else mmhg_to_psi(pressure))
    if investigation == "PSI-39":
        oxygen = numeric(row, "Oxygen")
        pressure_text = raw_cell(row, "Pressure")
        pressure_value = number(pressure_text)
        pressure = atm_to_psi(pressure_value) if pressure_value is not None and "atm" in str(pressure_text).casefold() else None
        return (None if oxygen is None else fraction_to_percent(oxygen), pressure)
    if investigation == "PSI-25":
        oxygen = numeric(row, "Calibrated initial O2 % by vol")
        return oxygen, 14.7
    return None, None


def assert_rounded_match(label: str, actual: Any, expected: float | None) -> None:
    if expected is None:
        assert actual is None, f"{label}: expected null from raw, found {actual!r}"
        return
    assert isinstance(actual, (int, float)), f"{label}: expected numeric {expected}, found {actual!r}"
    assert math.isclose(float(actual), round(expected, 2), rel_tol=0, abs_tol=0.01), f"{label}: output {actual} != rounded conversion {round(expected, 2)}"


def main() -> None:
    validate_user_facing_copy()
    tests = json.loads(TESTS_FILE.read_text(encoding="utf-8"))
    assert isinstance(tests, list), "tests.json must be a JSON array"
    ids = [point.get("id") for point in tests]
    assert len(ids) == len(set(ids)), "test ids are not unique"

    cached_tables: dict[Path, Any] = {}
    mapped_raw_cells_checked = 0
    o2_semantics_checked = 0
    for point in tests:
        source = point.get("source") or {}
        filename = source.get("file")
        row_number = source.get("row")
        assert filename, f"{point.get('id')}: source.file is missing"
        assert isinstance(row_number, int) and row_number >= 1, f"{point.get('id')}: source.row must be a positive integer"
        path = RAW / "tables" / point["investigation"] / filename
        assert path.is_file(), f"{point.get('id')}: raw source file does not exist: {path}"
        if path not in cached_tables:
            cached_tables[path] = read_table(path)
        raw_table = cached_tables[path]
        assert row_number <= len(raw_table), f"{point.get('id')}: source row {row_number} exceeds parsed row count {len(raw_table)}"
        source_rows = source.get("rows") or [row_number]
        for source_row in source_rows:
            assert isinstance(source_row, int) and 1 <= source_row <= len(raw_table), f"{point.get('id')}: grouped source row {source_row} is outside {path.name}"

        source_fields = point.get("source_fields") or {}
        for field, mapping in source_fields.items():
            assert field in {"o2_pct", "pressure_psi", "flow_cm_s"}, f"{point.get('id')}: unsupported source field mapping {field}"
            column = mapping.get("column") if isinstance(mapping, dict) else None
            assert column, f"{point.get('id')}: {field} source column is missing"
            for source_row in source_rows:
                raw_value = raw_cell(raw_table.iloc[source_row - 1].to_dict(), column)
                if raw_value is None or not str(raw_value).strip() or not re.search(r"\d", str(raw_value)):
                    continue
                mapped_raw_cells_checked += 1
                if point.get(field) is None:
                    reason = (point.get("missing_reasons") or {}).get(field, "").strip()
                    assert reason and "blank" not in reason.casefold(), (
                        f"{point.get('id')}: {column} contains {raw_value!r}, but {field} is null with no non-blank rejection reason"
                    )

        if point.get("investigation") in {"PSI-10", "PSI-159"} and point.get("table_key") in {"normal", "inverse"}:
            expected_semantics = "ambient" if point["table_key"] == "normal" else "burner_stream"
            actual_semantics = (point.get("extra") or {}).get("o2_semantics")
            assert actual_semantics == expected_semantics, (
                f"{point.get('id')}: expected O2 semantics {expected_semantics}, found {actual_semantics!r}"
            )
            o2_semantics_checked += 1

        o2 = point.get("o2_pct")
        pressure = point.get("pressure_psi")
        flow = point.get("flow_cm_s")
        assert o2 is None or 0 <= o2 <= 100, f"{point.get('id')}: O2 is outside 0–100%: {o2}"
        assert pressure is None or 0 < pressure < 120, f"{point.get('id')}: pressure is outside (0, 120) psi: {pressure}"
        assert flow is None or flow >= 0, f"{point.get('id')}: flow is negative: {flow}"
        for field in ("o2_pct", "pressure_psi", "o2_partial_psi", "flow_cm_s"):
            value = point.get(field)
            assert value is None or (isinstance(value, (int, float)) and math.isfinite(float(value))), f"{point.get('id')}: {field} is not a finite number or null"

    eligible: list[dict[str, Any]] = []
    for point in tests:
        quality = point.get("quality") or {}
        metrics = point.get("metrics") or {}
        has_recheckable_pressure = quality.get("pressure_psi") == "measured" or metrics.get("source_pressure_psi") is not None
        if quality.get("o2_pct") == "measured" and has_recheckable_pressure and point.get("o2_pct") is not None:
            eligible.append(point)
    assert len(eligible) >= 20, f"Only {len(eligible)} measured O2/pressure points are eligible for the 20-row spot-check"
    saffire_98_99 = [point for point in tests if point.get("investigation") in {"PSI-98", "PSI-99"}]
    assert len(saffire_98_99) == 11, f"Expected 11 SAFFIRE-I/II sample points, found {len(saffire_98_99)}"
    for point in saffire_98_99:
        assert point.get("flow_cm_s") == 20 and (point.get("quality") or {}).get("flow_cm_s") == "measured", (
            f"{point.get('id')}: SAFFIRE I/II Air Flow must normalize to measured 20 cm/s"
        )
    randomizer = random.Random(20261114)
    checked = randomizer.sample(eligible, 20)
    print("Raw-source spot-checks (20 random measured O2/pressure rows):")
    for point in checked:
        source = point["source"]
        path = RAW / "tables" / point["investigation"] / source["file"]
        table = cached_tables[path]
        raw_row = table.iloc[source["row"] - 1].to_dict()
        expected_o2, expected_pressure = expected_o2_and_pressure(point, raw_row)
        assert_rounded_match(f"{point['id']} O2", point.get("o2_pct"), expected_o2)
        actual_pressure = point.get("pressure_psi") if point.get("pressure_psi") is not None else (point.get("metrics") or {}).get("source_pressure_psi")
        assert_rounded_match(f"{point['id']} converted pressure", actual_pressure, expected_pressure)
        pressure_output = str(actual_pressure) + (" psi (preserved outside coordinate bound)" if point.get("pressure_psi") is None else " psi")
        print(f"  {point['id']} row {source['row']}: O2 {point['o2_pct']}% / {round(expected_o2 or 0, 2)}%; converted pressure {pressure_output} / {round(expected_pressure or 0, 2)} psi — pass")

    by_investigation: dict[str, Counter[str]] = defaultdict(Counter)
    for point in tests:
        by_investigation[point["investigation"]][point.get("outcome", "unknown")] += 1
    print("\nTests by investigation × outcome:")
    for investigation in sorted(by_investigation, key=lambda item: (int("".join(character for character in item if character.isdigit()) or 0), item)):
        values = by_investigation[investigation]
        print(f"  {investigation}: " + ", ".join(f"{outcome}={values[outcome]}" for outcome in ("burned", "self_extinguished", "no_ignition", "unknown") if values[outcome]))

    print("\nQuality flags (% of all test points by plotted condition field):")
    for field in ("o2_pct", "pressure_psi", "flow_cm_s"):
        flags = Counter((point.get("quality") or {}).get(field) or "null" for point in tests)
        formatted = ", ".join(f"{flag}={count} ({count / len(tests) * 100:.1f}%)" for flag, count in sorted(flags.items()))
        print(f"  {field}: {formatted}")
    print(f"\nValidation passed: {len(tests)} points, all sources/rows and ranges valid, {len(ids)} unique ids, {mapped_raw_cells_checked} non-empty numeric source cells audited, O2 semantics checked for {o2_semantics_checked} normal/inverse records, SAFFIRE I/II flow=20 cm/s for 11/11 points, 20/20 conversions matched.")


if __name__ == "__main__":
    main()
