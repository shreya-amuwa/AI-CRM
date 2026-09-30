/**
 * ==============================================================================
 * WABASTORE SALES OS - GOOGLE APPS SCRIPT WEBHOOK & SHEET SYNC CONNECTOR
 * ==============================================================================
 * Connects your Google Spreadsheet rows directly to Wabastore Sales OS CRM.
 * 
 * Google Spreadsheet: https://docs.google.com/spreadsheets/d/1-zJLKmYkio7ussaalkJoS2yr_IMzLogx9M1xQLiBAN4/edit
 * Google Spreadsheet ID: 1-zJLKmYkio7ussaalkJoS2yr_IMzLogx9M1xQLiBAN4
 * Deployment ID: AKfycbyeCTmyncacqe88DEx83oGOqq3ltFfKuR_gTT_9viKr9FxrmpeU0Jw3gjLsJuKCnODSDQ
 * 
 * HOW TO DEPLOY IN 3 EASY STEPS:
 * 1. In your Google Sheet, click Extensions > Apps Script.
 * 2. Delete existing code, paste this entire file, and click Save (disk icon).
 * 3. Click Deploy > Manage deployments > Click Edit (pencil icon)
 *    -> Under Version, select "New version"
 *    -> Under "Who has access", select "Anyone"
 *    -> Click Deploy!
 * ==============================================================================
 */

/**
 * Handles GET requests: Reads sheet rows and returns them as clean JSON leads.
 * Called automatically when you click "Sync Google Sheet Leads" in Wabastore.
 */
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet() || ss.getSheets()[0];
    var data = sheet.getDataRange().getValues();

    if (!data || data.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        count: 0,
        leads: [],
        message: "Sheet is currently empty"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Row 0 contains column headers (e.g. Customer Name, Phone, Email, Store, Notes)
    var headers = data[0].map(function(h) {
      return String(h).trim();
    });

    var leads = [];

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      // Skip completely blank rows
      var isBlank = row.every(function(cell) {
        return cell === "" || cell === null || cell === undefined;
      });
      if (isBlank) continue;

      var leadObj = {};
      headers.forEach(function(header, colIdx) {
        var val = row[colIdx];
        leadObj[header] = val !== undefined && val !== null ? val : "";
      });
      leads.push(leadObj);
    }

    var result = {
      status: "success",
      count: leads.length,
      spreadsheetId: ss.getId(),
      spreadsheetName: ss.getName(),
      leads: leads
    };

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handles POST requests: Appends incoming leads from Wabastore / Webhooks into the sheet.
 */
function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet() || ss.getSheets()[0];
    
    var body = {};
    if (e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }

    var name = body.name || body.customer_name || body.fullName || "Customer Lead";
    var phone = body.contact || body.phone || body.mobile || "";
    var email = body.email || "";
    var store = body.company || body.store || body.organization || "Wabastore Client";
    var source = body.sourceId || body.source || "whatsapp";
    var timestamp = new Date().toISOString();

    sheet.appendRow([name, phone, email, store, source, timestamp]);

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "Lead appended successfully",
      name: name,
      phone: phone
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
