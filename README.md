# Monsoon Portal

Islamabad monsoon field clearance map — live status via Google Sheets.

**Live site:** https://monsoon-omega.vercel.app

## Features

- 327 field points + waterways on OSM / hybrid / satellite map
- Green = done, red = pending
- Live team sync via Google Sheet (no database)
- Mobile-friendly full-screen map with slide-up panel

## Data

| Runtime (on Vercel) | Source |
|---------------------|--------|
| `data/points.json` | Map locations |
| `data/waterways.json` | Nullah lines |
| Google Sheet | Shared status (live sync) |

Rebuild map data from Excel + KMZ: `python scripts/build-data.py`

## Config

`js/config.js` — Google Apps Script Web App URL for live sync.

Setup: `scripts/google-apps-script/SETUP.txt`
