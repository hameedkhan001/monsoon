/**
 * Google Sheets live sync
 * Spreadsheet: https://docs.google.com/spreadsheets/d/1RXK1qE33E7pYQt4lcUNyUQ1V4Favo2NzAk240vjByhE/edit
 *
 * REQUIRED for live sync: deploy Apps Script from that sheet and paste the
 * Web App URL below (starts with https://script.google.com/macros/s/.../exec)
 * See: scripts/google-apps-script/SETUP.txt
 */
window.MONSOON_CONFIG = {
  spreadsheetId: "1RXK1qE33E7pYQt4lcUNyUQ1V4Favo2NzAk240vjByhE",

  // Paste Web App URL here after deploying Code.gs (not the docs.google.com link)
  sheetsApiUrl: "https://script.google.com/macros/s/AKfycbzasRVieVGA8E-gClphxLPX--N_uZJ6BlUr4AwBXcmP2y9E7eFu6YfUmgPBaohtrG1UPQ/exec",

  // Must match SECRET in Google Apps Script (Code.gs)
  sheetsSecret: "cda-monsoon-2026",

  syncIntervalMs: 5000,
};
