# Monsoon Portal

Islamabad monsoon field clearance map.

**Live site:** https://monsoon-omega.vercel.app

## One file for everything: Google Sheet

Your team edits **one Google Sheet** — the map updates automatically (~5 seconds). No redeploy, no Excel, no KMZ.

| Column | Required | Example |
|--------|----------|---------|
| id | Yes | sr-328 |
| name | Yes | Culvert #328 |
| category | Yes | Culvert |
| latitude | Yes | 33.6844 |
| longitude | Yes | 73.0479 |
| status | Yes | pending / done |

Optional: sr, updatedAt, landmark, location, team, remarks

**Guide for field team:** `data/SHEET-GUIDE.txt`

## Waterways

Nullah lines still come from `data/waterways.json` (rarely changed).

## Apps Script update (one time)

If adding new points does not appear on map, update Apps Script:
1. Extensions → Apps Script → paste `scripts/google-apps-script/Code.gs`
2. Deploy → Manage deployments → Edit → **New version** → Deploy
