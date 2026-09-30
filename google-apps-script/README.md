# Google Apps Script Sync for Wabastore Sales OS

This directory contains the code to connect your Google Sheet directly to Wabastore Sales OS.

- **Google Spreadsheet**: `https://docs.google.com/spreadsheets/d/1-zJLKmYkio7ussaalkJoS2yr_IMzLogx9M1xQLiBAN4/edit`
- **Apps Script File**: `Code.gs`

## Quick Setup:
1. Open your Google Sheet, click **Extensions > Apps Script**.
2. Replace everything in `Code.gs` with the content of `Code.gs` from this folder.
3. Click **Save** (disk icon).
4. Click **Deploy > Manage deployments**:
   - Click the **Edit** (pencil) icon.
   - Change **Version** to **"New version"**.
   - Ensure **Who has access** is set to **"Anyone"**.
   - Click **Deploy**.
5. In Wabastore Sales OS, click **"Sync Google Sheet Leads"**.

## Alternative 10-Second Setup (Zero Apps Script Required):
In your Google Sheet:
1. Click the green **Share** button in the top right.
2. Under **General access**, change from **"Restricted"** to **"Anyone with the link"** (Viewer).
3. In Wabastore Sales OS, click **"Sync Google Sheet Leads"**!
