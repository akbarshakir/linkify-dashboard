/** Linkify Dashboard read-only Google Sheets endpoint. */
const SPREADSHEET_ID = "1mnA7uwwDDePadQ5irlmaQ0gk67awQyHHmIAi6NCvzeo";
function doGet(e) {
  const p=(e&&e.parameter)||{}, tabName=String(p.tab||"").trim(), callback=String(p.callback||"").trim();
  let result;
  try {
    if(!tabName) throw new Error("Missing tab parameter.");
    const sheet=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(tabName);
    if(!sheet) throw new Error('Tab not found: "'+tabName+'".');
    const range=sheet.getDataRange(), values=range.getValues(), display=range.getDisplayValues(), formulas=range.getFormulas(), rich=range.getRichTextValues();
    if(!values.length) result={headers:[],rows:[]};
    else {
      const headers=display[0].map((h,i)=>String(h||values[0][i]||"").trim()), rows=[];
      for(let r=1;r<values.length;r++) {
        const row=[];
        for(let c=0;c<values[r].length;c++) {
          const value=values[r][c], shown=display[r][c]; let link="";
          try { const cell=rich[r][c]; if(cell){link=cell.getLinkUrl()||""; if(!link&&cell.getRuns){for(const run of cell.getRuns()){link=run.getLinkUrl()||"";if(link)break;}}} } catch(_){}
          if(!link&&formulas[r][c]) { const m=formulas[r][c].match(/HYPERLINK\s*\(\s*["'](https?:\/\/[^"']+)["']/i); if(m)link=m[1]; }
          if(!link&&typeof value==="string"&&/^https?:\/\/\S+/i.test(value.trim()))link=value.trim();
          row.push({v:value instanceof Date?value.toISOString():value,f:String(shown==null?"":shown),l:link});
        }
        rows.push(row);
      }
      result={headers,rows};
    }
  } catch(err) { result={error:err&&err.message?err.message:String(err)}; }
  const json=JSON.stringify(result);
  if(callback&&/^[A-Za-z_$][\w$]*$/.test(callback)) return ContentService.createTextOutput(callback+"("+json+");").setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
