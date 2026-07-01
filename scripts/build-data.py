#!/usr/bin/env python3
"""Merge CDA Excel tracker with KMZ coordinates into data/points.json."""

import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path

try:
    import openpyxl
except ImportError:
    raise SystemExit("Install openpyxl: pip install openpyxl")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
EXCEL_FILE = DATA_DIR / "CDA_GSTW_Monsoon_Field_Tracking.xlsx"
OUTPUT_FILE = DATA_DIR / "points.json"
WATERWAYS_FILE = DATA_DIR / "waterways.kmz"
WATERWAYS_OUTPUT = DATA_DIR / "waterways.json"

KMZ_SOURCES = {
    "Chowk Point": (DATA_DIR / "chowk points.kmz", ["Chowk Points"]),
    "Nullah Overflow": (DATA_DIR / "chowk points.kmz", ["Nullah Overflow"]),
    "Road Flooding": (DATA_DIR / "chowk points.kmz", ["Road Flooding"]),
    "Bridge": (DATA_DIR / "Culvert & Bridge.kmz", ["Bridge"]),
    "Culvert": (DATA_DIR / "Culvert & Bridge.kmz", ["Culverts", "Pipes"]),
}

DONE_STATUSES = {
    "done",
    "completed",
    "complete",
    "yes",
    "y",
    "cleared",
    "cleaned",
    "finished",
}


def normalize_status(value):
    v = str(value or "").strip().lower()
    if v in DONE_STATUSES:
        return "done"
    return "pending"


def parse_kmz_lines(path):
    """Extract LineString geometries from a KMZ file."""
    with zipfile.ZipFile(path) as zf:
        kml_name = next(n for n in zf.namelist() if n.endswith(".kml"))
        kml = zf.read(kml_name).decode("utf-8", errors="replace")

    blocks = re.split(r"<Placemark", kml)[1:]
    lines = []

    for index, block in enumerate(blocks, start=1):
        if "LineString" not in block:
            continue

        name_match = re.search(r"<name>([^<]*)</name>", block)
        raw_name = name_match.group(1).strip() if name_match else ""
        name = raw_name if raw_name and raw_name != "0" else f"Waterway {index}"

        line_match = re.search(r"<coordinates>\s*([^<]+?)\s*</coordinates>", block, re.S)
        if not line_match:
            continue

        coordinates = []
        for token in line_match.group(1).strip().split():
            parts = token.split(",")
            if len(parts) < 2:
                continue
            lng, lat = float(parts[0]), float(parts[1])
            coordinates.append([lat, lng])

        if len(coordinates) < 2:
            continue

        lines.append(
            {
                "id": f"waterway-{index}",
                "name": name,
                "coordinates": coordinates,
            }
        )

    return lines


def build_waterways():
    if not WATERWAYS_FILE.exists():
        return [], [f"Missing waterways file: {WATERWAYS_FILE}"]

    lines = parse_kmz_lines(WATERWAYS_FILE)
    if not lines:
        return [], ["No LineString features found in waterways.kmz"]

    return lines, []


def parse_kmz(path):
    with zipfile.ZipFile(path) as zf:
        kml_name = next(n for n in zf.namelist() if n.endswith(".kml"))
        kml = zf.read(kml_name).decode("utf-8", errors="replace")

    blocks = re.split(r"<Placemark", kml)[1:]
    points = []

    for block in blocks:
        name_match = re.search(r"<name>([^<]*)</name>", block)
        name = name_match.group(1).strip() if name_match else ""

        point_match = re.search(
            r"<Point>.*?<coordinates>\s*([^<]+?)\s*</coordinates>", block, re.S
        )
        if point_match:
            parts = point_match.group(1).strip().split(",")
        else:
            line_match = re.search(r"<coordinates>\s*([^<]+?)\s*</coordinates>", block, re.S)
            if not line_match:
                continue
            parts = line_match.group(1).strip().split()[0].split(",")

        if len(parts) < 2:
            continue

        lng, lat = float(parts[0]), float(parts[1])
        points.append({"name": name, "lat": lat, "lng": lng})

    return points


def load_kmz_by_category():
    grouped = defaultdict(list)

    for category, (kmz_path, labels) in KMZ_SOURCES.items():
        if not kmz_path.exists():
            raise FileNotFoundError(f"Missing KMZ file: {kmz_path}")

        all_points = parse_kmz(kmz_path)
        for label in labels:
            grouped[category].extend([p for p in all_points if p["name"] == label])

    return grouped


def load_excel_rows():
    wb = openpyxl.load_workbook(EXCEL_FILE, read_only=True, data_only=True)
    ws = wb["Field Tracker"]
    rows = []

    for row in ws.iter_rows(min_row=5, values_only=True):
        if not row or row[0] is None:
            continue
        rows.append(
            {
                "sr": int(row[0]),
                "category": row[1],
                "location": row[2],
                "landmark": row[3],
                "status": row[6],
                "progress": row[7] if row[7] is not None else 0,
                "date": row[8],
                "team": row[9],
                "remarks": row[10],
            }
        )

    wb.close()
    return rows


def build_points():
    if not EXCEL_FILE.exists():
        raise FileNotFoundError(f"Missing Excel file: {EXCEL_FILE}")

    kmz_by_category = load_kmz_by_category()
    excel_rows = load_excel_rows()
    category_index = defaultdict(int)
    points = []
    errors = []

    for row in excel_rows:
        category = row["category"]
        idx = category_index[category]
        category_index[category] += 1

        coords_list = kmz_by_category.get(category, [])
        if idx >= len(coords_list):
            errors.append(f"No KMZ coordinate for {category} row Sr.# {row['sr']} (index {idx})")
            continue

        coord = coords_list[idx]
        landmark = row["landmark"]
        location = row["location"]
        label_parts = [category, f"#{row['sr']}"]
        if landmark:
            label_parts.append(str(landmark))
        elif location:
            label_parts.append(str(location))

        status = normalize_status(row["status"])
        if status == "pending" and row["progress"] and float(row["progress"]) >= 100:
            status = "done"

        points.append(
            {
                "id": f"sr-{row['sr']}",
                "sr": row["sr"],
                "name": " ".join(label_parts),
                "category": category,
                "lat": coord["lat"],
                "lng": coord["lng"],
                "status": status,
                "progress": float(row["progress"] or 0),
                "landmark": str(landmark).strip() if landmark else None,
                "location": str(location).strip() if location else None,
                "team": str(row["team"]).strip() if row["team"] else None,
                "remarks": str(row["remarks"]).strip() if row["remarks"] else None,
                "date": str(row["date"]) if row["date"] else None,
            }
        )

    return points, errors


def main():
    points, point_errors = build_points()
    waterways, waterway_errors = build_waterways()

    OUTPUT_FILE.write_text(json.dumps(points, indent=2), encoding="utf-8")
    WATERWAYS_OUTPUT.write_text(json.dumps(waterways, indent=2), encoding="utf-8")

    print(f"Wrote {len(points)} points to {OUTPUT_FILE}")
    print(f"Wrote {len(waterways)} waterways to {WATERWAYS_OUTPUT}")

    errors = point_errors + waterway_errors
    if errors:
        print(f"Warnings ({len(errors)}):")
        for err in errors[:10]:
            print(f"  - {err}")
        if len(errors) > 10:
            print(f"  ... and {len(errors) - 10} more")


if __name__ == "__main__":
    main()
