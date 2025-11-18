// public/js/script.js
// Full frontend script for Online Inventory & Documents System
// Update API_BASE if using a custom domain

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

let inventory = [];
let activityLog = [];
let documents = [];
const currentPage = window.location.pathname.split('/').pop();

// --- API wrapper ---
async function apiFetch(url, options = {}) {
  const user = getUsername();
  const opts = Object.assign({}, options);
  opts.headers = Object.assign({}, options.headers || {});
  opts.headers['X-Username'] = user;
  if(opts.body && typeof opts.body === 'string' && !opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
  return fetch(url, opts);
}

// --- Auth Redirect ---
if(!sessionStorage.getItem('isLoggedIn') && !currentPage.includes('login.html')) window.location.href = 'login.html';

// --- Utilities ---
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

// --- Renderers ---
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
  if(!list) return;
  list.innerHTML = '';
  activityLog.forEach(log => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(log.user||'System')}</td><td>${escapeHtml(log.action||'')}</td><td>${log.time ? new Date(log.time).toLocaleString() : 'N/A'}</td>`;
    list.appendChild(tr);
  });
  renderDashboardData();
}

function renderDashboardData(){
  const tbody = qs('#recentActivities');
  if(tbody) {
    tbody.innerHTML = '';
    activityLog.slice(0,5).forEach(l => {
      const tr = document.createElement('tr');
      const timeStr = l.time ? new Date(l.time).toLocaleString() : new Date().toLocaleString();
      tr.innerHTML = `<td>${escapeHtml(l.user||'Admin')}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(timeStr)}</td>`;
      tbody.appendChild(tr);
    });
  }

  if(qs('#dash_totalItems')){
    let totalValue = 0, totalRevenue = 0, totalStock = 0;
    inventory.forEach(it => {
      totalValue += Number(it.quantity||0)*Number(it.unitCost||0);
      totalRevenue += Number(it.quantity||0)*Number(it.unitPrice||0);
      totalStock += Number(it.quantity||0);
    });
    qs('#dash_totalItems').textContent = inventory.length;
    qs('#dash_totalValue').textContent = totalValue.toFixed(2);
    qs('#dash_totalRevenue').textContent = totalRevenue.toFixed(2);
    qs('#dash_totalStock').textContent = totalStock;
  }
}

// --- Fetchers ---
async function fetchInventory() {
  try {
    const res = await apiFetch(`${API_BASE}/inventory`);
    if(!res.ok) throw new Error('Failed to fetch inventory');
    const data = await res.json();
    inventory = data.map(i => ({ ...i, id: i.id || i._id }));
    renderInventory(inventory);
    renderDashboardData();
  } catch(e){ console.error(e); }
}

async function fetchDocuments() {
  try {
    const res = await apiFetch(`${API_BASE}/documents`);
    if(!res.ok) throw new Error('Failed to fetch documents');
    const data = await res.json();
    documents = data.map(d => ({ ...d, id: d.id || d._id }));
    renderDocuments(documents);
  } catch(e){ console.error(e); }
}

async function fetchLogs() {
  try {
    const res = await apiFetch(`${API_BASE}/logs`);
    if(!res.ok) throw new Error('Failed to fetch logs');
    activityLog = await res.json();
    renderLogs();
  } catch(e){ console.error(e); }
}

// --- Auth ---
async function login() {
  const user = qs('#username')?.value?.trim();
  const pass = qs('#password')?.value?.trim();
  const msg = qs('#loginMessage');
  showMsg(msg, '');
  if(!user||!pass){ showMsg(msg,'⚠️ Please enter username and password.'); return; }

  try {
    const res = await apiFetch(`${API_BASE}/login`, { method:'POST', body:JSON.stringify({username:user,password:pass}) });
    const data = await res.json();
    if(res.ok){
      sessionStorage.setItem('isLoggedIn','true');
      sessionStorage.setItem('adminName',user);
      showMsg(msg,'✅ Login successful! Redirecting...','green');
      setTimeout(()=>window.location.href='index.html',700);
    } else showMsg(msg,`❌ ${data.message||'Login failed.'}`);
  } catch(e){ showMsg(msg,'❌ Server connection failed.','red'); console.error(e);}
}

async function register(){
  const user = qs('#newUsername')?.value?.trim();
  const pass = qs('#newPassword')?.value?.trim();
  const code = qs('#securityCode')?.value?.trim();
  const msg = qs('#registerMessage');
  showMsg(msg,'');
  if(!user||!pass||!code){ showMsg(msg,'⚠️ Please fill in all fields.','red'); return; }

  try {
    const res = await apiFetch(`${API_BASE}/register`,{method:'POST',body:JSON.stringify({username:user,password:pass,securityCode:code})});
    const data = await res.json();
    if(res.ok){ showMsg(msg,'✅ Registered successfully!','green'); setTimeout(toggleForm,900); }
    else showMsg(msg,`❌ ${data.message||'Registration failed.'}`,'red');
  } catch(e){ showMsg(msg,'❌ Server connection failed.','red'); console.error(e);}
}

function toggleForm(){
  const loginForm = qs('#loginForm');
  const registerForm = qs('#registerForm');
  const formTitle = qs('#formTitle');
  if(!loginForm||!registerForm||!formTitle) return;
  if(getComputedStyle(loginForm).display==='none'){
    loginForm.style.display='block'; registerForm.style.display='none'; formTitle.textContent='🔐 Admin Login';
  } else {
    loginForm.style.display='none'; registerForm.style.display='block'; formTitle.textContent='🧾 Register Account';
  }
}

// --- Inventory CRUD ---
async function confirmAndAddProduct(){
  const sku = qs('#p_sku')?.value?.trim();
  const name = qs('#p_name')?.value?.trim();
  const category = qs('#p_category')?.value?.trim();
  const quantity = Number(qs('#p_quantity')?.value||0);
  const unitCost = Number(qs('#p_unitCost')?.value||0);
  const unitPrice = Number(qs('#p_unitPrice')?.value||0);
  if(!sku||!name) return alert('⚠️ Please enter SKU and Name.');
  if(!confirm(`Confirm Add Product: ${name} (${sku})?`)) return;

  try {
    const res = await apiFetch(`${API_BASE}/inventory`,{method:'POST',body:JSON.stringify({sku,name,category,quantity,unitCost,unitPrice})});
    if(res.ok){
      ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id=>{if(qs(id)) qs(id).value='';});
      await fetchInventory();
      if(currentPage.includes('inventory')) await fetchLogs();
      alert('✅ Product added successfully.');
    } else alert('❌ Failed to add product.');
  } catch(e){ console.error(e); alert('❌ Server error while adding product.'); }
}

async function confirmAndDeleteItem(id){
  const it = inventory.find(x=>String(x.id)===String(id));
  if(!it) return;
  if(!confirm(`Confirm Delete: "${it.name}"?`)) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory/${id}`,{method:'DELETE'});
    if(res.status===204){ await fetchInventory(); alert('🗑️ Item deleted!'); }
    else alert('❌ Failed to delete item.');
  } catch(e){ console.error(e); alert('❌ Server error while deleting item.'); }
}

function openEditPageForItem(id){ window.location.href = `product.html?id=${encodeURIComponent(id)}`; }

async function bindProductPage(){
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if(id){
    try{
      const res = await apiFetch(`${API_BASE}/inventory`);
      const items = await res.json();
      const it = items.find(x=>String(x.id)===String(id));
      if(!it){ alert('Item not found'); return; }
      qs('#prod_id').value=it.id||it._id;
      qs('#prod_sku').value=it.sku||'';
      qs('#prod_name').value=it.name||'';
      qs('#prod_category').value=it.category||'';
      qs('#prod_quantity').value=it.quantity||0;
      qs('#prod_unitCost').value=it.unitCost||0;
      qs('#prod_unitPrice').value=it.unitPrice||0;
    } catch(e){ alert('Item load failed.'); return; }
  }

  qs('#saveProductBtn')?.addEventListener('click', async ()=>{
    if(!confirm('Confirm: Save Changes?')) return;
    const idVal = qs('#prod_id')?.value;
    const body = {
      sku: qs('#prod_sku')?.value,
      name: qs('#prod_name')?.value,
      category: qs('#prod_category')?.value,
      quantity: Number(qs('#prod_quantity')?.value||0),
      unitCost: Number(qs('#prod_unitCost')?.value||0),
      unitPrice: Number(qs('#prod_unitPrice')?.value||0)
    };
    try{
      const res = await apiFetch(`${API_BASE}/inventory/${idVal}`,{method:'PUT',body:JSON.stringify(body)});
      if(res.ok){ alert('✅ Item updated'); window.location.href='inventory.html'; }
      else { const err = await res.json(); alert('❌ Failed to update item: '+(err.message||'Unknown')); }
    } catch(e){ console.error(e); alert('❌ Server connection error during update.'); }
  });

  qs('#cancelProductBtn')?.addEventListener('click',()=>window.location.href='inventory.html');
}

// --- Documents CRUD ---
async function uploadDocuments(){
  const fileInput = qs('#docUpload');
  const files = fileInput?.files;
  let msgEl = qs('#uploadMessage');
  if(!msgEl){ msgEl=document.createElement('p'); msgEl.id='uploadMessage'; if(qs('.controls')) qs('.controls').appendChild(msgEl);}
  if(!files||files.length===0){ showMsg(msgEl,'⚠️ Please select a file to upload.'); return; }
  if(files.length>1){ showMsg(msgEl,'⚠️ Only single file upload allowed.'); fileInput.value=''; return; }

  const file = files[0];
  if(!confirm(`Confirm Upload: ${file.name}?`)){ showMsg(msgEl,'Upload cancelled.','orange'); return; }

  showMsg(msgEl,`Uploading ${file.name}...`,'orange');
  try{
    const buffer = await new Promise((resolve,reject)=>{
      const fr = new FileReader();
      fr.onload=e=>resolve(e.target.result);
      fr.onerror=reject;
      fr.readAsArrayBuffer(file);
    });
    const res = await fetch(`${API_BASE}/documents`,{method:'POST',body:buffer,headers:{'Content-Type':file.type||'application/octet-stream','X-Username':getUsername(),'X-File-Name':file.name}});
    if(res.ok){ await res.json(); showMsg(msgEl,`✅ File uploaded: ${file.name}`,'green'); }
    else{ const err = await res.json(); throw new Error(err.message||`Server ${res.status}`); }
  } catch(e){ console.error(e); showMsg(msgEl,`❌ Upload failed: ${e.message}`,'red'); fileInput.value=''; return; }
  fileInput.value='';
  setTimeout(async ()=>{ await fetchDocuments(); if(msgEl) msgEl.remove(); },1000);
}

async function downloadDocument(docId, fileName){
  if(!confirm(`Confirm Download: ${fileName}?`)) return;
  try{
    const res = await fetch(`${API_BASE}/documents/download/${docId}`,{method:'GET',headers:{'X-Username':getUsername()}});
    if(!res.ok){ let msg='Download failed'; try{ const e = await res.json(); msg=e.message||msg;}catch{} alert(msg); return; }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=fileName; document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
  } catch(e){ console.error(e); alert('❌ Download failed'); }
}

async function deleteDocumentConfirm(id){
  const doc = documents.find(d=>String(d.id)===String(id));
  if(!doc) return; if(!confirm(`Delete document: ${doc.name}?`)) return;
  try{
    const res = await apiFetch(`${API_BASE}/documents/${id}`,{method:'DELETE'});
    if(res.status===204||res.ok){ await fetchDocuments(); alert('🗑️ Document deleted'); }
    else alert('❌ Failed to delete document.');
  } catch(e){ console.error(e); alert('❌ Server error while deleting'); }
}

function searchInventory(){
  const q = (qs('#searchInput')?.value||'').toLowerCase().trim();
  renderInventory(inventory.filter(it=> (it.sku||'').toLowerCase().includes(q)||(it.name||'').toLowerCase().includes(q)||(it.category||'').toLowerCase().includes(q)));
}
function searchDocuments(){
  const q = (qs('#searchDocs')?.value||'').toLowerCase().trim();
  renderDocuments(documents.filter(d=>(d.name||'').toLowerCase().includes(q)));
}

// --- PDF / Excel Report ---
function exportInventoryExcel(){
  const csv = ['SKU,Name,Category,Quantity,Unit Cost,Unit Price,Value'].concat(inventory.map(it=>[
    it.sku,it.name,it.category,it.quantity,it.unitCost,it.unitPrice,(Number(it.quantity)*Number(it.unitCost)).toFixed(2)
  ].join(','))).join('\n');

  const blob = new Blob([csv],{type:'text/csv'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='inventory_report.csv'; a.click();
}

function exportDocumentsExcel(){
  const csv = ['Name,Size(MB),Upload Date'].concat(documents.map(d=>[
    d.name,((d.sizeBytes||0)/(1024*1024)).toFixed(2),new Date(d.date).toLocaleString()
  ].join(','))).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='documents_report.csv'; a.click();
}

// --- Init ---
window.addEventListener('DOMContentLoaded',()=>{
  if(currentPage==='inventory.html') fetchInventory();
  else if(currentPage==='documents.html') fetchDocuments();
  else if(currentPage==='logs.html') fetchLogs();
  else if(currentPage==='product.html') bindProductPage();
  qs('#logoutBtn')?.addEventListener('click',logout);
  qs('#themeToggleBtn')?.addEventListener('click',toggleTheme);
  qs('#loginBtn')?.addEventListener('click',login);
  qs('#registerBtn')?.addEventListener('click',register);
  qs('#toggleFormBtn')?.addEventListener('click',toggleForm);
  qs('#addProductBtn')?.addEventListener('click',confirmAndAddProduct);
  qs('#uploadDocBtn')?.addEventListener('click',uploadDocuments);
  qs('#searchInput')?.addEventListener('input',searchInventory);
  qs('#searchDocs')?.addEventListener('input',searchDocuments);
  qs('#exportInventoryBtn')?.addEventListener('click',exportInventoryExcel);
  qs('#exportDocumentsBtn')?.addEventListener('click',exportDocumentsExcel);
});
