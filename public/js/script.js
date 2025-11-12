// public/js/script.js
// Updated client-side script for Online Inventory & Documents System
// API_BASE auto-switches for localhost vs production

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

// ====== Utilities ======
const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

let inventory = [];
let activityLog = [];
let documents = [];
const currentPage = window.location.pathname.split('/').pop();

// ====== API Wrapper ======
async function apiFetch(url, options = {}) {
  const user = getUsername();
  options.headers = {
      'Content-Type': 'application/json',
      'X-Username': user,
      ...options.headers
  };
  if (options.body && typeof options.body !== 'string') options.body = JSON.stringify(options.body);
  try {
    const res = await fetch(url, options);
    const data = await res.json().catch(()=>null);
    return { ok: res.ok, status: res.status, data };
  } catch(e) {
    console.error('API fetch error:', e);
    return { ok:false, status:0, data:null };
  }
}

// ====== Auth ======
function redirectIfNotLoggedIn(){
  if(!sessionStorage.getItem('isLoggedIn') && !currentPage.includes('login.html')){
    window.location.href = 'login.html';
  }
}
redirectIfNotLoggedIn();

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

// ====== Renderers ======

// Inventory Table
function renderInventory(items){
  const listEl = qs('#inventoryList');
  if(!listEl) return;

  listEl.innerHTML = '';
  let totalValue = 0, totalRevenue = 0, totalStock = 0;

  items.forEach(item => {
      const qty = Number(item.quantity || 0);
      const uc = Number(item.unitCost || 0);
      const up = Number(item.unitPrice || 0);
      const invVal = qty * uc;
      const rev = qty * up;

      totalValue += invVal;
      totalRevenue += rev;
      totalStock += qty;

      const row = document.createElement('tr');
      row.dataset.id = item.id;

      if(qty === 0) row.classList.add('out-of-stock-row');
      else if(qty < 10) row.classList.add('low-stock-row');

      row.innerHTML = `
          <td>${escapeHtml(item.sku)}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.category)}</td>
          <td>${qty}</td>
          <td class="money">RM ${uc.toFixed(2)}</td>
          <td class="money">RM ${up.toFixed(2)}</td>
          <td class="money">RM ${invVal.toFixed(2)}</td>
          <td class="actions">
            <button class="primary-btn small-btn" onclick="openEditPageForItem('${item.id}')">✏️ Edit</button>
            <button class="danger-btn small-btn" onclick="confirmAndDeleteItem('${item.id}')">🗑️ Delete</button>
          </td>
      `;
      listEl.appendChild(row);
  });

  qs('#totalValue')?.textContent = totalValue.toFixed(2);
  qs('#totalRevenue')?.textContent = totalRevenue.toFixed(2);
  qs('#totalStock')?.textContent = totalStock;
}

// Documents Table
function renderDocuments(docs){
  const listEl = qs('#docList');
  if(!listEl) return;
  listEl.innerHTML = '';

  docs.forEach(doc => {
    const sizeMB = ((doc.sizeBytes || doc.size || 0) / (1024*1024)).toFixed(2);
    const row = document.createElement('tr');
    row.dataset.id = doc.id;
    row.innerHTML = `
      <td>${escapeHtml(doc.name)}</td>
      <td>${sizeMB} MB</td>
      <td>${new Date(doc.date).toLocaleString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="downloadDocument('${encodeURIComponent(doc.name)}')">⬇️ Download</button>
        <button class="danger-btn small-btn" onclick="deleteDocumentConfirm('${doc.id}')">🗑️ Delete</button>
      </td>
    `;
    listEl.appendChild(row);
  });
}

// Activity Logs
function renderLogs(){
  const listEl = qs('#logList');
  if(!listEl) return;
  listEl.innerHTML = '';
  [...activityLog].reverse().forEach(log => {
    const li = document.createElement('li');
    li.innerHTML = `[${escapeHtml(log.time)}] <b>${escapeHtml(log.user)}</b>: ${escapeHtml(log.action)}`;
    listEl.appendChild(li);
  });
  renderDashboardStats();
}

// Dashboard Stats
function renderDashboardStats(){
  if(!qs('#dash_totalItems')) return;
  let totalValue=0, totalRevenue=0, totalStock=0;
  inventory.forEach(item=>{
    const qty = Number(item.quantity||0);
    totalValue += qty * Number(item.unitCost||0);
    totalRevenue += qty * Number(item.unitPrice||0);
    totalStock += qty;
  });
  qs('#dash_totalItems').textContent = inventory.length;
  qs('#dash_totalValue').textContent = totalValue.toFixed(2);
  qs('#dash_totalRevenue').textContent = totalRevenue.toFixed(2);
  qs('#dash_totalStock').textContent = totalStock;
}

// ====== Data Fetchers ======
async function fetchInventory(){ 
  const res = await apiFetch(`${API_BASE}/inventory`);
  if(res.ok){ inventory = res.data || []; renderInventory(inventory); renderDashboardStats(); }
  else console.error('Fetch inventory failed');
}

async function fetchDocuments(){ 
  const res = await apiFetch(`${API_BASE}/documents`);
  if(res.ok){ documents = res.data || []; renderDocuments(documents); }
  else console.error('Fetch documents failed');
}

async function fetchLogs(){
  const res = await apiFetch(`${API_BASE}/logs`);
  if(res.ok){ activityLog = res.data || []; renderLogs(); }
  else console.error('Fetch logs failed');
}

// ====== Auth ======
async function login(){
  const user = qs('#username')?.value.trim();
  const pass = qs('#password')?.value.trim();
  const msg = qs('#loginMessage');
  showMsg(msg,'');
  if(!user||!pass){ showMsg(msg,'⚠️ Enter username and password'); return; }

  const res = await apiFetch(`${API_BASE}/login`, { method:'POST', body:{ username:user,password:pass } });
  if(res.ok && res.data.success){
    sessionStorage.setItem('isLoggedIn','true');
    sessionStorage.setItem('adminName', user);
    showMsg(msg,'✅ Login successful','green');
    setTimeout(()=> window.location.href='index.html', 700);
  } else showMsg(msg,`❌ ${res.data?.message || 'Login failed'}`,'red');
}

async function register(){
  const user = qs('#newUsername')?.value.trim();
  const pass = qs('#newPassword')?.value.trim();
  const code = qs('#securityCode')?.value.trim();
  const msg = qs('#registerMessage');
  showMsg(msg,'');
  if(!user||!pass||!code){ showMsg(msg,'⚠️ Fill all fields'); return; }

  const res = await apiFetch(`${API_BASE}/register`, { method:'POST', body:{ username:user,password:pass,securityCode:code } });
  if(res.ok && res.data.success){ showMsg(msg,'✅ Registered! Login now','green'); setTimeout(toggleForm,900); }
  else showMsg(msg,`❌ ${res.data?.message || 'Registration failed'}`,'red');
}

function toggleForm(){
  const loginForm=qs('#loginForm'), registerForm=qs('#registerForm'), formTitle=qs('#formTitle');
  if(!loginForm||!registerForm||!formTitle) return;
  if(getComputedStyle(loginForm).display==='none'){
    loginForm.style.display='block'; registerForm.style.display='none'; formTitle.textContent='🔐 Admin Login';
  } else{
    loginForm.style.display='none'; registerForm.style.display='block'; formTitle.textContent='🧾 Register Account';
  }
}

// ====== Inventory CRUD ======
async function confirmAndAddProduct(){
  const sku = qs('#p_sku')?.value.trim();
  const name = qs('#p_name')?.value.trim();
  const category = qs('#p_category')?.value.trim();
  const quantity = Number(qs('#p_quantity')?.value || 0);
  const unitCost = Number(qs('#p_unitCost')?.value || 0);
  const unitPrice = Number(qs('#p_unitPrice')?.value || 0);
  if(!sku||!name) return alert('Enter SKU and Name');
  if(!confirm(`Add Product: ${name} (${sku})?`)) return;

  const res = await apiFetch(`${API_BASE}/inventory`, { method:'POST', body:{ sku,name,category,quantity,unitCost,unitPrice } });
  if(res.ok){ await fetchInventory(); alert('✅ Product added'); ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id=>qs(id)?.value=''); }
  else alert('❌ Failed to add product');
}

async function confirmAndDeleteItem(id){
  const item = inventory.find(x=>x.id===id);
  if(!item) return;
  if(!confirm(`Delete "${item.name}"?`)) return;

  const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method:'DELETE' });
  if(res.ok || res.status===204){ await fetchInventory(); alert('🗑️ Item deleted'); }
  else alert('❌ Failed to delete item');
}

// ====== Documents ======
async function uploadDocuments(){
  const files = qs('#docUpload')?.files || [];
  if(files.length===0) return alert('Select files');

  for(let file of files){
    const docMetadata = { name:file.name, type:file.type, sizeBytes:file.size };
    const res = await apiFetch(`${API_BASE}/documents`, { method:'POST', body:docMetadata });
    if(!res.ok) return alert(`❌ Failed to upload ${file.name}`);
  }
  qs('#docUpload').value='';
  await fetchDocuments();
  alert('✅ Documents uploaded');
}

function downloadDocument(fileNameEncoded){ const fileName = decodeURIComponent(fileNameEncoded); window.open(`${API_BASE}/documents/download/${encodeURIComponent(fileName)}`,'_blank'); }

async function deleteDocumentConfirm(id){
  const doc = documents.find(d=>d.id===id);
  if(!doc) return;
  if(confirm(`Delete document metadata for "${doc.name}"?`)) await deleteDocument(id);
}

async function deleteDocument(id){
  const res = await apiFetch(`${API_BASE}/documents/${id}`, { method:'DELETE' });
  if(res.ok || res.status===204){ await fetchDocuments(); alert('🗑️ Document deleted'); }
  else alert('❌ Delete failed');
}

// ====== Init ======
document.addEventListener('DOMContentLoaded', ()=>{
  const adminName = getUsername();
  if(qs('#adminName')) qs('#adminName').textContent = adminName;

  const theme = (window.CONFIG && CONFIG.LS_THEME) ? localStorage.getItem(CONFIG.LS_THEME) : null;
  if(theme==='dark') document.body.classList.add('dark-mode');

  if(currentPage.includes('login.html')){
    qs('#loginBtn')?.addEventListener('click', login);
    qs('#registerBtn')?.addEventListener('click', register);
    qs('#toggleToRegister')?.addEventListener('click', toggleForm);
    qs('#toggleToLogin')?.addEventListener('click', toggleForm);
  } else {
    if(currentPage.includes('inventory')) { fetchInventory(); }
    if(currentPage.includes('documents')) { fetchDocuments(); }
    if(currentPage.includes('log') || currentPage === '' || currentPage==='index.html') { fetchLogs(); fetchInventory(); }
  }
});

// ====== Expose globals ======
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.downloadDocument = downloadDocument;
window.deleteDocumentConfirm = deleteDocumentConfirm;
window.confirmAndAddProduct = confirmAndAddProduct;
