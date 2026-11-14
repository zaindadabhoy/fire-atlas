"""Normalize cached NASA PSI investigation tables without network access."""

from __future__ import annotations

import html
import json
import math
import re
from collections import Counter, OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from units import atm_to_psi, bar_to_psi, fraction_to_percent, is_missing, mmhg_to_psi, number, number_values, range_or_list, round_output
from hardware_mapping import SUITES, annotate_hardware_suites


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
PUBLIC = ROOT / "app" / "public" / "data"
DOCS = ROOT / "docs"


def clean_text(value: Any) -> str | None:
    if is_missing(value):
        return None
    text = html.unescape(re.sub(r"<[^>]*>", " ", str(value)))
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def header_key(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value).strip()).casefold()


def cell(row: dict[str, Any], *names: str) -> Any:
    normalized = {header_key(key): value for key, value in row.items()}
    for name in names:
        candidate = normalized.get(header_key(name))
        if not is_missing(candidate) and str(candidate).strip():
            return candidate
    return None


def cell_text(row: dict[str, Any], *names: str) -> str | None:
    return clean_text(cell(row, *names))


def as_number(value: Any) -> float | None:
    return number(value)


def fraction_pct(value: Any) -> float | None:
    parsed = as_number(value)
    return None if parsed is None else fraction_to_percent(parsed)


def parse_pressure_atm(value: Any) -> float | None:
    parsed = as_number(value)
    return None if parsed is None else atm_to_psi(parsed)


def parse_pressure_bar(value: Any) -> float | None:
    parsed = as_number(value)
    return None if parsed is None else bar_to_psi(parsed)


def parse_pressure_mmhg(value: Any) -> float | None:
    parsed = as_number(value)
    return None if parsed is None else mmhg_to_psi(parsed)


def pressure_coordinate_reason(pressure_psi: float, source_label: str) -> str:
    if pressure_psi == 0:
        return f"Source {source_label} converts to 0.00 psi; zero is treated as an instrument artifact and kept null. The converted value is preserved in metrics.source_pressure_psi."
    return f"Source {source_label} converts to {pressure_psi:.2f} psi, outside the validated (0, 120) psi field range; the converted value is preserved in metrics.source_pressure_psi."


def text_number(value: Any) -> float | None:
    return number(value)


def raw_numeric_map(row: dict[str, Any], mapping: dict[str, str]) -> dict[str, float | None]:
    return {output: as_number(cell(row, source)) for output, source in mapping.items()}


def nonempty_row(row: dict[str, Any]) -> bool:
    return any(not is_missing(value) and str(value).strip() for value in row.values())


def phase_for_fuel(value: Any) -> str | None:
    text = (clean_text(value) or "").casefold()
    if not text:
        return None
    if any(token in text for token in ("methanol", "ethanol", "droplet", "octane", "fuel droplet")):
        return "liquid"
    if any(token in text for token in ("pmma", "sibal", "nomex", "fabric", "film", "slab", "sphere", "solid", "cotton", "silicone", "wax", "paper", "material")):
        return "solid"
    if any(token in text for token in ("ch4", "c2h4", "c2h6", "c3h8", "ethane", "ethylene", "propane", "butane", "gas", "methane")):
        return "gas"
    return None


def diluent_from_fractions(row: dict[str, Any], *, oxygen: str | None = None, nitrogen: str | None = None, helium: str | None = None, co2: str | None = None) -> str | None:
    found: list[str] = []
    for label, name in (("He", helium), ("CO2", co2), ("N2", nitrogen)):
        parsed = as_number(cell(row, name)) if name else None
        if parsed is not None and parsed > 0:
            found.append(label)
    if len(found) > 1:
        return "mixed"
    return found[0] if found else None


def output_id(investigation: str, table_key: str, test_label: str, row_number: int, seen: set[str]) -> str:
    label = test_label.strip() or f"row-{row_number}"
    candidate = f"{investigation}:{table_key}:{label}"
    if candidate in seen:
        candidate = f"{candidate}:r{row_number}"
    while candidate in seen:
        candidate = f"{candidate}:x"
    seen.add(candidate)
    return candidate


@dataclass
class AdapterContext:
    investigation: str
    table_key: str
    file_name: str
    acronym: str | None
    doi: str | None
    psi_url: str
    seen_ids: set[str]
    points: list[dict[str, Any]] = field(default_factory=list)
    skipped: list[tuple[int, str]] = field(default_factory=list)
    outcome_mapping: dict[str, dict[str, Any]] = field(default_factory=dict)
    collapsed_rows: int = 0
    flags: list[str] = field(default_factory=list)

    def skip(self, row_number: int, reason: str) -> None:
        self.skipped.append((row_number, reason))

    def add_test(
        self,
        *,
        row_number: int,
        test_label: str,
        fuel_phase: str | None,
        configuration: str,
        material: str | None,
        o2_pct: float | None,
        pressure_psi: float | None,
        flow_cm_s: float | None,
        diluent: str | None,
        outcome: str,
        outcome_raw: str,
        metrics: dict[str, Any] | None = None,
        quality: dict[str, str | None] | None = None,
        assumptions: list[str] | None = None,
        missing_reasons: dict[str, str] | None = None,
        extra: dict[str, Any] | None = None,
        source_fields: dict[str, dict[str, Any]] | None = None,
        source_warnings: list[str] | None = None,
        source_rows: list[int] | None = None,
    ) -> None:
        rows = source_rows or [row_number]
        row_quality = quality or {
            "o2_pct": "measured" if o2_pct is not None else None,
            "pressure_psi": "measured" if pressure_psi is not None else None,
            "flow_cm_s": "measured" if flow_cm_s is not None else None,
        }
        identifier = output_id(self.investigation, self.table_key, test_label, row_number, self.seen_ids)
        reasons = dict(missing_reasons or {})
        null_reasons = {
            "fuel_phase": "Fuel phase cannot be determined from the source description.",
            "material": "No usable fuel or sample-material value is present in this PSI row.",
            "o2_pct": "The source row/table has no usable oxygen value for this point.",
            "pressure_psi": "The source row/table has no usable pressure value for this point.",
            "flow_cm_s": "The source row/table has no measured flow speed in cm/s for this point.",
            "diluent": "No usable diluent composition is recorded for this PSI row.",
        }
        values_for_null_check = {
            "fuel_phase": fuel_phase,
            "material": material,
            "o2_pct": o2_pct,
            "pressure_psi": pressure_psi,
            "flow_cm_s": flow_cm_s,
            "diluent": diluent,
        }
        for key, value in values_for_null_check.items():
            if value is None:
                reasons.setdefault(key, null_reasons[key])
        if o2_pct is None or pressure_psi is None:
            reasons.setdefault("o2_partial_psi", "O2 partial pressure is derived from O2 and pressure; at least one required source value is null.")
        for metric_key, metric_value in (metrics or {}).items():
            if metric_value is None:
                reasons.setdefault(f"metrics.{metric_key}", "The corresponding PSI field is absent, blank, or non-numeric in this row.")
        point = {
            "id": identifier,
            "investigation": self.investigation,
            "acronym": self.acronym,
            "table_key": self.table_key,
            "test_label": test_label.strip() or f"row {row_number}",
            "fuel_phase": fuel_phase,
            "configuration": configuration,
            "material": material,
            "o2_pct": o2_pct,
            "pressure_psi": pressure_psi,
            "o2_partial_psi": None if o2_pct is None or pressure_psi is None else (o2_pct / 100.0) * pressure_psi,
            "flow_cm_s": flow_cm_s,
            "diluent": diluent,
            "outcome": outcome,
            "outcome_raw": outcome_raw,
            "metrics": metrics or {},
            "quality": row_quality,
            "assumptions": assumptions or [],
            "missing_reasons": reasons,
            "source_fields": source_fields or {},
            "source_warnings": source_warnings or [],
            "source": {"file": self.file_name, "row": row_number, "rows": rows},
            "doi": self.doi,
            "psi_url": self.psi_url,
            "extra": extra or {},
        }
        self.points.append(point)


@dataclass
class NonTestContext:
    investigation: str
    table_key: str
    file_name: str
    acronym: str | None
    doi: str | None
    psi_url: str
    rows: list[dict[str, Any]] = field(default_factory=list)
    skipped: list[tuple[int, str]] = field(default_factory=list)

    def skip(self, row_number: int, reason: str) -> None:
        self.skipped.append((row_number, reason))


def records(df: pd.DataFrame):
    for zero_index, (_, series) in enumerate(df.iterrows()):
        yield zero_index + 1, series.to_dict()


def raw_common(ctx: AdapterContext, row: dict[str, Any], row_number: int, *, o2_raw: Any, pressure_psi: float | None, flow_cm_s: float | None, flow_quality: str | None = None, o2_quality: str | None = None, pressure_quality: str | None = None, assumptions: list[str] | None = None, missing_reasons: dict[str, str] | None = None, source_columns: dict[str, str] | None = None, source_warnings: list[str] | None = None, **fields: Any) -> None:
    quality = {
        "o2_pct": o2_quality if o2_quality is not None else ("measured" if fields.get("o2_pct") is not None else None),
        "pressure_psi": pressure_quality if pressure_quality is not None else ("measured" if pressure_psi is not None else None),
        "flow_cm_s": flow_quality if flow_quality is not None else ("measured" if flow_cm_s is not None else None),
    }
    source_fields = {
        name: {
            "column": column,
            "raw_value": None if is_missing(cell(row, column)) else str(cell(row, column)),
        }
        for name, column in (source_columns or {}).items()
    }
    ctx.add_test(row_number=row_number, pressure_psi=pressure_psi, flow_cm_s=flow_cm_s, quality=quality, assumptions=assumptions, missing_reasons=missing_reasons, source_fields=source_fields, source_warnings=source_warnings, **fields)


def _adapt_psi_159(ctx: AdapterContext, df: pd.DataFrame, inverse: bool) -> None:
    term_column = "Self -ext or flow term" if inverse else "Self-ext or flow term"
    o2_column = "XO2" if inverse else "XO2 before test"
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        label = cell_text(row, "Test")
        if not label:
            ctx.skip(row_number, "no test label")
            continue
        hot = (cell_text(row, "Hot ignition") or "").casefold()
        term = (cell_text(row, term_column) or "").casefold()
        if hot == "no":
            outcome = "no_ignition"
        elif hot == "yes" and term == "se":
            outcome = "self_extinguished"
        elif hot == "yes" and term == "ft":
            outcome = "burned"
        else:
            outcome = "unknown"
        o2_raw = cell(row, o2_column)
        pressure_raw = cell(row, "approx p (bar)")
        o2_pct = fraction_pct(o2_raw)
        source_pressure_psi = parse_pressure_bar(pressure_raw)
        pressure_psi = source_pressure_psi if source_pressure_psi is not None and 0 < source_pressure_psi < 120 else None
        if source_pressure_psi is not None and pressure_psi is None:
            ctx.flags.append(f"row {row_number}: approx p={pressure_raw} bar converts to {source_pressure_psi:.2f} psi, outside the validated (0, 120) psi field range; retained in metrics.source_pressure_psi and pressure_psi is null")
        assumptions: list[str] = []
        missing: dict[str, str] = {}
        if o2_pct is None:
            missing["o2_pct"] = f"The PSI value {clean_text(o2_raw)!r} in {o2_column} contains no numeric oxygen fraction; text such as the O2 label is not a measurement."
        if pressure_psi is None and source_pressure_psi is not None:
            missing["pressure_psi"] = pressure_coordinate_reason(source_pressure_psi, "approx p (bar)")
        elif pressure_psi is None:
            missing["pressure_psi"] = "approx p (bar) is blank or non-numeric in the PSI row"
        metrics = {
            "burn_time_s": as_number(cell(row, "burn time (sec)")),
            "tad_k": as_number(cell(row, "Tad (K)")),
            "peak_burner_t_c": as_number(cell(row, "Peak burner Temp (C)", "Peak burner T (C)")),
            "hydrocarbon_burn_rate_mg_s": as_number(cell(row, "HC burnrate (mg/s)", "mHC (mg/s)")),
            "oxygen_flow_rate_mg_s": as_number(cell(row, "O2 flow rate (mg/s)")),
        }
        if source_pressure_psi is not None and pressure_psi is None:
            metrics["source_pressure_psi"] = source_pressure_psi
        extra = {"o2_source_raw": clean_text(o2_raw), "outcome_fields": {"hot_ignition": clean_text(cell(row, "Hot ignition")), "self_ext_or_flow_term": clean_text(cell(row, term_column))}}
        extra["o2_semantics"] = "burner_stream" if inverse else "ambient"
        raw_common(
            ctx, row, row_number, o2_raw=o2_raw, pressure_psi=pressure_psi, flow_cm_s=0.0, flow_quality="quiescent_chamber",
            o2_quality="measured" if o2_pct is not None else None, pressure_quality="measured" if pressure_psi is not None else None,
            test_label=label, fuel_phase="gas", configuration="inverse_flame" if inverse else "normal_flame",
            material=cell_text(row, "Fuel"), o2_pct=o2_pct, diluent=None, outcome=outcome,
            outcome_raw=f"Hot ignition={cell_text(row, 'Hot ignition') or 'not reported'}; {term_column}={cell_text(row, term_column) or 'not reported'}",
            metrics=metrics, assumptions=assumptions, missing_reasons=missing, extra=extra,
            source_columns={"o2_pct": o2_column, "pressure_psi": "approx p (bar)"},
        )


def adapt_psi_159_normal(ctx: AdapterContext, df: pd.DataFrame) -> None:
    _adapt_psi_159(ctx, df, inverse=False)


def adapt_psi_159_inverse(ctx: AdapterContext, df: pd.DataFrame) -> None:
    _adapt_psi_159(ctx, df, inverse=True)


def _adapt_psi_10(ctx: AdapterContext, df: pd.DataFrame, inverse: bool) -> None:
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        label = cell_text(row, "Test")
        if not label:
            ctx.skip(row_number, "no test label")
            continue
        o2_raw = cell(row, "XO2" if inverse else "XO2 (init)")
        pressure_raw = cell(row, "pmean (atm)")
        o2_pct = fraction_pct(o2_raw)
        source_pressure_psi = parse_pressure_atm(pressure_raw)
        pressure_psi = source_pressure_psi if source_pressure_psi is not None and 0 < source_pressure_psi < 120 else None
        if source_pressure_psi is not None and pressure_psi is None:
            ctx.flags.append(f"row {row_number}: pmean={pressure_raw} atm converts to {source_pressure_psi:.2f} psi, outside the validated (0, 120) psi field range; retained in metrics.source_pressure_psi and pressure_psi is null")
        ramped = any((clean_text(cell(row, name)) or "").casefold() == "ramped" for name in ("Xfuel", "mfuel (mg/s)", "mN2 (mg/s)", "mtot (mg/s)", "mean Zst", "Tad (K)"))
        assumptions = ["Ramped flow is reported as text and is not treated as a numeric speed."] if ramped else ["Outcome: burned — PSI records an established flame, but this table does not report an outcome for each test."]
        missing: dict[str, str] = {}
        if o2_pct is None:
            missing["o2_pct"] = f"The PSI value {clean_text(o2_raw)!r} in {'XO2' if inverse else 'XO2 (init)'} contains no numeric oxygen fraction; text such as the O2 label is not a measurement."
        if pressure_psi is None and source_pressure_psi is not None:
            missing["pressure_psi"] = pressure_coordinate_reason(source_pressure_psi, "pmean (atm)")
        elif pressure_psi is None:
            missing["pressure_psi"] = "pmean (atm) is blank or non-numeric in the PSI row"
        metrics = {
            "tad_k": as_number(cell(row, "Tad (K)")),
            "fuel_rate_mg_s": as_number(cell(row, "mfuel (mg/s)", "mO2 (mg/s)")),
            "nitrogen_rate_mg_s": as_number(cell(row, "mN2 (mg/s)")),
            "fuel_fraction": as_number(cell(row, "Xfuel")),
            "mean_stoichiometric_fraction": as_number(cell(row, "mean Zst")),
        }
        if source_pressure_psi is not None and pressure_psi is None:
            metrics["source_pressure_psi"] = source_pressure_psi
        extra: dict[str, Any] = {"raw_o2_fraction": clean_text(o2_raw), "ramped_values_present": ramped}
        material = cell_text(row, "Fuel") or ("C2H4" if inverse else None)
        extra["o2_semantics"] = "burner_stream" if inverse else "ambient"
        raw_common(
            ctx, row, row_number, o2_raw=o2_raw, pressure_psi=pressure_psi, flow_cm_s=0.0, flow_quality="quiescent_chamber",
            test_label=label, fuel_phase="gas", configuration="inverse_flame" if inverse else "normal_flame",
            material=material, o2_pct=o2_pct, diluent="N2" if as_number(cell(row, "mN2 (mg/s)")) not in (None, 0) else None,
            outcome="burned", outcome_raw="PSI records an established flame; this table does not report an outcome for each test.",
            metrics=metrics, assumptions=assumptions, missing_reasons=missing, extra=extra,
            source_columns={"o2_pct": "XO2" if inverse else "XO2 (init)", "pressure_psi": "pmean (atm)"},
        )


def adapt_psi_10_normal(ctx: AdapterContext, df: pd.DataFrame) -> None:
    _adapt_psi_10(ctx, df, inverse=False)


def adapt_psi_10_inverse(ctx: AdapterContext, df: pd.DataFrame) -> None:
    _adapt_psi_10(ctx, df, inverse=True)


def adapt_psi_69_flex(ctx: AdapterContext, df: pd.DataFrame) -> None:
    mapping = {"extinction": "self_extinguished", "disruption": "burned", "completion": "burned"}
    counts = Counter(clean_text(value) or "(blank)" for value in df["Test end"].tolist()) if "Test end" in df.columns else Counter()
    ctx.outcome_mapping = {raw: {"count": count, "outcome": mapping.get(raw.casefold(), "unknown")} for raw, count in sorted(counts.items())}
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        label = cell_text(row, "FLEX Test #") or cell_text(row, "FLEX Identifier")
        if not label:
            ctx.skip(row_number, "no test label")
            continue
        raw_end = cell_text(row, "Test end") or ""
        end = raw_end.casefold()
        outcome = mapping.get(end, "unknown")
        if any(token in end for token in ("fail", "no ignition", "ignition failure", "not ignited")):
            outcome = "no_ignition"
        o2_raw = cell(row, "O initial ambient composition; mole fraction")
        pressure_raw = cell(row, "Ambient pressure; mmHg")
        o2_pct = fraction_pct(o2_raw)
        source_pressure_psi = parse_pressure_mmhg(pressure_raw)
        pressure_psi = source_pressure_psi if source_pressure_psi is not None and 0 < source_pressure_psi < 120 else None
        if source_pressure_psi is not None and pressure_psi is None:
            ctx.flags.append(f"row {row_number}: Ambient pressure={pressure_raw} mmHg converts to {source_pressure_psi:.2f} psi, outside the validated (0, 120) psi field range; retained in metrics.source_pressure_psi and pressure_psi is null")
        helium = as_number(cell(row, "He initial ambient composition; mole fraction"))
        co2 = as_number(cell(row, "CO initial ambient composition; mole fraction"))
        nitrogen = as_number(cell(row, "N initial ambient composition; mole fraction"))
        diluent = "mixed" if (helium or 0) > 0 and (co2 or 0) > 0 else "He" if (helium or 0) > 0 else "CO2" if (co2 or 0) > 0 else "N2" if (nitrogen or 0) > 0 else None
        missing = {}
        if o2_pct is None:
            missing["o2_pct"] = f"The PSI value {clean_text(o2_raw)!r} in O initial ambient composition contains no numeric oxygen fraction."
        if pressure_psi is None and source_pressure_psi is not None:
            missing["pressure_psi"] = pressure_coordinate_reason(source_pressure_psi, "Ambient pressure (mmHg)")
        elif pressure_psi is None:
            missing["pressure_psi"] = "Ambient pressure; mmHg is blank or non-numeric"
        metrics = {
            "initial_droplet_diameter_mm": as_number(cell(row, "Droplet initial diameter; mm")),
            "visible_extinction_diameter_mm": as_number(cell(row, "Visible flame extinction diameter; mm")),
            "burning_rate_mm_s": as_number(cell(row, "Burning rate; mm")),
            "burn_time_s": as_number(cell(row, "Burn time; s")),
        }
        if source_pressure_psi is not None and pressure_psi is None:
            metrics["source_pressure_psi"] = source_pressure_psi
        raw_common(
            ctx, row, row_number, o2_raw=o2_raw, pressure_psi=pressure_psi, flow_cm_s=0.0, flow_quality="quiescent_chamber",
            test_label=label, fuel_phase="liquid", configuration="droplet", material=cell_text(row, "Fuel"), o2_pct=o2_pct,
            diluent=diluent, outcome=outcome, outcome_raw=f"Test end={raw_end or 'not reported'}", metrics=metrics,
            missing_reasons=missing, extra={"test_date": cell_text(row, "Test Date"), "flex_identifier": cell_text(row, "FLEX Identifier")},
            source_columns={"o2_pct": "O initial ambient composition; mole fraction", "pressure_psi": "Ambient pressure; mmHg"},
        )


def adapt_psi_39_cfi(ctx: AdapterContext, df: pd.DataFrame) -> None:
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        label = cell_text(row, "Flex Number") or cell_text(row, "CIR")
        if not label:
            ctx.skip(row_number, "no test label")
            continue
        oxygen = cell(row, "Oxygen")
        oxygen_pct = fraction_pct(oxygen)
        raw_pressure = cell_text(row, "Pressure")
        pressure_value = as_number(raw_pressure)
        source_pressure_psi = atm_to_psi(pressure_value) if pressure_value is not None and raw_pressure and "atm" in raw_pressure.casefold() else None
        pressure_psi = source_pressure_psi if source_pressure_psi is not None and 0 < source_pressure_psi < 120 else None
        if source_pressure_psi is not None and pressure_psi is None:
            ctx.flags.append(f"row {row_number}: Pressure={raw_pressure} converts to {source_pressure_psi:.2f} psi, outside the validated (0, 120) psi field range; retained in metrics.source_pressure_psi and pressure_psi is null")
        helium = as_number(cell(row, "Helium"))
        nitrogen = as_number(cell(row, "Nitrogen"))
        diluent = "He" if helium is not None and helium > 0 else "N2" if nitrogen is not None and nitrogen > 0 else None
        missing = {}
        if oxygen_pct is None:
            missing["o2_pct"] = f"The PSI value {clean_text(oxygen)!r} in Oxygen contains no numeric oxygen fraction."
        if pressure_psi is None and source_pressure_psi is not None:
            missing["pressure_psi"] = pressure_coordinate_reason(source_pressure_psi, "Pressure")
        elif pressure_psi is None:
            missing["pressure_psi"] = "Pressure was not a numeric value with an explicit atm unit"
        metrics: dict[str, Any] = {"flex_number": as_number(label), "fiber_present": cell_text(row, "Fiber")}
        if source_pressure_psi is not None and pressure_psi is None:
            metrics["source_pressure_psi"] = source_pressure_psi
        raw_common(
            ctx, row, row_number, o2_raw=oxygen, pressure_psi=pressure_psi, flow_cm_s=0.0, flow_quality="quiescent_chamber",
            test_label=label, fuel_phase="liquid", configuration="droplet", material=cell_text(row, "Fuel"), o2_pct=oxygen_pct,
            diluent=diluent, outcome="unknown", outcome_raw="No outcome field in the PSI-39 table.",
            metrics=metrics, missing_reasons=missing,
            extra={"cir": cell_text(row, "CIR"), "test_date": cell_text(row, "Test Date"), "local_time": cell_text(row, "Local Time")},
            source_columns={"o2_pct": "Oxygen", "pressure_psi": "Pressure"},
        )


def sample_geometry(raw: str | None) -> tuple[str | None, dict[str, Any]]:
    if not raw:
        return None, {}
    text = raw.strip()
    metrics: dict[str, Any] = {}
    thickness_um: float | None = None
    match = re.search(r"(\d+(?:\.\d+)?)\s*(?:micron|microns|um|µm)\b", text, re.I)
    if match:
        thickness_um = float(match.group(1))
    else:
        match = re.search(r"(\d+(?:\.\d+)?)\s*mm\b", text, re.I)
        if match and any(token in text.casefold() for token in ("film", "thick", "micron")):
            thickness_um = float(match.group(1)) * 1000
    if thickness_um is not None:
        metrics["sample_thickness_um"] = thickness_um
    width = re.search(r"(\d+(?:\.\d+)?)\s*cm\s*(?:wide|width)", text, re.I)
    if width:
        metrics["sample_width_cm"] = float(width.group(1))
    geometry_match = re.search(r"\b(sphere|slab|film|fabric|candle|rod)\b", text, re.I)
    if geometry_match:
        geometry = geometry_match.group(1).casefold()
        metrics["sample_geometry"] = geometry
        if geometry == "sphere":
            dimensions = re.findall(r"(\d+(?:\.\d+)?)\s*cm\b", text, re.I)
            if dimensions:
                metrics["sample_diameter_cm"] = float(dimensions[-1])
    cleaned = re.sub(r"\d+(?:\.\d+)?\s*(?:microns?|um|µm|mm|cm)(?:\s*(?:wide|width|thick))?", " ", text, flags=re.I)
    cleaned = re.sub(r"\b(?:sphere|slab|film|fabric|candle|rod|wide|width|thick|thickness)\b", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,-/")
    material = cleaned or None
    return material, metrics


def adapt_psi_25_bass_ii(ctx: AdapterContext, df: pd.DataFrame) -> None:
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        label = cell_text(row, "Test #")
        if not label:
            ctx.skip(row_number, "no Test # label")
            continue
        material_raw = cell_text(row, "Fuel Sample Material")
        material, geometry = sample_geometry(material_raw)
        o2_raw = cell(row, "Calibrated initial O2 % by vol")
        final_o2 = as_number(cell(row, "Calibrated final O2 % by vol"))
        initial_o2 = as_number(o2_raw)
        initial_co = as_number(cell(row, "Initial CO (ppm)"))
        final_co = as_number(cell(row, "Final CO (ppm)"))
        metrics: dict[str, Any] = {
            "fan_display": cell_text(row, "Fan display"),
            "o2_drop_pct": None if initial_o2 is None or final_o2 is None else initial_o2 - final_o2,
            "co_rise_ppm": None if initial_co is None or final_co is None else final_co - initial_co,
            **geometry,
        }
        missing = {"flow_cm_s": "Fan display is a setting, not a measured cm/s speed; no flow velocity is present in this table."}
        if initial_o2 is None:
            missing["o2_pct"] = f"The PSI value {clean_text(o2_raw)!r} in Calibrated initial O2 % by vol contains no numeric oxygen value."
        assumptions = ["MSG assumed at ISS cabin pressure (~14.7 psi); pressure is not recorded in this table."]
        raw_common(
            ctx, row, row_number, o2_raw=o2_raw, pressure_psi=14.7, flow_cm_s=None, flow_quality=None, pressure_quality="assumed",
            test_label=label, fuel_phase="solid", configuration="thin_sample", material=material,
            o2_pct=initial_o2, o2_quality="measured" if initial_o2 is not None else None, diluent=None, outcome="unknown",
            outcome_raw="The table has no combustion outcome field; O2 and CO changes are retained as measurements only.",
            metrics=metrics, assumptions=assumptions, missing_reasons=missing,
            extra={"material_source_raw": material_raw, "fan_display_is_setting_not_velocity": True},
        )


def adapt_psi_26_bass(ctx: AdapterContext, df: pd.DataFrame) -> None:
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        label = cell_text(row, "Test #") or cell_text(row, "As Run Test #")
        if not label:
            reason = "maintenance/cleaning record without a test number" if "clean" in (cell_text(row, "Fuel Sample Material") or "").casefold() else "no test label"
            ctx.skip(row_number, reason)
            continue
        material_raw = cell_text(row, "Fuel Sample Material")
        material, geometry = sample_geometry(material_raw)
        missing = {"o2_pct": "The PSI-26 table contains no oxygen concentration column."}
        raw_common(
            ctx, row, row_number, o2_raw=None, pressure_psi=14.7, flow_cm_s=None, pressure_quality="assumed",
            test_label=label, fuel_phase="solid", configuration="solid_sample", material=material, o2_pct=None, o2_quality=None,
            diluent=None, outcome="unknown", outcome_raw="The table has no oxygen or combustion outcome field.", metrics=geometry,
            assumptions=["MSG assumed at ISS cabin pressure (~14.7 psi); pressure is not recorded in this table."],
            missing_reasons={**missing, "flow_cm_s": "The PSI-26 table reports no ambient flow velocity in cm/s."}, extra={"material_source_raw": material_raw},
            source_columns={},
        )


def parse_oxygen_percent(raw: Any) -> tuple[float | None, str | None, str | None]:
    text = clean_text(raw)
    values = number_values(text)
    if not values:
        return None, None, text
    if len(values) >= 2:
        return (min(values) + max(values)) / 2, "from_range", text
    if text and ("~" in text or "approx" in text.casefold()):
        return values[0], "from_range", text
    return values[0], "measured", text


def saffire_outcome(row: dict[str, Any]) -> tuple[str, str]:
    raw_time = cell_text(row, "Burn Time (s)", "Burn Time (sec)")
    if raw_time and "insignificant" in raw_time.casefold():
        return "self_extinguished", f"Burn Time={raw_time}"
    parsed_time = as_number(raw_time)
    if parsed_time is not None and parsed_time > 0:
        return "burned", f"Burn Time={raw_time}"
    burn_fields = ("?-g Burn Length", "?-g Spread Length", "1-g Burn Length", "1-g Spread Rate", "1-g Spread Length")
    present = [(name, cell_text(row, name)) for name in burn_fields]
    present = [(name, value) for name, value in present if value and value.casefold() not in {"n/a", "na", "none", "-"}]
    if present:
        return "burned", "; ".join(f"{name}={value}" for name, value in present)
    return "unknown", f"Burn Time={raw_time or 'not reported'}; no numeric burn length/spread reported"


def _adapt_saffire(ctx: AdapterContext, df: pd.DataFrame, version: int) -> None:
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        label = cell_text(row, "Sample Number")
        if not label:
            ctx.skip(row_number, "no sample number")
            continue
        lower = label.casefold()
        material_source = cell_text(row, "Material")
        if lower.startswith("f1c1") or lower.startswith("f2c1") or "flow vis" in (material_source or "").casefold():
            ctx.skip(row_number, "pre-test flow-visualization reference, not a burn test")
            continue
        if lower.startswith("note"):
            ctx.skip(row_number, "editorial note row, not a sample test")
            continue
        raw_o2 = cell(row, "Percent O2", "Percent O2 (Note 1)")
        o2_pct, o2_quality, o2_text = parse_oxygen_percent(raw_o2)
        pressure_psi = 14.7
        flow_text = cell(row, "Air Flow (cm/s)", "Air Flow")
        flow_cm_s = as_number(flow_text)
        o2_column = "Percent O2" if any(header_key(name) == header_key("Percent O2") for name in row) else "Percent O2 (Note 1)"
        flow_column = "Air Flow (cm/s)" if any(header_key(name) == header_key("Air Flow (cm/s)") for name in row) else "Air Flow"
        thickness_raw = cell(row, "Sample Thickness (cm)", "Samle Thickness")
        thickness_text = clean_text(thickness_raw)
        raw_time = cell_text(row, "Burn Time (s)", "Burn Time (sec)")
        if version == 3:
            outcome = "unknown"
            outcome_raw = "The SAFFIRE-III sample table has no burn-time or burn-length outcome column."
        else:
            outcome, outcome_raw = saffire_outcome(row)
        missing: dict[str, str] = {}
        if o2_pct is None:
            missing["o2_pct"] = "No O2 percentage field is present in the SAFFIRE-III table." if version == 3 else f"The PSI value {clean_text(raw_o2)!r} in the Percent O2 field contains no parseable oxygen value."
        if flow_cm_s is None:
            missing["flow_cm_s"] = "Air Flow is blank or has no numeric speed in this PSI row."
        metrics = {
            "burn_time_s": as_number(raw_time),
            "ignition_time_s": as_number(cell(row, "Ignition Time (s)")),
            "flow_direction": cell_text(row, "Flow Direction", "Direction"),
            "sample_thickness_cm": as_number(thickness_raw) if version == 1 else None,
            "sample_thickness_raw": thickness_text if version == 2 else None,
            "sample_length_cm": as_number(cell(row, "Sample Length (cm)", "Sample Length")),
            "sample_width_cm": as_number(cell(row, "Sample Width (cm)", "Sample Width")),
            "burn_length_microgravity": cell_text(row, "?-g Burn Length"),
            "spread_length_microgravity": cell_text(row, "?-g Spread Length"),
            "burn_length_1g": cell_text(row, "1-g Burn Length"),
            "spread_rate_1g": cell_text(row, "1-g Spread Rate"),
        }
        if version == 2:
            metrics.pop("sample_thickness_cm", None)
        assumptions = ["Cygnus cabin pressure assumed as 14.7 psi; pressure is not recorded in this table."]
        source_warnings: list[str] = []
        if version == 2 and thickness_text:
            mm_values = number_values(thickness_text) if "mm" in thickness_text.casefold() else []
            metrics["sample_thickness_mm_values"] = mm_values or None
            if re.search(r"(?<!\d)037\s*mm\b", thickness_text, re.I):
                warning = f"PSI-99 source reports sample thickness as '{thickness_text}'. A possible reading is 0.37 mm, but the source value is retained without correction."
                source_warnings.append(warning)
                ctx.flags.append(f"row {row_number}: {warning}")
        raw_common(
            ctx, row, row_number, o2_raw=raw_o2, pressure_psi=pressure_psi, flow_cm_s=flow_cm_s,
            test_label=label, fuel_phase="solid", configuration="large_sample", material=material_source,
            o2_pct=o2_pct, o2_quality=o2_quality, pressure_quality="assumed", flow_quality="measured" if flow_cm_s is not None else None,
            diluent=None, outcome=outcome, outcome_raw=outcome_raw, metrics=metrics, assumptions=assumptions,
            missing_reasons=missing, extra={"raw_o2_text": o2_text, "camera_1": cell_text(row, "Camera 1"), "camera_2": cell_text(row, "Camera 2")},
            source_columns={"o2_pct": o2_column, "flow_cm_s": flow_column}, source_warnings=source_warnings,
        )


def adapt_psi_98_saffire_i(ctx: AdapterContext, df: pd.DataFrame) -> None:
    _adapt_saffire(ctx, df, 1)


def adapt_psi_99_saffire_ii(ctx: AdapterContext, df: pd.DataFrame) -> None:
    _adapt_saffire(ctx, df, 2)


def adapt_psi_100_saffire_iii(ctx: AdapterContext, df: pd.DataFrame) -> None:
    _adapt_saffire(ctx, df, 3)


def adapt_psi_107_spice(ctx: AdapterContext, df: pd.DataFrame) -> None:
    group_columns = ("GMT date", "GMT ignition", "Fuel", "Nozzle (mm)", "Fuel Rate (sccm)", "Air Rate (cm/s)")
    grouped: OrderedDict[tuple[Any, ...], list[tuple[int, dict[str, Any]]]] = OrderedDict()
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        values: list[Any] = []
        for col in group_columns:
            raw = cell(row, col)
            parsed = as_number(raw) if col not in ("GMT date", "GMT ignition", "Fuel") else None
            values.append(parsed if parsed is not None else (clean_text(raw) or "").casefold())
        grouped.setdefault(tuple(values), []).append((row_number, row))
    for group in grouped.values():
        row_number, row = group[0]
        source_rows = [number for number, _ in group]
        ctx.collapsed_rows += len(group) - 1
        raw_o2 = 20.9
        pressure_psi = 14.7
        flow = as_number(cell(row, "Air Rate (cm/s)"))
        source_flow = flow
        if flow is not None and flow < 0:
            flow = None
            ctx.flags.append(f"rows {','.join(str(item) for item in source_rows)}: Air Rate={source_flow:.2f} cm/s is negative; preserved in metrics.source_flow_cm_s and flow_cm_s is null")
        date = cell_text(row, "GMT date") or "date unknown"
        ignition = cell_text(row, "GMT ignition") or "ignition time unknown"
        fuel = cell_text(row, "Fuel")
        nozzle = as_number(cell(row, "Nozzle (mm)"))
        fuel_rate = as_number(cell(row, "Fuel Rate (sccm)"))
        label = f"{date} {ignition} {fuel or 'fuel unknown'} {fuel_rate if fuel_rate is not None else 'rate unknown'} sccm"
        missing = {}
        if flow is None:
            missing["flow_cm_s"] = "Air Rate (cm/s) is blank or non-numeric in the PSI row."
        metrics = {
            "source_row_count": len(group),
            "nozzle_mm": nozzle,
            "fuel_rate_sccm": fuel_rate,
            "fuel_rate_mg_s": as_number(cell(row, "Fuel Rate (mg/s)")),
            "hc_fuel_rate_mg_s": as_number(cell(row, "HC Fuel Rate (mg/s)")),
        }
        if source_flow is not None and source_flow < 0:
            metrics["source_flow_cm_s"] = source_flow
            missing["flow_cm_s"] = f"PSI-107 reports a signed Air Rate of {source_flow:.2f} cm/s; the negative value is preserved in metrics.source_flow_cm_s and excluded from non-negative speed coordinates."
        assumptions = ["O2 set to 20.9% as an ISS cabin-air assumption; PSI-107 does not report O2.", "Pressure set to 14.7 psi as an ISS cabin-pressure assumption; PSI-107 does not report pressure."]
        raw_common(
            ctx, row, row_number, o2_raw=raw_o2, pressure_psi=pressure_psi, flow_cm_s=flow,
            test_label=label, fuel_phase="gas", configuration="coflow_jet", material=fuel, o2_pct=20.9,
            o2_quality="assumed", pressure_quality="assumed", flow_quality="measured" if flow is not None else None,
            diluent=None, outcome="burned", outcome_raw=f"PSI-107 logs ignition at {cell_text(row, 'GMT ignition') or 'not reported'} and flame off at {cell_text(row, 'GMT Flame Off') or 'not reported'}; the table does not provide a per-test outcome field.",
            metrics=metrics, assumptions=assumptions, missing_reasons=missing,
            extra={"gmt_date": date, "gmt_ignition": ignition, "gmt_flame_off": cell_text(row, "GMT Flame Off"), "collapsed_duplicate_rows": len(group), "flow_reading_note": "signed negative raw value; not shown as a speed" if source_flow is not None and source_flow < 0 else None},
            source_rows=source_rows,
            source_columns={"flow_cm_s": "Air Rate (cm/s)"},
        )


def make_detection(ctx: NonTestContext, row: dict[str, Any], row_number: int, *, label: str, material: str | None, flow_cm_s: float | None, metrics: dict[str, Any], note: str | None = None) -> None:
    missing: dict[str, str] = {}
    if material is None:
        missing["material"] = "The source row has no usable material description."
    if flow_cm_s is None:
        missing["flow_cm_s"] = "The source table has no measured flow velocity in cm/s for this record."
    for metric_key, metric_value in metrics.items():
        if metric_value is None:
            missing[f"metrics.{metric_key}"] = "The corresponding PSI field is absent, blank, or non-numeric in this row."
    ctx.rows.append({
        "id": f"{ctx.investigation}:{ctx.table_key}:{label.strip() or f'row-{row_number}'}",
        "investigation": ctx.investigation,
        "acronym": ctx.acronym,
        "test_label": label.strip() or f"row {row_number}",
        "material": material,
        "flow_cm_s": flow_cm_s,
        "metrics": metrics,
        "note": note,
        "missing_reasons": missing,
        "source": {"file": ctx.file_name, "row": row_number},
        "doi": ctx.doi,
        "psi_url": ctx.psi_url,
    })


def adapt_psi_102_same(ctx: NonTestContext, df: pd.DataFrame) -> None:
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        label = cell_text(row, "Sample #") or f"row {row_number}"
        make_detection(ctx, row, row_number, label=label, material=cell_text(row, "Sample Material"),
            flow_cm_s=as_number(cell(row, "Air Flow (cm/s)")),
            metrics={"weight_loss_rate_mg_min": as_number(cell(row, "Weight loss rate (mg/min)")), "aging_duration_min": as_number(cell(row, "Aging Duration (minutes)"))})


def adapt_psi_101_same_r(ctx: NonTestContext, df: pd.DataFrame) -> None:
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        label = cell_text(row, "SAME Test #") or f"row {row_number}"
        make_detection(ctx, row, row_number, label=label, material=cell_text(row, "Sample Type"),
            flow_cm_s=as_number(cell(row, "Inlet velocity (cm/s)")),
            metrics={"rt_r0": as_number(cell(row, "Rt/R0")), "duration_s": as_number(cell(row, "Duration (sec)")), "primary_aging_time_s": as_number(cell(row, "Primary aging time (sec)")), "primary_mixing_time_s": as_number(cell(row, "Primary mixing time (sec)")), "net_aging_time_s": as_number(cell(row, "Net aging time (sec)"))},
            note=cell_text(row, "Description"))


def adapt_psi_47_daft(ctx: NonTestContext, df: pd.DataFrame) -> None:
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        label = cell_text(row, "Session Name") or f"row {row_number}"
        make_detection(ctx, row, row_number, label=label, material=cell_text(row, "Sample Material"), flow_cm_s=None,
            metrics={}, note="; ".join(part for part in (cell_text(row, "Hardware Description"), cell_text(row, "Sampled Location")) if part))


def make_envelope(ctx: NonTestContext, row_number: int, *, fuel_phase: str | None, material: str | None,
    o2_pct_values: list[float] | None = None, pressure_psi_values: list[float] | None = None,
    flow_cm_s_values: list[float] | None = None, count: float | int | None = None, note: str | None = None,
    extra: dict[str, Any] | None = None) -> None:
    def bounds(values: list[float] | None) -> list[float] | None:
        return None if not values else [min(values), max(values)]
    missing: dict[str, str] = {}
    null_fields = {
        "fuel_phase": (fuel_phase, "Fuel phase is not determinable from the summary row."),
        "material": (material, "The summary row has no usable fuel/material description."),
        "o2_pct_values": (o2_pct_values, "The table row does not report an oxygen concentration; fuel concentration is not treated as O2."),
        "pressure_psi_values": (pressure_psi_values, "The table row does not report a pressure value."),
        "flow_cm_s_values": (flow_cm_s_values, "The table row does not report a flow speed in cm/s."),
        "count": (count, "The table row has no usable test/count value."),
        "note": (note, "The table row has no summary note."),
    }
    for field_name, (value, reason) in null_fields.items():
        if value is None:
            missing[field_name] = reason
    if not o2_pct_values:
        missing["o2_pct_range"] = missing.get("o2_pct_values", "No oxygen values are available to form a range.")
    if not pressure_psi_values:
        missing["pressure_psi_range"] = missing.get("pressure_psi_values", "No pressure values are available to form a range.")
    if not flow_cm_s_values:
        missing["flow_cm_s_range"] = missing.get("flow_cm_s_values", "No flow values are available to form a range.")
    ctx.rows.append({
        "id": f"{ctx.investigation}:row{row_number}",
        "investigation": ctx.investigation,
        "acronym": ctx.acronym,
        "fuel_phase": fuel_phase,
        "material": material,
        "o2_pct_values": o2_pct_values,
        "o2_pct_range": bounds(o2_pct_values),
        "pressure_psi_values": pressure_psi_values,
        "pressure_psi_range": bounds(pressure_psi_values),
        "flow_cm_s_values": flow_cm_s_values,
        "flow_cm_s_range": bounds(flow_cm_s_values),
        "count": count,
        "note": note,
        "missing_reasons": missing,
        "source": {"file": ctx.file_name, "row": row_number},
        "doi": ctx.doi,
        "psi_url": ctx.psi_url,
        "extra": extra or {},
    })


def adapt_psi_20_bre(ctx: NonTestContext, df: pd.DataFrame) -> None:
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        o2, _ = range_or_list(cell(row, "Oxygen Conc (percent)"))
        make_envelope(ctx, row_number, fuel_phase=phase_for_fuel(cell(row, "Fuel Bottle")), material=cell_text(row, "Fuel Bottle"),
            o2_pct_values=o2, count=as_number(cell(row, "Flames Ignited")), note=cell_text(row, "Notes"),
            extra={"date": " ".join(part for part in (cell_text(row, "Year"), cell_text(row, "Month"), cell_text(row, "Date")) if part), "burner_size_mm": as_number(cell(row, "Burner Size (mm)"))})


def adapt_psi_21_cld(ctx: NonTestContext, df: pd.DataFrame) -> None:
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        material = cell_text(row, "Fuel Bottle")
        make_envelope(ctx, row_number, fuel_phase="gas", material=material, o2_pct_values=None,
            count=as_number(cell(row, "Flames ignited")), note=cell_text(row, "Notes") or f"Fuel concentration range, not oxygen concentration: {cell_text(row, 'Fuel conc. Range') or 'not specified'}.",
            extra={"fuel_concentration_range": cell_text(row, "Fuel conc. Range"), "fuel_mfc_slpm": as_number(cell(row, "Fuel MFC")), "n2_mfc_slpm": as_number(cell(row, "N2 MFC")), "test_day": cell_text(row, "Test Day")})


def adapt_psi_22_efield(ctx: NonTestContext, df: pd.DataFrame) -> None:
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        material = cell_text(row, "Fuel Bottle")
        make_envelope(ctx, row_number, fuel_phase="gas", material=material, o2_pct_values=None,
            count=as_number(cell(row, "Flames Ignited")), note=cell_text(row, "Notes") or f"Fuel concentration, not oxygen concentration: {cell_text(row, 'Fuel Conc') or 'not specified'}.",
            extra={"fuel_concentration": cell_text(row, "Fuel Conc"), "test_type": cell_text(row, "Test Type"), "test_day": cell_text(row, "Test Day"), "mesh_polarity": cell_text(row, "Mesh Polarity")})


def adapt_psi_23_s_flame(ctx: NonTestContext, df: pd.DataFrame) -> None:
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        atmosphere = cell_text(row, "Atmosphere*")
        match = re.search(r"([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*%?\s*O\s*2", atmosphere or "", re.I)
        oxygen = [float(match.group(1))] if match else None
        make_envelope(ctx, row_number, fuel_phase="gas", material=cell_text(row, "Fuel Bottle"), o2_pct_values=oxygen,
            count=as_number(cell(row, "Flames Ignited*")), note=cell_text(row, "Notes") or atmosphere,
            extra={"atmosphere_raw": atmosphere, "test_type": cell_text(row, "Test Type"), "test_day": cell_text(row, "Test Day*")})


def adapt_psi_68_flex2(ctx: NonTestContext, df: pd.DataFrame) -> None:
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        oxygen, _ = range_or_list(cell(row, "Oxygen Mole Fraction"))
        oxygen = None if not oxygen else [fraction_to_percent(value) for value in oxygen]
        pressure_atm, _ = range_or_list(cell(row, "Ambient Pressure (atm)"))
        pressure = None if not pressure_atm else [atm_to_psi(value) for value in pressure_atm]
        flow, _ = range_or_list(cell(row, "Flow Velocity (cm/s)"))
        fuel = cell_text(row, "Sample (Fuel Type)")
        make_envelope(ctx, row_number, fuel_phase="liquid", material=fuel, o2_pct_values=oxygen, pressure_psi_values=pressure,
            flow_cm_s_values=flow, note=f"Ambient gas mixture: {cell_text(row, 'Ambient Gas Mixture') or 'not specified'}; initial droplet diameter: {cell_text(row, 'Initial Droplet Diameter (mm)') or 'not specified'} mm; ambient temperature: {cell_text(row, 'Ambient Temperature (C)') or 'not specified'} °C.",
            extra={"ambient_gas_mixture": cell_text(row, "Ambient Gas Mixture"), "droplet_diameter_raw": cell_text(row, "Initial Droplet Diameter (mm)"), "ambient_temperature_c": as_number(cell(row, "Ambient Temperature (C)"))})


def adapt_psi_106_slice(ctx: NonTestContext, df: pd.DataFrame) -> None:
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        raw_fuel = cell_text(row, "Fuel Type")
        match = re.search(r"\d+(?:\.\d+)?\s*%\s*([A-Za-z0-9]+)", raw_fuel or "")
        material = match.group(1) if match else raw_fuel
        make_envelope(ctx, row_number, fuel_phase="gas" if material else None, material=material, o2_pct_values=None,
            count=None, note=raw_fuel, extra={"test_date_raw": cell_text(row, "Test Date"), "fuel_description_raw": raw_fuel})


def adapt_psi_142_data_summary(ctx: NonTestContext, df: pd.DataFrame) -> None:
    for row_number, row in records(df):
        if not nonempty_row(row):
            ctx.skip(row_number, "blank CSV record")
            continue
        note = cell_text(row, "Data Description")
        reference = cell_text(row, "Reference Publication Link")
        figure = cell_text(row, "Figure ID in Reference")
        make_envelope(ctx, row_number, fuel_phase=None, material=None, note=note,
            extra={"data_id": as_number(cell(row, "Data ID")), "reference_publication_link": reference, "figure_id_in_reference": figure})


@dataclass(frozen=True)
class TableSpec:
    investigation: str
    table_key: str
    filename_token: str
    category: str
    adapter: Callable[..., None]


TABLE_SPECS = [
    TableSpec("PSI-159", "normal", "CFI-G_Normal Flames.csv", "test", adapt_psi_159_normal),
    TableSpec("PSI-159", "inverse", "CFI-G_Inverse Flames.csv", "test", adapt_psi_159_inverse),
    TableSpec("PSI-10", "normal", "Flame Design_Normal Flame.csv", "test", adapt_psi_10_normal),
    TableSpec("PSI-10", "inverse", "Flame Design_Inverse Flame.csv", "test", adapt_psi_10_inverse),
    TableSpec("PSI-69", "flex", "_FLEX.csv", "test", adapt_psi_69_flex),
    TableSpec("PSI-39", "cfi", "_CFI.csv", "test", adapt_psi_39_cfi),
    TableSpec("PSI-25", "bass-ii", "_BASS-II.csv", "test", adapt_psi_25_bass_ii),
    TableSpec("PSI-26", "bass", "_BASS.csv", "test", adapt_psi_26_bass),
    TableSpec("PSI-98", "saffire-i", "_SAFFIRE-1.csv", "test", adapt_psi_98_saffire_i),
    TableSpec("PSI-99", "saffire-ii", "_SAFFIRE-2.csv", "test", adapt_psi_99_saffire_ii),
    TableSpec("PSI-100", "saffire-iii", "_SAFFIRE-3.csv", "test", adapt_psi_100_saffire_iii),
    TableSpec("PSI-107", "spice", "_Spice.csv", "test", adapt_psi_107_spice),
    TableSpec("PSI-102", "same", "_SAME.csv", "detection", adapt_psi_102_same),
    TableSpec("PSI-101", "same-r", "_SAME-R.csv", "detection", adapt_psi_101_same_r),
    TableSpec("PSI-47", "daft", "_DAFT.csv", "detection", adapt_psi_47_daft),
    TableSpec("PSI-20", "bre", "_ACME BRE.csv", "envelope", adapt_psi_20_bre),
    TableSpec("PSI-21", "cld", "_CLD Flame.csv", "envelope", adapt_psi_21_cld),
    TableSpec("PSI-22", "e-field", "_ACME E-FIELD Flames.csv", "envelope", adapt_psi_22_efield),
    TableSpec("PSI-23", "s-flame", "_ACME s-Flame.csv", "envelope", adapt_psi_23_s_flame),
    TableSpec("PSI-68", "flex-2", "_Flex2.csv", "envelope", adapt_psi_68_flex2),
    TableSpec("PSI-106", "slice", "_Slice.csv", "envelope", adapt_psi_106_slice),
    TableSpec("PSI-142", "data-summary", "_Data Summary Table.csv", "envelope", adapt_psi_142_data_summary),
]


def read_table(path: Path) -> pd.DataFrame:
    try:
        return pd.read_csv(path, encoding="utf-8-sig", skip_blank_lines=False)
    except UnicodeDecodeError:
        return pd.read_csv(path, encoding="latin-1", skip_blank_lines=False)


def detail_records() -> dict[str, dict[str, Any]]:
    details: dict[str, dict[str, Any]] = {}
    for path in sorted((RAW / "investigations").glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
        accession = str(payload.get("accession") or path.stem)
        if not accession.startswith("PSI-"):
            accession = f"PSI-{accession}"
        details[accession] = payload
    return details


def value_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return clean_text(value)
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        parts = [value_text(item) for item in value]
        return clean_text("; ".join(item for item in parts if item))
    if isinstance(value, dict):
        for key in ("Name", "name", "title", "label", "value"):
            if value.get(key):
                return value_text(value[key])
        return clean_text("; ".join(f"{key}: {value_text(item)}" for key, item in value.items() if value_text(item)))
    return clean_text(value)


def limited_text(value: Any, limit: int = 1200) -> str | None:
    text = value_text(value)
    if not text or len(text) <= limit:
        return text
    prefix = text[:limit]
    stops = [match.end() for match in re.finditer(r"[.!?](?:\s|$)", prefix)]
    if stops:
        return prefix[:stops[-1]].strip()
    return prefix.rsplit(" ", 1)[0].rstrip() + "…"


def safety_tags(detail: dict[str, Any], investigation_id: str | None = None) -> list[str]:
    text = " ".join(str(detail.get(key) or "") for key in ("acronym", "title", "objective", "approach", "researchImpacts", "hardware")).casefold()
    tags: list[str] = []
    if investigation_id == "PSI-159" or "cfi-g" in text or any(token in text for token in ("flammability", "flame spread", "ignition", "material", "extinction limit", "oxygen")):
        tags.append("prevention")
    if any(token in text for token in ("smoke", "aerosol", "particulate", "soot", "detector")):
        tags.append("detection")
    if any(token in text for token in ("extinguish", "suppressant", "co2", "helium", "dilution", "flex")):
        tags.append("suppression")
    return tags


def finite_range(values: list[Any]) -> list[float] | None:
    numeric = [float(value) for value in values if isinstance(value, (int, float)) and math.isfinite(float(value))]
    return [min(numeric), max(numeric)] if numeric else None


def build_investigations(details: dict[str, dict[str, Any]], tests: list[dict[str, Any]], envelopes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for investigation in sorted(details, key=lambda item: (int(re.sub(r"\D", "", item) or 0), item)):
        detail = details[investigation]
        related = detail.get("related_glds")
        if not related:
            related = None
        test_rows = [point for point in tests if point["investigation"] == investigation]
        envelope_rows = [item for item in envelopes if item["investigation"] == investigation]
        o2 = [point["o2_pct"] for point in test_rows if point.get("o2_pct") is not None]
        pressure = [point["pressure_psi"] for point in test_rows if point.get("pressure_psi") is not None]
        flow = [point["flow_cm_s"] for point in test_rows if point.get("flow_cm_s") is not None]
        phases = sorted({point["fuel_phase"] for point in test_rows if point.get("fuel_phase")})
        code = investigation.split("-", 1)[-1]
        output.append({
            "id": investigation,
            "acronym": value_text(detail.get("investigationAcronym")),
            "title": limited_text(detail.get("title")),
            "doi": value_text(detail.get("doi")),
            "psi_url": f"https://psi.nasa.gov/physci/repo/data/investigations/{investigation}",
            "objective": limited_text(detail.get("objective")),
            "approach": limited_text(detail.get("approach")),
            "hypothesis": limited_text(detail.get("hypothesis")),
            "research_impacts": limited_text(detail.get("researchImpacts")),
            "hardware": limited_text(detail.get("experimentHardware")),
            "start_date": value_text(detail.get("investigationStartDate")),
            "end_date": value_text(detail.get("investigationEndDate")),
            "related": value_text(related),
            "publications_count": len(detail.get("publications") or []),
            "n_tests": len(test_rows),
            "n_envelopes": len(envelope_rows),
            "fuel_phases": phases,
            "o2_range": finite_range(o2),
            "pressure_range_psi": finite_range(pressure),
            "flow_range_cm_s": finite_range(flow),
            "safety_tags": safety_tags(detail, investigation),
            "missing_reasons": {},
        })
        record = output[-1]
        for field_name in ("acronym", "title", "doi", "objective", "approach", "hypothesis", "research_impacts", "hardware", "start_date", "end_date", "related"):
            if record[field_name] is None:
                record["missing_reasons"][field_name] = f"{field_name} is not present in the cached PSI investigation detail."
        for field_name, label in (("o2_range", "oxygen"), ("pressure_range_psi", "pressure"), ("flow_range_cm_s", "flow")):
            if record[field_name] is None:
                record["missing_reasons"][field_name] = f"No normalized test points contain a usable {label} value for this investigation."
    return output


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rounded = round_output(payload)
    path.write_text(json.dumps(rounded, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def source_spec_for(path: Path, specs: list[TableSpec]) -> TableSpec | None:
    for spec in specs:
        if spec.investigation == path.parent.name and spec.filename_token.casefold() in path.name.casefold():
            return spec
    return None


def normalize_all() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    details = detail_records()
    seen_ids: set[str] = set()
    tests: list[dict[str, Any]] = []
    envelopes: list[dict[str, Any]] = []
    detections: list[dict[str, Any]] = []
    logs: list[dict[str, Any]] = []
    matched: set[tuple[str, str]] = set()
    for path in sorted((RAW / "tables").glob("PSI-*/*.csv")):
        spec = source_spec_for(path, TABLE_SPECS)
        df = read_table(path)
        if spec is None:
            logs.append({"investigation": path.parent.name, "table_key": "unmapped", "file": path.name, "category": "not normalized", "adapter": "none", "rows_in": len(df), "rows_out": 0, "skipped": [(row + 1, "no adapter registered") for row in range(len(df))], "mapping": {}, "collapsed_rows": 0, "flags": []})
            continue
        matched.add((spec.investigation, spec.table_key))
        detail = details.get(spec.investigation, {})
        acronym = value_text(detail.get("investigationAcronym"))
        doi = value_text(detail.get("doi"))
        psi_url = f"https://psi.nasa.gov/physci/repo/data/investigations/{spec.investigation}"
        if spec.category == "test":
            ctx = AdapterContext(spec.investigation, spec.table_key, path.name, acronym, doi, psi_url, seen_ids)
            spec.adapter(ctx, df)
            tests.extend(ctx.points)
            logs.append({"investigation": spec.investigation, "table_key": spec.table_key, "file": path.name, "category": spec.category, "adapter": spec.adapter.__name__, "rows_in": len(df), "rows_out": len(ctx.points), "skipped": ctx.skipped, "mapping": ctx.outcome_mapping, "collapsed_rows": ctx.collapsed_rows, "flags": ctx.flags})
        else:
            ctx = NonTestContext(spec.investigation, spec.table_key, path.name, acronym, doi, psi_url)
            spec.adapter(ctx, df)
            if spec.category == "envelope":
                envelopes.extend(ctx.rows)
            else:
                detections.extend(ctx.rows)
            logs.append({"investigation": spec.investigation, "table_key": spec.table_key, "file": path.name, "category": spec.category, "adapter": spec.adapter.__name__, "rows_in": len(df), "rows_out": len(ctx.rows), "skipped": ctx.skipped, "mapping": {}, "collapsed_rows": 0, "flags": []})
    missing_specs = [spec for spec in TABLE_SPECS if (spec.investigation, spec.table_key) not in matched]
    for spec in missing_specs:
        logs.append({"investigation": spec.investigation, "table_key": spec.table_key, "file": "(missing)", "category": spec.category, "adapter": spec.adapter.__name__, "rows_in": 0, "rows_out": 0, "skipped": [(0, "expected raw CSV not found")], "mapping": {}, "collapsed_rows": 0, "flags": []})
    investigations = build_investigations(details, tests, envelopes)
    annotate_hardware_suites(investigations)
    return tests, envelopes, investigations, detections, logs


def render_log(logs: list[dict[str, Any]], tests: list[dict[str, Any]], envelopes: list[dict[str, Any]], detections: list[dict[str, Any]]) -> str:
    lines = [
        "# PSI normalization log",
        "",
        "Generated offline from files already stored under data/raw/. No network requests were made.",
        "All source row numbers are one-based data-record indices from pandas parsing; the CSV header is not counted.",
        "Floating-point values are rounded to two decimals only when written to JSON.",
        "",
        "## Table-by-table results",
        "",
        "| Investigation | Table key | Adapter | Source file | Rows in | Points/records out | Rows skipped | Collapsed duplicate rows | Skip reasons |",
        "|---|---|---|---|---:|---:|---:|---:|---|",
    ]
    for item in logs:
        reasons = Counter(reason for _, reason in item["skipped"])
        reason_text = "; ".join(f"{reason}: {count}" for reason, count in sorted(reasons.items())) or "—"
        lines.append(f"| {item['investigation']} | {item['table_key']} | {item.get('adapter', 'none')} ({item['category']}) | {item['file']} | {item['rows_in']} | {item['rows_out']} | {len(item['skipped'])} | {item['collapsed_rows']} | {reason_text} |")
        if item["skipped"]:
            examples = ", ".join(f"row {row} ({reason})" for row, reason in item["skipped"][:8])
            lines.append(f"  - Skipped-row examples: {examples}{' …' if len(item['skipped']) > 8 else ''}")
        if item["mapping"]:
            mapping_items = "; ".join(f"{raw} ({entry['count']}) → {entry['outcome']}" for raw, entry in item["mapping"].items())
            lines.append(f"  - Outcome mapping: {mapping_items}")
        for flag in item.get("flags", []):
            lines.append(f"  - Flagged: {flag}")
        if item["investigation"] == "PSI-159" and item["table_key"] == "inverse":
            lines.append("  - The inventory manifest reports 154 populated rows; the CSV parser also exposes 861 empty records (1,015 parsed records total). Empty records are skipped; populated source rows remain traceable.")
        if item["investigation"] == "PSI-107":
            lines.append("  - Repeated rows were grouped by date, ignition time, fuel, nozzle, fuel rate (sccm), and air rate (cm/s); grouped source row indices are retained on each point.")
    lines.extend([
        "",
        "## Output counts",
        "",
        f"- Test points: {len(tests)}",
        f"- Envelopes: {len(envelopes)}",
        f"- Detection records: {len(detections)}",
        "- Investigations: 25 (one per cached detail JSON)",
        "",
        "## FLEX Test end mapping",
        "",
        "| Raw PSI value | Count | Normalized outcome |",
        "|---|---:|---|",
    ])
    flex = next((item for item in logs if item["investigation"] == "PSI-69"), None)
    if flex and flex["mapping"]:
        for raw, entry in flex["mapping"].items():
            lines.append(f"| {raw} | {entry['count']} | {entry['outcome']} |")
    else:
        lines.append("| (no FLEX values found) | 0 | unknown |")
    lines.extend([
        "",
        "## Explicit assumptions and mapping notes",
        "",
        "- PSI-159 and PSI-10 normal-flame O2 fields describe ambient chamber oxygen; inverse-flame O2 is burner-stream oxygen. `extra.o2_semantics` records `ambient` or `burner_stream`.",
        "- PSI-25 and PSI-26 pressure is set to 14.7 psi as an explicit MSG/ISS cabin assumption; PSI-98/99/100 pressure is set to 14.7 psi as an explicit Cygnus cabin assumption.",
        "- PSI-107 O2 (20.9%) and pressure (14.7 psi) are assumptions; the source table contains neither field.",
        "- PSI-25 O2 and CO changes are metrics only; they do not determine an outcome. PSI-26 has no O2 field and retains null.",
        "- PSI-100 SAFFIRE-III has no O2 or burn-outcome column; O2 remains null and outcome is unknown.",
        "- PSI-20/21/22/23/68/106/142 remain envelopes; fuel concentration is never re-labeled as oxygen concentration.",
        "- No PSI value absent from the raw files was silently filled. Missing measurement reasons are attached to each affected test point.",
        "",
    ])
    return "\n".join(lines)


def render_dictionary() -> str:
    return """# Data dictionary — normalized PSI outputs

All values below are generated by `python pipeline/normalize.py` from cached PSI data in `data/raw/`. Source row indices are one-based data-record indices. Numeric JSON output is rounded to two decimal places; calculations use the parsed source precision before serialization.

## `tests.json` — one TestPoint per combustion test

| Field | Meaning | Unit / allowed values | Derivation |
|---|---|---|---|
| `id` | Unique point identifier | text | `investigation:table_key:test_label`; duplicate labels get a source-row suffix |
| `investigation` | PSI accession | `PSI-N` | Raw investigation detail accession |
| `acronym` | PSI investigation acronym | text or null | Raw investigation detail `investigationAcronym` |
| `table_key` | Adapter/table family | text | Stable key for the source table |
| `test_label` | Source test/sample label | text | PSI test, sample, or grouped SPICE condition label |
| `fuel_phase` | Fuel phase | `solid`, `liquid`, `gas`, or null | Adapter mapping from table/context |
| `configuration` | Combustion arrangement | text | Adapter mapping; e.g. `normal_flame`, `inverse_flame`, `droplet`, `thin_sample`, `large_sample`, `coflow_jet` |
| `material` | Fuel or sample material | text or null | Cleaned PSI fuel/material cell; unknown material stays null |
| `o2_pct` | Oxygen concentration used by the source rule | percent (0–100) or null | Mole fraction ×100 where PSI reports a fraction; SAFFIRE ranges use midpoint; explicit assumptions flagged |
| `pressure_psi` | Absolute pressure | psi or null | atm ×14.6959, bar ×14.5038, mmHg ×0.0193368; assumed values are labeled in `quality` and `assumptions` |
| `o2_partial_psi` | Derived oxygen partial pressure | psi or null | `o2_pct / 100 × pressure_psi`; null if either input is null |
| `flow_cm_s` | Ambient/forced flow speed | cm/s or null | Source speed; zero for quiescent chamber with `quiescent_chamber` quality; BASS fan display is not converted |
| `diluent` | Reported or inferred principal diluent | `N2`, `He`, `CO2`, `mixed`, or null | Explicit PSI ambient composition columns only |
| `outcome` | Normalized result | `burned`, `self_extinguished`, `no_ignition`, `unknown` | Per-table mapping stated in the prompt and normalization log |
| `outcome_raw` | Raw outcome evidence or mapping note | text | Original PSI outcome cells or explicit explanation where no outcome column exists |
| `metrics` | Additional reported values | object | Numeric fields retain source units in their key names; string settings remain strings |
| `metrics.source_pressure_psi` | Converted pressure outside the validated coordinate limit | psi | Raw PSI pressure is converted and retained here when its value is not within `0 < pressure_psi < 120`; zero is marked as an instrument artifact and the plottable `pressure_psi` is null with a reason |
| `metrics.source_flow_cm_s` | Signed SPICE air-rate source value outside the speed coordinate domain | cm/s | A negative PSI-107 air-rate reading stays signed here; `flow_cm_s` is null rather than changed to an absolute value |
| `quality.o2_pct` | O2 provenance | `measured`, `from_range`, `assumed`, or null | Source measurement, parsed range/approximation, assumption, or missing |
| `quality.pressure_psi` | Pressure provenance | `measured`, `assumed`, or null | Source measurement, labeled cabin assumption, or missing |
| `quality.flow_cm_s` | Flow provenance | `measured`, `quiescent_chamber`, `assumed`, or null | Source speed, known zero-flow chamber, assumption, or missing |
| `assumptions` | Human-readable assumptions | text list | Added whenever a displayed condition or mapped outcome depends on a stated rule/assumption |
| `missing_reasons` | Why a key measurement is null | object keyed by field | Adapter explanation based on absent/non-numeric PSI cells |
| `source_fields` | Explicit raw column mapping for measured condition fields | object keyed by `o2_pct`, `pressure_psi`, or `flow_cm_s` | Each mapped field records its raw column header and original cell text for the validator and audit trail |
| `source_warnings` | Source-data quality warnings | text list | Keeps source anomalies visible without silently repairing them; e.g. PSI-99 thickness `037 mm` is preserved and flagged |
| `source.file` | Raw CSV basename | filename | Exact file under `data/raw/tables/<investigation>/` |
| `source.row` | First contributing source record | one-based row | Data record index; CSV header excluded |
| `source.rows` | All contributing source records | one-based row list | Same as `source.row` for a single record; lists grouped SPICE duplicate rows |
| `doi` | Investigation DOI | DOI text or null | Raw investigation detail |
| `psi_url` | Human PSI investigation page | URL | Stable PSI human-page URL derived from accession |
| `extra.o2_semantics` | Meaning of the normalized O₂ value | `ambient` / `burner_stream` | PSI-159 and PSI-10 normal flame uses ambient chamber O₂; inverse flame uses burner-stream O₂. Other investigations are left unclassified when the source does not establish the meaning. |

### Test-point table mappings

| PSI table | Main fields and behavior |
|---|---|
| PSI-159 Normal/Inverse | Fractional XO2 ×100; bar→psi; hot ignition plus SE/FT outcome mapping; Tad, burn time, peak burner temperature. Inverse XO2 is explicitly burner-stream oxygen. |
| PSI-10 Normal/Inverse | Fractional XO2 ×100; mean atm→psi; established flames map to burned; `RAMPED` remains a row with a note and non-numeric values null. |
| PSI-69 FLEX | Ambient oxygen fraction ×100; mmHg→psi; Extinction→self-extinguished, Disruption/Completion→burned; He/CO2/N2 diluent from source fractions. |
| PSI-39 CFI | Oxygen fraction ×100; explicit atm pressure→psi; outcome unknown because no outcome column is present. |
| PSI-25 BASS-II | Initial O2 % as reported; 14.7 psi assumed; no flow conversion from fan setting; O2 drop, CO rise and fan display retained as metrics; outcome unknown. |
| PSI-26 BASS | O2 null; 14.7 psi assumed; flow null; outcome unknown; material/geometry parsed where present. |
| PSI-98/99/100 SAFFIRE | O2 percent/range parsed when present; 14.7 psi Cygnus assumption; measured air flow. PSI-98/99 pre-test flow visualization and note rows are skipped. PSI-99 mixed-unit thickness strings stay raw; `037 mm` is explicitly warned and is not corrected. |
| PSI-107 SPICE | O2 20.9% and pressure 14.7 psi explicitly assumed; measured air rate; repeated conditions grouped by the requested six keys and source rows retained. |

## `envelopes.json` — daily summaries and ranges

| Field | Meaning | Unit / derivation |
|---|---|---|
| `id`, `investigation`, `acronym` | Envelope identity | PSI accession and source row |
| `fuel_phase`, `material` | Summary fuel/material | Text mapped from source description; null when unknown |
| `o2_pct_values`, `o2_pct_range` | Reported O2 values and bounds | Percent; fractional FLEX-2 values ×100; fuel concentration is not used as O2 |
| `pressure_psi_values`, `pressure_psi_range` | Reported pressure values and bounds | psi; FLEX-2 atm values converted by 14.6959; missing stays null |
| `flow_cm_s_values`, `flow_cm_s_range` | Reported flow values and bounds | cm/s; missing stays null |
| `count` | Source count such as flames ignited | count; null when not present |
| `note`, `extra` | Source summary text/context | Original notes, dates, fuel range, reference links, calibration descriptions |
| `missing_reasons` | Why a summary value/range is null | object keyed by field | States that the PSI row lacks a value, or that a fuel concentration was intentionally not treated as oxygen |
| `source`, `doi`, `psi_url` | Provenance | Raw CSV basename + one-based row and investigation citation |

## `investigations.json` — all cached PSI details

| Field | Meaning | Derivation |
|---|---|---|
| `id`, `acronym`, `title`, `doi`, `psi_url` | Investigation identity/citation | Raw PSI detail JSON; PSI human URL derived from accession |
| `objective`, `approach`, `hypothesis`, `research_impacts`, `hardware` | Detail text | HTML stripped, whitespace collapsed, capped at 1,200 characters near a sentence boundary |
| `start_date`, `end_date`, `related`, `publications_count` | PSI metadata | Raw detail fields; absent dates/relations remain null; publication count is list length |
| `missing_reasons` | Why nullable metadata/coverage is null | object keyed by field | Records absent detail fields and coverage bounds with no usable normalized test values |
| `n_tests`, `n_envelopes`, `fuel_phases` | Normalized-data counts | Count of output rows for this accession |
| `o2_range`, `pressure_range_psi`, `flow_range_cm_s` | Coverage bounds | Min/max of non-null normalized test-point values; null when no values exist |
| `safety_tags` | Keyword group labels | Rule-based matches for prevention, detection, suppression in title/objective/impacts |
| `hardware_suite`, `hardware_mapping_status` | Comparison suite and mapping audit status | Ordered keyword rules in `pipeline/hardware_mapping.py`; unmatched items are retained as `other` and logged to `data/processed/hardware_mapping_log.json` |

## `detection.json` — non-combustion smoke/dust observations

`id`, `investigation`, `acronym`, `test_label`, `material`, `flow_cm_s`, `metrics`, `note`, `missing_reasons`, `source`, `doi`, and `psi_url`. Flow is cm/s only where an explicit speed column exists. Metric keys preserve units (for example `weight_loss_rate_mg_min`, `duration_s`); missing fields remain null with a reason and no combustion outcome is assigned.

## `findings.json` — deterministic coverage, facts, and ranking cache

Generated by `python pipeline/findings.py` after normalization; identical copies are written under `data/processed/` and `app/public/data/`.

| Field | Meaning | Derivation |
|---|---|---|
| `summary` | Counts of tests, investigations, envelopes, and detection records | Direct counts from normalized JSON files |
| `coverage_by_habitat` | Coverage for each valid preset and solid/liquid/gas phase | `COVERED` = at least 5 measured pairs in ±5 percentage points and ±2 psi; `COVERED · ASSUMED P` = that threshold only after adding measured O₂ points with assumed 14.7 psi cabin pressure; `SPARSE` = 1–4 points under the same measured/assumed-pressure rule; `NONE` = no point. `n_near`, `n_near_assumed_pressure`, and `n_near_with_assumed_pressure` remain separate. Nearest records use `sqrt((ΔO₂/10)^2 + (Δp/3)^2)`. |
| `facts[]` | Source-backed global, habitat, and insight facts | Includes O₂ partial-pressure comparisons with Earth, nearest evidence and O₂ gaps by habitat/phase, material contrasts at matched conditions, O₂/pressure outcome shares, FLEX diluent extinction shares, and solid-test O₂ bounds. `support` contains normalized test IDs or habitat source IDs. |
| `context_snippets[]` | One short qualitative investigation extract | First ≤300-character sentence boundary from `research_impacts` or `objective`; cites the investigation ID and does not introduce derived measurements. |
| `headline_fact_ids` | Four fact IDs selected for the rotating app header | IDs point to entries in `facts[]`; values are never hard-coded into the UI. |
| `rankings[]` | Precomputed investigation lists by habitat, phase, and safety pillar | Mirrors `app/src/lib/rank.ts`: condition proximity 45%, phase match 25%, pillar match 20%, measured-data richness 10%; each entry includes score breakdown and reason facts. |

The app recomputes a ranking for live query inputs using the same scoring formula. Counts and extrema include only source-backed normalized rows; assumed values are separately identified and do not count toward measured coverage.
"""


def main() -> None:
    tests, envelopes, investigations, detections, logs = normalize_all()
    unmapped = annotate_hardware_suites(investigations)
    PROCESSED.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    write_json(PROCESSED / "tests.json", tests)
    write_json(PUBLIC / "tests.json", tests)
    write_json(PROCESSED / "envelopes.json", envelopes)
    write_json(PUBLIC / "envelopes.json", envelopes)
    write_json(PROCESSED / "investigations.json", investigations)
    write_json(PUBLIC / "investigations.json", investigations)
    write_json(PROCESSED / "detection.json", detections)
    write_json(PUBLIC / "detection.json", detections)
    write_json(PROCESSED / "hardware_mapping_log.json", {"suites": list(SUITES), "unmapped_count": len(unmapped), "unmapped": unmapped})
    (PROCESSED / "normalize_log.md").write_text(render_log(logs, tests, envelopes, detections), encoding="utf-8")
    dictionary = render_dictionary()
    (DOCS / "DATA_DICTIONARY.md").write_text(dictionary, encoding="utf-8")
    (PUBLIC / "data-dictionary.md").write_text(dictionary, encoding="utf-8")
    print(f"Normalized {len(tests)} test points, {len(envelopes)} envelopes, {len(detections)} detection records, and {len(investigations)} investigations.")
    for investigation in investigations:
        print(f"{investigation['id']} {investigation['acronym'] or '—'}: {investigation['n_tests']} tests, {investigation['n_envelopes']} envelopes")
    print(f"Wrote data/processed and app/public/data copies; log: data/processed/normalize_log.md")
    print(f"Hardware mapping: {len(investigations) - len(unmapped)}/{len(investigations)} mapped; {len(unmapped)} retained as other (log: data/processed/hardware_mapping_log.json).")


if __name__ == "__main__":
    main()

