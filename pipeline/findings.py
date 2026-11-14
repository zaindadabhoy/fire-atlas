"""Deterministic, source-backed coverage facts and investigation rankings."""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"
PUBLIC = ROOT / "app" / "public" / "data"
PHASES = ("solid", "liquid", "gas")
PILLARS = ("prevention", "detection", "suppression")
KNOWN_OUTCOMES = ("burned", "self_extinguished", "no_ignition")


def load(name: str) -> Any:
    return json.loads((PROCESSED / name).read_text(encoding="utf-8"))


def known_conditions(point: dict[str, Any]) -> bool:
    return isinstance(point.get("o2_pct"), (int, float)) and isinstance(point.get("pressure_psi"), (int, float))


def measured_conditions(point: dict[str, Any]) -> bool:
    quality = point.get("quality") or {}
    return known_conditions(point) and quality.get("o2_pct") == "measured" and quality.get("pressure_psi") == "measured"


def distance(point: dict[str, Any], o2_pct: float, pressure_psi: float) -> float:
    return math.sqrt(((float(point["o2_pct"]) - o2_pct) / 10.0) ** 2 + ((float(point["pressure_psi"]) - pressure_psi) / 3.0) ** 2)


def inside_window(point: dict[str, Any], o2_pct: float, pressure_psi: float) -> bool:
    return known_conditions(point) and abs(float(point["o2_pct"]) - o2_pct) <= 5 and abs(float(point["pressure_psi"]) - pressure_psi) <= 2


def o2_bin(value: float) -> str:
    if value < 18:
        return "<18"
    if value < 25:
        return "18-25"
    if value < 35:
        return "25-35"
    if value <= 50:
        return "35-50"
    return ">50"


def pressure_bin(value: float) -> str:
    if value < 9:
        return "<9"
    if value < 12:
        return "9-12"
    if value <= 16:
        return "12-16"
    return ">16"


def phase_label(phase: str) -> str:
    return {"solid": "Solid", "liquid": "Droplet", "gas": "Gas"}.get(phase, phase.title())


def span_text(values: list[float], unit: str) -> str:
    low, high = min(values), max(values)
    if f"{low:.1f}" == f"{high:.1f}":  # equal at display precision -> show one value
        return f"{high:.1f} {unit}"
    return f"{low:.1f}–{high:.1f} {unit}"


def context_sentence(investigation: dict[str, Any]) -> dict[str, Any] | None:
    for field in ("research_impacts", "objective"):
        text = investigation.get(field)
        if not isinstance(text, str):
            continue
        for candidate in re.split(r"(?<=[.!?])\s+", " ".join(text.split())):
            if candidate and len(candidate) <= 300:
                return {
                    "id": f"context:{investigation['id']}",
                    "citation_key": investigation["id"],
                    "investigation_id": investigation["id"],
                    "text": candidate,
                    "source_field": field,
                    "support": [investigation["id"]],
                }
    return None


def coverage_for_phase(tests: list[dict[str, Any]], o2_pct: float, pressure_psi: float, phase: str) -> dict[str, Any]:
    phase_rows = [point for point in tests if point.get("fuel_phase") == phase]
    measured_rows = [point for point in phase_rows if measured_conditions(point)]
    known_rows = [point for point in phase_rows if known_conditions(point)]
    near_measured = [point for point in measured_rows if inside_window(point, o2_pct, pressure_psi)]
    near_all = [point for point in known_rows if inside_window(point, o2_pct, pressure_psi)]
    near_assumed_pressure = [
        point for point in phase_rows
        if point.get("o2_pct") is not None
        and (point.get("quality") or {}).get("o2_pct") == "measured"
        and (point.get("quality") or {}).get("pressure_psi") == "assumed"
        and abs(float(point.get("pressure_psi") or 0) - 14.7) <= 0.05
        and inside_window(point, o2_pct, pressure_psi)
    ]
    near_with_assumed_pressure = len(near_measured) + len(near_assumed_pressure)

    def nearest(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {"id": point["id"], "distance": round(distance(point, o2_pct, pressure_psi), 4)}
            for point in sorted(rows, key=lambda item: (distance(item, o2_pct, pressure_psi), item["id"]))[:8]
        ]

    oxygen_rows = [point for point in phase_rows if point.get("o2_pct") is not None and (point.get("quality") or {}).get("o2_pct") == "measured"]
    pressure_rows = [point for point in phase_rows if point.get("pressure_psi") is not None and (point.get("quality") or {}).get("pressure_psi") == "measured"]
    max_o2 = max(oxygen_rows, key=lambda item: (item["o2_pct"], item["id"])) if oxygen_rows else None
    min_pressure = min(pressure_rows, key=lambda item: (item["pressure_psi"], item["id"])) if pressure_rows else None
    return {
        "n_near": len(near_measured),
        "n_near_incl_assumed": len(near_all),
        "n_near_assumed_pressure": len(near_assumed_pressure),
        "n_near_with_assumed_pressure": near_with_assumed_pressure,
        "coverage": "covered" if len(near_measured) >= 5 else "covered_assumed_pressure" if near_with_assumed_pressure >= 5 else "sparse" if near_with_assumed_pressure else "none",
        "nearest": nearest(measured_rows),
        "nearest_incl_assumed": nearest(known_rows),
        "max_o2_tested": None if max_o2 is None else {"value": max_o2["o2_pct"], "test_id": max_o2["id"]},
        "min_pressure_tested": None if min_pressure is None else {"value": min_pressure["pressure_psi"], "test_id": min_pressure["id"]},
        "measured_test_count": len(measured_rows),
    }


def rank_investigations(
    tests: list[dict[str, Any]],
    investigations: list[dict[str, Any]],
    o2_pct: float,
    pressure_psi: float,
    phase_filter: str | None = None,
    pillar: str | None = None,
    limit: int = 8,
) -> list[dict[str, Any]]:
    measured_by_investigation: dict[str, list[dict[str, Any]]] = {}
    known_by_investigation: dict[str, list[dict[str, Any]]] = {}
    count_by_investigation: dict[str, int] = {}
    phase_by_investigation: dict[str, set[str]] = {}
    for point in tests:
        investigation = point.get("investigation")
        if not investigation:
            continue
        count_by_investigation[investigation] = count_by_investigation.get(investigation, 0) + 1
        if measured_conditions(point):
            measured_by_investigation.setdefault(investigation, []).append(point)
        if point.get("o2_pct") is not None and point.get("pressure_psi") is not None:
            known_by_investigation.setdefault(investigation, []).append(point)
        if point.get("fuel_phase"):
            phase_by_investigation.setdefault(investigation, set()).add(point["fuel_phase"])
    assumed_weight = 0.6  # assumed coordinates count, but less than measured ones
    richness_max = max(count_by_investigation.values(), default=0)
    results: list[dict[str, Any]] = []

    for investigation in investigations:
        identifier = investigation["id"]
        measured = measured_by_investigation.get(identifier, [])
        using_assumed = not measured
        pool = known_by_investigation.get(identifier, []) if using_assumed else measured
        weight = assumed_weight if using_assumed else 1.0
        label = "test points (assumed coordinates)" if using_assumed else "measured test points"
        within = [point for point in pool if inside_window(point, o2_pct, pressure_psi)]
        nearest = sorted(pool, key=lambda item: (distance(item, o2_pct, pressure_psi), item["id"]))
        if within:
            proximity = len(within) / len(pool) * weight
            condition_text = f"{len(within)} of {len(pool)} {label} fall within the query window."
            condition_cites = [point["id"] for point in within[:5]]
        elif nearest:
            d_min = distance(nearest[0], o2_pct, pressure_psi)
            proximity = math.exp(-d_min) * weight
            condition_text = f"No {label.replace(' points', '')} in the query window; nearest is {nearest[0]['o2_pct']:.1f} % O₂ at {nearest[0]['pressure_psi']:.1f} psi."
            condition_cites = [nearest[0]["id"]]
        else:
            proximity = 0.0
            condition_text = "No test-level O₂ and pressure pair is available for condition proximity."
            condition_cites = [identifier]

        phases = set(investigation.get("fuel_phases") or []) | phase_by_investigation.get(identifier, set())
        phase_match = 1.0 if phase_filter is not None and phase_filter in phases else 0.0
        phase_factor = 1.0 if phase_filter is None or phase_match else 0.4
        tags = set(investigation.get("safety_tags") or [])
        pillar_match = 1.0 if pillar is not None and pillar in tags else 0.0
        n_tests = count_by_investigation.get(identifier, 0)
        richness = math.log1p(n_tests) / math.log1p(richness_max) if richness_max else 0.0
        breakdown = {
            "condition_proximity": round(45 * proximity * phase_factor, 2),
            "phase_match": round(25 * phase_match, 2),
            "pillar_match": round(20 * pillar_match, 2),
            "data_richness": round(10 * richness, 2),
        }
        reasons = [{"text": condition_text, "cites": condition_cites}]
        if phase_filter:
            reasons.append({
                "text": f"Has {phase_filter} fuel-phase records." if phase_match else f"No {phase_filter} fuel-phase records are listed.",
                "cites": [identifier],
            })
        if pillar:
            reasons.append({
                "text": f"Tagged for {pillar}." if pillar_match else f"Not tagged for {pillar}.",
                "cites": [identifier],
            })
        reasons.append({
            "text": f"{n_tests} test points ({len(measured)} with measured O₂ and pressure) contribute to data richness.",
            "cites": [identifier],
        })
        score = round(sum(breakdown.values()), 2)
        results.append({
            "id": identifier,
            "acronym": investigation.get("acronym"),
            "title": investigation.get("title"),
            "score": score,
            "breakdown": breakdown,
            "reason_facts": reasons,
            "n_measured_tests": len(measured),
            "proximity_share": round(proximity, 4),
            "phase_factor": phase_factor,
            "phase_match": bool(phase_match),
            "pillar_match": bool(pillar_match),
        })

    results.sort(key=lambda item: (-item["score"], item["id"]))
    return [{**item, "rank": index + 1} for index, item in enumerate(results[:limit])]


def make_findings(
    tests: list[dict[str, Any]],
    envelopes: list[dict[str, Any]],
    investigations: list[dict[str, Any]],
    detections: list[dict[str, Any]],
    habitats: list[dict[str, Any]],
) -> dict[str, Any]:
    coverage: dict[str, Any] = {}
    facts: list[dict[str, Any]] = []

    def add_fact(identifier: str, value: Any, unit: str, support: list[str], text: str, **details: Any) -> None:
        facts.append({"id": f"fact:{identifier}", "value": value, "unit": unit, "support": support, "text": text, **details})

    all_test_ids = [point["id"] for point in tests]
    add_fact("total_tests", len(tests), "tests", all_test_ids, f"{len(tests):,} normalized combustion test points are available.")
    add_fact("total_investigations", len(investigations), "investigations", [item["id"] for item in investigations], f"{len(investigations)} PSI investigations are indexed.")
    valid_habitats = [habitat for habitat in habitats if habitat.get("o2_pct") is not None and habitat.get("pressure_psi") is not None]
    earth = next((item for item in valid_habitats if item.get("id") == "earth-sea-level"), None)
    if earth:
        earth_po2 = float(earth["o2_pct"]) * float(earth["pressure_psi"]) / 100.0
        for habitat in valid_habitats:
            po2 = float(habitat["o2_pct"]) * float(habitat["pressure_psi"]) / 100.0
            supports = [f"habitat:{habitat['id']}"]
            if habitat["id"] != earth["id"]:
                supports.append(f"habitat:{earth['id']}")
            if habitat["id"] == earth["id"]:
                text = f"Earth sea level reference: O₂ partial pressure is {po2:.2f} psi at {float(habitat['o2_pct']):g} % O₂."
                po2_delta = 0.0
                fraction_delta = 0.0
            else:
                po2_delta = (po2 - earth_po2) / earth_po2 * 100.0
                fraction_delta = (float(habitat["o2_pct"]) - float(earth["o2_pct"])) / float(earth["o2_pct"]) * 100.0
                po2_direction = "below" if po2_delta < 0 else "above"
                fraction_direction = "higher" if fraction_delta >= 0 else "lower"
                text = (
                    f"{habitat.get('name') or habitat['id']} O₂ partial pressure is {po2:.2f} psi, "
                    f"{abs(po2_delta):.0f}% {po2_direction} Earth's {earth_po2:.2f} psi, "
                    f"while O₂ mole fraction is {abs(fraction_delta):.0f}% {fraction_direction}."
                )
            add_fact(
                f"{habitat['id']}_o2_partial_pressure_vs_earth",
                round(po2, 2),
                "psi",
                supports,
                text,
                habitat_id=habitat["id"],
                p_o2_psi=round(po2, 2),
                percent_vs_earth=round(po2_delta, 2),
                oxygen_fraction_percent_vs_earth=round(fraction_delta, 2),
                source=habitat.get("source"),
                earth_source=earth.get("source"),
            )

    for phase in PHASES:
        rows = [point for point in tests if point.get("fuel_phase") == phase]
        phase_ids = [point["id"] for point in rows]
        label = phase_label(phase)
        add_fact(f"{phase}_test_count", len(rows), "tests", phase_ids, f"{len(rows)} test points are classified as {label}.")
        oxygen_rows = [point for point in rows if point.get("o2_pct") is not None and (point.get("quality") or {}).get("o2_pct") == "measured"]
        pressure_rows = [point for point in rows if point.get("pressure_psi") is not None and (point.get("quality") or {}).get("pressure_psi") == "measured"]
        max_o2 = max(oxygen_rows, key=lambda item: (item["o2_pct"], item["id"])) if oxygen_rows else None
        min_pressure = min(pressure_rows, key=lambda item: (item["pressure_psi"], item["id"])) if pressure_rows else None
        if max_o2:
            add_fact(f"{phase}_max_o2", max_o2["o2_pct"], "%", [max_o2["id"]], f"Highest measured O₂ in {label} tests: {max_o2['o2_pct']:.2f} %.", test_id=max_o2["id"])
        else:
            add_fact(f"{phase}_max_o2", None, "%", phase_ids, f"No measured O₂ value is available for {label} test points.")
        if min_pressure:
            add_fact(f"{phase}_min_pressure", min_pressure["pressure_psi"], "psi", [min_pressure["id"]], f"Lowest measured pressure in {label} tests: {min_pressure['pressure_psi']:.2f} psi.", test_id=min_pressure["id"])
        else:
            add_fact(f"{phase}_min_pressure", None, "psi", phase_ids, f"No measured pressure value is available for {label} test points; cabin pressure is assumed or absent.")

    solid_above = [point for point in tests if point.get("fuel_phase") == "solid" and point.get("o2_pct") is not None and (point.get("quality") or {}).get("o2_pct") == "measured" and point["o2_pct"] > 25]
    solid_ids = [point["id"] for point in tests if point.get("fuel_phase") == "solid"]
    add_fact("solid_tests_above_25", len(solid_above), "tests", [point["id"] for point in solid_above] or solid_ids, f"Solid-material tests above 25 % measured O₂: {len(solid_above)}.")
    solid_o2_rows = [point for point in tests if point.get("fuel_phase") == "solid" and point.get("o2_pct") is not None
        and (point.get("quality") or {}).get("o2_pct") == "measured"]
    if solid_o2_rows:
        solid_rows = [point for point in tests if point.get("fuel_phase") == "solid"]
        solid_o2_min = min(solid_o2_rows, key=lambda point: (point["o2_pct"], point["id"]))
        solid_o2_max = max(solid_o2_rows, key=lambda point: (point["o2_pct"], point["id"]))
        add_fact(
            "solid_test_o2_range",
            len(solid_rows),
            "tests",
            [point["id"] for point in solid_rows],
            f"All {len(solid_rows)} solid tests are represented; their measured O₂ coordinates span {solid_o2_min['o2_pct']:.1f}–{solid_o2_max['o2_pct']:.1f} %.",
            measured_o2_test_count=len(solid_o2_rows),
            min_o2_pct=solid_o2_min["o2_pct"],
            min_test_id=solid_o2_min["id"],
            max_o2_pct=solid_o2_max["o2_pct"],
            max_test_id=solid_o2_max["id"],
        )

        moon_habitat = next((item for item in habitats if item.get("id") == "moon-base"), None)
        if moon_habitat and isinstance(moon_habitat.get("o2_min_pct"), (int, float)):
            moon_min_o2 = float(moon_habitat["o2_min_pct"])
            add_fact(
                "moon-base_o2_min",
                moon_min_o2,
                "% O₂",
                ["habitat:moon-base"],
                f"The planned lunar habitat atmosphere starts at {moon_min_o2:g} % O₂, per the challenge condition range.",
                habitat_id="moon-base",
                source=moon_habitat.get("source"),
            )

        apollo = next((item for item in valid_habitats if item.get("id") == "apollo-1"), None)
        if apollo and earth:
            apollo_po2 = float(apollo["o2_pct"]) * float(apollo["pressure_psi"]) / 100.0
            earth_po2 = float(earth["o2_pct"]) * float(earth["pressure_psi"]) / 100.0
            ratio = apollo_po2 / earth_po2 if earth_po2 else None
            if ratio is not None:
                add_fact(
                    "apollo-1_o2_partial_pressure_ratio_vs_earth",
                    round(ratio, 2),
                    "× Earth reference",
                    ["habitat:apollo-1", "habitat:earth-sea-level"],
                    f"Apollo 1's cabin O₂ partial pressure was {ratio:.2f}× Earth's sea-level reference ({apollo_po2:.2f} psi vs {earth_po2:.2f} psi).",
                    habitat_id="apollo-1",
                    apollo_p_o2_psi=round(apollo_po2, 2),
                    earth_p_o2_psi=round(earth_po2, 2),
                    source=apollo.get("source"),
                    earth_source=earth.get("source"),
                )
            o2_gap = float(apollo["o2_pct"]) - float(solid_o2_max["o2_pct"])
            add_fact(
                "apollo-1_o2_gap_vs_solid_max",
                round(o2_gap, 1),
                "percentage points",
                ["habitat:apollo-1", solid_o2_max["id"]],
                f"Apollo 1's {float(apollo['o2_pct']):g} % O₂ is {o2_gap:.1f} percentage points above PSI's highest measured solid-test O₂ of {float(solid_o2_max['o2_pct']):.1f} %.",
                habitat_id="apollo-1",
                max_solid_test_id=solid_o2_max["id"],
                source=apollo.get("source"),
            )

    for habitat in valid_habitats:
        h_id = habitat["id"]
        habitat_coverage = {
            phase: coverage_for_phase(tests, float(habitat["o2_pct"]), float(habitat["pressure_psi"]), phase)
            for phase in PHASES
        }
        coverage[h_id] = {"name": habitat.get("name"), "o2_pct": habitat["o2_pct"], "pressure_psi": habitat["pressure_psi"], "o2_min_pct": habitat.get("o2_min_pct"), "pressure_max_psi": habitat.get("pressure_max_psi"), "phases": habitat_coverage}
        for phase in PHASES:
            result = habitat_coverage[phase]
            phase_rows = [point for point in tests if point.get("fuel_phase") == phase]
            measured_rows = [point for point in phase_rows if measured_conditions(point)]
            known_rows = [point for point in phase_rows if known_conditions(point)]
            nearest_rows = measured_rows or known_rows
            nearest_point = min(nearest_rows, key=lambda point: (distance(point, float(habitat["o2_pct"]), float(habitat["pressure_psi"])), point["id"])) if nearest_rows else None
            if nearest_point:
                o2_gap = float(habitat["o2_pct"]) - float(nearest_point["o2_pct"])
                if abs(o2_gap) < 0.05:
                    gap_text = "at the same O₂ concentration"
                elif o2_gap > 0:
                    gap_text = f"{o2_gap:.1f} percentage points lower in O₂"
                else:
                    gap_text = f"{abs(o2_gap):.1f} percentage points higher in O₂"
                evidence_kind = "measured" if measured_rows else "nearest available test with assumed coordinates"
                quality = nearest_point.get("quality") or {}
                pressure_note = "pressure assumed" if quality.get("pressure_psi") == "assumed" else "pressure measured" if quality.get("pressure_psi") == "measured" else "pressure quality not measured"
                near_text = (
                    f"Nearest {phase_label(phase)} evidence for {habitat.get('name') or h_id} is {nearest_point['id']} "
                    f"({evidence_kind}) at {float(nearest_point['o2_pct']):.1f} % O₂ and {float(nearest_point['pressure_psi']):.2f} psi; "
                    f"it is {gap_text} with {pressure_note}."
                )
                nearest_details = {
                    "test_id": nearest_point["id"],
                    "phase": phase,
                    "habitat_id": h_id,
                    "o2_pct": nearest_point["o2_pct"],
                    "pressure_psi": nearest_point["pressure_psi"],
                    "distance": round(distance(nearest_point, float(habitat["o2_pct"]), float(habitat["pressure_psi"])), 4),
                    "o2_gap_pct_points": round(o2_gap, 2),
                    "quality": quality,
                    "measured_coordinates": bool(measured_rows),
                }
                nearest_support = [nearest_point["id"]]
                nearest_value = nearest_point["o2_pct"]
            else:
                near_text = f"No test-level {phase} condition pair is available for {habitat.get('name') or h_id}."
                nearest_details = {"test_id": None, "phase": phase, "habitat_id": h_id, "o2_pct": None, "pressure_psi": None, "distance": None, "o2_gap_pct_points": None, "quality": None, "measured_coordinates": False}
                nearest_support = [point["id"] for point in phase_rows]
                nearest_value = None
            add_fact(f"{h_id}_nearest_{phase}", nearest_value, "% O₂", nearest_support, near_text, **nearest_details)
            window_ids = [
                point["id"] for point in tests
                if point.get("fuel_phase") == phase and measured_conditions(point)
                and inside_window(point, float(habitat["o2_pct"]), float(habitat["pressure_psi"]))
            ]
            label = phase_label(phase)
            add_fact(
                f"{h_id}_near_{phase}",
                result["n_near"],
                "tests",
                window_ids or [point["id"] for point in tests if point.get("fuel_phase") == phase],
                f"{habitat.get('name')}: {result['n_near']} measured {label} tests are within ±5 % O₂ and ±2 psi.",
                habitat_id=h_id,
                phase=phase,
                n_near_incl_assumed=result["n_near_incl_assumed"],
                n_near_assumed_pressure=result["n_near_assumed_pressure"],
                n_near_with_assumed_pressure=result["n_near_with_assumed_pressure"],
                coverage_tier=result["coverage"],
            )

    flex = [point for point in tests if point.get("investigation") == "PSI-69"]
    for diluent, names in (("He", {"He", "mixed"}), ("CO2", {"CO2", "mixed"})):
        matching = [point for point in flex if point.get("diluent") in names]
        outcome_split = {outcome: sum(point.get("outcome") == outcome for point in matching) for outcome in ("burned", "self_extinguished", "no_ignition", "unknown")}
        add_fact(
            f"flex_{diluent.casefold()}_tests",
            len(matching),
            "tests",
            [point["id"] for point in matching],
            f"FLEX tests with {diluent} in the diluent: {len(matching)}; outcome split {', '.join(f'{key} {value}' for key, value in outcome_split.items() if value)}.",
            outcome_split=outcome_split,
        )

    for diluent in ("N2", "He", "CO2"):
        matching = [point for point in flex if point.get("diluent") == diluent and point.get("outcome") in KNOWN_OUTCOMES]
        if not matching:
            continue
        outcome_split = {outcome: sum(point.get("outcome") == outcome for point in matching) for outcome in KNOWN_OUTCOMES}
        extinction_share = outcome_split["self_extinguished"] / len(matching) * 100.0
        add_fact(
            f"flex_diluent_{diluent.casefold()}_extinction",
            len(matching),
            "tests",
            [point["id"] for point in matching],
            f"FLEX {diluent} diluent tests self-extinguished in {extinction_share:.1f}% of {len(matching)} tests with known outcomes.",
            dataset="FLEX",
            diluent=diluent,
            outcome_split=outcome_split,
            extinction_share_pct=round(extinction_share, 2),
        )

    trend_series = (
        ("flex", "FLEX", "liquid", lambda point: point.get("investigation") == "PSI-69"),
        ("cfi_g_normal", "CFI-G normal", "gas", lambda point: point.get("investigation") == "PSI-159" and point.get("table_key") == "normal"),
        ("cfi_g_inverse", "CFI-G inverse", "gas", lambda point: point.get("investigation") == "PSI-159" and point.get("table_key") == "inverse"),
        ("saffire", "SAFFIRE", "solid", lambda point: point.get("investigation") in {"PSI-98", "PSI-99", "PSI-100"}),
    )

    def add_outcome_trend(series_key: str, series_name: str, phase: str, axis: str, bin_label: str, matching: list[dict[str, Any]]) -> None:
        if len(matching) < 5:
            return
        outcome_split = {outcome: sum(point.get("outcome") == outcome for point in matching) for outcome in KNOWN_OUTCOMES}
        shares = {outcome: round(count / len(matching) * 100.0, 2) for outcome, count in outcome_split.items()}
        if axis == "o2":
            oxygen_basis = "burner-stream O₂" if series_key == "cfi_g_inverse" else "ambient O₂"
            text = f"{series_name} outcomes at {bin_label} % {oxygen_basis} (n={len(matching)}): "
        else:
            text = f"{series_name} outcomes at {bin_label} psi (n={len(matching)}): "
        text += ", ".join(f"{outcome.replace('_', ' ')} {shares[outcome]:.1f}%" for outcome in KNOWN_OUTCOMES) + "."
        quality_counts = {}
        for point in matching:
            quality = (point.get("quality") or {}).get("o2_pct" if axis == "o2" else "pressure_psi") or "not reported"
            quality_counts[quality] = quality_counts.get(quality, 0) + 1
        add_fact(
            f"trend_{axis}_{series_key}_{bin_label.replace('-', '_').replace('<', 'lt').replace('>', 'gt')}",
            len(matching),
            "tests",
            [point["id"] for point in matching],
            text,
            trend_type=f"{axis}_outcome_share",
            dataset=series_name,
            fuel_phase=phase,
            bin=bin_label,
            o2_basis=("burner_stream" if series_key == "cfi_g_inverse" else "ambient") if axis == "o2" else None,
            outcome_split=outcome_split,
            outcome_share_pct=shares,
            condition_quality_counts=quality_counts,
        )

    for series_key, series_name, phase, predicate in trend_series:
        dataset_rows = [point for point in tests if predicate(point) and point.get("outcome") in KNOWN_OUTCOMES]
        oxygen_rows = [point for point in dataset_rows if point.get("o2_pct") is not None and (point.get("quality") or {}).get("o2_pct") in {"measured", "from_range"}]
        for label in ("<18", "18-25", "25-35", "35-50", ">50"):
            matching = [point for point in oxygen_rows if o2_bin(float(point["o2_pct"])) == label]
            add_outcome_trend(series_key, series_name, phase, "o2", label, matching)

    pressure_series = tuple(item for item in trend_series if item[0] != "saffire")
    for series_key, series_name, phase, predicate in pressure_series:
        pressure_rows = [point for point in tests if predicate(point) and point.get("outcome") in KNOWN_OUTCOMES
            and point.get("pressure_psi") is not None and (point.get("quality") or {}).get("pressure_psi") == "measured"]
        for label in ("<9", "9-12", "12-16", ">16"):
            matching = [point for point in pressure_rows if pressure_bin(float(point["pressure_psi"])) == label]
            add_outcome_trend(series_key, series_name, phase, "pressure", label, matching)

    material_contrasts: set[tuple[str, ...]] = set()
    for investigation_id in sorted({str(point.get("investigation")) for point in tests if point.get("investigation")}):
        for phase in PHASES:
            rows = [point for point in tests if point.get("investigation") == investigation_id
                and point.get("fuel_phase") == phase and point.get("material")
                and point.get("outcome") in KNOWN_OUTCOMES
                and point.get("o2_pct") is not None and (point.get("quality") or {}).get("o2_pct") in {"measured", "from_range"}
                and point.get("flow_cm_s") is not None]
            rows.sort(key=lambda point: (float(point["o2_pct"]), float(point["flow_cm_s"]), str(point.get("material")), point["id"]))
            for anchor in rows:
                cluster = [point for point in rows if abs(float(point["o2_pct"]) - float(anchor["o2_pct"])) <= 0.5
                    and abs(float(point["flow_cm_s"]) - float(anchor["flow_cm_s"])) <= 0.5]
                if not cluster or max(float(point["o2_pct"]) for point in cluster) - min(float(point["o2_pct"]) for point in cluster) > 0.5:
                    continue
                if max(float(point["flow_cm_s"]) for point in cluster) - min(float(point["flow_cm_s"]) for point in cluster) > 0.5:
                    continue
                ids = tuple(sorted(point["id"] for point in cluster))
                if ids in material_contrasts:
                    continue
                outcomes_by_material: dict[str, set[str]] = {}
                material_ids: dict[str, list[str]] = {}
                for point in cluster:
                    material = str(point["material"]).strip()
                    outcomes_by_material.setdefault(material, set()).add(point["outcome"])
                    material_ids.setdefault(material, []).append(point["id"])
                if len(outcomes_by_material) < 2 or len({outcome for values in outcomes_by_material.values() for outcome in values}) < 2:
                    continue
                material_contrasts.add(ids)
                o2_values = [float(point["o2_pct"]) for point in cluster]
                flow_values = [float(point["flow_cm_s"]) for point in cluster]
                pressure_values = [float(point["pressure_psi"]) for point in cluster if point.get("pressure_psi") is not None]
                pressure_is_assumed = bool(pressure_values) and all((point.get("quality") or {}).get("pressure_psi") == "assumed" for point in cluster if point.get("pressure_psi") is not None)
                descriptions = [f"{material} {', '.join(sorted(outcome.replace('_', ' ') for outcome in outcome_set))}" for material, outcome_set in sorted(outcomes_by_material.items())]
                condition = f"{span_text(o2_values, '% O₂')} and {span_text(flow_values, 'cm/s')}"
                if pressure_is_assumed:
                    condition += f" with assumed {span_text(pressure_values, 'psi')} cabin pressure"
                add_fact(
                    f"material_contrast_{investigation_id.lower().replace('-', '_')}_{len(material_contrasts)}",
                    len(cluster),
                    "matched tests",
                    list(ids),
                    f"Matched {investigation_id} {phase} conditions at {condition} had different material outcomes: {'; '.join(descriptions)}.",
                    investigation_id=investigation_id,
                    fuel_phase=phase,
                    o2_pct_range=[round(min(o2_values), 2), round(max(o2_values), 2)],
                    flow_cm_s_range=[round(min(flow_values), 2), round(max(flow_values), 2)],
                    pressure_psi_range=[round(min(pressure_values), 2), round(max(pressure_values), 2)] if pressure_values else None,
                    pressure_assumed=pressure_is_assumed,
                    material_outcomes={material: sorted(outcome_set) for material, outcome_set in outcomes_by_material.items()},
                    material_support=material_ids,
                )

    detection_ids = [item.get("id") for item in detections if item.get("id")]
    add_fact("detection_records", len(detections), "records", detection_ids, f"{len(detections)} smoke/dust detection records are indexed separately from combustion tests.")

    context_snippets = [snippet for investigation in investigations if (snippet := context_sentence(investigation)) is not None]

    headline_candidates = [
        "fact:solid_max_o2",
        "fact:solid_tests_above_25",
        "fact:moon-base_near_gas" if "moon-base" in coverage else "fact:iss_near_gas",
        "fact:liquid_max_o2",
    ]
    fact_index = {fact["id"]: fact for fact in facts}
    headline_fact_ids = [identifier for identifier in headline_candidates if identifier in fact_index][:4]
    rankings: list[dict[str, Any]] = []
    for habitat in valid_habitats:
        for phase in PHASES:
            for pillar in (None, *PILLARS):
                rankings.append({
                    "habitat_id": habitat["id"],
                    "phase": phase,
                    "pillar": pillar,
                    "items": rank_investigations(tests, investigations, float(habitat["o2_pct"]), float(habitat["pressure_psi"]), phase, pillar),
                })

    return {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "summary": {
            "total_tests": len(tests),
            "total_investigations": len(investigations),
            "total_envelopes": len(envelopes),
            "total_detection_records": len(detections),
        },
        "coverage_by_habitat": coverage,
        "facts": facts,
        "context_snippets": context_snippets,
        "headline_fact_ids": headline_fact_ids,
        "rankings": rankings,
    }


def main() -> None:
    tests = load("tests.json")
    envelopes = load("envelopes.json")
    investigations = load("investigations.json")
    detections = load("detection.json")
    habitats = json.loads((PUBLIC / "habitats.json").read_text(encoding="utf-8"))
    data = make_findings(tests, envelopes, investigations, detections, habitats)
    serialized = json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    (PROCESSED / "findings.json").write_text(serialized, encoding="utf-8")
    (PUBLIC / "findings.json").write_text(serialized, encoding="utf-8")
    for identifier in data["headline_fact_ids"]:
        fact = next(item for item in data["facts"] if item["id"] == identifier)
        print(f"{fact['id']}: {fact['text']}")
    moon = data["coverage_by_habitat"].get("moon-base", {}).get("phases", {})
    if moon:
        print("Moon base measured tests within ±5 % O₂ and ±2 psi:")
        for phase in PHASES:
            result = moon[phase]
            print(f"  {phase}: {result['n_near']} measured; {result['n_near_incl_assumed']} including assumed; {result['coverage']}")
    print(f"Wrote {len(data['facts'])} source-backed facts and {len(data['rankings'])} precomputed ranking sets to processed/public data.")


if __name__ == "__main__":
    main()
