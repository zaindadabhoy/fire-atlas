#!/usr/bin/env python3
"""Harvest NASA PSI combustion investigations and write an auditable inventory."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Iterable

import pandas as pd
import requests


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
SEARCH_URL = "https://psi.nasa.gov/geode-py/ws/repo/search"
DETAIL_URL = "https://psi.nasa.gov/geode-py/ws/repo/investigations/{investigation_id}"
DOWNLOAD_URL = "https://psi.nasa.gov/geode-py/ws/studies/{investigation_id}/download"
TERMS = ("combustion", "flame", "fire", "smoke", "droplet", "flammability", "soot", "aerosol")
USER_AGENT = "fire-atlas-hackathon/0.1"
MEDIA_EXTENSIONS = {".mp4", ".mov", ".avi", ".mpeg", ".mpg", ".webm", ".jpg", ".jpeg", ".png", ".gif", ".tif", ".tiff", ".bmp", ".webp"}
RELEVANT = re.compile(
    r"combust|fire|flame|flammab|ignit|burn|smoke|aerosol|soot|droplet|combustion|fire safety",
    re.IGNORECASE,
)
INTEREST = {
    "o2_concentration": re.compile(r"\b(o2|xo2|oxygen|o₂)\b|oxygen.*(percent|fraction|concentration)|\bvol\.?\s*%", re.I),
    "pressure": re.compile(r"pressure|\b(bar|psi|kpa|pa|atm)\b", re.I),
    "flow_or_air_speed": re.compile(r"flow|velocity|air.?speed|gas.?speed|\b(cm/s|m/s|mm/s)\b", re.I),
    "fuel_or_material": re.compile(r"fuel|material|sample|specimen|cloth|paper|polymer|droplet|liquid|gas", re.I),
    "sample_geometry": re.compile(r"thick|diameter|width|length|geometry|dimension|area", re.I),
    "outcome": re.compile(r"ignit|extingu|burn|combust|flame|outcome|result", re.I),
}


class PSIClient:
    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json, text/plain, */*"})
        self.last_request_at = 0.0

    def request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        kwargs.setdefault("timeout", 30)
        for attempt in range(4):  # initial request plus three retries
            elapsed = time.monotonic() - self.last_request_at
            if elapsed < 0.3:
                time.sleep(0.3 - elapsed)
            try:
                response = self.session.request(method, url, **kwargs)
                self.last_request_at = time.monotonic()
                response.raise_for_status()
                return response
            except (requests.RequestException, requests.HTTPError):
                self.last_request_at = time.monotonic()
                if attempt == 3:
                    raise
                time.sleep(0.5 * (2**attempt))
        raise RuntimeError("unreachable retry state")


def read_json_response(response: requests.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return json.loads(response.content.decode("utf-8-sig"))


def total_hits(payload: dict[str, Any]) -> int | None:
    total = payload.get("hits", {}).get("total")
    if isinstance(total, dict):
        value = total.get("value")
        return int(value) if value is not None else None
    try:
        return int(total) if total is not None else None
    except (TypeError, ValueError):
        return None


def extract_hits(payload: dict[str, Any]) -> list[dict[str, Any]]:
    hits = payload.get("hits", {}).get("hits", [])
    return [h.get("_source", {}) for h in hits if isinstance(h, dict) and isinstance(h.get("_source", {}), dict)]


def fetch_term(client: PSIClient, term: str) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"term": term, "source": "psi", "type": "investigation"}
    first = read_json_response(client.request("GET", SEARCH_URL, params=params))
    results = extract_hits(first)
    total = total_hits(first)
    returned = len(results)
    if total is None or total <= returned:
        return results

    # Elasticsearch APIs usually use from/size. Try this first, then the page convention.
    print(f"  {term}: API reports {total} results; first response returned {returned}; checking pagination")
    for mode in ("from", "page"):
        paged: list[dict[str, Any]] = list(results)
        known = {
            str(hit.get("Accession") or hit.get("accession") or json.dumps(hit, sort_keys=True, ensure_ascii=False))
            for hit in paged
        }
        page_size = max(returned, 10)
        offset = returned
        failed = False
        while len(paged) < total:
            page_params = dict(params)
            if mode == "from":
                page_params.update({"size": page_size, "from": offset})
            else:
                page_params.update({"size": page_size, "page": (offset // page_size) + 1})
            try:
                payload = read_json_response(client.request("GET", SEARCH_URL, params=page_params))
                page_hits = extract_hits(payload)
            except (requests.RequestException, ValueError) as exc:
                print(f"  {term}: pagination mode {mode} failed: {exc}")
                failed = True
                break
            if not page_hits:
                failed = True
                break
            new_hits = []
            for hit in page_hits:
                identity = str(hit.get("Accession") or hit.get("accession") or json.dumps(hit, sort_keys=True, ensure_ascii=False))
                if identity not in known:
                    known.add(identity)
                    new_hits.append(hit)
            if not new_hits:
                failed = True
                break
            paged.extend(new_hits)
            offset += len(page_hits)
            if len(page_hits) < page_size:
                break
        if not failed and len(paged) >= min(total, returned + 1):
            print(f"  {term}: fetched {len(paged)} hits with {mode} pagination")
            return paged
        print(f"  {term}: {mode} pagination did not expand results; trying next convention")
    print(f"  {term}: endpoint pagination could not be confirmed; retaining {len(results)} returned hits")
    return results


def source_text(source: dict[str, Any]) -> str:
    preferred = [
        "Research Area", "SubResearch Area", "title", "Title", "Acronym", "Keywords", "keywords",
        "Objective", "objective", "Description", "description", "Abstract", "abstract",
    ]
    values: list[str] = []
    for key in preferred:
        if key in source:
            values.append(str(source[key]))
    return " ".join(values)


def keep_investigation(source: dict[str, Any]) -> tuple[bool, str]:
    text = source_text(source)
    if RELEVANT.search(text):
        return True, "relevant combustion/fire/smoke/aerosol metadata"
    # A search hit with sparse metadata is ambiguous; the instructions favor retaining it.
    populated = sum(1 for key in ("Research Area", "SubResearch Area", "title", "Title", "Acronym") if source.get(key))
    if populated < 3:
        return True, "kept: search hit has sparse metadata; relevance is uncertain"
    return False, "no combustion/fire/smoke/aerosol terms in research area, title, acronym, or keywords"


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def filename_for(item: Any) -> str | None:
    if isinstance(item, str):
        return item if item.strip() else None
    if isinstance(item, dict):
        for key in ("file_name", "filename", "fileName", "name", "file"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                return value
    return None


def collect_other_files(detail: dict[str, Any]) -> list[Any]:
    found: list[Any] = []
    seen: set[str] = set()
    for key, value in detail.items():
        if key.lower() in {"experimentaltable", "publications", "relatedinvestigations"}:
            continue
        if key.lower() not in {"files", "datafiles", "resources", "otherfiles", "associatedfiles"}:
            continue
        values = value if isinstance(value, list) else [value]
        for item in values:
            name = filename_for(item)
            identity = name or json.dumps(item, sort_keys=True, ensure_ascii=False, default=str)
            if identity not in seen:
                found.append(item)
                seen.add(identity)
    return found


def file_item_size(item: Any) -> int | None:
    if isinstance(item, dict):
        for key in ("size", "size_bytes", "fileSize", "bytes", "contentLength"):
            try:
                if item.get(key) is not None:
                    return int(item[key])
            except (TypeError, ValueError):
                pass
    return None


def safe_name(original: str) -> str:
    # Keep the source file's basename; prevent a catalog entry from escaping its folder.
    name = Path(original.replace("\\", "/")).name
    return name or "unnamed-file"


def get_signed_url(client: PSIClient, investigation_id: str, file_name: str) -> str:
    response = client.request(
        "GET",
        DOWNLOAD_URL.format(investigation_id=investigation_id),
        params={"file": file_name, "version": 1, "redirect": "false"},
    )
    signed = response.text.strip().strip('"')
    if not signed.startswith(("http://", "https://")):
        raise ValueError(f"download endpoint did not return a signed URL: {signed[:180]}")
    return signed


def download_table(client: PSIClient, investigation_id: str, file_name: str, target: Path, force: bool) -> None:
    if target.exists() and not force:
        print(f"    cached table: {target.relative_to(ROOT)}")
        return
    signed = get_signed_url(client, investigation_id, file_name)
    response = client.request("GET", signed)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(response.content)


def download_other(client: PSIClient, investigation_id: str, item: Any, target_dir: Path, force: bool) -> dict[str, Any]:
    original = filename_for(item)
    record: dict[str, Any] = {"file": original, "metadata": item if isinstance(item, dict) else None}
    if not original:
        record["downloaded"] = False
        record["reason"] = "no recognizable file name in detail metadata"
        return record
    target = target_dir / safe_name(original)
    record["path"] = target.relative_to(ROOT).as_posix()
    declared_size = file_item_size(item)
    media = Path(original).suffix.lower() in MEDIA_EXTENSIONS
    if media and declared_size is not None and declared_size > 5 * 1024 * 1024:
        record.update({"downloaded": False, "bytes": declared_size, "reason": "media file exceeds 5 MB"})
        return record
    if target.exists() and not force:
        record.update({"downloaded": True, "bytes": target.stat().st_size, "cached": True})
        return record
    try:
        signed = get_signed_url(client, investigation_id, original)
        response = client.request("GET", signed, stream=True)
        content_length = response.headers.get("Content-Length")
        if media and content_length and int(content_length) > 5 * 1024 * 1024:
            response.close()
            record.update({"downloaded": False, "bytes": int(content_length), "reason": "media file exceeds 5 MB"})
            return record
        target.parent.mkdir(parents=True, exist_ok=True)
        size = 0
        with target.open("wb") as output:
            for chunk in response.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                size += len(chunk)
                if media and size > 5 * 1024 * 1024:
                    output.close()
                    target.unlink(missing_ok=True)
                    record.update({"downloaded": False, "bytes": size, "reason": "media file exceeded 5 MB while streaming"})
                    return record
                output.write(chunk)
        response.close()
        record.update({"downloaded": True, "bytes": size})
    except Exception as exc:  # retain failure context in the manifest
        record.update({"downloaded": False, "error": str(exc)})
    return record


def load_table(path: Path) -> tuple[list[Any], list[list[Any]], int | None, str, list[str]]:
    notes: list[str] = []
    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xlsm"}:
        workbook = pd.ExcelFile(path, engine="openpyxl")
        if not workbook.sheet_names:
            return [], [], 0, "xlsx", ["workbook contains no sheets"]
        sheet = workbook.sheet_names[0]
        try:
            import openpyxl

            source_workbook = openpyxl.load_workbook(path, read_only=False, data_only=True)
            merged_ranges = list(source_workbook[sheet].merged_cells.ranges)
            if merged_ranges:
                notes.append("merged worksheet cells detected: " + ", ".join(str(value) for value in merged_ranges[:8]))
        except Exception as exc:
            notes.append(f"could not inspect worksheet merge ranges: {exc}")
        frame = pd.read_excel(path, sheet_name=sheet, header=None, dtype=object, engine="openpyxl")
        values = frame.where(pd.notna(frame), None).values.tolist()
        while values and all(value is None for value in values[-1]):
            values.pop()
        header = values[0] if values else []
        rows = values[1:4] if len(values) > 1 else []
        if any(value is None for value in header):
            notes.append("blank header cells may indicate merged or multi-row headers")
        if any(isinstance(value, str) and value != value.strip() for value in header):
            notes.append("leading or trailing whitespace detected in header cells")
        if len(values) > 1 and header and sum(value is not None for value in values[1]) >= max(2, sum(value is not None for value in header) - 1):
            second = [str(v).strip().lower() for v in values[1] if v is not None]
            header_text = [str(v).strip().lower() for v in header if v is not None]
            if second and sum(1 for v in second if any(token in v for token in ("o2", "oxygen", "pressure", "flow", "test", "sample"))) >= 2:
                notes.append("second worksheet row also resembles column labels; possible multi-row header")
        return header, rows, max(0, len(values) - 1), f"xlsx:{sheet}", notes

    if suffix in {".csv", ".txt", ".tsv", ".dat"}:
        raw = path.read_bytes()
        encoding = "utf-8-sig"
        if raw.startswith(b"\xef\xbb\xbf"):
            notes.append("UTF-8 BOM detected (removed for parsing)")
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            encoding = "latin-1"
            text = raw.decode("latin-1")
            notes.append("UTF-8 decode failed; parsed with latin-1 fallback")
        if re.search(r"[\u00a0\u2007\u2009\u200a\u202f\u3000]", text):
            notes.append("non-standard Unicode spaces detected")
        if "\ufffd" in text:
            notes.append("replacement characters detected")
        delimiter = "\t" if suffix == ".tsv" else None
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                sample = handle.read(8192)
                handle.seek(0)
                if delimiter is None:
                    try:
                        delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
                    except csv.Error:
                        delimiter = ","
                reader = csv.reader(handle, delimiter=delimiter)
                all_rows = list(reader)
        except Exception as exc:
            return [], [], None, encoding, [f"could not parse delimited file: {exc}"]
        nonempty = [row for row in all_rows if any(cell.strip() for cell in row)]
        header = nonempty[0] if nonempty else []
        rows = nonempty[1:4]
        data_rows = max(0, len(nonempty) - 1)
        if any(cell != cell.strip() for cell in header):
            notes.append("leading or trailing whitespace detected in header cells")
        # Validate via pandas with the requested encoding first, then the specified fallback.
        try:
            pd.read_csv(path, encoding="utf-8-sig", sep=delimiter, dtype=object, on_bad_lines="skip")
        except UnicodeDecodeError:
            try:
                pd.read_csv(path, encoding="latin-1", sep=delimiter, dtype=object, on_bad_lines="skip")
            except Exception as exc:
                notes.append(f"pandas row count unavailable after latin-1 fallback: {exc}")
        except Exception as exc:
            notes.append(f"pandas could not parse one or more rows: {exc}")
        if any("\n" in cell or "\r" in cell for cell in header):
            notes.append("multi-line header cell detected")
        if header and any(not cell.strip() for cell in header):
            notes.append("blank header cells may indicate merged or multi-row headers")
        if len(nonempty) > 1:
            second = [cell.strip().lower() for cell in nonempty[1] if cell.strip()]
            header_words = ("o2", "oxygen", "pressure", "flow", "test", "sample", "fuel", "result")
            if sum(1 for value in second if any(word in value for word in header_words)) >= 2:
                notes.append("second row also resembles column labels; possible multi-row header")
        return header, rows, data_rows, encoding, notes
    return [], [], None, "binary/unknown", [f"unsupported table format: {suffix or '(no extension)'}"]


def cell(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).replace("|", "\\|").replace("\r", " ").replace("\n", "<br>")


def column_summary(header: Iterable[Any]) -> dict[str, list[str]]:
    values = [str(value) for value in header]
    return {category: [name for name in values if pattern.search(name)] for category, pattern in INTEREST.items()}


def table_display(table: dict[str, Any], inventory_lines: list[str]) -> None:
    inventory_lines.append(f"### {table['file']}\n")
    inventory_lines.append(f"Path: `{table['path']}` · rows: {table.get('rows', 'unknown')} · bytes: {table.get('bytes', 'unknown')}\n")
    inventory_lines.append(f"Format/encoding: {table.get('encoding', 'unknown')}\n")
    if table.get("notes"):
        inventory_lines.append("Notes: " + "; ".join(table["notes"]) + "\n")
    header = table.get("header", [])
    inventory_lines.append("**Exact header cells (JSON-escaped to preserve whitespace and embedded newlines):**\n\n```json\n" + json.dumps(header, ensure_ascii=False) + "\n```\n")
    inventory_lines.append("**First 3 data rows:**\n")
    if header:
        inventory_lines.append("| " + " | ".join(cell(v) for v in header) + " |\n")
        inventory_lines.append("| " + " | ".join("---" for _ in header) + " |\n")
        for row in table.get("sample_rows", []):
            padded = list(row) + [None] * max(0, len(header) - len(row))
            inventory_lines.append("| " + " | ".join(cell(v) for v in padded[: len(header)]) + " |\n")
    else:
        inventory_lines.append("No readable header row.\n")
    inventory_lines.append("**Columns of interest (identification only):**\n")
    matches = table.get("columns_of_interest", {})
    for category, names in matches.items():
        inventory_lines.append(f"- {category.replace('_', ' ')}: {', '.join(f'`{name}`' for name in names) if names else 'none identified'}\n")
    inventory_lines.append("\n")


def parse_detail_fields(detail: dict[str, Any], search_source: dict[str, Any], investigation_id: str) -> dict[str, Any]:
    tables = detail.get("experimentalTable") or []
    if not isinstance(tables, list):
        tables = []
    acronym = detail.get("acronym") or detail.get("Acronym") or search_source.get("Acronym")
    title = detail.get("title") or detail.get("Title") or search_source.get("title") or search_source.get("Title")
    publication_values = detail.get("publications") or []
    dois: list[str] = []
    if isinstance(publication_values, list):
        for publication in publication_values:
            if isinstance(publication, dict):
                doi = publication.get("doi") or publication.get("DOI")
                if doi:
                    dois.append(str(doi))
            elif isinstance(publication, str) and "doi.org/" in publication:
                dois.append(publication.split("doi.org/", 1)[-1])
    doi = detail.get("doi") or detail.get("DOI") or (dois[0] if dois else None)
    hardware = detail.get("experimentHardware") or detail.get("hardware") or search_source.get("Experiment Hardware")
    related_value = detail.get("relatedInvestigations", search_source.get("relatedInvestigations"))
    related = related_value
    if related is not None and not isinstance(related, list):
        related = [related]
    related_ids = None if related is None else [str(item.get("Accession") or item.get("id") or item) if isinstance(item, dict) else str(item) for item in related]
    start_date = detail.get("startDate") or detail.get("start_date") or search_source.get("Start Date") or search_source.get("Start Date (UTC)")
    end_date = detail.get("endDate") or detail.get("end_date") or search_source.get("End Date") or search_source.get("End Date (UTC)")
    return {
        "id": investigation_id,
        "acronym": acronym,
        "title": title,
        "doi": doi,
        "hardware": hardware,
        "research_area": detail.get("Research Area") or detail.get("researchArea") or search_source.get("Research Area"),
        "sub_research_area": detail.get("SubResearch Area") or detail.get("subResearchArea") or search_source.get("SubResearch Area"),
        "start_date": start_date,
        "end_date": end_date,
        "related": related_ids,
        "tables": [],
        "other_files": [],
        "errors": [],
        "_experimental_tables": tables,
    }


def run(force: bool = False) -> int:
    client = PSIClient()
    raw_dir = RAW
    (raw_dir / "investigations").mkdir(parents=True, exist_ok=True)
    (raw_dir / "tables").mkdir(parents=True, exist_ok=True)
    discovered: OrderedDict[str, dict[str, Any]] = OrderedDict()
    unassigned_hits: list[dict[str, Any]] = []
    search_errors: list[dict[str, str]] = []
    for term in TERMS:
        print(f"Searching PSI for {term}…")
        try:
            sources = fetch_term(client, term)
        except Exception as exc:
            search_errors.append({"term": term, "error": str(exc)})
            print(f"  search failed: {exc}", file=sys.stderr)
            continue
        print(f"  received {len(sources)} result(s)")
        for source in sources:
            accession = source.get("Accession") or source.get("accession")
            if accession and str(accession).strip():
                discovered.setdefault(str(accession).strip(), source)
            else:
                unassigned_hits.append({"id": None, "search_term": term, "reason": "search result has no Accession", "search_source": source})

    kept: OrderedDict[str, dict[str, Any]] = OrderedDict()
    excluded: list[dict[str, Any]] = list(unassigned_hits)
    for investigation_id, source in discovered.items():
        keep, reason = keep_investigation(source)
        if keep:
            kept[investigation_id] = source
        else:
            excluded.append({
                "id": investigation_id,
                "title": source.get("Title") or source.get("title"),
                "acronym": source.get("Acronym") or source.get("acronym"),
                "research_area": source.get("Research Area") or source.get("research_area"),
                "reason": reason,
                "search_source": source,
            })
    write_json(raw_dir / "excluded.json", excluded)
    print(f"Discovered {len(discovered)} unique investigations; keeping {len(kept)}, excluding {len(excluded)}")

    manifest: list[dict[str, Any]] = []
    for index, (investigation_id, source) in enumerate(kept.items(), start=1):
        print(f"[{index}/{len(kept)}] {investigation_id}: fetching detail")
        record: dict[str, Any] = {"id": investigation_id, "tables": [], "other_files": [], "errors": []}
        detail_path = raw_dir / "investigations" / f"{safe_name(investigation_id)}.json"
        try:
            if detail_path.exists() and not force:
                detail = json.loads(detail_path.read_text(encoding="utf-8"))
                print("    cached investigation detail")
            else:
                detail = read_json_response(client.request("GET", DETAIL_URL.format(investigation_id=investigation_id)))
                write_json(detail_path, detail)
            if not isinstance(detail, dict):
                raise ValueError("detail endpoint did not return a JSON object")
            record.update(parse_detail_fields(detail, source, investigation_id))
            for table_entry in record.pop("_experimental_tables", []):
                if not isinstance(table_entry, dict):
                    record["errors"].append(f"experimentalTable entry is not an object: {table_entry!r}")
                    continue
                file_name = filename_for(table_entry)
                if not file_name:
                    record["errors"].append(f"experimentalTable entry missing file_name: {table_entry!r}")
                    continue
                table_path = raw_dir / "tables" / safe_name(investigation_id) / safe_name(file_name)
                table_record: dict[str, Any] = {"file": file_name, "path": table_path.relative_to(ROOT).as_posix()}
                try:
                    download_table(client, investigation_id, file_name, table_path, force)
                    table_record["bytes"] = table_path.stat().st_size
                    header, sample_rows, row_count, encoding, notes = load_table(table_path)
                    table_record.update({
                        "rows": row_count,
                        "encoding": encoding,
                        "header": header,
                        "sample_rows": sample_rows,
                        "notes": notes,
                        "columns_of_interest": column_summary(header),
                    })
                except Exception as exc:
                    table_record["error"] = str(exc)
                    record["errors"].append(f"table {file_name}: {exc}")
                    print(f"    table failed ({file_name}): {exc}", file=sys.stderr)
                record["tables"].append(table_record)
            other_items = collect_other_files(detail)
            for item in other_items:
                other_record = download_other(client, investigation_id, item, raw_dir / "files" / safe_name(investigation_id), force)
                record["other_files"].append(other_record)
        except Exception as exc:
            record["errors"].append(f"investigation detail: {exc}")
            print(f"    detail failed: {exc}", file=sys.stderr)
        record.setdefault("acronym", source.get("Acronym"))
        record.setdefault("title", source.get("title") or source.get("Title"))
        metadata_fields = ("acronym", "title", "doi", "hardware", "research_area", "sub_research_area", "start_date", "end_date", "related")
        record["missing_fields"] = [
            {"field": field, "reason": "not present in the PSI detail or search payload"}
            for field in metadata_fields
            if record.get(field) is None
        ]
        if not record.get("tables"):
            record["table_note"] = "No experimentalTable files were returned in the PSI detail payload."
        record["search_source"] = source
        manifest.append(record)

    write_json(raw_dir / "manifest.json", manifest)
    inventory: list[str] = [
        "# NASA PSI Combustion Data Inventory\n\n",
        "Generated by `python pipeline/harvest.py`. Table previews preserve source header names and values; columns are identified but not normalized.\n\n",
        f"Investigations discovered: {len(discovered)} · kept: {len(kept)} · excluded: {len(excluded)}\n\n",
        "## Investigation summary\n\n",
        "| ID | Acronym | Title | # tables | Total rows | DOI |\n| --- | --- | --- | ---: | ---: | --- |\n",
    ]
    for record in manifest:
        rows = [table.get("rows") for table in record.get("tables", []) if isinstance(table.get("rows"), int)]
        total_rows = sum(rows) if rows else "unknown"
        inventory.append(
            f"| {cell(record.get('id'))} | {cell(record.get('acronym'))} | {cell(record.get('title'))} | "
            f"{len(record.get('tables', []))} | {total_rows} | {cell(record.get('doi'))} |\n"
        )
    inventory.append("\n## Table details\n\n")
    for record in manifest:
        inventory.append(f"## {record.get('id')} — {record.get('acronym') or record.get('title') or 'untitled'}\n\n")
        if record.get("errors"):
            inventory.append("Investigation errors: " + "; ".join(record["errors"]) + "\n\n")
        for table in record.get("tables", []):
            table_display(table, inventory)
    if search_errors:
        inventory.append("## Search errors\n\n")
        for error in search_errors:
            inventory.append(f"- {error['term']}: {error['error']}\n")
    inventory.append("\n## Excluded search results\n\n")
    inventory.append(f"See `data/raw/excluded.json` for {len(excluded)} dropped hits and the reason for each.\n")
    (raw_dir / "INVENTORY.md").write_text("".join(inventory), encoding="utf-8")
    print(f"Wrote {len(manifest)} manifest entries to {raw_dir / 'manifest.json'}")
    print(f"Wrote inventory to {raw_dir / 'INVENTORY.md'}")
    if search_errors:
        print(f"Warning: {len(search_errors)} search term(s) failed; see inventory search errors", file=sys.stderr)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="re-download existing details and tables")
    args = parser.parse_args()
    return run(force=args.force)


if __name__ == "__main__":
    raise SystemExit(main())
