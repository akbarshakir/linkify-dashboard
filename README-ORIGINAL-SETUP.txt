LINKIFY DASHBOARD — OCTOBER LIVE-LINK FIX

Why: Some October cells appear to use rich-text hyperlinks. Google’s public GViz feed can return visible text but omit the actual link target. This version uses a read-only Apps Script endpoint to retrieve both.

ONE-TIME SETUP
1. Open https://script.google.com/ and sign in to the Google account that can access your spreadsheet.
2. Create a New project. In Code.gs, replace the sample code with the complete contents of the Code.gs file in this ZIP. Save.
3. Click Deploy > New deployment. Choose Web app.
4. Set Execute as: Me. Set Who has access: Anyone. Click Deploy and approve the Google permission prompt.
5. Copy the Web app URL ending in /exec.
6. Open script.js in this ZIP. Near the top, The deployed Apps Script URL is already filled in script.js. If you create a new deployment, replace CONFIG.APPS_SCRIPT_URL with the new URL and save.
7. Keep index.html, style.css and script.js in the same folder. Open index.html, sign in, click Sync Now, and test October 2026.

Files: index.html, style.css, script.js, Code.gs, README.txt. Code.gs is pasted into Google Apps Script; it is not a browser file.

Privacy: The endpoint is read-only. Anyone who obtains its URL can read the configured sheet tabs, so only share the URL with people allowed to see the spreadsheet. Never put Google private keys or Supabase service-role keys in frontend files.

LIVE URL FIX: script.js now prioritizes actual rich-text hyperlink targets and falls back to linked cells elsewhere in the row if a sheet uses an unexpected column heading. If a row has multiple unrelated hyperlinks, check the live URL column header and make it explicit in liveAlts.
