// server/server.js
// CLEANED FINAL — Full backend + robust PDF generator (multi-page, header only on page1, totals on last page, footer on every page)

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Auto-install helper (will attempt npm install missing packages if environment allows)
function ensureDependencies(pkgs = []) {
  const missing = [];
  for (const p of pkgs) {
    try { require.resolve(p); } catch (e) { missing.push(p); }
  }
  if (missing.length === 0) return;
  console.log('Missing packages detected:', missing.join(', '));
  try {
    const cmd = `npm install --no-audit --no-fund ${missing.join(' ')}`;
    console.log('Installing missing packages:', cmd);
    execSync(cmd, { stdio: 'inherit' });
    console.log('Dependency install completed.');
  } catch (err) {
    console.error('Auto-install failed. Run "npm install" manually if environment prevents install.', err);
  }
}

ensureDependencies([ 'express', 'cors', 'mongoose', 'xlsx', 'pdfkit' ]);

// Requires
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const xlsx = require('xlsx');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || '1234';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB connection guard
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set. Set the environment variable and restart.');
  process.exit(1);
}

mongoose.set('strictQuery', false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('✅ Connected to MongoDB'))
  .catch(err => { console.error('❌ MongoDB connect error:', err); process.exit(1); });

// Models
const { Schema } = mongoose;

const UserSchema = new Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const InventorySchema = new Schema({
  sku: String,
  name: String,
  category: String,
  quantity: { type: Number, default: 0 },
  unitCost: { type: Number, default: 0 },
  unitPrice: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Inventory = mongoose.model('Inventory', InventorySchema);

const DocumentSchema = new Schema({
  name: String,
  size: Number,
  date: { type: Date, default: Date.now }
});
const Doc = mongoose.model('Doc', DocumentSchema);

const LogSchema = new Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model('ActivityLog', LogSchema);

// Duplicate-log protection
const DUPLICATE_WINDOW_MS = 30 * 1000;
async function logActivity(user, action) {
  try {
    const safeUser = (user || 'System') + '';
    const safeAction = (action || '') + '';
    const now = Date.now();
    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean();
    if (last) {
      const lastTime = last.time ? new Date(last.time).getTime() : 0;
      if (last.user === safeUser && last.action === safeAction && (now - lastTime) <= DUPLICATE_WINDOW_MS) {
        return;
      }
    }
    await ActivityLog.create({ user: safeUser, action: safeAction, time: new Date() });
  } catch (err) {
    console.error('logActivity error:', err);
  }
}

// Health
app.get('/api/test', (req, res) => res.json({ success: true, time: new Date().toISOString() }));

// ----------------- AUTH -----------------
app.post('/api/register', async (req, res) => {
  const { username, password, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE) return res.status(403).json({ success:false, message:'Invalid security code' });
  if (!username || !password) return res.status(400).json({ success:false, message:'Missing fields' });
  try {
    if (await User.findOne({ username })) return res.status(409).json({ success:false, message:'Username exists' });
    await User.create({ username, password });
    await logActivity('System', `Registered user: ${username}`);
    return res.json({ success:true, message:'Registered' });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success:false, message:'Missing credentials' });
  try {
    const user = await User.findOne({ username, password }).lean();
    if (!user) return res.status(401).json({ success:false, message:'Invalid credentials' });
    await logActivity(username, 'Logged in');
    return res.json({ success:true, user: username });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

// ----------------- INVENTORY CRUD -----------------
app.get('/api/inventory', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const normalized = items.map(i => ({ ...i, id: i._id.toString() }));
    return res.json(normalized);
  } catch (err) {
    console.error('inventory fetch error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    await logActivity(req.headers['x-username'] || 'System', `Added: ${item.name}`);
    return res.status(201).json({ ...item.toObject(), id: item._id.toString() });
  } catch (err) {
    console.error('inventory create error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'] || 'System', `Updated: ${item.name}`);
    return res.json({ ...item.toObject(), id: item._id.toString() });
  } catch (err) {
    console.error('inventory update error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const item = await Inventory.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'] || 'System', `Deleted: ${item.name}`);
    return res.status(204).send();
  } catch (err) {
    console.error('inventory delete error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

// ----------------- PDF REPORT (multi-page, header only on page1) -----------------
app.get('/api/inventory/report/pdf', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const now = new Date();
    const printDate = now.toLocaleString();
    const reportId = `REP-${Date.now()}`;
    const printedBy = req.headers['x-username'] || 'System';
    const filename = `Inventory_Report_${now.toISOString().slice(0,10)}.pdf`;

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, bufferPages: true });
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);

    // HEADER (only on first page)
    doc.font('Helvetica-Bold').fontSize(22).text('L&B Company', 40, 40);
    doc.font('Helvetica').fontSize(10)
      .text('Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', 40, 70)
      .text('Phone: 01133127622', 40, 85)
      .text('Email: lbcompany@gmail.com', 40, 100);

    // RIGHT meta block — moved upper-right
    doc.font('Helvetica-Bold').fontSize(15).text('INVENTORY REPORT', 620, 40);
    doc.font('Helvetica').fontSize(10)
      .text(`Print Date: ${printDate}`, 620, 63)
      .text(`Report ID: ${reportId}`, 620, 78)
      .text('Status: Generated', 620, 93)
      .text(`Printed by: ${printedBy}`, 620, 108);

    // divider
    doc.moveTo(40, 130).lineTo(doc.page.width - 40, 130).stroke();

    // table configuration (fixed columns — widths confirmed)
    const rowHeight = 18;
    const colsX = {
      sku: 40,
      name: 100,
      category: 260,
      qty: 340,
      cost: 400,
      price: 480,
      value: 560,
      revenue: 670
    };
    const colWidths = {
      sku: 60,
      name: 160,
      category: 80,
      qty: 60,
      cost: 80,
      price: 80,
      value: 110,
      revenue: 120
    };

    // starting y after header
    let y = 150;

    // function to draw the compact table header (used on page 1 and repeated on subsequent pages)
    function drawTableHeader(repeatTopY = null) {
      const topY = (repeatTopY !== null) ? repeatTopY : y;
      doc.font('Helvetica-Bold').fontSize(10);

      // draw header cells with borders
      doc.rect(colsX.sku, topY, colWidths.sku, rowHeight).stroke();
      doc.rect(colsX.name, topY, colWidths.name, rowHeight).stroke();
      doc.rect(colsX.category, topY, colWidths.category, rowHeight).stroke();
      doc.rect(colsX.qty, topY, colWidths.qty, rowHeight).stroke();
      doc.rect(colsX.cost, topY, colWidths.cost, rowHeight).stroke();
      doc.rect(colsX.price, topY, colWidths.price, rowHeight).stroke();
      doc.rect(colsX.value, topY, colWidths.value, rowHeight).stroke();
      doc.rect(colsX.revenue, topY, colWidths.revenue, rowHeight).stroke();

      doc.fillColor('black');
      doc.text('SKU', colsX.sku + 3, topY + 4);
      doc.text('Product Name', colsX.name + 3, topY + 4);
      doc.text('Category', colsX.category + 3, topY + 4);
      doc.text('Quantity', colsX.qty + 3, topY + 4);
      doc.text('Unit Cost', colsX.cost + 3, topY + 4);
      doc.text('Unit Price', colsX.price + 3, topY + 4);
      doc.text('Total Inventory Value', colsX.value + 3, topY + 4);
      doc.text('Total Potential Revenue', colsX.revenue + 3, topY + 4);

      // move y below header only if not using repeatTopY
      if (repeatTopY === null) y += rowHeight;
    }

    // draw first header
    drawTableHeader();

    // (Part 1/3 ends here)
    // -----------------------
    // DRAW TABLE ROWS
    // -----------------------
    let subtotalQty = 0;
    let totalValue = 0;
    let totalRevenue = 0;

    for (const it of items) {
      // Page overflow check
      if (y + rowHeight > (doc.page.height - 80)) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 40 });
        y = 40;
        drawTableHeader(y);
        y += rowHeight;
        doc.font("Helvetica").fontSize(9);
      }

      const qty = Number(it.quantity || 0);
      const cost = Number(it.unitCost || 0);
      const price = Number(it.unitPrice || 0);

      const value = qty * cost;
      const revenue = qty * price;

      subtotalQty += qty;
      totalValue += value;
      totalRevenue += revenue;

      // Row boundaries + text
      doc.rect(colsX.sku, y, colWidths.sku, rowHeight).stroke();
      doc.rect(colsX.name, y, colWidths.name, rowHeight).stroke();
      doc.rect(colsX.category, y, colWidths.category, rowHeight).stroke();
      doc.rect(colsX.qty, y, colWidths.qty, rowHeight).stroke();
      doc.rect(colsX.cost, y, colWidths.cost, rowHeight).stroke();
      doc.rect(colsX.price, y, colWidths.price, rowHeight).stroke();
      doc.rect(colsX.value, y, colWidths.value, rowHeight).stroke();
      doc.rect(colsX.revenue, y, colWidths.revenue, rowHeight).stroke();

      doc.text(it.sku || "", colsX.sku + 3, y + 4);
      doc.text(it.name || "", colsX.name + 3, y + 4);
      doc.text(it.category || "", colsX.category + 3, y + 4);
      doc.text(String(qty), colsX.qty + 3, y + 4);
      doc.text(`RM ${cost.toFixed(2)}`, colsX.cost + 3, y + 4);
      doc.text(`RM ${price.toFixed(2)}`, colsX.price + 3, y + 4);
      doc.text(`RM ${value.toFixed(2)}`, colsX.value + 3, y + 4);
      doc.text(`RM ${revenue.toFixed(2)}`, colsX.revenue + 3, y + 4);

      y += rowHeight;
    }

    // -----------------------
    // TOTALS BOX (LAST PAGE)
    // -----------------------
    function drawTotals() {
      let boxY = y + 20;

      // Prevent totals from overlapping bottom margin
      if (boxY > doc.page.height - 120) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 40 });
        boxY = 60;
      }

      const boxX = 560;
      const boxWidth = 230;
      const boxHeight = 68;

      doc.rect(boxX, boxY, boxWidth, boxHeight).stroke();

      doc.font("Helvetica-Bold").fontSize(10);
      doc.text(`Subtotal (Quantity): ${subtotalQty} units`, boxX + 10, boxY + 10);
      doc.text(`Total Inventory Value: RM ${totalValue.toFixed(2)}`, boxX + 10, boxY + 28);
      doc.text(`Total Potential Revenue: RM ${totalRevenue.toFixed(2)}`, boxX + 10, boxY + 46);

      doc.font("Helvetica").fontSize(9);
    }

    drawTotals();

    // — PART 3 WILL CONTAIN —
    // ✔ Page numbers (center bottom)
    // ✔ Footer (“Generated by L&B Inventory System”) on every page
    // ✔ doc.end()
    // -------------------------------
    // PAGE NUMBERS (ALL PAGES)
    // -------------------------------
    const range = doc.bufferedPageRange(); // { start, count }

    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);

      doc.font("Helvetica")
         .fontSize(9)
         .text(`Page ${i + 1} of ${range.count}`, 0, doc.page.height - 30, {
            align: "center"
         });
    }

    // ------------------------------------------
    // FOOTER — bottom center on every page
    // ------------------------------------------
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);

      doc.font("Helvetica")
         .fontSize(9)
         .text("Generated by L&B Inventory System", 0, doc.page.height - 45, {
            align: "center"
         });
    }

    // End PDF
    doc.end();

  } catch (err) {
    console.error("PDF generation error:", err);
    return res.status(500).json({ message: "PDF generation failed" });
  }
});


// ============================================================================
//                               XLSX REPORT
// ============================================================================
app.get('/api/inventory/report', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();

    const filename = `Inventory_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;

    const ws_data = [
      ["L&B Company - Inventory Report"],
      ["Date:", new Date().toISOString().slice(0, 10)],
      [],
      ["SKU", "Name", "Category", "Quantity", "Unit Cost", "Unit Price", "Total Inventory Value", "Total Potential Revenue"]
    ];

    let totalValue = 0, totalRevenue = 0;

    items.forEach(it => {
      const qty = Number(it.quantity || 0);
      const uc = Number(it.unitCost || 0);
      const up = Number(it.unitPrice || 0);

      const invVal = qty * uc;
      const rev = qty * up;

      totalValue += invVal;
      totalRevenue += rev;

      ws_data.push([
        it.sku || "",
        it.name || "",
        it.category || "",
        qty,
        uc.toFixed(2),
        up.toFixed(2),
        invVal.toFixed(2),
        rev.toFixed(2)
      ]);
    });

    ws_data.push([]);
    ws_data.push(["", "", "", "Totals", "", "", totalValue.toFixed(2), totalRevenue.toFixed(2)]);

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Inventory Report");

    const wb_out = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers["x-username"], `Generated XLSX Inventory Report`);

    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    res.send(wb_out);

  } catch (err) {
    console.error("XLSX error:", err);
    return res.status(500).json({ message: "Report failed" });
  }
});


// ============================================================================
//                               DOCUMENTS CRUD
// ============================================================================
app.get('/api/documents', async (req, res) => {
  try {
    const docs = await Doc.find({}).sort({ date: -1 }).lean();
    const normalized = docs.map(d => ({ ...d, id: d._id.toString() }));
    res.json(normalized);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post('/api/documents', async (req, res) => {
  try {
    const docu = await Doc.create({ ...req.body, date: new Date() });
    await logActivity(req.headers["x-username"], `Uploaded: ${docu.name}`);
    res.status(201).json({ ...docu.toObject(), id: docu._id.toString() });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const docu = await Doc.findByIdAndDelete(req.params.id);
    if (!docu) return res.status(404).json({ message: "Document not found" });

    await logActivity(req.headers["x-username"], `Deleted: ${docu.name}`);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.get('/api/documents/download/:filename', (req, res) => {
  const filename = req.params.filename || "";
  if (filename.startsWith("Inventory_Report"))
    return res.redirect("/api/inventory/report");

  return res.status(404).json({ message: "File not available" });
});


// ============================================================================
//                                      LOGS
// ============================================================================
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(500).lean();
    const formatted = logs.map(l => ({
      user: l.user,
      action: l.action,
      time: l.time ? new Date(l.time).toISOString() : new Date().toISOString()
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});


// ============================================================================
//                              SERVE FRONTEND
// ============================================================================
app.use(express.static(path.join(__dirname, '../public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/'))
    return res.status(404).json({ message: "API route not found" });

  res.sendFile(path.join(__dirname, '../public/index.html'));
});


// ============================================================================
//                         SERVER STARTUP + DEFAULT ADMIN
// ============================================================================
async function ensureDefaultAdminAndStartupLog() {
  try {
    const count = await User.countDocuments({}).exec();
    if (count === 0) {
      await User.create({ username: "admin", password: "password" });
      await logActivity("System", "Default admin created");
    }
    await logActivity("System", `Server started on port ${PORT}`);
  } catch (err) {
    console.error("Startup error:", err);
  }
}

(async () => {
  await ensureDefaultAdminAndStartupLog();
  console.log("Starting server...");
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
})();
