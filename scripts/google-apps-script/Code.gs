/**
 * Google Apps Script — shared status store (no database).
 *
 * Works with:
 * - google-sheet-status.csv  (3 columns: id, status, updatedAt)
 * - google-sheet-all-points.csv  (full sheet — updates status + updatedAt columns)
 *
 * SETUP:
 * 1. Paste your CSV into Google Sheet (row 1 = headers)
 * 2. Extensions → Apps Script → paste this file → Save
 * 3. Change SECRET below
 * 4. Deploy → New deployment → Web app (Execute as: Me, Anyone)
 * 5. Copy Web App URL into js/config.js
 */

const SECRET = "cda-monsoon-2026";

// Leave empty to use the first sheet tab. Or set e.g. "Sheet1" or "all_points"
const SHEET_NAME = "";

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getDataSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (SHEET_NAME) {
    const named = ss.getSheetByName(SHEET_NAME);
    if (named) return named;
  }
  return ss.getSheets()[0];
}

function getColumnMap(headers) {
  const map = {};
  for (var i = 0; i < headers.length; i++) {
    const key = String(headers[i] || "")
      .trim()
      .toLowerCase();
    if (key) map[key] = i;
  }
  return map;
}

function readStatusRows() {
  const sheet = getDataSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0];
  const cols = getColumnMap(headers);

  if (cols.id === undefined || cols.status === undefined) {
    throw new Error('Sheet must have "id" and "status" columns in row 1');
  }

  const updatedCol = cols.updatedat !== undefined ? cols.updatedat : cols["updated at"];

  return values.slice(1).map(function (row) {
    return {
      id: String(row[cols.id] || ""),
      status: String(row[cols.status] || "pending").toLowerCase(),
      updatedAt: updatedCol !== undefined && row[updatedCol] ? String(row[updatedCol]) : "",
    };
  }).filter(function (row) {
    return row.id;
  });
}

function doGet() {
  try {
    return jsonResponse(readStatusRows());
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.secret !== SECRET) {
      return jsonResponse({ ok: false, error: "unauthorized" });
    }

    if (body.action === "updateStatus") {
      updateStatus(body.id, body.status, body.updatedAt);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: false, error: "unknown action" });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function updateStatus(id, status, updatedAt) {
  const sheet = getDataSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const cols = getColumnMap(headers);

  if (cols.id === undefined || cols.status === undefined) {
    throw new Error('Sheet must have "id" and "status" columns in row 1');
  }

  const updatedCol = cols.updatedat !== undefined ? cols.updatedat : cols["updated at"];
  const when = updatedAt || new Date().toISOString();

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][cols.id]) === String(id)) {
      sheet.getRange(i + 1, cols.status + 1).setValue(status);
      if (updatedCol !== undefined) {
        sheet.getRange(i + 1, updatedCol + 1).setValue(when);
      }
      return;
    }
  }

  throw new Error("Point not found: " + id);
}
