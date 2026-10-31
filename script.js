/*
 * LINKIFY DASHBOARD CONFIG
 * 1) Paste your Supabase URL and publishable key below.
 * 2) Put your Google spreadsheet ID in SPREADSHEET_ID.
 * 3) Keep the exact tab names in SHEET_TABS. Add new month tab names here as you create them.
 * Never paste a Google private key or Supabase service-role key into this browser file.
 */
const CONFIG = {
  SUPABASE_URL: "https://wpqlwmzkyeryqjiabcnx.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_IbZnNomkcysrP3s2rW7IBA_Qj0XAusf",
  SPREADSHEET_ID: "1mnA7uwwDDePadQ5irlmaQ0gk67awQyHHmIAi6NCvzeo",
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbyYiFgDek0lE7fWo5LWzz-5ZttuOaRempD3EmVoiNQA4YHEiNf6RK63oOz96xGdannl/exec",
  // Fetch both September and October 2026. Add each new monthly tab here when it is created.
  SHEET_TABS: ["September 26", "October 26"],
  // If the sheet's first row is a title instead of column headers, change this to 2.
  HEADER_ROW: 1
};

const $ = (id) => document.getElementById(id);
const loginPanel = $("loginPanel");
const dashboard = $("dashboard");
const loginForm = $("loginForm");
const loginMessage = $("loginMessage");
const errorBanner = $("errorBanner");
const syncStatus = $("syncStatus");
let supabaseClient = null;
let currentView = "current";
let currentOrders = [];
let preservedOrders = [];
let allOrders = [];
const CACHE_KEY = "linkify_dashboard_last_orders_v1";

function normalizeHeader(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function numberValue(value) {
  if (typeof value === "number") return value;
  const cleaned = String(value ?? "").replace(/[,\s₨$]/g, "").replace(/PKR|USD/gi, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function formatPKR(value) {
  return "PKR " + Math.round(Number(value || 0)).toLocaleString("en-PK");
}
function formatMoney(value, currency) {
  const n = Number(value || 0);
  return (currency || "PKR") + " " + n.toLocaleString("en-PK", {maximumFractionDigits: 2});
}
function monthLabel(dateValue, tabName) {
  // Prefer the monthly tab name so every order stays grouped under its source month.
  const tabMatch = String(tabName || "").match(/^([A-Za-z]+)\s+(\d{2}|\d{4})$/);
  if (tabMatch) {
    const monthDate = new Date(`${tabMatch[1]} 1, ${tabMatch[2].length === 2 ? "20" + tabMatch[2] : tabMatch[2]}`);
    if (!isNaN(monthDate)) return monthDate.toLocaleDateString("en-US", {month:"long", year:"numeric"});
  }
  if (dateValue instanceof Date && !isNaN(dateValue)) return dateValue.toLocaleDateString("en-US", {month:"long", year:"numeric"});
  const parsed = parseDate(dateValue);
  if (parsed) return parsed.toLocaleDateString("en-US", {month:"long", year:"numeric"});
  return tabName || "Unknown month";
}
function parseDate(value) {
  if (value instanceof Date && !isNaN(value)) return value;
  if (typeof value === "string") {
    const m = value.match(/^Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]), Number(m[3]));
    const d = new Date(value);
    if (!isNaN(d)) return d;
  }
  return null;
}
function dateForDisplay(value) {
  const d = parseDate(value);
  return d ? d.toLocaleDateString("en-GB", {day:"2-digit",month:"short",year:"numeric"}) : String(value || "");
}
function safeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}
function getColumnIndex(headers, alternatives) {
  const normalized = headers.map(normalizeHeader);
  for (const name of alternatives) {
    const idx = normalized.indexOf(normalizeHeader(name));
    if (idx >= 0) return idx;
  }
  return -1;
}
function cellValue(row, headers, alternatives) {
  const idx = getColumnIndex(headers, alternatives);
  if (idx < 0 || !row[idx]) return "";
  return row[idx].f ?? row[idx].v ?? "";
}
// Extract a URL from a cell, prioritizing the actual rich-text hyperlink target.
// In Google Sheets, a cell may display a title while its real URL is stored in `l`.
function urlFromCell(cell) {
  if (!cell) return "";
  const isUrl = (value) => typeof value === "string" && /^(https?:\/\/|www\.)/i.test(value.trim());
  if (isUrl(cell.l)) return cell.l.trim();
  if (isUrl(cell.v)) return cell.v.trim();
  if (isUrl(cell.f)) return cell.f.trim();
  return "";
}
function urlCellValue(row, headers, alternatives) {
  const idx = getColumnIndex(headers, alternatives);
  if (idx >= 0 && row[idx]) {
    const found = urlFromCell(row[idx]);
    if (found) return found;
  }
  // Fallback: some vendor sheets put the live hyperlink under an unexpected
  // column heading. Search all linked cells, preferring columns whose headings
  // look like live/published/article/post/URL fields.
  const preferredWords = /live|publish|article|post|link|url/i;
  const orderedIndexes = headers.map((header, i) => ({i, preferred: preferredWords.test(String(header || ""))}))
    .sort((a, b) => Number(b.preferred) - Number(a.preferred));
  for (const item of orderedIndexes) {
    const found = urlFromCell(row[item.i]);
    if (found) return found;
  }
  // Last fallback for sheets where the target URL itself is plain text.
  for (const cell of (row || [])) {
    const found = urlFromCell(cell);
    if (found) return found;
  }
  return "";
}
function parseGviz(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Google Sheets returned an unexpected response. Check that the sheet is shared as Anyone with the link: Viewer.");
  const payload = JSON.parse(text.slice(start, end + 1));
  if (payload.status === "error") throw new Error(payload.errors?.[0]?.detailed_message || "Google Sheets could not return the tab data.");
  const table = payload.table;
  if (!table || !table.cols) throw new Error("No sheet data found. Check the tab name and header row.");
  const headers = table.cols.map((c) => c.label || c.id || "");
  return {headers, rows: (table.rows || []).map((r) => (r.c || []).map((c) => c ? ({v:c.v, f:c.f}) : null))};
}
function fetchAppsScriptTab(tabName, attempt = 1) {
  return new Promise((resolve, reject) => {
    const endpoint = String(CONFIG.APPS_SCRIPT_URL || "").trim();
    if (!endpoint || endpoint.includes("PASTE_YOUR_APPS_SCRIPT")) {
      reject(new Error("Apps Script URL is missing. Paste your deployed Web App URL into CONFIG.APPS_SCRIPT_URL."));
      return;
    }

    const callbackName = "__linkifySheetCallback_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    let finished = false;
    let loadTimer;
    const timeoutMs = 60000;

    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(loadTimer);
      script.onload = null;
      script.onerror = null;
      if (script.parentNode) script.parentNode.removeChild(script);
      try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
    };

    const fail = (message, retryable = false) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (retryable && attempt < 2) {
        // Retry once after a short pause. Apps Script may be slow to wake up.
        setTimeout(() => fetchAppsScriptTab(tabName, attempt + 1).then(resolve).catch(reject), 1200);
      } else {
        reject(new Error(message));
      }
    };

    const timer = setTimeout(() => {
      fail("Apps Script did not respond for “" + tabName + "” within 60 seconds" +
        (attempt < 2 ? "; retrying once…" : ". Check that the deployment is a Web app, Execute as Me, access Anyone, and that you deployed a new version after saving Code.gs."), true);
    }, timeoutMs);

    window[callbackName] = (payload) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (!payload || payload.error) {
        reject(new Error(payload && payload.error ? payload.error : "Apps Script returned an empty response for “" + tabName + "”."));
      } else if (!Array.isArray(payload.headers) || !Array.isArray(payload.rows)) {
        reject(new Error("Apps Script responded, but the data format is invalid for “" + tabName + "”. Save and redeploy Code.gs."));
      } else {
        resolve(payload);
      }
    };

    script.onerror = () => {
      fail("The browser could not load the Apps Script response for “" + tabName + "”. Check the /exec URL, deployment access = Anyone, and Google account permissions.", true);
    };

    // A successful script download should call the JSONP callback. If it loads
    // without calling it, the deployed script is probably returning HTML/old code.
    script.onload = () => {
      loadTimer = setTimeout(() => {
        if (!finished) fail("Apps Script loaded but did not call its JSONP callback for “" + tabName + "”. Open the /exec URL with ?tab=" + encodeURIComponent(tabName) + "&callback=test. If it does not start with test({, save Code.gs and deploy a New version.", true);
      }, 1800);
    };

    const separator = endpoint.includes("?") ? "&" : "?";
    script.src = endpoint + separator + "tab=" + encodeURIComponent(tabName) +
      "&callback=" + encodeURIComponent(callbackName) + "&_=" + Date.now();
    script.async = true;
    document.head.appendChild(script);
  });
}

async function fetchSheetTab(tabName) {
  // Read actual hyperlink targets, including rich-text links that GViz can omit.
  const payload = await fetchAppsScriptTab(tabName);
  if (!Array.isArray(payload.headers) || !Array.isArray(payload.rows)) throw new Error("Unexpected data for tab “" + tabName + "”. Check Code.gs and redeploy the Web App.");
  const parsed = {headers: payload.headers, rows: payload.rows.map(row => (row || []).map(cell => cell ? ({v:cell.v, f:cell.f, l:cell.l}) : null))};
  const headers = parsed.headers;
  const serialAlts = ["Serial No", "Serial Number", "S No", "Sr No", "Serial"];
  const dateAlts = ["Date", "Order Date", "Published Date"];
  const websiteAlts = ["Website", "Domain", "Site", "Target Website", "Target URL", "Website URL", "Website Name"];
  const liveAlts = [
    "Live URL", "Live Link", "Published URL", "Article URL", "Live Article Link",
    "Live Website", "Published Link", "Live URL Link", "Live Website Link",
    "Live Article URL", "Published Article URL", "Published Article Link",
    "Live Post URL", "Post URL", "Article Live URL", "URL"
  ];
  const agencyAlts = ["Agency", "Vendor", "Website Provider"];
  const clientAlts = ["Client Name", "Client", "Customer Name", "Customer", "Client/Agency"];
  const agencyPriceAlts = ["Agency Price", "Agency Price PKR", "Vendor Price", "Cost"];
  const clientPriceAlts = ["Client Price", "Sale Price", "Selling Price"];
  const currencyAlts = ["Currency", "Client Currency"];
  const rateAlts = ["USD Rate", "Exchange Rate", "Conversion Rate"];
  const clientPkrAlts = ["Client Price PKR", "Sale PKR", "Client PKR"];
  const profitAlts = ["Profit", "Profit PKR", "Net Profit"];
  const output = [];
  for (const row of parsed.rows) {
    const get = (names) => cellValue(row, headers, names);
    const website = String(get(websiteAlts) || "").trim();
    const liveUrl = String(urlCellValue(row, headers, liveAlts) || "").trim();
    if (!website && !liveUrl) continue;
    const serial = String(get(serialAlts) || "").trim();
    const dateRaw = get(dateAlts);
    const agency = numberValue(get(agencyPriceAlts));
    const clientRaw = numberValue(get(clientPriceAlts));
    const currency = String(get(currencyAlts) || "PKR").trim().toUpperCase();
    const rate = numberValue(get(rateAlts)) || 1;
    const clientPkrCell = get(clientPkrAlts);
    const profitCell = get(profitAlts);
    const clientPKR = clientPkrCell !== "" && clientPkrCell !== null
      ? numberValue(clientPkrCell)
      : (currency === "USD" ? clientRaw * rate : clientRaw);
    const profit = profitCell !== "" && profitCell !== null
      ? numberValue(profitCell)
      : clientPKR - agency;
    const dateParsed = parseDate(dateRaw);
    output.push({
      id: tabName + "::" + (serial || website + "::" + String(dateRaw || output.length)),
      serial, tabName, dateRaw, dateDisplay: dateForDisplay(dateRaw),
      month: monthLabel(dateRaw, tabName), website, liveUrl, agency,
      client: String(get(clientAlts) || "").trim(),
      agencyName: String(get(agencyAlts) || "").trim(),
      clientPrice: clientRaw, currency, rate, clientPKR, profit,
      dateSort: dateParsed ? dateParsed.getTime() : 0,
      fingerprint: JSON.stringify([dateRaw,website,liveUrl,agency,clientRaw,currency,rate,clientPKR,profit,get(clientAlts),get(agencyAlts)])
    });
  }
  return output;
}
async function fetchAllOrders() {
  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID.includes("PASTE_")) throw new Error("Add your Google Spreadsheet ID in script.js.");
  if (!CONFIG.SHEET_TABS.length) throw new Error("Add at least one monthly tab name in CONFIG.SHEET_TABS.");
  const results = await Promise.all(CONFIG.SHEET_TABS.map(fetchSheetTab));
  return results.flat();
}
function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.remove("hidden");
}
function clearError() {
  errorBanner.textContent = "";
  errorBanner.classList.add("hidden");
}
function setSyncState(state, text) {
  syncStatus.className = "status " + state;
  syncStatus.innerHTML = "<i></i>" + text;
}
function uniqueSort(values) {
  return [...new Set(values.map(v => String(v || "").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}
function updateSelect(id, values, allLabel) {
  const select = $(id);
  const old = select.value;
  select.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = allLabel;
  select.appendChild(option);
  [...new Set(values.map(v => String(v || "").trim()).filter(Boolean))].forEach(value => {
    const op = document.createElement("option");
    op.value = value; op.textContent = value; select.appendChild(op);
  });
  if ([...select.options].some(o => o.value === old)) select.value = old;
}
function updateFilters() {
  const months = [...new Set(allOrders.map(o => o.month).filter(Boolean))].sort((a, b) => {
    const da = new Date(a), db = new Date(b);
    return (da - db) || a.localeCompare(b);
  });
  updateSelect("monthFilter", months, "All months");
  updateSelect("agencyFilter", uniqueSort(allOrders.map(o=>o.agencyName)), "All agencies");
  updateSelect("clientFilter", uniqueSort(allOrders.map(o=>o.client)), "All clients");
}
function filteredOrders() {
  const query = $("searchInput").value.trim().toLowerCase();
  const month = $("monthFilter").value;
  const agency = $("agencyFilter").value;
  const client = $("clientFilter").value;
  const currency = $("currencyFilter").value;
  const source = currentView === "current" ? currentOrders : preservedOrders;
  return source.filter(o => {
    const haystack = [o.website,o.liveUrl,o.client,o.agencyName,o.serial,o.tabName].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!month || o.month === month) &&
      (!agency || o.agencyName === agency) && (!client || o.client === client) &&
      (!currency || o.currency === currency);
  }).sort((a,b)=>b.dateSort-a.dateSort);
}
function updateMonthlyKpis() {
  const selectedMonth = $("monthFilter").value;
  const orders = currentOrders.filter(o => !selectedMonth || o.month === selectedMonth);
  const revenue = orders.reduce((sum, o) => sum + o.clientPKR, 0);
  const cost = orders.reduce((sum, o) => sum + o.agency, 0);
  const profit = orders.reduce((sum, o) => sum + o.profit, 0);
  const title = selectedMonth ? selectedMonth : "All months";
  $("monthlyDashboardTitle").textContent = "Monthly dashboard · " + title;
  $("monthlyOrders").textContent = orders.length.toLocaleString("en-PK");
  $("monthlyOrdersNote").textContent = selectedMonth ? "Orders in " + selectedMonth : "All months combined";
  $("monthlyRevenue").textContent = formatPKR(revenue);
  $("monthlyCost").textContent = formatPKR(cost);
  $("monthlyProfit").textContent = formatPKR(profit);
}
function renderOrders() {
  updateMonthlyKpis();
  const orders = filteredOrders();
  $("resultsCount").textContent = orders.length + (orders.length === 1 ? " order" : " orders");
  $("ordersBody").innerHTML = "";
  $("mobileOrders").innerHTML = "";
  if (!orders.length) {
    $("ordersBody").innerHTML = '<tr><td colspan="8" class="empty">No orders match these filters.</td></tr>';
    $("mobileOrders").innerHTML = '<div class="empty">No orders match these filters.</div>';
    return;
  }
  orders.forEach(o => {
    const websiteUrl = safeUrl(o.website);
    const liveUrl = safeUrl(o.liveUrl);
    const websiteHTML = websiteUrl ? '<a href="' + escapeHTML(websiteUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(o.website) + '</a>' : escapeHTML(o.website || "—");
    const liveHTML = liveUrl ? '<a href="' + escapeHTML(liveUrl) + '" target="_blank" rel="noopener noreferrer">Open live link ↗</a>' : "—";
    const tr = document.createElement("tr");
    tr.innerHTML = '<td>' + websiteHTML + '</td><td>' + escapeHTML(o.client || "—") + '</td><td>' + escapeHTML(o.agencyName || "—") + '</td><td>' + liveHTML + '</td><td class="money">' + formatPKR(o.agency) + '</td><td class="money">' + escapeHTML(formatMoney(o.clientPrice,o.currency)) + '</td><td class="money ' + (o.profit >= 0 ? "profit-positive" : "profit-negative") + '">' + formatPKR(o.profit) + '</td><td>' + escapeHTML(o.month) + '</td>';
    $("ordersBody").appendChild(tr);
    const card = document.createElement("article");
    card.className = "order-mobile";
    card.innerHTML = '<div class="order-mobile-head"><div><h3>' + escapeHTML(o.website || "Untitled website") + '</h3>' + (websiteUrl ? '<a href="' + escapeHTML(websiteUrl) + '" target="_blank" rel="noopener noreferrer">Open website ↗</a>' : '') + (liveUrl ? ' · <a href=' + '"' + escapeHTML(liveUrl) + '" target="_blank" rel="noopener noreferrer">Live link ↗</a>' : '') + '</div><span class="month">' + escapeHTML(o.month) + '</span></div><p class="mobile-client"><strong>Client:</strong> ' + escapeHTML(o.client || "—") + '</p><p class="mobile-client"><strong>Agency/Vendor:</strong> ' + escapeHTML(o.agencyName || "—") + '</p><div class="mobile-money"><div><span>Agency price</span><strong>' + formatPKR(o.agency) + '</strong></div><div><span>Client price</span><strong>' + escapeHTML(formatMoney(o.clientPrice,o.currency)) + '</strong></div><div><span>Profit PKR</span><strong class="' + (o.profit >= 0 ? "profit-positive" : "profit-negative") + '">' + formatPKR(o.profit) + '</strong></div></div>';
    $("mobileOrders").appendChild(card);
  });
}
function setExportMessage(message, kind = "") {
  const el = $("exportMessage");
  if (!el) return;
  el.textContent = message;
  el.className = "export-message" + (kind ? " " + kind : "");
}
function exportFilteredXlsx(kind) {
  const orders = filteredOrders();
  if (!orders.length) {
    setExportMessage("No matching orders to export. Adjust your search or filters first.", "error");
    return;
  }
  if (!window.XLSX || !window.XLSX.utils) {
    setExportMessage("Excel export library did not load. Check your internet connection and refresh the dashboard.", "error");
    return;
  }
  const isClient = kind === "client";
  const headers = isClient ? ["Website", "Live URL", "Client Price"] : ["Agency Name", "Website", "Live URL", "Agency Price"];
  const rows = orders.map(o => isClient
    ? [String(o.website || ""), String(o.liveUrl || ""), Number(o.clientPrice || 0)]
    : [String(o.agencyName || ""), String(o.website || ""), String(o.liveUrl || ""), Number(o.agency || 0)]
  );
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws["!cols"] = isClient
    ? [{wch:32},{wch:65},{wch:18}]
    : [{wch:28},{wch:32},{wch:65},{wch:18}];
  ws["!autofilter"] = {ref: XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length,c:headers.length-1}})};
  // Keep price values numeric so the recipient can sort, sum, and calculate in Excel.
  for (let i = 0; i < orders.length; i++) {
    const rowNum = i + 2;
    const priceCol = isClient ? 2 : 3;
    const priceCell = XLSX.utils.encode_cell({r:rowNum-1,c:priceCol});
    if (ws[priceCell]) {
      ws[priceCell].z = isClient
        ? (String(orders[i].currency || "PKR").toUpperCase() === "USD" ? '"USD "#,##0.00' : '"PKR "#,##0.00')
        : '"PKR "#,##0.00';
    }
    const liveCol = isClient ? 1 : 2;
    const liveCell = XLSX.utils.encode_cell({r:rowNum-1,c:liveCol});
    const liveUrl = safeUrl(orders[i].liveUrl);
    if (ws[liveCell] && liveUrl) ws[liveCell].l = {Target:liveUrl, Tooltip:"Open live URL"};
    const websiteCol = isClient ? 0 : 1;
    const websiteCell = XLSX.utils.encode_cell({r:rowNum-1,c:websiteCol});
    const websiteUrl = safeUrl(orders[i].website);
    if (ws[websiteCell] && websiteUrl) ws[websiteCell].l = {Target:websiteUrl, Tooltip:"Open website"};
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, isClient ? "Client Orders" : "Agency Orders");
  const selected = isClient ? $("clientFilter").value : $("agencyFilter").value;
  const safeName = (selected || (isClient ? "Filtered-Clients" : "Filtered-Agencies"))
    .replace(/[\\/:*?"<>|]+/g, "-").trim().replace(/\s+/g, "-").slice(0,60);
  const stamp = new Date().toISOString().slice(0,10);
  const fileName = (isClient ? "Linkify-Client-" : "Linkify-Agency-") + safeName + "-" + stamp + ".xlsx";
  XLSX.writeFile(wb, fileName);
  setExportMessage("Exported " + orders.length + " filtered order(s) to " + fileName, "success");
}

function updateKpis() {
  const revenue = currentOrders.reduce((sum,o)=>sum+o.clientPKR,0);
  const cost = currentOrders.reduce((sum,o)=>sum+o.agency,0);
  const profit = currentOrders.reduce((sum,o)=>sum+o.profit,0);
  $("kpiOrders").textContent = currentOrders.length.toLocaleString("en-PK");
  $("kpiRevenue").textContent = formatPKR(revenue);
  $("kpiCost").textContent = formatPKR(cost);
  $("kpiProfit").textContent = formatPKR(profit);
  $("currentCount").textContent = currentOrders.length;
  $("preservedCount").textContent = preservedOrders.length;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function setView(view) {
  currentView = view;
  document.querySelectorAll(".view-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  renderOrders();
}
function saveSnapshot(orders) {
  try {
    const old = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
    const newById = new Map(orders.map(o=>[o.id,o]));
    // Keep earlier rows that disappeared from a successfully read tab as preserved.
    const missing = old.filter(o=>!newById.has(o.id)).map(o=>({...o,preserved:true}));
    const fresh = orders.map(o=>({...o,preserved:false}));
    const snapshots = [...fresh, ...missing.filter(o=>!newById.has(o.id))];
    localStorage.setItem(CACHE_KEY, JSON.stringify(snapshots));
    return {current:fresh, preserved:missing};
  } catch {
    return {current:orders.map(o=>({...o,preserved:false})), preserved:[]};
  }
}
function loadCachedSnapshot() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
    currentOrders = cached.filter(o=>!o.preserved);
    preservedOrders = cached.filter(o=>o.preserved);
    allOrders = [...currentOrders,...preservedOrders];
    updateKpis(); updateFilters(); renderOrders();
  } catch {}
}
async function syncOrders() {
  clearError();
  $("syncBtn").disabled = true;
  $("syncBtn").textContent = "Syncing…";
  setSyncState("", "Reading Google Sheet…");
  try {
    const orders = await fetchAllOrders();
    const snap = saveSnapshot(orders);
    currentOrders = snap.current;
    preservedOrders = snap.preserved;
    allOrders = [...currentOrders,...preservedOrders];
    updateKpis(); updateFilters(); renderOrders();
    const now = new Date();
    $("lastSynced").textContent = "Last synced " + now.toLocaleString();
    setSyncState("ok", "Sync successful");
    if (!orders.length) showError("The tab was read, but no orders were found. Check the tab name and header row in script.js.");
  } catch (err) {
    setSyncState("error", "Sync failed");
    showError((err && err.message ? err.message : String(err)) + " Check that the spreadsheet is shared as Anyone with the link → Viewer, and that the tab name in script.js exactly matches the Google Sheet.");
  } finally {
    $("syncBtn").disabled = false;
    $("syncBtn").textContent = "↻ Sync Now";
  }
}
function showDashboard() {
  loginPanel.classList.add("hidden");
  dashboard.classList.remove("hidden");
  loadCachedSnapshot();
}
async function boot() {
  const configured = CONFIG.SUPABASE_PUBLISHABLE_KEY && !CONFIG.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_");
  if (!window.supabase || !configured) {
    loginMessage.textContent = "Add your Supabase publishable key in script.js, then refresh this page.";
    return;
  }
  supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);
  try {
    const {data:{session}} = await supabaseClient.auth.getSession();
    if (session) { showDashboard(); await syncOrders(); }
  } catch (e) { loginMessage.textContent = "Supabase setup issue: " + e.message; }
}
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "Signing in…";
  if (!supabaseClient) {
    if (!window.supabase) { loginMessage.textContent = "Could not load Supabase. Check your internet connection."; return; }
    if (!CONFIG.SUPABASE_PUBLISHABLE_KEY || CONFIG.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_")) {
      loginMessage.textContent = "Paste your Supabase publishable key near the top of script.js first."; return;
    }
    supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);
  }
  const {error} = await supabaseClient.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
  if (error) { loginMessage.textContent = error.message; return; }
  loginMessage.textContent = "";
  showDashboard();
  await syncOrders();
});
$("syncBtn").addEventListener("click", syncOrders);
$("exportClientBtn").addEventListener("click", () => exportFilteredXlsx("client"));
$("exportAgencyBtn").addEventListener("click", () => exportFilteredXlsx("agency"));
$("signOutBtn").addEventListener("click", async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
  dashboard.classList.add("hidden");
  loginPanel.classList.remove("hidden");
  $("password").value = "";
});
document.querySelectorAll(".view-btn").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));
["searchInput","monthFilter","agencyFilter","clientFilter","currencyFilter"].forEach(id=>$(id).addEventListener(id==="searchInput"?"input":"change",renderOrders));
boot();
