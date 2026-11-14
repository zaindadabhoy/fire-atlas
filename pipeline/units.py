"""Shared, explicit unit conversions for the NASA PSI normalization pipeline."""

from __future__ import annotations

import math
import re
from typing import Any


ATM_TO_PSI = 14.6959
BAR_TO_PSI = 14.5038
MMHG_TO_PSI = 0.0193368


def atm_to_psi(value: float) -> float:
    return value * ATM_TO_PSI


def bar_to_psi(value: float) -> float:
    return value * BAR_TO_PSI


def mmhg_to_psi(value: float) -> float:
    return value * MMHG_TO_PSI


def fraction_to_percent(value: float) -> float:
    return value * 100.0


def is_missing(value: Any) -> bool:
    if value is None:
        return True
    try:
        return bool(math.isnan(float(value)))
    except (TypeError, ValueError, OverflowError):
        return False


def number(value: Any) -> float | None:
    """Return the first finite numeric token in a PSI cell, or None."""
    if is_missing(value):
        return None
    if isinstance(value, (int, float)):
        result = float(value)
        return result if math.isfinite(result) else None
    text = str(value).strip().replace(",", "")
    if not text or text.casefold() in {"none", "n/a", "na", "null", "-", "—"}:
        return None
    match = re.search(r"(?<![A-Za-z0-9_])[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?", text)
    if not match:
        return None
    try:
        result = float(match.group(0))
    except ValueError:
        return None
    return result if math.isfinite(result) else None


def number_values(value: Any) -> list[float]:
    """Parse numeric list/range cells without treating units as values."""
    if is_missing(value):
        return []
    if isinstance(value, (int, float)):
        parsed = number(value)
        return [] if parsed is None else [parsed]
    text = str(value).strip()
    if not text:
        return []
    # A spaced or adjacent dash between two numbers is a range separator, not
    # a negative sign (for example, "21.5 - 21.7" and "1.5-5").
    normalized = re.sub(r"(?<=\d)\s*[-–—]\s*(?=\d)", " ", text.replace(",", ""))
    matches = re.findall(r"(?<![A-Za-z0-9_])[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?", normalized)
    values: list[float] = []
    for token in matches:
        try:
            parsed = float(token)
        except ValueError:
            continue
        if math.isfinite(parsed):
            values.append(parsed)
    return values


def range_or_list(value: Any) -> tuple[list[float] | None, list[float] | None]:
    """Return parsed values and their min/max range; both are null if absent."""
    values = number_values(value)
    if not values:
        return None, None
    unique_values = list(dict.fromkeys(values))
    return unique_values, [min(unique_values), max(unique_values)]


def round_output(value: Any) -> Any:
    """Round numeric output recursively, leaving integers and non-numbers intact."""
    if isinstance(value, dict):
        return {key: round_output(item) for key, item in value.items()}
    if isinstance(value, list):
        return [round_output(item) for item in value]
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return round(value, 2)
    return value
