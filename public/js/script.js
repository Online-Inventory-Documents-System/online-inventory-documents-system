// public/js/script.js
// Full client-side script with Sales & Orders support (advanced multi-item orders)

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

let inventory = [], sales = [], orders = [], activityLog = [], documents = [];
const currentPage = window.location.pathname.split('/').pop();

async function apiFetch(url, options={}) {
  const user = getUsername();
  options.headers = { 'Content-Type': 'application/json', 'X-Username': user, ...options.headers };
  return fetch(url, options);
}

/* --- Auth redirect --- */
if(!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')) {
  try { window.location.href = 'login.html'; } catch(e) {}
}

function logout(){ sessionStorage.removeItem('isLoggedIn'); sessionStorage.removeItem('adminName'); window.location.href='login.html'; }
function toggleTheme(){ document.body.classList.toggle('dark-mode'); }

/* ===================== RENDERERS ===================== */

function renderInventory(items){
  const listEl = qs('#inventoryList'); if(!listEl) return;
  listEl.innerHTML = '';
  let totalValue = 0, totalRevenue = 0, totalStock = 0;
  items.forEach(it=>{
    const id = it.id || it._id;
    const qty = Number(it.quantity||0);
    const uc = Number(it.unitCost||0);
    const up = Number(it.unitPrice||0);
    const invVal = qty * uc, rev = qty * up;
    totalValue += invVal; totalRevenue += rev; totalStock += qty;
    const tr = document.createElement('tr');
    if(qty===0) tr.classList.add('out-of-stock-row');
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
    listEl.appendChild(tr);
  });
  if(qs('#totalValue')) qs('#totalValue').textContent = totalValue.toFixed(2);
  if(qs('#totalRevenue')) qs('#totalRevenue').textContent = totalRevenue.toFixed(2);
  if(qs('#totalStock')) qs('#totalStock').textContent = totalStock;
}

function renderSales(rows){
  const t = qs('#salesList'); if(!t) return;
  t.innerHTML = '';
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(r.invoice)}</td><td>${escapeHtml(r.product)}</td><td>${r.quantity}</td><td class="money">RM ${(Number(r.total)||0).toFixed(2)}</td><td>${new Date(r.date).toLocaleString()}</td>`;
    t.appendChild(tr);
  });
}

function renderOrders(rows){
  const t = qs('#ordersList'); if(!t) return;
  t.innerHTML = '';
  rows.forEach(o=>{
    const itemsSummary = (Array.isArray(o.items)? o.items.map(i=>`${i.name} x${i.qty}`).join(', '):'');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(o.orderNumber)}</td><td>${escapeHtml(o.customerName)}</td><td>${escapeHtml(itemsSummary)}</td><td class="money">RM ${(Number(o.total)||0).toFixed(2)}</td><td>${escapeHtml(o.status)}</td><td>${new Date(o.date).toLocaleString()}</td>`;
    t.appendChild(tr);
  });
}

/* ===================== FETCHERS ===================== */

async function fetchInventory(){ try{ const res = await apiFetch(`${API_BASE}/inventory`); if(!res.ok) throw new Error(); inventory = await res.json(); renderInventory(inventory); }catch(e){console.error(e);} }
async function fetchSales(){ try{ const res = await apiFetch(`${API_BASE}/sales`); if(!res.ok) throw new Error(); sales = await res.json(); renderSales(sales); }catch(e){console.error(e);} }
async function fetchOrders(){ try{ const res = await apiFetch(`${API_BASE}/orders`); if(!res.ok) throw new Error(); orders = await res.json(); renderOrders(orders); }catch(e){console.error(e);} }
async function fetchDocuments(){ try{ const res = await apiFetch(`${API_BASE}/documents`); if(!res.ok) throw new Error(); documents = await res.json(); }catch(e){console.error(e);} }
async function fetchLogs(){ try{ const res = await apiFetch(`${API_BASE}/logs`); if(!res.ok) throw new Error(); activityLog = await res.json(); renderDashboardData(); }catch(e){console.error(e);} }

/* ===================== INIT/BINDINGS ===================== */

window.addEventListener('load', async ()=>{
  if(qs('#adminName')) qs('#adminName').textContent = getUsername();
  try{
    if(currentPage.includes('inventory')) { await fetchInventory(); bindInventoryUI(); }
    if(currentPage.includes('sales')) { await fetchSales(); bindSalesUI(); }
    if(currentPage.includes('orders')) { await fetchOrders(); bindOrdersUI(); }
    if(currentPage.includes('documents')) { await fetchDocuments(); bindDocumentsUI(); }
    if(currentPage.includes('log') || currentPage==='' || currentPage==='index.html') { await fetchLogs(); await fetchInventory(); }
    if(currentPage.includes('product')) bindProductPage();
    if(currentPage.includes('setting')) bindSettingPage();
  }catch(e){ console.error('init error', e); }
});

/* ===================== Inventory CRUD (unchanged) ===================== */

async function confirmAndAddProduct(){ 
  const sku = qs('#p_sku')?.value?.trim(); const name = qs('#p_name')?.value?.trim();
  if(!sku||!name) return alert('Enter SKU & name');
  const category = qs('#p_category')?.value?.trim(); const quantity = Number(qs('#p_quantity')?.value||0);
  const unitCost = Number(qs('#p_unitCost')?.value||0); const unitPrice = Number(qs('#p_unitPrice')?.value||0);
  if(!confirm(`Add ${name}?`)) return;
  try{ const res = await apiFetch(`${API_BASE}/inventory`, { method:'POST', body: JSON.stringify({ sku,name,category,quantity,unitCost,unitPrice }) }); if(res.ok){ ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id=>qs(id)&& (qs(id).value='')); await fetchInventory(); alert('Added'); }else alert('Add failed'); }catch(e){console.error(e); alert('Server error');}
}

async function confirmAndDeleteItem(id){ const it = inventory.find(x=>String(x.id)===String(id)); if(!it) return; if(!confirm(`Delete ${it.name}?`)) return; try{ const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method:'DELETE' }); if(res.status===204){ await fetchInventory(); alert('Deleted'); } else alert('Delete failed'); }catch(e){console.error(e); alert('Server error');} }

async function confirmAndGenerateReport(){
  if(!confirm('Generate inventory Excel?')) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert(`Failed: ${err.message}`); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition'); const fn = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : `Inventory_Report_${Date.now()}.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); await fetchDocuments(); alert('Report downloaded.');
  }catch(e){console.error(e); alert('Error');}
}

function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', confirmAndGenerateReport);
  qs('#searchInput')?.addEventListener('input', ()=>{ const q = (qs('#searchInput')?.value||'').toLowerCase(); renderInventory(inventory.filter(it=> (it.sku||'').toLowerCase().includes(q) || (it.name||'').toLowerCase().includes(q) || (it.category||'').toLowerCase().includes(q))); });
  qs('#clearSearchBtn')?.addEventListener('click', ()=> { if(qs('#searchInput')) { qs('#searchInput').value=''; renderInventory(inventory); } });
}

/* ===================== Product page bindings ===================== */
function openEditPageForItem(id){ window.location.href = `product.html?id=${encodeURIComponent(id)}`; }
async function bindProductPage(){ /* uses existing inventory endpoint to fetch item then bind save */ 
  const params = new URLSearchParams(window.location.search); const id = params.get('id'); if(id){ try{ const res = await apiFetch(`${API_BASE}/inventory`); const items = await res.json(); const it = items.find(x=>String(x.id)===String(id)); if(!it) return alert('Not found'); qs('#prod_id')&&(qs('#prod_id').value=it.id||it._id); qs('#prod_sku')&&(qs('#prod_sku').value=it.sku||''); qs('#prod_name')&&(qs('#prod_name').value=it.name||''); qs('#prod_category')&&(qs('#prod_category').value=it.category||''); qs('#prod_quantity')&&(qs('#prod_quantity').value=it.quantity||0); qs('#prod_unitCost')&&(qs('#prod_unitCost').value=it.unitCost||0); qs('#prod_unitPrice')&&(qs('#prod_unitPrice').value=it.unitPrice||0); }catch(e){console.error(e); alert('Load failed'); } }
  qs('#saveProductBtn')?.addEventListener('click', async ()=>{ if(!confirm('Save changes?')) return; const idVal = qs('#prod_id')?.value; const body = { sku: qs('#prod_sku')?.value, name: qs('#prod_name')?.value, category: qs('#prod_category')?.value, quantity: Number(qs('#prod_quantity')?.value||0), unitCost: Number(qs('#prod_unitCost')?.value||0), unitPrice: Number(qs('#prod_unitPrice')?.value||0) }; try{ const res = await apiFetch(`${API_BASE}/inventory/${idVal}`, { method:'PUT', body: JSON.stringify(body) }); if(res.ok){ alert('Updated'); window.location.href='inventory.html'; } else { const err = await res.json(); alert('Failed: ' + (err.message||'')); } }catch(e){console.error(e); alert('Server error'); } });
  qs('#cancelProductBtn')?.addEventListener('click', ()=> window.location.href='inventory.html');
}

/* ===================== Documents ===================== */
async function uploadDocuments(){ const files = qs('#docUpload')?.files || []; if(files.length===0) return showMsg(qs('#uploadMessage'),'Select files','red'); if(!confirm(`Upload metadata for ${files.length} files?`)) return; for(const f of files){ try{ const res = await apiFetch(`${API_BASE}/documents`, { method:'POST', body: JSON.stringify({ name:f.name, sizeBytes: f.size, type: f.type }) }); if(!res.ok) throw new Error('Failed'); }catch(e){ console.error(e); showMsg(qs('#uploadMessage'),`Failed ${f.name}`); return; } } qs('#docUpload').value=''; setTimeout(()=>fetchDocuments(),800); showMsg(qs('#uploadMessage'),'Uploaded','green'); }
function downloadDocument(fnEnc){ const fn = decodeURIComponent(fnEnc); if(!confirm(`Download ${fn}?`)) return; window.open(`${API_BASE}/documents/download/${encodeURIComponent(fn)}`,'_blank'); }
async function deleteDocumentConfirm(id){ const d = documents.find(x=>String(x.id)===String(id)); if(!d) return; if(!confirm(`Delete ${d.name}?`)) return; try{ const res = await apiFetch(`${API_BASE}/documents/${id}`, { method:'DELETE' }); if(res.status===204){ await fetchDocuments(); alert('Deleted'); } else alert('Failed'); }catch(e){console.error(e); alert('Server error');} }
function bindDocumentsUI(){ qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments); qs('#searchDocs')?.addEventListener('input', ()=>{ const q=(qs('#searchDocs')?.value||'').toLowerCase(); renderDocuments(documents.filter(d=> (d.name||'').toLowerCase().includes(q))); }); }

/* ===================== Sales UI ===================== */

function bindSalesUI(){
  // Add Sale modal controls
  qs('#downloadSalesXLSXBtnInline')?.addEventListener('click', downloadSalesReportXLSX);
  qs('#downloadSalesPDFBtn')?.addEventListener('click', ()=> window.open(`${API_BASE}/sales/report/pdf`, '_blank'));
  // Add Sale button
  qs('#addSaleBtn')?.addEventListener('click', ()=> openSaleModal());
  // Modal Save
  qs('#saveSaleBtn')?.addEventListener('click', addSale);
  // Close modal
  qs('#saleModalClose')?.addEventListener('click', ()=> closeSaleModal());
}

function openSaleModal(){
  // build modal HTML if missing
  if(!qs('#saleModal')){
    const modal = document.createElement('div');
    modal.id='saleModal';
    modal.className='modal';
    modal.innerHTML = `
      <div class="modal-inner" style="background:white;padding:20px;border-radius:8px;max-width:520px;margin:60px auto;">
        <h3>Add New Sale</h3>
        <label>Invoice (optional)</label><input id="sale_invoice" />
        <label>Product</label><input id="sale_product" />
        <label>Quantity</label><input id="sale_quantity" type="number" value="1" min="1" />
        <label>Total (RM)</label><input id="sale_total" type="number" step="0.01" />
        <div style="margin-top:12px;display:flex;gap:8px;">
          <button id="saveSaleBtn" class="primary-btn">Save</button>
          <button id="saleModalClose" class="secondary-btn">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    // rebind handlers
    qs('#saveSaleBtn')?.addEventListener('click', addSale);
    qs('#saleModalClose')?.addEventListener('click', closeSaleModal);
  }
  qs('#saleModal').style.display='block';
}

function closeSaleModal(){ if(qs('#saleModal')) qs('#saleModal').style.display='none'; }

async function addSale(){
  const invoice = qs('#sale_invoice')?.value?.trim();
  const product = qs('#sale_product')?.value?.trim();
  const qty = Number(qs('#sale_quantity')?.value || 0);
  const total = Number(qs('#sale_total')?.value || 0);
  if(!product || qty<=0) return alert('Fill product and qty');
  try{
    const res = await apiFetch(`${API_BASE}/sales`, { method:'POST', body: JSON.stringify({ invoice, product, quantity: qty, total }) });
    if(res.ok){ await fetchSales(); closeSaleModal(); alert('Sale recorded'); }
    else { const err = await res.json(); alert('Failed: ' + (err.message||'')); }
  }catch(e){ console.error(e); alert('Server error'); }
}

/* Download Sales XLSX */
async function downloadSalesReportXLSX(){
  try{
    const res = await apiFetch(`${API_BASE}/sales/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition'); const fn = cd && cd.match(/filename="(.+?)"/)? cd.match(/filename="(.+?)"/)[1] : `Sales_Report.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); await fetchSales();
  }catch(e){ console.error(e); alert('Error'); }
}

/* ===================== Orders UI (Advanced multi-item) ===================== */

function bindOrdersUI(){
  qs('#downloadOrdersXLSXBtnInline')?.addEventListener('click', downloadOrdersReportXLSX);
  qs('#downloadOrdersPDFBtn')?.addEventListener('click', ()=> window.open(`${API_BASE}/orders/report/pdf`, '_blank'));
  qs('#addOrderBtn')?.addEventListener('click', ()=> openOrderModal());
  qs('#orderModalClose')?.addEventListener('click', ()=> closeOrderModal());
}

function openOrderModal(){
  if(!qs('#orderModal')){
    const modal = document.createElement('div');
    modal.id='orderModal';
    modal.className='modal';
    modal.innerHTML = `
      <div class="modal-inner" style="background:white;padding:20px;border-radius:8px;max-width:720px;margin:60px auto;">
        <h3>Create New Order</h3>
        <label>Customer Name</label><input id="order_customer" />
        <div id="order_items_container" style="margin-top:12px;"></div>
        <button id="addOrderItemBtn" class="secondary-btn" style="margin-top:8px;">+ Add Item</button>
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center;">
          <label style="margin:0;">Total: RM <span id="order_total_display">0.00</span></label>
          <div style="flex:1"></div>
          <button id="saveOrderBtn" class="primary-btn">Save Order</button>
          <button id="orderModalClose" class="secondary-btn">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // add first item row by default
    addOrderItemRow();
    qs('#addOrderItemBtn')?.addEventListener('click', addOrderItemRow);
    qs('#saveOrderBtn')?.addEventListener('click', saveOrderFromModal);
    qs('#orderModalClose')?.addEventListener('click', closeOrderModal);
  } else {
    // reset fields
    qs('#order_customer').value = '';
    const container = qs('#order_items_container'); container.innerHTML = ''; addOrderItemRow();
    qs('#order_total_display').textContent = '0.00';
  }
  qs('#orderModal').style.display = 'block';
}

function closeOrderModal(){ if(qs('#orderModal')) qs('#orderModal').style.display = 'none'; }

function addOrderItemRow(){
  const container = qs('#order_items_container');
  const idx = container.children.length;
  const row = document.createElement('div');
  row.className = 'order-item-row';
  row.style = 'display:flex;gap:8px;margin-top:8px;';
  row.innerHTML = `
    <input placeholder="SKU" class="order_sku" style="flex:1" />
    <input placeholder="Name" class="order_name" style="flex:2" />
    <input placeholder="Qty" class="order_qty" type="number" min="1" value="1" style="width:80px" />
    <input placeholder="Price" class="order_price" type="number" step="0.01" value="0.00" style="width:100px" />
    <button class="danger-btn removeItemBtn">Remove</button>
  `;
  container.appendChild(row);

  row.querySelector('.order_qty').addEventListener('input', updateOrderTotalFromModal);
  row.querySelector('.order_price').addEventListener('input', updateOrderTotalFromModal);
  row.querySelector('.removeItemBtn').addEventListener('click', ()=>{
    row.remove(); updateOrderTotalFromModal();
  });
  updateOrderTotalFromModal();
}

function updateOrderTotalFromModal(){
  const rows = qsa('#order_items_container .order-item-row');
  let total = 0;
  rows.forEach(r=>{
    const q = Number(r.querySelector('.order_qty')?.value || 0);
    const p = Number(r.querySelector('.order_price')?.value || 0);
    total += q * p;
  });
  qs('#order_total_display').textContent = total.toFixed(2);
}

async function saveOrderFromModal(){
  const customer = qs('#order_customer')?.value?.trim();
  const rows = qsa('#order_items_container .order-item-row');
  if(!customer) return alert('Enter customer name');
  if(rows.length === 0) return alert('Add at least one item');
  const items = rows.map(r => ({ sku: r.querySelector('.order_sku')?.value?.trim(), name: r.querySelector('.order_name')?.value?.trim(), qty: Number(r.querySelector('.order_qty')?.value||0), price: Number(r.querySelector('.order_price')?.value||0) }));
  // compute total
  const total = items.reduce((s,i)=> s + (Number(i.qty||0) * Number(i.price||0)), 0);
  try{
    const res = await apiFetch(`${API_BASE}/orders`, { method:'POST', body: JSON.stringify({ customerName: customer, items, total }) });
    if(res.ok){ await fetchOrders(); closeOrderModal(); alert('Order saved'); }
    else { const err = await res.json(); alert('Failed: ' + (err.message || '')); }
  }catch(e){ console.error(e); alert('Server error'); }
}

async function downloadOrdersReportXLSX(){
  try{
    const res = await apiFetch(`${API_BASE}/orders/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert(`Failed: ${err.message}`); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition'); const fn = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : `Orders_Report.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); await fetchOrders();
  }catch(e){ console.error(e); alert('Error'); }
}

/* ===================== ZIP download for dashboard if present ===================== */
async function downloadAllReportsZip(){
  try{
    const res = await apiFetch(`${API_BASE}/reports/zip`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert(`Failed: ${err.message}`); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `All_Reports_${new Date().toISOString().slice(0,10)}.zip`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }catch(e){ console.error(e); alert('Error'); }
}

/* ===================== Settings, Logs (bindings) - re-used existing functions ================ */

function bindSettingPage(){ /* minimal binding reused elsewhere */ }
function bindProductPage(){ /* implemented above */ }
function bindDocumentsUI(){ /* already defined above */ }

/* Expose some functions used by inline onclicks */
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.downloadSalesReportXLSX = downloadSalesReportXLSX;
window.downloadOrdersReportXLSX = downloadOrdersReportXLSX;
window.downloadAllReportsZip = downloadAllReportsZip;
window.addOrderItemRow = addOrderItemRow;
