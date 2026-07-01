# CDA GSTW Monsoon Cleaning Portal

Map portal for Islamabad monsoon field clearance — **327 points** from your Excel tracker, positioned using KMZ files.

## Your data (in `data/`)

| File | Purpose |
|------|---------|
| `CDA_GSTW_Monsoon_Field_Tracking.xlsx` | Status, category, Sr.#, team, remarks |
| `chowk points.kmz` | Coordinates for Chowk, Nullah, Road Flooding |
| `Culvert & Bridge.kmz` | Coordinates for Culverts, Bridges, Pipes |
| `waterways.kmz` | Nullah / waterway route lines |
| `points.json` | Merged map data (auto-generated) |
| `waterways.json` | Waterway line geometry (auto-generated) |

**Categories loaded:** Chowk Point (43), Nullah Overflow (4), Road Flooding (50), Bridge (81), Culvert (149), Waterways (68 lines)

## Quick start

```powershell
cd C:\Users\ah759\Downloads\monsoon
python -m http.server 5500
```

Open [http://localhost:5500](http://localhost:5500)

## After updating Excel or KMZ files

Re-build the map data:

```powershell
python scripts/build-data.py
```

Then click **Reload Data** in the portal (or refresh the page).

## Map features

- **Green** = Done / cleaned
- **Red** = Pending / not done
- Layers: OSM street, Hybrid, Satellite
- Filter by status or category
- Toggle **Show waterways** to display nullah routes in blue
- Click a point → **Mark as Done (Yes)**
- **Export Status** → Excel with your tracker columns

Status is saved in the browser. Use Export to share updates between machines.

## Notes

- `waterways.kmz` is shown as blue lines on the map (reference routes, not status-tracked points).
- Coordinates are matched to Excel rows by **category + order** within each KMZ layer.
