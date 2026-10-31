
/** Linkify Dashboard read-only Google Sheets endpoint. */

const SPREADSHEET_ID = "1mnA7uwwDDePadQ5irlmaQ0gk67awQyHHmIAi6NCvzeo";

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = String(p.action || "").trim();
  const tabName = String(p.tab || "").trim();
  const callback = String(p.callback || "").trim();

  let result;

  try {
    // Open spreadsheet once for both actions
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);

    // Automatically discover monthly tabs
    if (action === "listTabs") {
      const monthNames = [
        "Jan", "January", "Feb", "February",
        "Mar", "March", "Apr", "April",
        "May", "Jun", "June", "Jul", "July",
        "Aug", "August", "Sep", "September",
        "Oct", "October", "Nov", "November",
        "Dec", "December"
      ];

      const monthTabs = spreadsheet.getSheets()
        .map(sheet => sheet.getName())
        .filter(name => {
          const match = name.match(/^([A-Za-z]+)\s+(\d{2}|\d{4})$/);

          if (!match) return false;

          return monthNames.some(
            month => month.toLowerCase() === match[1].toLowerCase()
          );
        });

      result = { tabs: monthTabs };

    } else {
      if (!tabName) {
        throw new Error("Missing tab parameter.");
      }

      const sheet = spreadsheet.getSheetByName(tabName);

      if (!sheet) {
        throw new Error('Tab not found: "' + tabName + '".');
      }

      const range = sheet.getDataRange();
      const values = range.getValues();
      const display = range.getDisplayValues();
      const formulas = range.getFormulas();
      const rich = range.getRichTextValues();

      if (!values.length) {
        result = { headers: [], rows: [] };

      } else {
        const headers = display[0].map(
          (h, i) => String(h || values[0][i] || "").trim()
        );

        const rows = [];

        for (let r = 1; r < values.length; r++) {
          const row = [];

          for (let c = 0; c < values[r].length; c++) {
            const value = values[r][c];
            const shown = display[r][c];
            let link = "";

            try {
              const cell = rich[r][c];

              if (cell) {
                link = cell.getLinkUrl() || "";

                if (!link && cell.getRuns) {
                  for (const run of cell.getRuns()) {
                    link = run.getLinkUrl() || "";
                    if (link) break;
                  }
                }
              }
            } catch (_) {}

            if (!link && formulas[r][c]) {
              const m = formulas[r][c].match(
                /HYPERLINK\s*\(\s*["'](https?:\/\/[^"']+)["']/i
              );

              if (m) link = m[1];
            }

            if (
              !link &&
              typeof value === "string" &&
              /^https?:\/\/\S+/i.test(value.trim())
            ) {
              link = value.trim();
            }

            row.push({
              v: value instanceof Date ? value.toISOString() : value,
              f: String(shown == null ? "" : shown),
              l: link
            });
          }

          rows.push(row);
        }

        result = { headers, rows };
      }
    }

  } catch (err) {
    result = {
      error: err && err.message ? err.message : String(err)
    };
  }

  const json = JSON.stringify(result);

  if (callback && /^[A-Za-z_$][\w$]*$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
