# Google Apps Script Sync for Wabastore Sales OS

This directory contains the code that lets the CRM read leads from a Google Sheet (and append leads to it).

The web app runs as the sheet owner and anyone who has its URL can call it, so it is protected by a key
(`CRM_SHEET_KEY` in Script Properties) that every request must send as `?key=...`. Never commit the web app URL,
the spreadsheet link or the key; the CRM's JavaScript is public. See `docs/security/FINDINGS.md` (SEC-2026-004).

## Setup
1. Open the Google Sheet, click **Extensions > Apps Script**.
2. Replace everything in `Code.gs` with the content of `Code.gs` from this folder and click **Save**.
3. **Project Settings > Script Properties > Add property**: `CRM_SHEET_KEY` = a random value of 32+ characters
   (for example the output of `openssl rand -hex 24`). Keep it in your password manager.
4. **Deploy > New deployment** (type *Web app*, execute as *Me*, access *Anyone*). Copy the new web app URL.
5. **Deploy > Manage deployments**: **archive every older deployment**. An archived deployment's URL stops working;
   the old URL was public in earlier versions of the app.
6. In the CRM (Wabastore > Remote Leads API), paste `<web app URL>?key=<CRM_SHEET_KEY>` and click
   **Sync Google Sheet Leads**. The value is remembered in that browser only.

Keep the sheet's own sharing on **Restricted**. Do not use "Anyone with the link": the link would then be the only
thing protecting the customers' names, phone numbers and e-mail addresses.
