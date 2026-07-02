/**
 * Google Apps Script — full map data from sheet (no database).
 *
 * Sheet columns (row 1 headers):
 * id | sr | name | category | latitude | longitude | status | updatedAt
 * Optional: landmark, location, team, remarks, progress %
 *
 * Deploy: Web app → Execute as Me → Anyone can access
 */

const SECRET = "cda-monsoon-2026";
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

function pickColumn(cols, names) {
  for (var i = 0; i < names.length; i++) {
    if (cols[names[i]] !== undefined) return cols[names[i]];
  }
  return undefined;
}

function readAllPoints() {
  const sheet = getDataSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0];
  const cols = getColumnMap(headers);

  if (cols.id === undefined) {
    throw new Error('Sheet must have an "id" column in row 1');
  }

  const latCol = pickColumn(cols, ["latitude", "lat"]);
  const lngCol = pickColumn(cols, ["longitude", "lng", "lon", "long"]);
  const updatedCol = pickColumn(cols, ["updatedat", "updated at"]);
  const progressCol = pickColumn(cols, ["progress %", "progress"]);

  if (latCol === undefined || lngCol === undefined) {
    throw new Error('Sheet must have "latitude" and "longitude" columns');
  }

  return values
    .slice(1)
    .map(function (row, index) {
      const id = String(row[cols.id] || "").trim();
      if (!id) return null;

      const lat = parseFloat(row[latCol]);
      const lng = parseFloat(row[lngCol]);
      if (!isFinite(lat) || !isFinite(lng)) return null;

      const sr = cols.sr !== undefined && row[cols.sr] !== "" ? row[cols.sr] : index + 1;
      const name =
        cols.name !== undefined && row[cols.name]
          ? String(row[cols.name])
          : (cols.category !== undefined && row[cols.category]
              ? String(row[cols.category]) + " #" + sr
              : id);

      return {
        id: id,
        sr: sr,
        name: name,
        category: cols.category !== undefined ? String(row[cols.category] || "") : "",
        lat: lat,
        lng: lng,
        status: String(cols.status !== undefined ? row[cols.status] || "pending" : "pending").toLowerCase(),
        updatedAt: updatedCol !== undefined && row[updatedCol] ? String(row[updatedCol]) : "",
        landmark: cols.landmark !== undefined ? String(row[cols.landmark] || "") : "",
        location: cols.location !== undefined ? String(row[cols.location] || "") : "",
        team: cols.team !== undefined ? String(row[cols.team] || "") : "",
        remarks: cols.remarks !== undefined ? String(row[cols.remarks] || "") : "",
        progress: progressCol !== undefined ? row[progressCol] : 0,
      };
    })
    .filter(function (row) {
      return row;
    });
}

function doGet() {
  try {
    return jsonResponse(readAllPoints());
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
    throw new Error('Sheet must have "id" and "status" columns');
  }

  const updatedCol = pickColumn(cols, ["updatedat", "updated at"]);
  const progressCol = pickColumn(cols, ["progress %", "progress"]);
  const when = updatedAt || new Date().toISOString();
  const displayStatus = status === "done" ? "done" : "pending";

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][cols.id]) === String(id)) {
      sheet.getRange(i + 1, cols.status + 1).setValue(displayStatus);
      if (updatedCol !== undefined) {
        sheet.getRange(i + 1, updatedCol + 1).setValue(when);
      }
      if (progressCol !== undefined) {
        sheet.getRange(i + 1, progressCol + 1).setValue(status === "done" ? 100 : 0);
      }
      return;
    }
  }

  throw new Error("Point not found: " + id);
}
