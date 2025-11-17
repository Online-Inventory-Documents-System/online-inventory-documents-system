// public/js/script.js
// Complete, FIXED, UPDATED client script for Online Inventory & Document System

// ------------------------------ API BASE (FIXED FOR RENDER) ------------------------------
const API_BASE = window.location.hostname.includes("localhost")
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api"; // ✔ Correct for single Render service

// Utilities
const qs = (s) => document.querySelector(s);
const escapeHtml = (s) =>
  s
    ? String(s).replace(/[&<>"']/g, (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c])
      )
    : "";

const getUsername = () => sessionStorage.getItem("adminName") || "Guest";

let inventory = [];
let documents = [];
let activityLog = [];

const currentPage = window.location.pathname.split("/").pop();

// ------------------------------ UNIVERSAL FETCH WRAPPER ------------------------------
async function apiFetch(url, options = {}) {
  options.headers = {
    "Content-Type": "application/json",
    "X-Username": getUsername(),
    ...options.headers,
  };
  return fetch(url, options);
}

// ------------------------------ LOGIN REDIRECT ------------------------------
if (
  !sessionStorage.getItem("isLoggedIn") &&
  !window.location.pathname.includes("login.html")
) {
  window.location.href = "login.html";
}

// ------------------------------ LOGOUT ------------------------------
function logout() {
  sessionStorage.clear();
  window.location.href = "login.html";
}

// ------------------------------ DARK MODE ------------------------------
function toggleTheme() {
  document.body.classList.toggle("dark-mode");
  localStorage.setItem(
    "theme",
    document.body.classList.contains("dark-mode") ? "dark" : "light"
  );
}

// ------------------------------ RENDER INVENTORY ------------------------------
function renderInventory(items) {
  const list = qs("#inventoryList");
  if (!list) return;

  list.innerHTML = "";

  let tValue = 0,
    tRevenue = 0,
    tStock = 0;

  items.forEach((it) => {
    const qty = Number(it.quantity || 0);
    const uc = Number(it.unitCost || 0);
    const up = Number(it.unitPrice || 0);
    const invVal = qty * uc;
    const rev = qty * up;

    tValue += invVal;
    tRevenue += rev;
    tStock += qty;

    const tr = document.createElement("tr");
    if (qty === 0) tr.classList.add("out-of-stock-row");
    else if (qty < 10) tr.classList.add("low-stock-row");

    tr.innerHTML = `
      <td>${escapeHtml(it.sku)}</td>
      <td>${escapeHtml(it.name)}</td>
      <td>${escapeHtml(it.category)}</td>
      <td>${qty}</td>
      <td class="money">RM ${uc.toFixed(2)}</td>
      <td class="money">RM ${up.toFixed(2)}</td>
      <td class="money">RM ${invVal.toFixed(2)}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditPageForItem('${it.id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="confirmAndDeleteItem('${it.id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });

  qs("#totalValue") && (qs("#totalValue").textContent = tValue.toFixed(2));
  qs("#totalRevenue") && (qs("#totalRevenue").textContent = tRevenue.toFixed(2));
  qs("#totalStock") && (qs("#totalStock").textContent = tStock);
}

// ------------------------------ RENDER DOCUMENTS ------------------------------
function renderDocuments(docs) {
  const list = qs("#docList");
  if (!list) return;

  list.innerHTML = "";

  docs.forEach((d) => {
    const sizeMB = ((d.size || 0) / (1024 * 1024)).toFixed(2);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(d.name)}</td>
      <td>${sizeMB} MB</td>
      <td>${new Date(d.date).toLocaleString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="downloadDocument('${d.name}')">⬇️ Download</button>
        <button class="danger-btn small-btn" onclick="deleteDocumentConfirm('${d.id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });
}

// ------------------------------ RENDER LOGS ------------------------------
function renderLogs() {
  const table = qs("#logList");
  if (!table) return;

  table.innerHTML = "";

  activityLog.forEach((log) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${escapeHtml(log.user)}</td>
      <td>${escapeHtml(log.action)}</td>
      <td>${new Date(log.time).toLocaleString()}</td>
    `;

    table.appendChild(tr);
  });
}

// ------------------------------ FETCH INVENTORY ------------------------------
async function fetchInventory() {
  const res = await apiFetch(`${API_BASE}/inventory`);
  const data = await res.json();
  inventory = data.map((i) => ({ ...i, id: i.id || i._id }));
  renderInventory(inventory);
}

// ------------------------------ FETCH DOCUMENTS ------------------------------
async function fetchDocuments() {
  const res = await apiFetch(`${API_BASE}/documents`);
  const data = await res.json();
  documents = data.map((d) => ({ ...d, id: d.id || d._id }));
  renderDocuments(documents);
}

// ------------------------------ FETCH LOGS ------------------------------
async function fetchLogs() {
  const res = await apiFetch(`${API_BASE}/logs`);
  activityLog = await res.json();
  renderLogs();
}

// ------------------------------ INVENTORY ADD ------------------------------
async function confirmAndAddProduct() {
  const sku = qs("#p_sku").value.trim();
  const name = qs("#p_name").value.trim();
  const category = qs("#p_category").value.trim();
  const quantity = Number(qs("#p_quantity").value || 0);
  const unitCost = Number(qs("#p_unitCost").value || 0);
  const unitPrice = Number(qs("#p_unitPrice").value || 0);

  if (!sku || !name) return alert("Please enter SKU and Name.");

  const body = { sku, name, category, quantity, unitCost, unitPrice };

  await apiFetch(`${API_BASE}/inventory`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  await fetchInventory();
  alert("Product added!");
}

// ------------------------------ DELETE INVENTORY ------------------------------
async function confirmAndDeleteItem(id) {
  if (!confirm("Delete this item?")) return;

  await apiFetch(`${API_BASE}/inventory/${id}`, { method: "DELETE" });

  await fetchInventory();
  alert("Item deleted!");
}

// ------------------------------ PDF REPORT ------------------------------
async function confirmAndGeneratePDF() {
  if (!confirm("Generate PDF Report?")) return;

  const res = await apiFetch(`${API_BASE}/inventory/report/pdf`);
  const blob = await res.blob();

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "Inventory_Report.pdf";
  a.click();
}

// ------------------------------ XLSX REPORT ------------------------------
async function confirmAndGenerateReport() {
  if (!confirm("Generate Excel Report?")) return;

  const res = await apiFetch(`${API_BASE}/inventory/report`);
  const blob = await res.blob();

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "Inventory_Report.xlsx";
  a.click();
}

// ------------------------------ DOWNLOAD DOCUMENT ------------------------------
function downloadDocument(fileName) {
  if (!confirm(`Download ${fileName}?`)) return;

  const url = `${API_BASE}/documents/download/${encodeURIComponent(fileName)}`;
  window.open(url, "_blank");
}

// ------------------------------ DELETE DOCUMENT ------------------------------
async function deleteDocumentConfirm(id) {
  if (!confirm("Delete document metadata?")) return;

  await apiFetch(`${API_BASE}/documents/${id}`, { method: "DELETE" });

  await fetchDocuments();
}

// ------------------------------ SEARCH DOCUMENTS ------------------------------
function searchDocuments() {
  const q = qs("#searchDocs").value.toLowerCase();
  const filtered = documents.filter(
    (d) =>
      d.name.toLowerCase().includes(q) ||
      new Date(d.date).toLocaleString().toLowerCase().includes(q)
  );
  renderDocuments(filtered);
}

// ------------------------------ INIT PAGE ------------------------------
window.addEventListener("load", async () => {
  const theme = localStorage.getItem("theme");
  if (theme === "dark") document.body.classList.add("dark-mode");

  if (currentPage.includes("inventory")) {
    await fetchInventory();
    qs("#addProductBtn")?.addEventListener("click", confirmAndAddProduct);
    qs("#reportBtn")?.addEventListener("click", confirmAndGenerateReport);
    qs("#pdfReportBtn")?.addEventListener("click", confirmAndGeneratePDF);
  }

  if (currentPage.includes("documents")) {
    await fetchDocuments();
    qs("#searchDocs")?.addEventListener("input", searchDocuments);
  }

  if (currentPage.includes("log")) {
    await fetchLogs();
  }
});

// ------------------------------ GLOBAL EXPOSE ------------------------------
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openEditPageForItem = (id) => {
  window.location.href = `product.html?id=${id}`;
};
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.downloadDocument = downloadDocument;
window.deleteDocumentConfirm = deleteDocumentConfirm;

