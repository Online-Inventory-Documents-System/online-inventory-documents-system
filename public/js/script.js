// public/js/script.js
// Full client-side script with Searchable Dropdown (Name + SKU) and Sales/Orders integration

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color='red') => { if(!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

let inventory = [], sales = [], orders = [], documents = [], activityLog = [];
const currentPage = window.location.pathname.split('/').pop();

// fetch wrapper
async function apiFetch(url, opts = {}) {
  const user = getUsername();
  opts.headers = { 'Content-Type':'application/json', 'X-Username': user, ...opts.headers };
  return fetch(url, opts);
}

/* ---- Auth redirect (skip on login page) ---- */
if(!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')) {
  try { window.location.href = 'login.html'; } catch(e) {}
}

function logout(){ sessionStorage.removeItem('isLoggedIn'); sessionStorage.removeItem('adminName'); window.location.href='login.html'; }
function toggleTheme(){ document.body.classList.toggle('dark-mode'); if(window.CONFIG && CONFIG.LS_THEME) localStorage.setItem(CONFIG.LS_THEME, document.body.classList.contains('dark-mode') ? 'dark' : 'light'); }

/* =================== RENDERERS =================== */

function renderInventory(items){
  const list = qs('#inventoryList'); if(!list) return;
  list.innerHTML = '';
  let totalValue=0, totalRevenue=0, totalStock=0;
  items.forEach(it=>{
    const id = it.id || it._id;
    const qty = Number(it.quantity||0), uc = Number(it.unitCost||0), up = Number(it.unitPrice||0);
    const invVal = qty*uc, rev = qty*up;
    totalValue += invVal; totalRevenue += rev; totalStock += qty;
    const tr = document.createElement('tr');
    if(qty===0) tr.classList.add('out-of-stock-row'); else if(qty<10) tr.classList.add('low-stock-row');
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
      </td>`;
    list.appendChild(tr);
  });
  if(qs('#totalValue')) qs('#totalValue').textContent = totalValue.toFixed(2);
  if(qs('#totalRevenue')) qs('#totalRevenue').textContent = totalRevenue.toFixed(2);
  if(qs('#totalStock')) qs('#totalStock').textContent = totalStock;
}

function renderSales(rows){
  const t = qs('#salesList'); if(!t) return; t.innerHTML='';
  rows.forEach(r=>{
    const productDisplay = `${escapeHtml(r.product || '')} (${escapeHtml(r.sku||'')})`;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(r.invoice||'')}</td><td>${productDisplay}</td><td>${r.quantity}</td><td class="money">RM ${(Number(r.total)||0).toFixed(2)}</td><td>${new Date(r.date).toLocaleString()}</td>`;
    t.appendChild(tr);
  });
}

function renderOrders(rows){
  const t = qs('#ordersList'); if(!t) return; t.innerHTML='';
  rows.forEach(o=>{
    const itemsSummary = (Array.isArray(o.items) ? o.items.map(it => `${escapeHtml(it.name)} x${it.qty}`).join(', ') : '');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(o.orderNumber||'')}</td><td>${escapeHtml(o.customerName||'')}</td><td>${itemsSummary}</td><td class="money">RM ${(Number(o.total)||0).toFixed(2)}</td><td>${escapeHtml(o.status||'')}</td><td>${new Date(o.date).toLocaleString()}</td>`;
    t.appendChild(tr);
  });
}

/* =================== FETCHERS =================== */

async function fetchInventory(){ try{ const res = await apiFetch(`${API_BASE}/inventory`); if(!res.ok) throw new Error('inventory fetch'); inventory = await res.json(); renderInventory(inventory); }catch(e){ console.error(e); } }
async function fetchSales(){ try{ const res = await apiFetch(`${API_BASE}/sales`); if(!res.ok) throw new Error('sales fetch'); sales = await res.json(); renderSales(sales); }catch(e){ console.error(e); } }
async function fetchOrders(){ try{ const res = await apiFetch(`${API_BASE}/orders`); if(!res.ok) throw new Error('orders fetch'); orders = await res.json(); renderOrders(orders); }catch(e){ console.error(e); } }
async function fetchDocuments(){ try{ const res = await apiFetch(`${API_BASE}/documents`); if(!res.ok) throw new Error('documents fetch'); documents = await res.json(); }catch(e){ console.error(e); } }
async function fetchLogs(){ try{ const res = await apiFetch(`${API_BASE}/logs`); if(!res.ok) throw new Error('logs fetch'); activityLog = await res.json(); renderDashboardData(); }catch(e){ console.error(e); } }

/* Basic dashboard render reused */
function renderDashboardData(){
  // Recent activities
  const tbody = qs('#recentActivities'); if(tbody){ tbody.innerHTML=''; activityLog.slice().slice(0,5).forEach(l => { const tr=document.createElement('tr'); const timeStr = l.time ? new Date(l.time).toLocaleString() : new Date().toLocaleString(); tr.innerHTML = `<td>${escapeHtml(l.user||'')}</td><td>${escapeHtml(l.action||'')}</td><td>${escapeHtml(timeStr)}</td>`; tbody.appendChild(tr); }); }
  // Stats
  if(qs('#dash_totalItems')) {
    let totalValue=0, totalRevenue=0, totalStock=0;
    inventory.forEach(it => { const qty = Number(it.quantity||0); totalValue += qty * Number(it.unitCost||0); totalRevenue += qty * Number(it.unitPrice||0); totalStock += qty; });
    qs('#dash_totalItems').textContent = inventory.length;
    qs('#dash_totalValue').textContent = totalValue.toFixed(2);
    qs('#dash_totalRevenue').textContent = totalRevenue.toFixed(2);
    qs('#dash_totalStock').textContent = totalStock;
  }
}

/* =================== INIT =================== */

window.addEventListener('load', async ()=>{
  if(qs('#adminName')) qs('#adminName').textContent = getUsername();
  if(window.CONFIG && CONFIG.LS_THEME) { const t = localStorage.getItem(CONFIG.LS_THEME); if(t==='dark') document.body.classList.add('dark-mode'); }
  try {
    if(currentPage.includes('inventory')) { await fetchInventory(); bindInventoryUI(); }
    if(currentPage.includes('sales')) { await fetchSales(); bindSalesUI(); }
    if(currentPage.includes('orders')) { await fetchOrders(); bindOrdersUI(); }
    if(currentPage.includes('documents')) { await fetchDocuments(); bindDocumentsUI(); }
    if(currentPage.includes('log') || currentPage==='' || currentPage==='index.html') { await fetchLogs(); await fetchInventory(); }
    if(currentPage.includes('product')) bindProductPage();
    if(currentPage.includes('setting')) bindSettingPage();
  } catch(e){ console.error('init error', e); }
});

/* =================== INVENTORY CRUD =================== */

async function confirmAndAddProduct(){
  const sku = qs('#p_sku')?.value?.trim(); const name = qs('#p_name')?.value?.trim();
  const category = qs('#p_category')?.value?.trim(); const quantity = Number(qs('#p_quantity')?.value||0);
  const unitCost = Number(qs('#p_unitCost')?.value||0); const unitPrice = Number(qs('#p_unitPrice')?.value||0);
  if(!sku||!name) return alert('Enter SKU and Name');
  if(!confirm(`Add product: ${name} (${sku})?`)) return;
  try {
    const res = await apiFetch(`${API_BASE}/inventory`, { method:'POST', body: JSON.stringify({ sku,name,category,quantity,unitCost,unitPrice }) });
    if(res.ok){ await fetchInventory(); ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id=>qs(id)&& (qs(id).value='')); alert('Product added'); }
    else { const err = await res.json(); alert('Failed: '+(err.message||'')); }
  } catch(e){ console.error(e); alert('Server error adding product'); }
}

async function confirmAndDeleteItem(id){
  const it = inventory.find(x=>String(x.id)===String(id)); if(!it) return;
  if(!confirm(`Delete ${it.name}?`)) return;
  try { const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method:'DELETE' }); if(res.status===204){ await fetchInventory(); alert('Deleted'); } else { alert('Delete failed'); } } catch(e){ console.error(e); alert('Server error'); }
}

async function confirmAndGenerateReport(){
  if(!confirm('Generate inventory Excel?')) return;
  try {
    const res = await apiFetch(`${API_BASE}/inventory/report`, { method:'GET' });
    if(!res.ok){ const e = await res.json(); return alert('Failed: '+(e.message||'')); }
    const blob = await res.blob(); const cd = res.headers.get('Content-Disposition'); const fn = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : `Inventory_Report.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); await fetchDocuments(); alert('Report downloaded');
  } catch(e){ console.error(e); alert('Report error'); }
}

function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', confirmAndGenerateReport);
  qs('#searchInput')?.addEventListener('input', ()=>{ const q = (qs('#searchInput')?.value||'').toLowerCase(); renderInventory(inventory.filter(it=> (it.sku||'').toLowerCase().includes(q) || (it.name||'').toLowerCase().includes(q) || (it.category||'').toLowerCase().includes(q))); });
  qs('#clearSearchBtn')?.addEventListener('click', ()=> { if(qs('#searchInput')) { qs('#searchInput').value=''; renderInventory(inventory); } });
  // Inventory PDF
  const pdfBtn = qs('#downloadInventoryPDFBtn'); if(pdfBtn) pdfBtn.addEventListener('click', ()=> window.open(`${API_BASE}/inventory/report/pdf`, '_blank'));
}

/* =================== PRODUCT PAGE =================== */
function openEditPageForItem(id){ window.location.href = `product.html?id=${encodeURIComponent(id)}`; }
async function bindProductPage(){ 
  const params = new URLSearchParams(window.location.search); const id = params.get('id'); 
  if(id){ try{ const res = await apiFetch(`${API_BASE}/inventory`); const items = await res.json(); const it = items.find(x=>String(x.id)===String(id)); if(!it) return alert('Not found'); qs('#prod_id')&&(qs('#prod_id').value=it.id||it._id); qs('#prod_sku')&&(qs('#prod_sku').value=it.sku||''); qs('#prod_name')&&(qs('#prod_name').value=it.name||''); qs('#prod_category')&&(qs('#prod_category').value=it.category||''); qs('#prod_quantity')&&(qs('#prod_quantity').value=it.quantity||0); qs('#prod_unitCost')&&(qs('#prod_unitCost').value=it.unitCost||0); qs('#prod_unitPrice')&&(qs('#prod_unitPrice').value=it.unitPrice||0); }catch(e){ console.error(e); alert('Load failed'); } }
  qs('#saveProductBtn')?.addEventListener('click', async ()=>{ if(!confirm('Save changes?')) return; const idVal = qs('#prod_id')?.value; const body = { sku: qs('#prod_sku')?.value, name: qs('#prod_name')?.value, category: qs('#prod_category')?.value, quantity: Number(qs('#prod_quantity')?.value||0), unitCost: Number(qs('#prod_unitCost')?.value||0), unitPrice: Number(qs('#prod_unitPrice')?.value||0) }; try{ const res = await apiFetch(`${API_BASE}/inventory/${idVal}`, { method:'PUT', body: JSON.stringify(body) }); if(res.ok){ await fetchInventory(); alert('Updated'); window.location.href='inventory.html'; } else { const err = await res.json(); alert('Failed: ' + (err.message||'')); } } catch(e){ console.error(e); alert('Server error'); } });
  qs('#cancelProductBtn')?.addEventListener('click', ()=> window.location.href='inventory.html');
}

/* =================== DOCUMENTS =================== */

async function uploadDocuments(){ const files = qs('#docUpload')?.files || []; if(files.length===0){ showMsg(qs('#uploadMessage'),'Select files','red'); return; } if(!confirm(`Upload metadata for ${files.length} files?`)) return; for(const f of files){ try{ const res = await apiFetch(`${API_BASE}/documents`, { method:'POST', body: JSON.stringify({ name:f.name, sizeBytes:f.size, type: f.type }) }); if(!res.ok) throw new Error('Failed'); }catch(e){ console.error(e); showMsg(qs('#uploadMessage'),`Failed ${f.name}`); return; } } qs('#docUpload').value=''; setTimeout(()=>fetchDocuments(),800); showMsg(qs('#uploadMessage'),'Uploaded','green'); }
function downloadDocument(fnEnc){ const fn = decodeURIComponent(fnEnc); if(!confirm(`Download ${fn}?`)) return; window.open(`${API_BASE}/documents/download/${encodeURIComponent(fn)}`,'_blank'); }
async function deleteDocumentConfirm(id){ const d = documents.find(x=>String(x.id)===String(id)); if(!d) return; if(!confirm(`Delete ${d.name}?`)) return; try{ const res = await apiFetch(`${API_BASE}/documents/${id}`, { method:'DELETE' }); if(res.status===204){ await fetchDocuments(); alert('Deleted'); } else alert('Failed'); }catch(e){ console.error(e); alert('Server error'); } }
function bindDocumentsUI(){ qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments); qs('#searchDocs')?.addEventListener('input', ()=>{ const q=(qs('#searchDocs')?.value||'').toLowerCase(); renderDocuments(documents.filter(d=> (d.name||'').toLowerCase().includes(q))); }); }

/* =================== SALES UI & Modal (Searchable dropdown) =================== */

function bindSalesUI(){
  qs('#addSaleBtn')?.addEventListener('click', openSaleModal);
  qs('#downloadSalesXLSXBtnInline')?.addEventListener('click', downloadSalesReportXLSX);
  qs('#downloadSalesPDFBtn')?.addEventListener('click', ()=> window.open(`${API_BASE}/sales/report/pdf`, '_blank'));
}

function openSaleModal(){
  // Build modal if missing
  if(!qs('#saleModal')){
    const modal = document.createElement('div'); modal.id='saleModal'; modal.className='modal';
    modal.innerHTML = `
      <div class="modal-inner">
        <h3>Add New Sale</h3>
        <div style="display:grid;gap:8px;">
          <label>Product (search by name or SKU)</label>
          <div class="search-dropdown" id="sale_product_dropdown">
            <input id="sale_product_search" class="search-dropdown-input" placeholder="Type product name or SKU..." />
            <div class="search-dropdown-list" id="sale_product_list"></div>
          </div>
          <label>Invoice (optional)</label><input id="sale_invoice" />
          <div style="display:flex;gap:8px;">
            <div style="flex:1"><label>Quantity</label><input id="sale_quantity" type="number" value="1" min="1" /></div>
            <div style="flex:1"><label>Unit Price (editable)</label><input id="sale_unitPrice" type="number" step="0.01" /></div>
            <div style="flex:1"><label>Total</label><input id="sale_total" type="number" step="0.01" readonly /></div>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
            <button id="saveSaleBtn" class="primary-btn">Save</button>
            <button id="saleModalClose" class="secondary-btn">Close</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    // bind events
    const searchInput = qs('#sale_product_search');
    setupSearchableDropdown(searchInput, qs('#sale_product_list'), inventory, onSaleProductSelected);
    qs('#sale_quantity')?.addEventListener('input', updateSaleTotalFromModal);
    qs('#sale_unitPrice')?.addEventListener('input', updateSaleTotalFromModal);
    qs('#saveSaleBtn')?.addEventListener('click', addSale);
    qs('#saleModalClose')?.addEventListener('click', closeSaleModal);
  }
  // reset fields
  qs('#sale_product_search').value=''; qs('#sale_invoice').value=''; qs('#sale_quantity').value='1'; qs('#sale_unitPrice').value='0'; qs('#sale_total').value='0.00';
  qs('#sale_product_list').style.display='none';
  qs('#saleModal').style.display='block';
}

function closeSaleModal(){ const m = qs('#saleModal'); if(m) m.style.display='none'; }

function onSaleProductSelected(prod){
  // prod is the inventory object
  if(!prod) return;
  qs('#sale_product_search').value = `${prod.name} (${prod.sku})`;
  qs('#sale_unitPrice').value = Number(prod.unitPrice||0).toFixed(2);
  qs('#sale_product_search').dataset.selectedSku = prod.sku || '';
  qs('#sale_product_search').dataset.selectedId = prod.id || prod._id || '';
  updateSaleTotalFromModal();
  qs('#sale_product_list').style.display='none';
}

function updateSaleTotalFromModal(){
  const qty = Number(qs('#sale_quantity')?.value || 0);
  const up = Number(qs('#sale_unitPrice')?.value || 0);
  qs('#sale_total').value = (qty * up).toFixed(2);
}

async function addSale(){
  const invoice = qs('#sale_invoice')?.value?.trim();
  const selectedSku = qs('#sale_product_search')?.dataset?.selectedSku || '';
  const productName = qs('#sale_product_search')?.value || '';
  const qty = Number(qs('#sale_quantity')?.value || 0);
  const unitPrice = Number(qs('#sale_unitPrice')?.value || 0);
  const total = Number(qs('#sale_total')?.value || 0);
  if(!selectedSku || !productName || qty <= 0) return alert('Choose product and quantity');
  try{
    const res = await apiFetch(`${API_BASE}/sales`, { method:'POST', body: JSON.stringify({ invoice, product: productName, sku: selectedSku, quantity: qty, total }) });
    if(res.ok){ await fetchSales(); closeSaleModal(); alert('Sale recorded'); }
    else { const err = await res.json(); alert('Failed: ' + (err.message||'')); }
  }catch(e){ console.error(e); alert('Server error recording sale'); }
}

async function downloadSalesReportXLSX(){
  try{
    const res = await apiFetch(`${API_BASE}/sales/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob(); const cd = res.headers.get('Content-Disposition'); const fn = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : 'Sales_Report.xlsx';
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); await fetchSales();
  }catch(e){ console.error(e); alert('Error downloading sales report'); }
}

/* =================== ORDERS UI & Modal (Searchable + autofill price/sku) =================== */

function bindOrdersUI(){
  qs('#addOrderBtn')?.addEventListener('click', openOrderModal);
  qs('#downloadOrdersXLSXBtnInline')?.addEventListener('click', downloadOrdersReportXLSX);
  qs('#downloadOrdersPDFBtn')?.addEventListener('click', ()=> window.open(`${API_BASE}/orders/report/pdf`, '_blank'));
}

function openOrderModal(){
  if(!qs('#orderModal')){
    const modal = document.createElement('div'); modal.id='orderModal'; modal.className='modal';
    modal.innerHTML = `
      <div class="modal-inner">
        <h3>Create New Order</h3>
        <div style="display:grid;gap:8px;">
          <label>Customer Name</label><input id="order_customer" />
          <div id="order_items_container"></div>
          <div style="display:flex;gap:8px;">
            <button id="addOrderItemBtn" class="secondary-btn">+ Add Item</button>
            <div style="flex:1"></div>
            <label style="align-self:center;">Total: RM <span id="order_total_display">0.00</span></label>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button id="saveOrderBtn" class="primary-btn">Save Order</button>
            <button id="orderModalClose" class="secondary-btn">Close</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    qs('#addOrderItemBtn')?.addEventListener('click', addOrderItemRow);
    qs('#saveOrderBtn')?.addEventListener('click', saveOrderFromModal);
    qs('#orderModalClose')?.addEventListener('click', closeOrderModal);
    // add first row
    addOrderItemRow();
  } else {
    // reset
    qs('#order_customer').value=''; const container = qs('#order_items_container'); container.innerHTML=''; addOrderItemRow();
    qs('#order_total_display').textContent='0.00';
  }
  qs('#orderModal').style.display='block';
}

function closeOrderModal(){ const m=qs('#orderModal'); if(m) m.style.display='none'; }

function addOrderItemRow(){
  const container = qs('#order_items_container');
  const row = document.createElement('div'); row.className='order-item-row'; row.style='display:flex;gap:8px;margin-top:8px;align-items:center;';
  row.innerHTML = `
    <div style="flex:2;">
      <div class="search-dropdown">
        <input class="order_product_search search-dropdown-input" placeholder="Search product name or SKU..." />
        <div class="search-dropdown-list"></div>
      </div>
    </div>
    <div style="flex:1"><input class="order_qty" type="number" min="1" value="1" /></div>
    <div style="flex:1"><input class="order_price" type="number" step="0.01" value="0.00" /></div>
    <div style="width:40px"><button class="danger-btn removeItemBtn">✖</button></div>
  `;
  container.appendChild(row);
  const searchInput = row.querySelector('.order_product_search');
  const listBox = row.querySelector('.search-dropdown-list');
  setupSearchableDropdown(searchInput, listBox, inventory, (prod)=>{
    // fill row values from selected product
    if(!prod) return;
    searchInput.value = `${prod.name} (${prod.sku})`;
    searchInput.dataset.selectedSku = prod.sku || '';
    searchInput.dataset.selectedId = prod.id || prod._id || '';
    const priceInput = row.querySelector('.order_price');
    priceInput.value = Number(prod.unitPrice || 0).toFixed(2);
    // qty max enforcement can be added; here we simply show available qty in placeholder
    const qtyInput = row.querySelector('.order_qty'); qtyInput.max = prod.quantity || 0;
    updateOrderTotalFromModal();
  });
  row.querySelector('.order_qty').addEventListener('input', updateOrderTotalFromModal);
  row.querySelector('.order_price').addEventListener('input', updateOrderTotalFromModal);
  row.querySelector('.removeItemBtn').addEventListener('click', ()=>{ row.remove(); updateOrderTotalFromModal(); });
}

function updateOrderTotalFromModal(){
  const rows = qsa('#order_items_container .order-item-row');
  let total = 0;
  rows.forEach(r=>{
    const qty = Number(r.querySelector('.order_qty')?.value || 0);
    const price = Number(r.querySelector('.order_price')?.value || 0);
    total += qty * price;
  });
  qs('#order_total_display').textContent = total.toFixed(2);
}

async function saveOrderFromModal(){
  const customer = qs('#order_customer')?.value?.trim();
  if(!customer) return alert('Enter customer name');
  const rows = qsa('#order_items_container .order-item-row');
  if(rows.length === 0) return alert('Add at least one item');
  const items = rows.map(r => ({
    sku: r.querySelector('.order_product_search')?.dataset.selectedSku || '',
    name: r.querySelector('.order_product_search')?.value || '',
    qty: Number(r.querySelector('.order_qty')?.value || 0),
    price: Number(r.querySelector('.order_price')?.value || 0)
  })).filter(it => it.name && it.qty > 0);
  if(items.length === 0) return alert('Add at least one valid item');
  const total = items.reduce((s,i)=> s + (i.qty * i.price), 0);
  try{
    const res = await apiFetch(`${API_BASE}/orders`, { method:'POST', body: JSON.stringify({ customerName: customer, items, total }) });
    if(res.ok){ await fetchOrders(); closeOrderModal(); alert('Order saved'); }
    else { const err = await res.json(); alert('Failed: ' + (err.message||'')); }
  }catch(e){ console.error(e); alert('Server error saving order'); }
}

async function downloadOrdersReportXLSX(){
  try {
    const res = await apiFetch(`${API_BASE}/orders/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob(); const cd = res.headers.get('Content-Disposition'); const fn = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : 'Orders_Report.xlsx';
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); await fetchOrders();
  } catch(e){ console.error(e); alert('Error downloading orders report'); }
}

/* =================== ZIP ALL REPORTS helper =================== */

async function downloadAllReportsZip(){
  try{
    const res = await apiFetch(`${API_BASE}/reports/zip`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `All_Reports_${new Date().toISOString().slice(0,10)}.zip`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }catch(e){ console.error(e); alert('Error downloading zip'); }
}

/* =================== Searchable Dropdown utility =================== */
/*
  - inputEl: text input element
  - listEl: container element for results (div)
  - dataSource: inventory array (objects with at least name, sku, id, unitPrice, quantity)
  - onSelect: function(productObj)
  Behavior: shows items where name or sku includes typed query; displays "Name (SKU)"
*/
function setupSearchableDropdown(inputEl, listEl, dataSource, onSelect){
  if(!inputEl || !listEl) return;
  inputEl.addEventListener('input', ()=>{
    const q = (inputEl.value || '').toLowerCase().trim();
    if(!q){ listEl.style.display='none'; listEl.innerHTML=''; return; }
    const results = dataSource.filter(it => ((it.name||'').toLowerCase().includes(q) || (it.sku||'').toLowerCase().includes(q)));
    if(results.length===0){ listEl.innerHTML = `<div class="search-dropdown-item">No results</div>`; listEl.style.display='block'; return; }
    listEl.innerHTML = '';
    results.slice(0,80).forEach(it=>{
      const div = document.createElement('div'); div.className='search-dropdown-item';
      div.textContent = `${it.name} (${it.sku || ''})`;
      div.addEventListener('click', ()=> { onSelect(it); listEl.style.display='none'; });
      listEl.appendChild(div);
    });
    listEl.style.display='block';
  });
  // hide list on outside click
  document.addEventListener('click', (ev)=>{
    if(!inputEl.contains(ev.target) && !listEl.contains(ev.target)) { listEl.style.display='none'; }
  });
}

/* =================== Settings & Simple bindings =================== */
function bindSettingPage(){
  const currentUsername = getUsername();
  if(qs('#currentUser')) qs('#currentUser').textContent = currentUsername;
  qs('#changePasswordBtn')?.addEventListener('click', async ()=>{
    const newPass = qs('#newPassword')?.value; const conf = qs('#confirmPassword')?.value; const code = qs('#securityCode')?.value; const msgEl = qs('#passwordMessage');
    showMsg(msgEl,'');
    if(!newPass || !conf || !code) return showMsg(msgEl,'Fill all fields','red');
    if(newPass !== conf) return showMsg(msgEl,'Passwords do not match','red');
    if(!confirm('Change password?')) return;
    try{
      const res = await apiFetch(`${API_BASE}/account/password`, { method:'PUT', body: JSON.stringify({ username: currentUsername, newPassword: newPass, securityCode: code }) });
      const data = await res.json();
      if(res.ok){ showMsg(msgEl,'Password updated. Logging out...','green'); setTimeout(()=> logout(), 1200); } else showMsg(msgEl,`Failed: ${data.message||''}`,'red');
    }catch(e){ showMsg(msgEl,'Server error','red'); }
  });
  qs('#deleteAccountBtn')?.addEventListener('click', async ()=>{
    if(!confirm('Delete account?')) return; const code = prompt('Enter admin security code'); if(!code) return alert('Cancelled');
    try{ const res = await apiFetch(`${API_BASE}/account`, { method:'DELETE', body: JSON.stringify({ username: currentUsername, securityCode: code })}); const data = await res.json(); if(res.ok){ alert('Account deleted'); logout(); } else alert('Failed: '+(data.message||'')); } catch(e){ alert('Server error'); }
  });
}

/* =================== Login/Register UI =================== */

async function login(){
  const user = qs('#username')?.value?.trim(); const pass = qs('#password')?.value?.trim(); const msg = qs('#loginMessage'); showMsg(msg,'');
  if(!user||!pass) return showMsg(msg,'Enter username and password','red');
  try{
    const res = await apiFetch(`${API_BASE}/login`, { method:'POST', body: JSON.stringify({ username: user, password: pass })});
    const data = await res.json();
    if(res.ok){ sessionStorage.setItem('isLoggedIn','true'); sessionStorage.setItem('adminName', user); showMsg(msg,'Login successful','green'); setTimeout(()=> window.location.href='index.html', 600); }
    else showMsg(msg, `Login failed: ${data.message||''}`,'red');
  }catch(e){ showMsg(msg,'Server error','red'); console.error(e); }
}

async function register(){
  const user = qs('#newUsername')?.value?.trim(); const pass = qs('#newPassword')?.value?.trim(); const code = qs('#securityCode')?.value?.trim(); const msg = qs('#registerMessage'); showMsg(msg,'');
  if(!user||!pass||!code) return showMsg(msg,'Fill all fields','red');
  try{
    const res = await apiFetch(`${API_BASE}/register`, { method:'POST', body: JSON.stringify({ username: user, password: pass, securityCode: code })});
    const data = await res.json();
    if(res.ok){ showMsg(msg,'Registered! You may login.','green'); setTimeout(()=> toggleForm(), 900); } else showMsg(msg, `Failed: ${data.message||''}`,'red');
  }catch(e){ showMsg(msg,'Server error','red'); }
}

function toggleForm(){
  const loginForm = qs('#loginForm'), regForm = qs('#registerForm'), formTitle = qs('#formTitle');
  if(!loginForm||!regForm||!formTitle) return;
  if(getComputedStyle(loginForm).display === 'none'){ loginForm.style.display='block'; regForm.style.display='none'; formTitle.textContent='🔐 Admin Login'; }
  else { loginForm.style.display='none'; regForm.style.display='block'; formTitle.textContent='🧾 Register Account'; }
}

/* =================== Expose functions used inline =================== */
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.downloadSalesReportXLSX = downloadSalesReportXLSX;
window.downloadOrdersReportXLSX = downloadOrdersReportXLSX;
window.downloadAllReportsZip = downloadAllReportsZip;
window.login = login;
window.register = register;
window.toggleForm = toggleForm;
