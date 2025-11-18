// public/js/script.js
// Complete client-side script for Online Inventory & Documents System
// Update API_BASE if you use a custom domain.

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api"; // change if needed

// Utilities
const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

let inventory = [];
let activityLog = [];
let documents = [];
const currentPage = window.location.pathname.split('/').pop();

// Fetch wrapper
async function apiFetch(url, options = {}) {
  const user = getUsername();
  options.headers = {
    'Content-Type': 'application/json', // Default for JSON endpoints
    'X-Username': user,
    ...options.headers,
  };
  return fetch(url, options);
}

// Auth redirect (do not redirect when on login page)
if(!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')) {
  try { window.location.href = 'login.html'; } catch(e) {}
}

function logout(){
  sessionStorage.removeItem('isLoggedIn');
  sessionStorage.removeItem('adminName');
  if(window.CONFIG && CONFIG.LS_THEME) localStorage.removeItem(CONFIG.LS_THEME);
  window.location.href = 'login.html';
}

function toggleTheme(){
  document.body.classList.toggle('dark-mode');
  if(window.CONFIG && CONFIG.LS_THEME) {
    localStorage.setItem(CONFIG.LS_THEME, document.body.classList.contains('dark-mode') ? 'dark' : 'light');
  }
}

// ---------------------- Renderers ----------------------
function renderInventory(items) {
  const list = qs('#inventoryList');
  if(!list) return;
  list.innerHTML = '';
  let totalValue = 0, totalRevenue = 0, totalStock = 0;

  items.forEach(it => {
    const id = it.id || it._id;
    const qty = Number(it.quantity || 0);
    const uc = Number(it.unitCost || 0);
    const up = Number(it.unitPrice || 0);
    const invVal = qty * uc;
    const rev = qty * up;
    totalValue += invVal;
    totalRevenue += rev;
    totalStock += qty;

    const tr = document.createElement('tr');
    if(qty === 0) tr.classList.add('out-of-stock-row');
    else if(qty < 10) tr.classList.add('low-stock-row');

    tr.innerHTML = `
      <td>${escapeHtml(it.sku||'')}</td>
      <td>${escapeHtml(it.name||'')}</td>
      <td>${escapeHtml(it.category||'')}</td>
      <td>${qty}</td>
      <td class="money">RM ${uc.toFixed(2)}</td>
      <td class="money">RM ${up.toFixed(2)}</td>
      <td class="money">RM ${invVal.toFixed(2)}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditPageForItem('${id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="confirmAndDeleteItem('${id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });

  if(qs('#totalValue')) qs('#totalValue').textContent = totalValue.toFixed(2);
  if(qs('#totalRevenue')) qs('#totalRevenue').textContent = totalRevenue.toFixed(2);
  if(qs('#totalStock')) qs('#totalStock').textContent = totalStock;
}

function renderDocuments(docs) {
  const list = qs('#docList');
  if(!list) return;
  list.innerHTML = '';

  docs.forEach(d => {
    const id = d.id || d._id;
    const sizeMB = ((d.sizeBytes || d.size || 0) / (1024*1024)).toFixed(2);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(d.name||'')}</td>
      <td>${sizeMB} MB</td>
      <td>${new Date(d.date).toLocaleString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="downloadDocument('${id}', '${escapeHtml(d.name||'')}')">⬇️ Download</button>
        <button class="danger-btn small-btn" onclick="deleteDocumentConfirm('${id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });
}

function renderLogs() {
  const list = qs('#logList');
  if (!list) return;

  list.innerHTML = "";

  activityLog.forEach(log => {
    const tr = document.createElement("tr");

    const userCell = document.createElement("td");
    userCell.textContent = log.user || "System";

    const actionCell = document.createElement("td");
    actionCell.textContent = log.action || "";

    const timeCell = document.createElement("td");
    const timeStr = log.time ? new Date(log.time).toLocaleString() : "N/A";
    timeCell.textContent = timeStr;

    tr.appendChild(userCell);
    tr.appendChild(actionCell);
    tr.appendChild(timeCell);

    list.appendChild(tr);
  });

  renderDashboardData();
}

function renderDashboardData(){
  const tbody = qs('#recentActivities');
  if(tbody) {
    tbody.innerHTML = '';
    activityLog.slice(0,5).forEach(l => {
      const timeStr = l.time ? new Date(l.time).toLocaleString() : new Date().toLocaleString();
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(l.user||'Admin')}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(timeStr)}</td>`;
      tbody.appendChild(tr);
    });
  }

  if(qs('#dash_totalItems')) {
    let totalValue = 0, totalRevenue = 0, totalStock = 0;
    inventory.forEach(it => {
      const qty = Number(it.quantity || 0);
      totalValue += qty * Number(it.unitCost || 0);
      totalRevenue += qty * Number(it.unitPrice || 0);
      totalStock += qty;
    });
    qs('#dash_totalItems').textContent = inventory.length;
    qs('#dash_totalValue').textContent = totalValue.toFixed(2);
    qs('#dash_totalRevenue').textContent = totalRevenue.toFixed(2);
    qs('#dash_totalStock').textContent = totalStock;
  }
}

// ---------------------- Fetchers ----------------------
async function fetchInventory() {
  try {
    const res = await apiFetch(`${API_BASE}/inventory`);
    if(!res.ok) throw new Error('Failed to fetch inventory');
    const data = await res.json();
    inventory = data.map(i => ({ ...i, id: i.id || i._id }));
    renderInventory(inventory);
    renderDashboardData();
  } catch(err) { console.error(err); }
}

async function fetchDocuments() {
  try {
    const res = await apiFetch(`${API_BASE}/documents`);
    if(!res.ok) throw new Error('Failed to fetch documents');
    const data = await res.json();
    documents = data.map(d => ({ ...d, id: d.id || d._id }));
    renderDocuments(documents);
  } catch(err) { console.error(err); }
}

async function fetchLogs() {
  try {
    const res = await apiFetch(`${API_BASE}/logs`);
    if(!res.ok) throw new Error('Failed to fetch logs');
    activityLog = await res.json();
    renderLogs();
  } catch(err) { console.error(err); }
}

// ---------------------- Init ----------------------
window.addEventListener('load', async () => {
  const adminName = getUsername();
  if(qs('#adminName')) qs('#adminName').textContent = adminName;

  const theme = (window.CONFIG && CONFIG.LS_THEME) ? localStorage.getItem(CONFIG.LS_THEME) : null;
  if(theme === 'dark') document.body.classList.add('dark-mode');

  try {
    if(currentPage.includes('inventory')) { await fetchInventory(); bindInventoryUI(); }
    if(currentPage.includes('documents')) { await fetchDocuments(); bindDocumentsUI(); }
    if(currentPage.includes('log') || currentPage === '' || currentPage === 'index.html') { await fetchLogs(); await fetchInventory(); }
    if(currentPage.includes('product')) bindProductPage();
    if(currentPage.includes('setting')) bindSettingPage();
  } catch(e) { console.error('Init error', e); }
});

// ---------------------- Auth ----------------------
async function login(){
  const user = qs('#username')?.value?.trim();
  const pass = qs('#password')?.value?.trim();
  const msg = qs('#loginMessage');
  showMsg(msg, '');
  if(!user || !pass) { showMsg(msg, '⚠️ Please enter username and password.', 'red'); return; }

  try {
    const res = await apiFetch(`${API_BASE}/login`, { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
    const data = await res.json();
    if(res.ok) {
      sessionStorage.setItem('isLoggedIn', 'true');
      sessionStorage.setItem('adminName', user);
      showMsg(msg, '✅ Login successful! Redirecting...', 'green');
      setTimeout(()=> window.location.href = 'index.html', 700);
    } else {
      showMsg(msg, `❌ ${data.message || 'Login failed.'}`, 'red');
    }
  } catch(e) {
    showMsg(msg, '❌ Server connection failed.', 'red');
    console.error(e);
  }
}

async function register(){
  const user = qs('#newUsername')?.value?.trim();
  const pass = qs('#newPassword')?.value?.trim();
  const code = qs('#securityCode')?.value?.trim();
  const msg = qs('#registerMessage');
  showMsg(msg, '');
  if(!user || !pass || !code) { showMsg(msg, '⚠️ Please fill in all fields.', 'red'); return; }

  try {
    const res = await apiFetch(`${API_BASE}/register`, { method: 'POST', body: JSON.stringify({ username: user, password: pass, securityCode: code }) });
    const data = await res.json();
    if(res.ok) {
      showMsg(msg, '✅ Registered successfully! You can now log in.', 'green');
      setTimeout(()=> toggleForm(), 900);
    } else {
      showMsg(msg, `❌ ${data.message || 'Registration failed.'}`, 'red');
    }
  } catch(e) { showMsg(msg, '❌ Server connection failed.', 'red'); console.error(e); }
}

function toggleForm(){
  const loginForm = qs('#loginForm');
  const registerForm = qs('#registerForm');
  const formTitle = qs('#formTitle');
  if(!loginForm || !registerForm || !formTitle) return;
  if(getComputedStyle(loginForm).display === 'none') {
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    formTitle.textContent = '🔐 Admin Login';
  } else {
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
    formTitle.textContent = '🧾 Register Account';
  }
}

// ---------------------- Inventory CRUD ----------------------
async function confirmAndAddProduct(){
  const sku = qs('#p_sku')?.value?.trim();
  const name = qs('#p_name')?.value?.trim();
  const category = qs('#p_category')?.value?.trim();
  const quantity = Number(qs('#p_quantity')?.value || 0);
  const unitCost = Number(qs('#p_unitCost')?.value || 0);
  const unitPrice = Number(qs('#p_unitPrice')?.value || 0);
  if(!sku || !name) return alert('⚠️ Please enter SKU and Name.');
  if(!confirm(`Confirm Add Product: ${name} (${sku})?`)) return;

  const newItem = { sku, name, category, quantity, unitCost, unitPrice };
  try {
    const res = await apiFetch(`${API_BASE}/inventory`, { method: 'POST', body: JSON.stringify(newItem) });
    if(res.ok) {
      ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id => { if(qs(id)) qs(id).value = ''; });
      await fetchInventory();
      if(currentPage.includes('inventory')) await fetchLogs();
      alert('✅ Product added successfully.');
    } else {
      alert('❌ Failed to add product.');
    }
  } catch(e) { console.error(e); alert('❌ Server connection error while adding product.'); }
}

async function confirmAndDeleteItem(id){
  const it = inventory.find(x => String(x.id) === String(id));
  if(!it) return;
  if(!confirm(`Confirm Delete: "${it.name}"?`)) return;
  try {
    const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method: 'DELETE' });
    if(res.status === 204) {
      await fetchInventory();
      alert('🗑️ Item deleted!');
    } else {
      alert('❌ Failed to delete item.');
    }
  } catch(e) { console.error(e); alert('❌ Server connection error while deleting product.'); }
}

// ---------------------- Upload Generated Files ----------------------
async function uploadGeneratedFile(blob, fileName, mimeType) {
  try {
    const buffer = await blob.arrayBuffer();
    const res = await fetch(`${API_BASE}/documents`, {
      method: 'POST',
      body: buffer,
      headers: {
        'Content-Type': mimeType || 'application/octet-stream',
        'X-Username': getUsername(),
        'X-File-Name': fileName
      }
    });
    if(!res.ok) {
      const err = await res.json().catch(()=>({message:'Unknown error'}));
      console.error('Upload generated file failed:', err.message);
      return;
    }
    await fetchDocuments(); // Refresh Documents section
    console.log(`✅ Report "${fileName}" saved in Documents`);
  } catch(e) {
    console.error('Error uploading generated file:', e);
  }
}

// ---------------------- Generate Reports ----------------------
async function confirmAndGenerateReport() {
  if(!confirm('Confirm Generate Excel Report?')) return;

  try {
    const res = await apiFetch(`${API_BASE}/inventory/report`, { method: 'GET' });
    if(!res.ok) throw new Error('Failed to generate Excel report');

    const blob = await res.blob();
    const contentDisposition = res.headers.get('Content-Disposition');
    const filenameMatch = contentDisposition ? contentDisposition.match(/filename="(.+?)"/) : null;
    const filename = filenameMatch ? filenameMatch[1] : `Inventory_Report_${Date.now()}.xlsx`;

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);

    await uploadGeneratedFile(blob, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    alert(`✅ Excel Report "${filename}" downloaded & saved to Documents!`);
  } catch(e) {
    console.error('Excel Report Error:', e);
    alert('❌ Failed to generate Excel report. Check console.');
  }
}

async function confirmAndGeneratePDF() {
  if(!confirm("Generate PDF Inventory Report?")) return;

  try {
    const res = await apiFetch(`${API_BASE}/inventory/report/pdf`, { method: 'GET' });
    if(!res.ok) throw new Error('Failed to generate PDF report');

    const blob = await res.blob();
    const contentDisposition = res.headers.get('Content-Disposition');
    const filenameMatch = contentDisposition ? contentDisposition.match(/filename="(.+?)"/) : null;
    const filename = filenameMatch ? filenameMatch[1] : `Inventory_Report_${Date.now()}.pdf`;

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);

    await uploadGeneratedFile(blob, filename, 'application/pdf');
    alert(`✅ PDF Report "${filename}" downloaded & saved to Documents!`);
  } catch (e) {
    console.error('PDF Report Error:', e);
    alert("❌ Failed to generate PDF report. Check console.");
  }
}

// ---------------------- Bind Inventory UI ----------------------
function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', confirmAndGenerateReport); // XLSX
  qs('#pdfReportBtn')?.addEventListener('click', confirmAndGeneratePDF);  // PDF
  qs('#searchInput')?.addEventListener('input', searchInventory);
  qs('#clearSearchBtn')?.addEventListener('click', ()=> { if(qs('#searchInput')) { qs('#searchInput').value=''; searchInventory(); } });
}

function searchInventory(){
  const q = (qs('#searchInput')?.value || '').toLowerCase().trim();
  const filtered = inventory.filter(item => (item.sku||'').toLowerCase().includes(q) || (item.name||'').toLowerCase().includes(q) || (item.category||'').toLowerCase().includes(q));
  renderInventory(filtered);
}

// ---------------------- Product Page ----------------------
function openEditPageForItem(id){ window.location.href = `product.html?id=${encodeURIComponent(id)}`; }

async function bindProductPage(){
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if(id) {
    try {
      const res = await apiFetch(`${API_BASE}/inventory/${id}`);
      if(res.ok) {
        const it = await res.json();
        ['p_sku','p_name','p_category','p_quantity','p_unitCost','p_unitPrice'].forEach(f => { if(qs('#'+f)) qs('#'+f).value = it[f.replace('p_','')] || ''; });
      }
    } catch(e){ console.error(e); }
  }

  qs('#saveProductBtn')?.addEventListener('click', async ()=>{
    const updated = {
      sku: qs('#p_sku')?.value?.trim(),
      name: qs('#p_name')?.value?.trim(),
      category: qs('#p_category')?.value?.trim(),
      quantity: Number(qs('#p_quantity')?.value || 0),
      unitCost: Number(qs('#p_unitCost')?.value || 0),
      unitPrice: Number(qs('#p_unitPrice')?.value || 0)
    };
    if(!updated.name || !updated.sku) return alert('⚠️ SKU and Name required.');
    if(!confirm(`Save changes for ${updated.name}?`)) return;
    try {
      const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method: 'PUT', body: JSON.stringify(updated) });
      if(res.ok) { alert('✅ Updated successfully.'); await fetchInventory(); } else alert('❌ Failed to update.'); 
    } catch(e){ console.error(e); alert('❌ Server connection error.'); }
  });
}

// ---------------------- Documents UI ----------------------
function bindDocumentsUI(){
  qs('#fileUploadBtn')?.addEventListener('click', async ()=>{
    const file = qs('#fileInput')?.files[0];
    if(!file) return alert('⚠️ Select a file first.');
    if(!confirm(`Upload "${file.name}"?`)) return;
    try {
      const res = await fetch(`${API_BASE}/documents`, { method: 'POST', body: file, headers: { 'X-Username': getUsername(), 'X-File-Name': file.name } });
      if(res.ok){ alert('✅ File uploaded.'); await fetchDocuments(); }
      else alert('❌ Failed to upload.');
    } catch(e){ console.error(e); alert('❌ Server connection error.'); }
  });
}

// ---------------------- Documents Download/Delete ----------------------
async function downloadDocument(id, name){
  try {
    const res = await apiFetch(`${API_BASE}/documents/${id}/download`, { method: 'GET' });
    if(!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch(e){ console.error(e); alert('❌ Failed to download document.'); }
}

async function deleteDocumentConfirm(id){
  if(!confirm('Confirm Delete this document?')) return;
  try {
    const res = await apiFetch(`${API_BASE}/documents/${id}`, { method: 'DELETE' });
    if(res.ok) { alert('🗑️ Document deleted.'); await fetchDocuments(); }
    else alert('❌ Failed to delete document.');
  } catch(e){ console.error(e); alert('❌ Server connection error.'); }
}

// ---------------------- Settings Page ----------------------
function bindSettingPage(){
  qs('#themeToggleBtn')?.addEventListener('click', toggleTheme);
}

