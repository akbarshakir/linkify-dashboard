LINKIFY DASHBOARD — VERSION 2 (SEPARATE COPY)

IMPORTANT
This is a separate Version 2 folder. Your previously working files are not overwritten. Keep your original folder as the rollback version.

WHAT CHANGED
1. Preserves the existing Apps Script JSONP sync and rich-text live URL extraction logic. Code.gs is included unchanged from the files you supplied. Do not redeploy Apps Script just for these UI/export changes.
2. Adds Agency/Vendor name as a visible column in the desktop table and mobile cards. The value comes from your existing Google Sheet Agency column. No new sheet column is added.
3. Keeps search across website, live URL, client, agency, serial and month. Searching a live URL still shows the matching order's full available details.
4. Adds Export Client Excel and Export Agency Excel buttons. Both export only the records currently visible after applying search, month, agency, client, currency and Current/Preserved view filters.

EXPORT FORMATS
Client Excel: Website | Live URL | Client Price
Agency Excel: Agency Name | Website | Live URL | Agency Price
Live URLs and website URLs are written as clickable hyperlinks where supported by Excel. Price values remain numeric with currency formatting.

HOW TO TEST
1. Keep your original folder untouched. Extract this ZIP into a new folder such as Linkify-Dashboard-V2.
2. Keep index.html, style.css, script.js and Code.gs together. Code.gs remains deployed in Apps Script; it is included for reference/backup.
3. Open index.html, sign in and click Sync Now. Confirm September and October orders load and live links still open correctly.
4. Search for a known live URL. Confirm the row shows website, client, agency/vendor, both prices and other available order details.
5. Select a client in the Client filter, then click Export Client Excel. Confirm only Website, Live URL and Client Price columns are present.
6. Select an agency in the Agency filter, then click Export Agency Excel. Confirm only Agency Name, Website, Live URL and Agency Price columns are present.
7. Test combinations of search and filters; exports use the filtered result set.

DEPENDENCIES
Supabase JS and SheetJS (XLSX export) are loaded from jsDelivr CDN, so an internet connection is required.

SAFETY
This dashboard reads Google Sheets and does not write to the sheet. Do not place Google private keys or Supabase service-role keys in browser code.
