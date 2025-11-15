// public/js/script.js
// Full single-file client script supporting Inventory, Sales, Orders, Reports, Documents, Logs
// Replace API_BASE if you host the API at a different domain.

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api"; // change to your domain as necessary

// --------- Utilities ----------
const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const showMsg = (el, text, color='red') => { if(!el) return; el.textContent = text; el.style.color = color; };
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

// local caches
let inventory = [];
let sales = [];
let orders = [];
let documents = [];
let activityLog = [];

// page detection
const currentPage = window.location.pathname.split('/').pop();

// API wrapper
async function apiFetch(url, options = {}) {
  const user = getUsername();
  options.headers = {
    'Content-Type': 'application/json',
    'X-Username': user,
    ...options.headers
  };
  return fetch(url, options);
}

// --------- Auth redirect (do not redirect login/register) ----------
if(!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')) {
  try { window.location.href = 'login.html'; } catch(e) {}
}

// --------- Auth helpers ----------
function logout(){
  sessionStorage.removeItem('isLoggedIn');
  sessionStorage.removeItem('adminName');
  window.location.href = 'login.html';
}

// Theme toggle (simple)
function toggleTheme(){
  document.body.classList.toggle('dark-mode');
  if(window.CONFIG && CONFIG.LS_THEME) {
    localStorage.setItem(CONFIG.LS_THEME, document.body.classList.contains('dark-mode') ? 'dark' : 'light');
  }
}

// Expose globals for inline handlers
window.logout = logout;
window.toggleTheme = toggleTheme;

// --------- RENDERERS ----------

function renderInventory(items){
  const tbody = qs('#inventoryList');
  if(!tbody) return;
  tbody.innerHTML = '';
  let totalValue = 0, totalRevenue = 0, totalStock = 0;
  items.forEach(it=>{
    const id = it.id || it._id;
    const qty = Number(it.quantity || 0);
    const uc = Number(it.unitCost || 0);
    const up = Number(it.unitPrice || 0);
    const invVal = qty * uc;
    const rev = qty * up;
    totalValue += invVal; totalRevenue += rev; totalStock += qty;

    const tr = document.createElement('tr');
    if(qty === 0) tr.classList.add('out-of-stock-row');
    else if(qty < 10) tr.classList.add('low-stock-row');

    tr.innerHTML = `
      <td>${escapeHtml(it.sku || '')}</td>
      <td>${escapeHtml(it.name || '')}</td>
      <td>${escapeHtml(it.category || '')}</td>
      <td>${qty}</td>
      <td class="money">RM ${uc.toFixed(2)}</td>
      <td class="money">RM ${up.toFixed(2)}</td>
      <td class="money">RM ${invVal.toFixed(2)}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditPageForItem('${id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="confirmAndDeleteItem('${id}')">🗑️ Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  if(qs('#totalValue')) qs('#totalValue').textContent = totalValue.toFixed(2);
  if(qs('#totalRevenue')) qs('#totalRevenue').textContent = totalRevenue.toFixed(2);
  if(qs('#totalStock')) qs('#totalStock').textContent = totalStock;
  // also update inventory dropdowns used by sales/orders
  updateProductSelectors();
}

function renderSales(list){
  const tbody = qs('#salesList');
  if(!tbody) return;
  tbody.innerHTML = '';
  list.forEach(s=>{
    const id = s.id || s._id;
    const dateStr = s.date ? new Date(s.date).toLocaleString() : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(s.invoice || '')}</td>
      <td>${escapeHtml((s.productSku ? s.productSku + ' — ' : '') + (s.productName || ''))}</td>
      <td>${Number(s.quantity||0)}</td>
      <td class="money">RM ${(Number(s.total)||0).toFixed(2)}</td>
      <td>${escapeHtml(dateStr)}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditSale('${id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="deleteSaleConfirm('${id}')">🗑️ Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderOrders(list){
  const tbody = qs('#ordersList');
  if(!tbody) return;
  tbody.innerHTML = '';
  list.forEach(o=>{
    const id = o.id || o._id;
    const dateStr = o.date ? new Date(o.date).toLocaleString() : '';
    const itemsSummary = Array.isArray(o.items) ? o.items.map(i => `${escapeHtml(i.sku||i.name||'')} x${i.qty}`).join(', ') : '';
    const statusClass = (o.status||'').toLowerCase() === 'approved' ? 'status-completed' : (o.status||'').toLowerCase() === 'cancelled' ? 'status-cancelled' : 'status-pending';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(o.orderNumber || '')}</td>
      <td>${escapeHtml(o.customerName || '')}</td>
      <td>${itemsSummary}</td>
      <td class="money">RM ${(Number(o.total)||0).toFixed(2)}</td>
      <td><span class="order-status ${statusClass}">${escapeHtml(o.status || 'Pending')}</span></td>
      <td>${escapeHtml(dateStr)}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditOrder('${id}')">✏️ Edit</button>
        <button class="secondary-btn small-btn" onclick="changeOrderStatusPrompt('${id}')">🔁 Status</button>
        <button class="danger-btn small-btn" onclick="cancelOrderConfirm('${id}')">✖️ Cancel</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderDocuments(docs){
  const tbody = qs('#docList');
  if(!tbody) return;
  tbody.innerHTML = '';
  docs.forEach(d=>{
    const id = d.id || d._id;
    const sizeMB = ((d.sizeBytes || d.size || 0) / (1024*1024)).toFixed(2);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(d.name || '')}</td>
      <td>${sizeMB} MB</td>
      <td>${new Date(d.date).toLocaleString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="downloadDocument('${encodeURIComponent(d.name||'')}')">⬇️ Download</button>
        <button class="danger-btn small-btn" onclick="deleteDocumentConfirm('${id}')">🗑️ Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderLogs(){
  const list = qs('#logList');
  if(!list) return;
  list.innerHTML = '';
  activityLog.slice().reverse().slice(0,500).forEach(l=>{
    const li = document.createElement('li');
    const timeStr = l.time ? new Date(l.time).toLocaleString() : new Date().toLocaleString();
    li.innerHTML = `[${escapeHtml(timeStr)}] <b>${escapeHtml(l.user||'System')}</b>: ${escapeHtml(l.action||'')}`;
    list.appendChild(li);
  });

  // dashboard recent activities
  const tbody = qs('#recentActivities');
  if(tbody){
    tbody.innerHTML = '';
    activityLog.slice().reverse().slice(0,5).forEach(l=>{
      const tr = document.createElement('tr');
      const timeStr = l.time ? new Date(l.time).toLocaleString() : new Date().toLocaleString();
      tr.innerHTML = `<td>${escapeHtml(l.user||'System')}</td><td>${escapeHtml(l.action||'')}</td><td>${escapeHtml(timeStr)}</td>`;
      tbody.appendChild(tr);
    });
  }
}

// --------- FETCHERS ----------
async function fetchInventory(){
  try{
    const res = await apiFetch(`${API_BASE}/inventory`);
    if(!res.ok) throw new Error('Failed to fetch inventory');
    const data = await res.json();
    inventory = data.map(i => ({ ...i, id: i.id || i._id }));
    renderInventory(inventory);
  }catch(err){ console.error('fetchInventory', err); }
}

async function fetchSales(){
  try{
    const res = await apiFetch(`${API_BASE}/sales`);
    if(!res.ok) throw new Error('Failed to fetch sales');
    const data = await res.json();
    sales = data.map(s => ({ ...s, id: s.id || s._id }));
    renderSales(sales);
  }catch(err){ console.error('fetchSales', err); }
}

async function fetchOrders(){
  try{
    const res = await apiFetch(`${API_BASE}/orders`);
    if(!res.ok) throw new Error('Failed to fetch orders');
    const data = await res.json();
    orders = data.map(o => ({ ...o, id: o.id || o._id }));
    renderOrders(orders);
  }catch(err){ console.error('fetchOrders', err); }
}

async function fetchDocuments(){
  try{
    const res = await apiFetch(`${API_BASE}/documents`);
    if(!res.ok) throw new Error('Failed to fetch documents');
    const data = await res.json();
    documents = data.map(d => ({ ...d, id: d.id || d._id }));
    renderDocuments(documents);
  }catch(err){ console.error('fetchDocuments', err); }
}

async function fetchLogs(){
  try{
    const res = await apiFetch(`${API_BASE}/logs`);
    if(!res.ok) throw new Error('Failed to fetch logs');
    activityLog = await res.json();
    renderLogs();
  }catch(err){ console.error('fetchLogs', err); }
}

// --------- INIT ----------
window.addEventListener('load', async ()=>{
  // show admin
  const adminName = getUsername();
  if(qs('#adminName')) qs('#adminName').textContent = adminName;

  // theme
  if(window.CONFIG && CONFIG.LS_THEME) {
    const t = localStorage.getItem(CONFIG.LS_THEME);
    if(t === 'dark') document.body.classList.add('dark-mode');
  }

  try{
    if(currentPage.includes('inventory')) { await fetchInventory(); bindInventoryUI(); }
    if(currentPage.includes('sales')) { await fetchInventory(); await fetchSales(); bindSalesUI(); }
    if(currentPage.includes('orders')) { await fetchInventory(); await fetchOrders(); bindOrdersUI(); }
    if(currentPage.includes('documents')) { await fetchDocuments(); bindDocumentsUI(); }
    if(currentPage.includes('log') || currentPage==='' || currentPage==='index.html') { await fetchLogs(); await fetchInventory(); bindDashboardUI(); }
    if(currentPage.includes('product')) bindProductPage();
    if(currentPage.includes('setting')) bindSettingPage();
  }catch(e){ console.error('init error', e); }
});

// --------- INVENTORY CRUD & UI ----------
async function confirmAndAddProduct(){
  const sku = qs('#p_sku')?.value?.trim();
  const name = qs('#p_name')?.value?.trim();
  const category = qs('#p_category')?.value?.trim();
  const quantity = Number(qs('#p_quantity')?.value || 0);
  const unitCost = Number(qs('#p_unitCost')?.value || 0);
  const unitPrice = Number(qs('#p_unitPrice')?.value || 0);
  if(!sku || !name) return alert('Enter SKU and Name');
  if(!confirm(`Add product: ${name} (${sku})?`)) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory`, { method: 'POST', body: JSON.stringify({ sku, name, category, quantity, unitCost, unitPrice }) });
    if(res.ok){ ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id=> qs(id) && (qs(id).value='')); await fetchInventory(); alert('Product added'); }
    else { const d = await res.json(); alert('Failed: ' + (d.message||'')); }
  }catch(e){ console.error(e); alert('Server error'); }
}

async function confirmAndDeleteItem(id){
  const it = inventory.find(x=>String(x.id)===String(id));
  if(!it) return;
  if(!confirm(`Delete "${it.name}"?`)) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method: 'DELETE' });
    if(res.status === 204) { await fetchInventory(); alert('Deleted'); }
    else { const d = await res.json(); alert('Failed: ' + (d.message||'')); }
  }catch(e){ console.error(e); alert('Server error'); }
}

async function confirmAndGenerateReport(){
  if(!confirm('Generate Inventory Excel report?')) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory/report`, { method: 'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition');
    const fnMatch = cd ? cd.match(/filename="(.+?)"/) : null;
    const filename = fnMatch ? fnMatch[1] : `Inventory_Report_${Date.now()}.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    await fetchDocuments(); alert('Inventory report downloaded.');
  }catch(e){ console.error(e); alert('Report generation error'); }
}

function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', confirmAndGenerateReport);
  qs('#searchInput')?.addEventListener('input', ()=> {
    const q = (qs('#searchInput')?.value || '').toLowerCase().trim();
    renderInventory(inventory.filter(it=> (it.sku||'').toLowerCase().includes(q) || (it.name||'').toLowerCase().includes(q) || (it.category||'').toLowerCase().includes(q)));
  });
  qs('#clearSearchBtn')?.addEventListener('click', ()=> { if(qs('#searchInput')) { qs('#searchInput').value=''; renderInventory(inventory); } });
}

// open product edit page
function openEditPageForItem(id){ window.location.href = `product.html?id=${encodeURIComponent(id)}`; }

async function bindProductPage(){
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if(id){
    try{
      const res = await apiFetch(`${API_BASE}/inventory`);
      const items = await res.json();
      const it = items.find(x => String(x.id) === String(id));
      if(!it) return alert('Item not found');
      if(qs('#prod_id')) qs('#prod_id').value = it.id || it._id;
      if(qs('#prod_sku')) qs('#prod_sku').value = it.sku || '';
      if(qs('#prod_name')) qs('#prod_name').value = it.name || '';
      if(qs('#prod_category')) qs('#prod_category').value = it.category || '';
      if(qs('#prod_quantity')) qs('#prod_quantity').value = it.quantity || 0;
      if(qs('#prod_unitCost')) qs('#prod_unitCost').value = it.unitCost || 0;
      if(qs('#prod_unitPrice')) qs('#prod_unitPrice').value = it.unitPrice || 0;
    }catch(e){ console.error(e); alert('Load product failed'); }
  }

  qs('#saveProductBtn')?.addEventListener('click', async ()=>{
    if(!confirm('Save changes?')) return;
    const idVal = qs('#prod_id')?.value;
    const body = {
      sku: qs('#prod_sku')?.value,
      name: qs('#prod_name')?.value,
      category: qs('#prod_category')?.value,
      quantity: Number(qs('#prod_quantity')?.value || 0),
      unitCost: Number(qs('#prod_unitCost')?.value || 0),
      unitPrice: Number(qs('#prod_unitPrice')?.value || 0)
    };
    try{
      const res = await apiFetch(`${API_BASE}/inventory/${idVal}`, { method: 'PUT', body: JSON.stringify(body) });
      if(res.ok){ alert('Updated'); window.location.href = 'inventory.html'; }
      else { const d = await res.json(); alert('Failed: ' + (d.message||'')); }
    }catch(e){ console.error(e); alert('Server error'); }
  });

  qs('#cancelProductBtn')?.addEventListener('click', ()=> window.location.href = 'inventory.html');
}

// --------- DOCUMENTS ----------
async function uploadDocuments(){
  const files = qs('#docUpload')?.files || [];
  const msgEl = qs('#uploadMessage');
  if(!files.length) return showMsg(msgEl, 'Select files', 'red');
  if(!confirm(`Upload metadata for ${files.length} files?`)) return;
  showMsg(msgEl, 'Uploading metadata...', 'orange');
  for(const f of files){
    try{
      const res = await apiFetch(`${API_BASE}/documents`, { method: 'POST', body: JSON.stringify({ name: f.name, sizeBytes: f.size, type: f.type }) });
      if(!res.ok) throw new Error('Upload metadata failed');
    }catch(e){ console.error(e); showMsg(msgEl, `Failed ${f.name}`, 'red'); return; }
  }
  qs('#docUpload').value = '';
  setTimeout(()=> { fetchDocuments(); if(msgEl) msgEl.remove(); }, 800);
}

function downloadDocument(fnEnc){
  const fn = decodeURIComponent(fnEnc);
  if(!confirm(`Download ${fn}?`)) return;
  window.open(`${API_BASE}/documents/download/${encodeURIComponent(fn)}`, '_blank');
}

async function deleteDocumentConfirm(id){
  const d = documents.find(x=>String(x.id)===String(id));
  if(!d) return;
  if(!confirm(`Delete ${d.name}?`)) return;
  try{
    const res = await apiFetch(`${API_BASE}/documents/${id}`, { method: 'DELETE' });
    if(res.status === 204) { await fetchDocuments(); alert('Deleted'); }
    else { const dd = await res.json(); alert('Failed: ' + (dd.message||'')); }
  }catch(e){ console.error(e); alert('Server error'); }
}

function bindDocumentsUI(){
  qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments);
  qs('#searchDocs')?.addEventListener('input', ()=> {
    const q = (qs('#searchDocs')?.value || '').toLowerCase();
    renderDocuments(documents.filter(d => (d.name||'').toLowerCase().includes(q)));
  });
}

// --------- SALES (Add/Edit/Delete) ----------

// creates a simple modal for add/edit sale
function createSaleModalIfMissing(){
  if(qs('#saleModal')) return;
  const modal = document.createElement('div'); modal.id = 'saleModal';
  modal.style = 'position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,0.45);display:flex;align-items:flex-start;justify-content:center;z-index:9999;padding:30px;';
  modal.innerHTML = `
    <div style="background:white;border-radius:8px;padding:18px;max-width:520px;width:100%;">
      <h3 id="saleModalTitle">Add Sale</h3>
      <label>Invoice (optional)</label>
      <input id="sale_invoice" placeholder="Invoice # (optional)"/>
      <label>Product (search or SKU)</label>
      <input id="sale_product_select" placeholder="Type SKU or product name" list="sale_products_list" />
      <datalist id="sale_products_list"></datalist>
      <label>Quantity</label>
      <input id="sale_quantity" type="number" min="1" value="1" />
      <label>Unit Price (RM)</label>
      <input id="sale_unitPrice" type="number" step="0.01" value="0.00" />
      <label>Total (RM)</label>
      <input id="sale_total" type="number" step="0.01" value="0.00" />
      <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">
        <button id="saveSaleBtn" class="primary-btn">Save</button>
        <button id="closeSaleBtn" class="secondary-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // populate datalist and bind interactions
  qs('#sale_product_select').addEventListener('input', () => {
    const val = qs('#sale_product_select').value.trim();
    // try to find product by sku or name
    const found = inventory.find(i => (i.sku || '').toLowerCase() === val.toLowerCase() || (i.name || '').toLowerCase() === val.toLowerCase());
    if(found){
      qs('#sale_unitPrice').value = Number(found.unitPrice || found.unitPrice === 0 ? found.unitPrice : 0).toFixed(2);
      // update total
      const qty = Number(qs('#sale_quantity').value || 0);
      qs('#sale_total').value = (qty * Number(qs('#sale_unitPrice').value || 0)).toFixed(2);
    }
  });

  qs('#sale_quantity').addEventListener('input', ()=>{
    const qty = Number(qs('#sale_quantity').value || 0);
    const unit = Number(qs('#sale_unitPrice').value || 0);
    qs('#sale_total').value = (qty * unit).toFixed(2);
  });

  qs('#sale_unitPrice').addEventListener('input', ()=>{
    const qty = Number(qs('#sale_quantity').value || 0);
    const unit = Number(qs('#sale_unitPrice').value || 0);
    qs('#sale_total').value = (qty * unit).toFixed(2);
  });

  qs('#closeSaleBtn').addEventListener('click', ()=> { qs('#saleModal').style.display = 'none'; });
  qs('#saveSaleBtn').addEventListener('click', saveSaleFromModal);
}

// open add sale modal
function openAddSale(){
  createSaleModalIfMissing();
  qs('#saleModalTitle').textContent = 'Add Sale';
  qs('#sale_invoice').value = '';
  qs('#sale_product_select').value = '';
  qs('#sale_quantity').value = 1;
  qs('#sale_unitPrice').value = '0.00';
  qs('#sale_total').value = '0.00';
  refreshSaleDatalist();
  qs('#saleModal').style.display = 'flex';
}

// populate datalist for sales modal
function refreshSaleDatalist(){
  const dl = qs('#sale_products_list');
  if(!dl) return;
  dl.innerHTML = '';
  inventory.forEach(i=>{
    const opt = document.createElement('option');
    opt.value = `${i.sku} — ${i.name}`;
    dl.appendChild(opt);
    // also add simple sku-only option
    const opt2 = document.createElement('option');
    opt2.value = i.sku;
    dl.appendChild(opt2);
  });
}

// save sale (create or update depending on hidden edit id)
async function saveSaleFromModal(){
  const invoice = qs('#sale_invoice')?.value?.trim();
  const productInput = qs('#sale_product_select')?.value?.trim();
  if(!productInput) return alert('Choose product (by SKU or name)');
  // try to resolve SKU and name
  let matched = inventory.find(i => (i.sku && (productInput.indexOf(i.sku) !== -1 || productInput.toLowerCase().includes(i.sku.toLowerCase()))) || (i.name && productInput.toLowerCase().includes(i.name.toLowerCase())));
  if(!matched){
    // try direct equality
    matched = inventory.find(i => (i.sku || '').toLowerCase() === productInput.toLowerCase() || (i.name || '').toLowerCase() === productInput.toLowerCase());
  }
  const productSku = matched ? matched.sku : '';
  const productName = matched ? matched.name : productInput;
  const qty = Number(qs('#sale_quantity')?.value || 0);
  const total = Number(qs('#sale_total')?.value || 0);
  if(qty <= 0) return alert('Enter valid quantity');
  try{
    // if editing: check hidden id
    const editId = qs('#saleModal')?.dataset.editId;
    if(editId){
      const res = await apiFetch(`${API_BASE}/sales/${editId}`, { method: 'PUT', body: JSON.stringify({ invoice, productSku, productName, quantity: qty, total }) });
      if(res.ok){ qs('#saleModal').style.display = 'none'; delete qs('#saleModal').dataset.editId; await fetchSales(); alert('Sale updated'); }
      else { const d = await res.json(); alert('Failed: ' + (d.message||'')); }
    } else {
      const res = await apiFetch(`${API_BASE}/sales`, { method: 'POST', body: JSON.stringify({ invoice, productSku, productName, quantity: qty, total }) });
      if(res.ok){ qs('#saleModal').style.display = 'none'; await fetchSales(); alert('Sale added'); }
      else { const d = await res.json(); alert('Failed: ' + (d.message||'')); }
    }
  }catch(e){ console.error(e); alert('Server error'); }
}

// open edit sale modal (prefill)
async function openEditSale(id){
  createSaleModalIfMissing();
  qs('#saleModalTitle').textContent = 'Edit Sale';
  refreshSaleDatalist();
  // fetch sale
  try{
    const res = await apiFetch(`${API_BASE}/sales/${id}`);
    if(!res.ok) throw new Error('Not found');
    const s = await res.json();
    qs('#sale_invoice').value = s.invoice || '';
    qs('#sale_product_select').value = (s.productSku ? s.productSku + ' — ' : '') + (s.productName || '');
    qs('#sale_quantity').value = s.quantity || 1;
    qs('#sale_unitPrice').value = Number((s.total && s.quantity) ? (s.total / s.quantity).toFixed(2) : (s.unitPrice || 0)).toFixed(2);
    qs('#sale_total').value = Number(s.total || 0).toFixed(2);
    qs('#saleModal').dataset.editId = id;
    qs('#saleModal').style.display = 'flex';
  }catch(e){ console.error(e); alert('Failed to load sale'); }
}

// delete sale
async function deleteSaleConfirm(id){
  if(!confirm('Delete this sale?')) return;
  try{
    const res = await apiFetch(`${API_BASE}/sales/${id}`, { method: 'DELETE' });
    if(res.status === 204 || res.ok){ await fetchSales(); alert('Sale deleted'); }
    else { const d = await res.json(); alert('Failed: ' + (d.message||'')); }
  }catch(e){ console.error(e); alert('Server error'); }
}

// bind sales UI
function bindSalesUI(){
  // Add/Download buttons
  qs('#addSaleBtn')?.addEventListener('click', openAddSale);
  qs('#downloadSalesXLSXBtnInline')?.addEventListener('click', downloadSalesReportXLSX);
  qs('#downloadSalesPDFBtn')?.addEventListener('click', ()=> window.open(`${API_BASE}/sales/report/pdf`, '_blank'));
  // search
  qs('#searchSales')?.addEventListener('input', ()=> {
    const q = (qs('#searchSales')?.value || '').toLowerCase().trim();
    renderSales(sales.filter(s => ((s.invoice||'').toLowerCase().includes(q) || (s.productName||'').toLowerCase().includes(q) || (s.productSku||'').toLowerCase().includes(q))));
  });
  // initial refresh of datalist
  refreshSaleDatalist();
}

// download sales excel
async function downloadSalesReportXLSX(){
  try{
    const res = await apiFetch(`${API_BASE}/sales/report`, { method: 'GET' });
    if(!res.ok){ const d = await res.json(); return alert('Failed: ' + (d.message||'')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition');
    const fnMatch = cd ? cd.match(/filename="(.+?)"/) : null;
    const filename = fnMatch ? fnMatch[1] : `Sales_Report_${new Date().toISOString().slice(0,10)}.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    await fetchSales();
  }catch(e){ console.error(e); alert('Download error'); }
}

// --------- ORDERS (Advanced multi-item) ----------

function createOrderModalIfMissing(){
  if(qs('#orderModal')) return;
  const modal = document.createElement('div'); modal.id = 'orderModal';
  modal.style = 'position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,0.45);display:flex;align-items:flex-start;justify-content:center;z-index:9999;padding:20px;';
  modal.innerHTML = `
    <div style="background:white;border-radius:8px;padding:16px;max-width:900px;width:100%;max-height:90vh;overflow:auto;">
      <h3 id="orderModalTitle">Create New Order</h3>
      <label>Order Number (optional)</label>
      <input id="order_number" placeholder="Order # (auto if empty)" />
      <label>Customer Name</label>
      <input id="order_customer" placeholder="Customer full name" />
      <div id="order_items_container" style="margin-top:10px;"></div>
      <div style="margin-top:8px;"><button id="addOrderItemBtn" class="secondary-btn">+ Add Item</button></div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:12px;">
        <div style="font-weight:700">Total: RM <span id="order_total_display">0.00</span></div>
        <div style="flex:1"></div>
        <select id="order_status_select">
          <option value="Pending">Pending</option>
          <option value="Approved">Approved</option>
        </select>
        <button id="saveOrderBtn" class="primary-btn">Save Order</button>
        <button id="closeOrderBtn" class="secondary-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  qs('#addOrderItemBtn')?.addEventListener('click', addOrderItemRow);
  qs('#closeOrderBtn')?.addEventListener('click', ()=> qs('#orderModal').style.display = 'none');
  qs('#saveOrderBtn')?.addEventListener('click', saveOrderFromModal);
}

// add one row for an item in order modal; product selector autocompletes from inventory
function addOrderItemRow(pref = {}) {
  const container = qs('#order_items_container');
  if(!container) return;
  const row = document.createElement('div');
  row.className = 'order-item-row';
  row.style = 'display:flex;gap:8px;align-items:center;margin-top:8px;';
  row.innerHTML = `
    <input class="oi_sku" placeholder="SKU" style="width:110px" />
    <input class="oi_name" placeholder="Product name" style="flex:2" />
    <input class="oi_qty" type="number" min="1" value="${pref.qty || 1}" style="width:80px" />
    <input class="oi_price" type="number" step="0.01" value="${pref.price ? Number(pref.price).toFixed(2) : '0.00'}" style="width:120px" />
    <div style="width:120px;text-align:right;">Subtotal: RM <span class="oi_subtotal">0.00</span></div>
    <button class="danger-btn oi_remove">Remove</button>
  `;
  container.appendChild(row);

  const skuEl = row.querySelector('.oi_sku');
  const nameEl = row.querySelector('.oi_name');
  const qtyEl = row.querySelector('.oi_qty');
  const priceEl = row.querySelector('.oi_price');
  const subtotalEl = row.querySelector('.oi_subtotal');

  // populate if pref
  if(pref.sku) skuEl.value = pref.sku;
  if(pref.name) nameEl.value = pref.name;

  // event to auto-fill name/price when SKU or name typed
  function fillFromInventory(){
    const v = (skuEl.value || nameEl.value || '').trim().toLowerCase();
    const found = inventory.find(i => (i.sku || '').toLowerCase() === v || (i.name || '').toLowerCase().includes(v) || (i.sku && v.includes(i.sku.toLowerCase())));
    if(found){
      skuEl.value = found.sku || skuEl.value;
      nameEl.value = found.name || nameEl.value;
      // auto fill price but allow editing
      if(!priceEl || priceEl.value === '' || Number(priceEl.value) === 0) priceEl.value = Number(found.unitPrice || 0).toFixed(2);
    }
    updateRowSubtotal();
  }

  function updateRowSubtotal(){
    const q = Number(qtyEl.value || 0);
    const p = Number(priceEl.value || 0);
    subtotalEl.textContent = (q * p).toFixed(2);
    updateOrderTotalFromModal();
  }

  skuEl.addEventListener('input', fillFromInventory);
  nameEl.addEventListener('input', fillFromInventory);
  qtyEl.addEventListener('input', updateRowSubtotal);
  priceEl.addEventListener('input', updateRowSubtotal);
  row.querySelector('.oi_remove').addEventListener('click', ()=>{
    row.remove();
    updateOrderTotalFromModal();
  });

  updateRowSubtotal();
}

// update total display
function updateOrderTotalFromModal(){
  const rows = qsa('#order_items_container .order-item-row');
  let total = 0;
  rows.forEach(r=>{
    const q = Number(r.querySelector('.oi_qty')?.value || 0);
    const p = Number(r.querySelector('.oi_price')?.value || 0);
    total += q * p;
    const sub = r.querySelector('.oi_subtotal');
    if(sub) sub.textContent = (q * p).toFixed(2);
  });
  if(qs('#order_total_display')) qs('#order_total_display').textContent = total.toFixed(2);
}

// open create order modal
function openAddOrder(){
  createOrderModalIfMissing();
  qs('#orderModalTitle').textContent = 'Create New Order';
  qs('#order_number').value = '';
  qs('#order_customer').value = '';
  qs('#order_items_container').innerHTML = '';
  addOrderItemRow();
  qs('#order_status_select').value = 'Pending';
  qs('#orderModal').style.display = 'flex';
}

// save order (create or update)
async function saveOrderFromModal(){
  const editId = qs('#orderModal')?.dataset.editId;
  const orderNumber = qs('#order_number')?.value?.trim();
  const customer = qs('#order_customer')?.value?.trim();
  if(!customer) return alert('Enter customer name');
  const rows = qsa('#order_items_container .order-item-row');
  if(rows.length === 0) return alert('Add at least one item');

  const items = rows.map(r => ({
    sku: r.querySelector('.oi_sku')?.value?.trim(),
    name: r.querySelector('.oi_name')?.value?.trim(),
    qty: Number(r.querySelector('.oi_qty')?.value || 0),
    price: Number(r.querySelector('.oi_price')?.value || 0)
  })).filter(i => i.qty > 0);

  if(items.length === 0) return alert('Add at least one valid item');

  const total = items.reduce((s,i)=> s + i.qty * i.price, 0);
  const status = qs('#order_status_select')?.value || 'Pending';
  try{
    if(editId){
      const res = await apiFetch(`${API_BASE}/orders/${editId}`, { method: 'PUT', body: JSON.stringify({ orderNumber, customerName: customer, items, total, status }) });
      if(res.ok){ delete qs('#orderModal').dataset.editId; qs('#orderModal').style.display = 'none'; await fetchOrders(); alert('Order updated'); }
      else { const d = await res.json(); alert('Failed: ' + (d.message||'')); }
    } else {
      const res = await apiFetch(`${API_BASE}/orders`, { method: 'POST', body: JSON.stringify({ orderNumber, customerName: customer, items, total, status }) });
      if(res.ok){ qs('#orderModal').style.display = 'none'; await fetchOrders(); alert('Order created'); }
      else { const d = await res.json(); alert('Failed: ' + (d.message||'')); }
    }
  }catch(e){ console.error(e); alert('Server error'); }
}

// open edit order modal with prefilled data
async function openEditOrder(id){
  createOrderModalIfMissing();
  qs('#orderModalTitle').textContent = 'Edit Order';
  try{
    const res = await apiFetch(`${API_BASE}/orders/${id}`);
    if(!res.ok) throw new Error('Not found');
    const o = await res.json();
    qs('#orderModal').dataset.editId = id;
    qs('#order_number').value = o.orderNumber || '';
    qs('#order_customer').value = o.customerName || '';
    qs('#order_items_container').innerHTML = '';
    (o.items || []).forEach(it => addOrderItemRow({ sku: it.sku, name: it.name, qty: it.qty, price: it.price }));
    qs('#order_status_select').value = o.status || 'Pending';
    updateOrderTotalFromModal();
    qs('#orderModal').style.display = 'flex';
  }catch(e){ console.error(e); alert('Failed to load order'); }
}

// cancel order confirmation
async function cancelOrderConfirm(id){
  if(!confirm('Cancel this order? This will mark it as Cancelled.')) return;
  try{
    const res = await apiFetch(`${API_BASE}/orders/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'Cancelled' }) });
    if(res.ok){ await fetchOrders(); alert('Order cancelled'); }
    else { const d = await res.json(); alert('Failed: ' + (d.message||'')); }
  }catch(e){ console.error(e); alert('Server error'); }
}

// change order status prompt (Pending <-> Approved)
async function changeOrderStatusPrompt(id){
  const o = orders.find(x => String(x.id) === String(id));
  if(!o) return alert('Order not found');
  const newStatus = prompt('Enter status (Pending / Approved / Cancelled):', o.status || 'Pending');
  if(!newStatus) return;
  const ns = newStatus.trim();
  if(!['Pending','Approved','Cancelled'].includes(ns)) return alert('Invalid status');
  try{
    const res = await apiFetch(`${API_BASE}/orders/${id}`, { method: 'PUT', body: JSON.stringify({ status: ns }) });
    if(res.ok){ await fetchOrders(); alert('Status updated'); }
    else { const d = await res.json(); alert('Failed: ' + (d.message||'')); }
  }catch(e){ console.error(e); alert('Server error'); }
}

// download orders report
async function downloadOrdersReportXLSX(){
  try{
    const res = await apiFetch(`${API_BASE}/orders/report`, { method: 'GET' });
    if(!res.ok){ const d = await res.json(); return alert('Failed: ' + (d.message||'')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition');
    const fnMatch = cd ? cd.match(/filename="(.+?)"/) : null;
    const filename = fnMatch ? fnMatch[1] : `Orders_Report_${new Date().toISOString().slice(0,10)}.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    await fetchOrders();
  }catch(e){ console.error(e); alert('Download error'); }
}

// bind orders UI
function bindOrdersUI(){
  qs('#addOrderBtn')?.addEventListener('click', openAddOrder);
  qs('#downloadOrdersXLSXBtnInline')?.addEventListener('click', downloadOrdersReportXLSX);
  qs('#downloadOrdersPDFBtn')?.addEventListener('click', ()=> window.open(`${API_BASE}/orders/report/pdf`, '_blank'));
  qs('#searchOrders')?.addEventListener('input', ()=> {
    const q = (qs('#searchOrders')?.value || '').toLowerCase().trim();
    renderOrders(orders.filter(o => (o.orderNumber||'').toLowerCase().includes(q) || (o.customerName||'').toLowerCase().includes(q) || (o.items||[]).some(it => (it.name||'').toLowerCase().includes(q))));
  });
}

// --------- DASHBOARD / ZIP REPORT ----------
function bindDashboardUI(){
  qs('#downloadInventoryPDF')?.addEventListener('click', ()=> window.open(`${API_BASE}/inventory/report/pdf`, '_blank'));
  qs('#downloadInventoryXLSX')?.addEventListener('click', confirmAndGenerateReport);
  qs('#downloadAllReportsZip')?.addEventListener('click', downloadAllReportsZip);
}

async function downloadAllReportsZip(){
  try{
    const res = await apiFetch(`${API_BASE}/reports/zip`, { method: 'GET' });
    if(!res.ok){ const d = await res.json(); return alert('Failed: ' + (d.message||'')); }
    const blob = await res.blob();
    const filename = `All_Reports_${new Date().toISOString().slice(0,10)}.zip`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }catch(e){ console.error(e); alert('Download ZIP failed'); }
}

// --------- SETTINGS & LOGIC ----------
function bindSettingPage(){
  const current = getUsername();
  if(qs('#currentUser')) qs('#currentUser').textContent = current;

  qs('#changePasswordBtn')?.addEventListener('click', async ()=>{
    const newPass = qs('#newPassword')?.value;
    const conf = qs('#confirmPassword')?.value;
    const code = qs('#securityCode')?.value;
    const msgEl = qs('#passwordMessage');
    showMsg(msgEl, '', 'red');
    if(!newPass || !conf || !code) return showMsg(msgEl, 'Fill all fields', 'red');
    if(newPass !== conf) return showMsg(msgEl, 'Passwords do not match', 'red');
    if(!confirm('Change password?')) return;
    try{
      const res = await apiFetch(`${API_BASE}/account/password`, { method: 'PUT', body: JSON.stringify({ username: current, newPassword: newPass, securityCode: code }) });
      const data = await res.json();
      if(res.ok){ showMsg(msgEl, 'Password changed. Logging out...', 'green'); setTimeout(()=> logout(), 1200); }
      else showMsg(msgEl, data.message || 'Failed', 'red');
    }catch(e){ showMsg(msgEl, 'Server error', 'red'); }
  });

  qs('#deleteAccountBtn')?.addEventListener('click', async ()=>{
    if(!confirm('Delete account? This is irreversible.')) return;
    const code = prompt('Enter Admin Security Code:');
    if(!code) return;
    try{
      const res = await apiFetch(`${API_BASE}/account`, { method: 'DELETE', body: JSON.stringify({ username: current, securityCode: code }) });
      const data = await res.json();
      if(res.ok){ alert('Account deleted'); logout(); }
      else alert('Failed: ' + (data.message||''));
    }catch(e){ console.error(e); alert('Server error'); }
  });
}

// --------- PRODUCT SELECT HELPERS (sales/orders) ----------
function updateProductSelectors(){
  // used to refresh sale datalist and other selector UI when inventory changes
  refreshSaleDatalist();
  // no extra UI elements required here; order modal builds its rows from inventory when typing
}

// --------- LOGIC: Edit Sale / Edit Order endpoints used by server must exist ----------
// server-side endpoints expected:
// GET /api/sales, GET /api/sales/:id, POST /api/sales, PUT /api/sales/:id, DELETE /api/sales/:id
// GET /api/orders, GET /api/orders/:id, POST /api/orders, PUT /api/orders/:id, DELETE /api/orders/:id

// --------- LOGIN & REGISTER HANDLERS (if on login page) ----------
async function login(){
  const user = qs('#username')?.value?.trim();
  const pass = qs('#password')?.value?.trim();
  const msg = qs('#loginMessage');
  showMsg(msg, '');
  if(!user || !pass) { showMsg(msg, '⚠️ Enter username and password', 'red'); return; }
  try{
    const res = await apiFetch(`${API_BASE}/login`, { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
    const data = await res.json();
    if(res.ok){ sessionStorage.setItem('isLoggedIn','true'); sessionStorage.setItem('adminName', user); showMsg(msg, '✅ Login successful', 'green'); setTimeout(()=> location.href='index.html', 600); }
    else showMsg(msg, `❌ ${data.message || 'Login failed'}`, 'red');
  }catch(e){ showMsg(msg, '❌ Server error', 'red'); console.error(e); }
}

async function register(){
  const user = qs('#newUsername')?.value?.trim();
  const pass = qs('#newPassword')?.value?.trim();
  const code = qs('#securityCode')?.value?.trim();
  const msg = qs('#registerMessage');
  showMsg(msg, '');
  if(!user || !pass || !code) { showMsg(msg, '⚠️ Fill all fields', 'red'); return; }
  try{
    const res = await apiFetch(`${API_BASE}/register`, { method: 'POST', body: JSON.stringify({ username: user, password: pass, securityCode: code }) });
    const data = await res.json();
    if(res.ok){ showMsg(msg, '✅ Registered! You can login now', 'green'); setTimeout(()=> toggleForm(), 900); }
    else showMsg(msg, `❌ ${data.message || 'Registration failed'}`, 'red');
  }catch(e){ showMsg(msg, '❌ Server error', 'red'); }
}

function toggleForm(){
  const loginForm = qs('#loginForm'), registerForm = qs('#registerForm'), formTitle = qs('#formTitle');
  if(!loginForm || !registerForm || !formTitle) return;
  if(getComputedStyle(loginForm).display === 'none'){
    loginForm.style.display = 'block'; registerForm.style.display = 'none'; formTitle.textContent = '🔐 Admin Login';
  } else {
    loginForm.style.display = 'none'; registerForm.style.display = 'block'; formTitle.textContent = '🧾 Register Account';
  }
}

// bind login page events
document.addEventListener('DOMContentLoaded', ()=>{
  if(currentPage.includes('login.html')){
    qs('#loginBtn')?.addEventListener('click', login);
    qs('#registerBtn')?.addEventListener('click', register);
    qs('#toggleToRegister')?.addEventListener('click', toggleForm);
    qs('#toggleToLogin')?.addEventListener('click', toggleForm);
    if(qs('#contactPhone') && window.CONFIG && CONFIG.CONTACT_PHONE) qs('#contactPhone').textContent = CONFIG.CONTACT_PHONE;
  }
});

// --------- Expose some functions globally needed for inline onclicks ----------
window.openEditSale = openEditSale;
window.openEditOrder = openEditOrder;
window.deleteSaleConfirm = deleteSaleConfirm;
window.cancelOrderConfirm = cancelOrderConfirm;
window.changeOrderStatusPrompt = changeOrderStatusPrompt;
window.downloadSalesReportXLSX = downloadSalesReportXLSX;
window.downloadOrdersReportXLSX = downloadOrdersReportXLSX;
window.downloadAllReportsZip = downloadAllReportsZip;
window.openAddSale = openAddSale;
window.openAddOrder = openAddOrder;
window.confirmAndGenerateReport = confirmAndGenerateReport;
window.downloadDocument = downloadDocument;
window.deleteDocumentConfirm = deleteDocumentConfirm;
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;

