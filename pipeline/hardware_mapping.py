"""Challenge-defined investigation-to-hardware-suite mapping for Compare."""

from __future__ import annotations

from typing import Any


SUITES = (
    "CIR + ACME",
    "CIR + MDCA",
    "MSG + SPICE flow duct",
    "Saffire on Cygnus",
    "Smoke / aerosol instruments",
    "Analysis / modeling (ground)",
)

_INVESTIGATION_SUITES = {
    "PSI-20": "CIR + ACME",
    "PSI-21": "CIR + ACME",
    "PSI-22": "CIR + ACME",
    "PSI-23": "CIR + ACME",
    "PSI-10": "CIR + ACME",
    "PSI-159": "CIR + ACME",
    "PSI-69": "CIR + MDCA",
    "PSI-68": "CIR + MDCA",
    "PSI-39": "CIR + MDCA",
    "PSI-26": "MSG + SPICE flow duct",
    "PSI-25": "MSG + SPICE flow duct",
    "PSI-107": "MSG + SPICE flow duct",
    "PSI-106": "MSG + SPICE flow duct",
    "PSI-98": "Saffire on Cygnus",
    "PSI-99": "Saffire on Cygnus",
    "PSI-100": "Saffire on Cygnus",
    "PSI-102": "Smoke / aerosol instruments",
    "PSI-101": "Smoke / aerosol instruments",
    "PSI-47": "Smoke / aerosol instruments",
    "PSI-179": "Smoke / aerosol instruments",
    "PSI-60": "Analysis / modeling (ground)",
    "PSI-62": "Analysis / modeling (ground)",
    "PSI-115": "Analysis / modeling (ground)",
    "PSI-117": "Analysis / modeling (ground)",
    "PSI-142": "Analysis / modeling (ground)",
}


def map_hardware_suite(investigation: dict[str, Any]) -> tuple[str, str, str]:
    identifier = str(investigation.get("id") or "")
    suite = _INVESTIGATION_SUITES.get(identifier)
    if suite:
        return suite, "mapped", "explicit challenge mapping by PSI investigation id"
    # Preserve a visible audit flag for a future investigation outside the supplied set.
    return "Analysis / modeling (ground)", "unmapped", "investigation id is not in the explicit challenge mapping"


def annotate_hardware_suites(investigations: list[dict[str, Any]]) -> list[dict[str, str | None]]:
    unmapped: list[dict[str, str | None]] = []
    for item in investigations:
        suite, status, reason = map_hardware_suite(item)
        item["hardware_suite"] = suite
        item["hardware_mapping_status"] = status
        if status == "unmapped":
            unmapped.append({
                "id": str(item.get("id") or ""),
                "acronym": item.get("acronym"),
                "title": item.get("title"),
                "hardware": item.get("hardware"),
                "suite": suite,
                "reason": reason,
            })
    return unmapped
