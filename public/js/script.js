// public/js/script.js
// Online Inventory & Documents System - Updated & Modernized Script
// Update API_BASE if using a custom domain

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

// --- Utility functions ---
const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const moneyFormat = (n) => `RM ${Number(n||0).toFixed(2)}`;
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';
let inventory = [], activityLog = [], documents = [];
const currentPage = window.location.pathname.split('/').pop();

// --- Fetch wrapper ---
async function apiFetch(url, options = {}) {
  const opts = { ...options };
  opts.headers = { ...(options.headers || {}), 'X-Username': getUsername() };

  // Only set Content-Type for JSON bodies
  if (opts.body && typeof opts.body === 'string') opts.headers['Content-Type'] ||= 'application/json';
  return fetch(url, opts);
}

// --- Auth redirect ---
if(!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')) {
  window.location.href = 'login.html';
}

function logout() {
  sessionStorage.removeItem('isLoggedIn');
  sessionStorage.removeItem('adminName');
  if(window.CONFIG?.LS_THEME) localStorage.removeItem(CONFIG.LS_THEME);
  window.location.href = 'login.html';
}

function toggleTheme() {
  document.body.classList.toggle('dark-mode');
  if(window.CONFIG?.LS_THEME) {
    localStorage.setItem(CONFIG.LS_THEME, document.body.classList.contains('dark-mode') ? 'dark' : 'light');
  }
}

// --- Inventory rendering ---
function renderInventory(items) {
  const list = qs('#inventoryList');
  if(!list) return;
  list.innerHTML = '';
  let totalValue=0, totalRevenue=0, totalStock=0;

  items.forEach(it => {
    const id = it.id || it._id;
    const qty = Number(it.quantity || 0);
    const uc = Number(it.unitCost || 0);
    const up = Number(it.unitPrice || 0);
    const invVal = qty*uc, rev=qty*up;
    totalValue += invVal;
    totalRevenue += rev;
    totalStock += qty;

    const tr = document.createElement('tr');
    if(qty===0) tr.classList.add('out-of-stock-row');
    else if(qty<10) tr.classList.add('low-stock-row');

    tr.innerHTML = `
      <td>${escapeHtml(it.sku||'')}</td>
      <td>${escapeHtml(it.name||'')}</td>
      <td>${escapeHtml(it.category||'')}</td>
      <td>${qty}</td>
      <td class="money">${moneyFormat(uc)}</td>
      <td class="money">${moneyFormat(up)}</td>
      <td class="money">${moneyFormat(invVal)}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditPageForItem('${id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="confirmAndDeleteItem('${id}')">🗑️ Delete</button>
      </td>`;
    list.appendChild(tr);
  });

  qs('#totalValue')?.textContent = totalValue.toFixed(2);
  qs('#totalRevenue')?.textContent = totalRevenue.toFixed(2);
  qs('#totalStock')?.textContent = totalStock;
}

// --- Documents rendering ---
function renderDocuments(docs) {
  const list = qs('#docList');
  if(!list) return;
  list.innerHTML = '';

  docs.forEach(d => {
    const id = d.id || d._id;
    const sizeMB = ((d.sizeBytes||d.size||0)/(1024*1024)).toFixed(2);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(d.name||'')}</td>
      <td>${sizeMB} MB</td>
      <td>${new Date(d.date).toLocaleString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="downloadDocument('${id}', '${escapeHtml(d.name||'')}')">⬇️ Download</button>
        <button class="danger-btn small-btn" onclick="deleteDocumentConfirm('${id}')">🗑️ Delete</button>
      </td>`;
    list.appendChild(tr);
  });
}

// --- Activity logs rendering ---
function renderLogs() {
  const list = qs('#logList');
  if(!list) return;
  list.innerHTML = '';

  activityLog.forEach(log => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(log.user||'System')}</td><td>${escapeHtml(log.action||'')}</td><td>${new Date(log.time||Date.now()).toLocaleString()}</td>`;
    list.appendChild(tr);
  });

  renderDashboardData();
}

// --- Dashboard ---
function renderDashboardData() {
  if(qs('#recentActivities')) {
    const tbody = qs('#recentActivities');
    tbody.innerHTML = '';
    activityLog.slice(0,5).forEach(l => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(l.user||'Admin')}</td><td>${escapeHtml(l.action)}</td><td>${new Date(l.time||Date.now()).toLocaleString()}</td>`;
      tbody.appendChild(tr);
    });
  }

  if(qs('#dash_totalItems')) {
    let totalValue=0, totalRevenue=0, totalStock=0;
    inventory.forEach(it => {
      const qty=Number(it.quantity||0);
      totalValue+=qty*Number(it.unitCost||0);
      totalRevenue+=qty*Number(it.unitPrice||0);
      totalStock+=qty;
    });
    qs('#dash_totalItems').textContent = inventory.length;
    qs('#dash_totalValue').textContent = totalValue.toFixed(2);
    qs('#dash_totalRevenue').textContent = totalRevenue.toFixed(2);
    qs('#dash_totalStock').textContent = totalStock;
  }
}

// --- Fetch functions ---
async function fetchInventory() {
  try {
    const res = await apiFetch(`${API_BASE}/inventory`);
    if(!res.ok) throw new Error('Failed to fetch inventory');
    const data = await res.json();
    inventory = data.map(i => ({ ...i, id: i.id || i._id }));
    renderInventory(inventory);
    renderDashboardData();
  } catch(e) { console.error(e); }
}

async function fetchDocuments() {
  try {
    const res = await apiFetch(`${API_BASE}/documents`);
    if(!res.ok) throw new Error('Failed to fetch documents');
    const data = await res.json();
    documents = data.map(d => ({ ...d, id: d.id || d._id }));
    renderDocuments(documents);
  } catch(e) { console.error(e); }
}

async function fetchLogs() {
  try {
    const res = await apiFetch(`${API_BASE}/logs`);
    if(!res.ok) throw new Error('Failed to fetch logs');
    activityLog = await res.json();
    renderLogs();
  } catch(e) { console.error(e); }
}

// --- Auth ---
async function login() {
  const user = qs('#username')?.value?.trim();
  const pass = qs('#password')?.value?.trim();
  const msg = qs('#loginMessage');
  showMsg(msg, '');
  if(!user || !pass) return showMsg(msg, '⚠️ Please enter username and password.', 'red');

  try {
    const res = await apiFetch(`${API_BASE}/login`, { method:'POST', body: JSON.stringify({username:user,password:pass}) });
    const data = await res.json();
    if(res.ok) {
      sessionStorage.setItem('isLoggedIn','true');
      sessionStorage.setItem('adminName',user);
      showMsg(msg,'✅ Login successful! Redirecting...','green');
      setTimeout(()=>window.location.href='index.html',700);
    } else showMsg(msg, `❌ ${data.message||'Login failed.'}`, 'red');
  } catch(e) {
    showMsg(msg,'❌ Server connection failed.','red'); console.error(e);
  }
}

async function register() {
  const user = qs('#newUsername')?.value?.trim();
  const pass = qs('#newPassword')?.value?.trim();
  const code = qs('#securityCode')?.value?.trim();
  const msg = qs('#registerMessage');
  showMsg(msg,'');
  if(!user || !pass || !code) return showMsg(msg,'⚠️ Please fill in all fields.','red');

  try {
    const res = await apiFetch(`${API_BASE}/register`, { method:'POST', body: JSON.stringify({username:user,password:pass,securityCode:code}) });
    const data = await res.json();
    if(res.ok) {
      showMsg(msg,'✅ Registered successfully! You can now log in.','green');
      setTimeout(()=>toggleForm(),900);
    } else showMsg(msg, `❌ ${data.message||'Registration failed.'}`, 'red');
  } catch(e) { showMsg(msg,'❌ Server connection failed.','red'); console.error(e); }
}

function toggleForm() {
  const loginForm = qs('#loginForm');
  const registerForm = qs('#registerForm');
  const formTitle = qs('#formTitle');
  if(!loginForm || !registerForm || !formTitle) return;

  const showLogin = getComputedStyle(loginForm).display === 'none';
  loginForm.style.display = showLogin ? 'block' : 'none';
  registerForm.style.display = showLogin ? 'none' : 'block';
  formTitle.textContent = showLogin ? '🔐 Admin Login' : '🧾 Register Account';
}

// --- Inventory CRUD ---
async function confirmAndAddProduct() {
  const sku=qs('#p_sku')?.value?.trim();
  const name=qs('#p_name')?.value?.trim();
  const category=qs('#p_category')?.value?.trim();
  const quantity=Number(qs('#p_quantity')?.value||0);
  const unitCost=Number(qs('#p_unitCost')?.value||0);
  const unitPrice=Number(qs('#p_unitPrice')?.value||0);
  if(!sku || !name) return alert('⚠️ Please enter SKU and Name.');
  if(!confirm(`Confirm Add Product: ${name} (${sku})?`)) return;

  try {
    const res = await apiFetch(`${API_BASE}/inventory`, { method:'POST', body:JSON.stringify({sku,name,category,quantity,unitCost,unitPrice}) });
    if(res.ok) {
      ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id=>qs(id)?.value='');
      await fetchInventory();
      if(currentPage.includes('inventory')) await fetchLogs();
      alert('✅ Product added successfully.');
    } else alert('❌ Failed to add product.');
  } catch(e) { console.error(e); alert('❌ Server connection error while adding product.'); }
}

async function confirmAndDeleteItem(id) {
  const it=inventory.find(x=>String(x.id)===String(id));
  if(!it) return;
  if(!confirm(`Confirm Delete: "${it.name}"?`)) return;

  try {
    const res=await apiFetch(`${API_BASE}/inventory/${id}`,{method:'DELETE'});
    if(res.status===204){ await fetchInventory(); alert('🗑️ Item deleted!'); }
    else alert('❌ Failed to delete item.');
  } catch(e){console.error(e);alert('❌ Server connection error while deleting product.');}
}

function searchInventory(){
  const q=(qs('#searchInput')?.value||'').toLowerCase().trim();
  renderInventory(inventory.filter(item=> (item.sku||'').toLowerCase().includes(q) || (item.name||'').toLowerCase().includes(q) || (item.category||'').toLowerCase().includes(q)));
}

function openEditPageForItem(id){ window.location.href=`product.html?id=${encodeURIComponent(id)}`; }

async function bindInventoryUI() {
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', confirmAndGenerateReport);
  qs('#pdfReportBtn')?.addEventListener('click', confirmAndGeneratePDF);
  qs('#searchInput')?.addEventListener('input', searchInventory);
  qs('#clearSearchBtn')?.addEventListener('click',()=>{if(qs('#searchInput')){qs('#searchInput').value='';searchInventory();}});
}

// --- Product page ---
async function bindProductPage() {
  const id=new URLSearchParams(window.location.search).get('id');
  if(id) {
    try {
      const res=await apiFetch(`${API_BASE}/inventory`);
      const it=(await res.json()).find(x=>String(x.id)===String(id));
      if(!it) return alert('Item not found');

      ['prod_id','prod_sku','prod_name','prod_category','prod_quantity','prod_unitCost','prod_unitPrice'].forEach(field=>{
        if(qs(`#${field}`)) qs(`#${field}`).value=it[field.replace('prod_','')]||it[field.replace('prod_','id')]||0;
      });
    } catch(e){alert('Item load failed.');}
  }

  qs('#saveProductBtn')?.addEventListener('click', async ()=>{
    if(!confirm('Confirm: Save Changes?')) return;
    const idVal=qs('#prod_id')?.value;
    const body={
      sku: qs('#prod_sku')?.value,
      name: qs('#prod_name')?.value,
      category: qs('#prod_category')?.value,
      quantity: Number(qs('#prod_quantity')?.value||0),
      unitCost: Number(qs('#prod_unitCost')?.value||0),
      unitPrice: Number(qs('#prod_unitPrice')?.value||0)
    };
    try {
      const res=await apiFetch(`${API_BASE}/inventory/${idVal}`,{method:'PUT',body:JSON.stringify(body)});
      if(res.ok){alert('✅ Item updated');window.location.href='inventory.html';}
      else { const err=await res.json(); alert('❌ Failed to update item: '+(err.message||'Unknown')); }
    } catch(e){console.error(e);alert('❌ Server connection error during update.');}
  });

  qs('#cancelProductBtn')?.addEventListener('click',()=>window.location.href='inventory.html');
}

// --- Documents ---
async function uploadDocuments() {
  const fileInput=qs('#docUpload');
  const files=fileInput?.files;
  let msgEl=qs('#uploadMessage');
  if(!msgEl){ msgEl=document.createElement('p'); msgEl.id='uploadMessage'; qs('.controls')?.appendChild(msgEl); }
  if(!files?.length) return showMsg(msgEl,'⚠️ Please select a file.','red');
  if(files.length>1){ showMsg(msgEl,'⚠️ Only single file uploads supported.','red'); fileInput.value=''; return; }

  const file=files[0];
  if(!confirm(`Confirm Upload: "${file.name}"?`)) return showMsg(msgEl,'Upload cancelled.','orange');
  showMsg(msgEl, `Uploading "${file.name}"...`, 'orange');

  try {
    const buffer=await new Promise((res,rej)=>{
      const fr=new FileReader();
      fr.onload=e=>res(e.target.result);
      fr.onerror=rej;
      fr.readAsArrayBuffer(file);
    });

    const res=await fetch(`${API_BASE}/documents`,{
      method:'POST',
      body:buffer,
      headers:{
        'Content-Type': file.type||'application/octet-stream',
        'X-Username': getUsername(),
        'X-File-Name': file.name
      }
    });
    if(!res.ok){ const err=await res.json(); throw new Error(err.message||`Status ${res.status}`);}
    await res.json();
    showMsg(msgEl, `✅ Uploaded "${file.name}"`, 'green');
  } catch(e){console.error(e); showMsg(msgEl, `❌ Upload failed: ${e.message}`,'red'); if(fileInput)fileInput.value=''; return; }

  if(fileInput) fileInput.value='';
  setTimeout(async()=>{await fetchDocuments(); msgEl.remove();},1000);
}

async function downloadDocument(docId,fileName){
  if(!confirm(`Confirm Download: ${fileName}?`)) return;
  try {
    const res=await fetch(`${API_BASE}/documents/download/${docId}`,{method:'GET',headers:{'X-Username':getUsername()}});
    if(!res.ok){ let msg='Server error during download.'; try{msg=(await res.json()).message||msg;}catch{} alert(`❌ Download Failed: ${msg}`); return; }
    const blob=await res.blob();
    const url=window.URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=fileName; document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
  } catch(e){console.error(e); alert('❌ Unexpected error during download.'); }
}

async function deleteDocumentConfirm(id){
  const doc=documents.find(d=>String(d.id)===String(id));
  if(!doc) return;
  if(!confirm(`Delete document: ${doc.name}?`)) return;
  try {
    const res=await apiFetch(`${API_BASE}/documents/${id}`,{method:'DELETE'});
    if(res.status===204||res.ok){ await fetchDocuments(); alert('🗑️ Document deleted!'); }
    else alert('❌ Failed to delete document.');
  } catch(e){console.error(e); alert('❌ Server error while deleting document.');}
}

function searchDocuments() {
  const q=(qs('#searchDocs')?.value||'').toLowerCase().trim();
  renderDocuments(documents.filter(d=> (d.name||'').toLowerCase().includes(q)));
}

// --- Initialize page ---
document.addEventListener('DOMContentLoaded',()=>{
  if(currentPage.includes('inventory')) { fetchInventory(); bindInventoryUI(); }
  if(currentPage.includes('documents')) { fetchDocuments(); qs('#docUploadBtn')?.addEventListener('click', uploadDocuments); qs('#searchDocs')?.addEventListener('input', searchDocuments);}
  if(currentPage.includes('logs')) fetchLogs();
  if(currentPage.includes('product')) bindProductPage();

  qs('#logoutBtn')?.addEventListener('click',logout);
  qs('#themeToggleBtn')?.addEventListener('click',toggleTheme);
});
