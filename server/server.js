// server/server.js
// MongoDB (Mongoose) based server for Online Inventory & Documents System
// Final production-ready single-file delivery (includes Invoice-style PDF endpoint)

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || '1234';

// ===== Middleware =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== Mongoose / Models =====
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Set MONGODB_URI environment variable.');
  process.exit(1);
}

mongoose.set('strictQuery', false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('Connected to MongoDB Atlas'))
  .catch(err => { console.error('MongoDB connect error:', err); process.exit(1); });

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

// ===== safer logActivity (suppress near-duplicate entries) =====
const DUPLICATE_WINDOW_MS = 30 * 1000; // 30 seconds

async function logActivity(user, action){
  try {
    const safeUser = (user || 'Unknown').toString();
    const safeAction = (action || '').toString();
    const now = Date.now();

    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean().exec();
    if (last) {
      const lastUser = last.user || 'Unknown';
      const lastAction = last.action || '';
      const lastTime = last.time ? new Date(last.time).getTime() : 0;
      if (lastUser === safeUser && lastAction === safeAction && (now - lastTime) <= DUPLICATE_WINDOW_MS) {
        return; // skip noisy duplicate
      }
    }
    await ActivityLog.create({ user: safeUser, action: safeAction, time: new Date() });
  } catch (err) {
    console.error('logActivity error:', err);
  }
}

// ===== Health check =====
app.get('/api/test', (req, res) => res.json({ success:true, message:'API is up', time: new Date().toISOString() }));

// ============================================================================
// AUTH
// ============================================================================
app.post('/api/register', async (req, res) => {
  const { username, password, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE) return res.status(403).json({ success:false, message:'Invalid security code' });
  if (!username || !password) return res.status(400).json({ success:false, message:'Missing username or password' });

  try {
    const exists = await User.findOne({ username }).lean();
    if (exists) return res.status(409).json({ success:false, message:'Username already exists' });

    await User.create({ username, password });
    await logActivity('System', `Registered new user: ${username}`);
    return res.json({ success:true, message:'Registration successful' });
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
  } catch(err){
    console.error('login error', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

app.put('/api/account/password', async (req, res) => {
  const { username, newPassword, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE) return res.status(403).json({ message: 'Invalid Admin Security Code' });

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message:'User not found' });
    user.password = newPassword;
    await user.save();
    await logActivity(username, 'Changed account password');
    return res.json({ success:true, message:'Password updated successfully' });
  } catch (err) {
    console.error('change password error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.delete('/api/account', async (req, res) => {
  const { username, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE) return res.status(403).json({ message:'Invalid Admin Security Code' });

  try {
    const result = await User.deleteOne({ username });
    if (result.deletedCount === 0) return res.status(404).json({ message:'User not found' });
    await logActivity('System', `Deleted account for user: ${username}`);
    return res.json({ success:true, message:'Account deleted successfully' });
  } catch (err) {
    console.error('delete account error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

// ============================================================================
// INVENTORY CRUD
// ============================================================================
app.get('/api/inventory', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const normalized = items.map(i => ({ ...i, id: i._id.toString() }));
    return res.json(normalized);
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    await logActivity(req.headers['x-username'], `Added product: ${item.name}`);
    const normalized = { ...item.toObject(), id: item._id.toString() };
    return res.status(201).json(normalized);
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new:true });
    if (!item) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'], `Updated product: ${item.name}`);
    const normalized = { ...item.toObject(), id: item._id.toString() };
    return res.json(normalized);
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const item = await Inventory.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'], `Deleted product: ${item.name}`);
    return res.status(204).send();
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});
// ============================================================================
// PDF REPORT — INVOICE STYLE — ONE PAGE — 8 COLUMNS — BORDER STYLE B
// ============================================================================
app.get('/api/inventory/report/pdf', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const now = new Date();
    const filename = `Inventory_Report_${now.toISOString().slice(0,10)}.pdf`;

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 40
    });

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");

    doc.pipe(res);

    // --------------------------------------------------
    // INVOICE HEADER
    // --------------------------------------------------
    const headerY = 40;

    // Left header column
    doc.fontSize(20).font("Helvetica-Bold").text("L&B Company", 40, headerY);
    doc.fontSize(10).font("Helvetica")
      .text("Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka", 40, headerY + 28)
      .text("Phone: 01133127622", 40, headerY + 44)
      .text("Email: lbcompany@gmail.com", 40, headerY + 58);

    // Right header column
    const rightX = 520;
    doc.fontSize(18).font("Helvetica-Bold")
      .text("INVENTORY REPORT", rightX, headerY);
    doc.fontSize(10).font("Helvetica")
      .text(`Report No: REP-${Date.now()}`, rightX, headerY + 26)
      .text(`Date: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`, rightX, headerY + 42)
      .text("Status: Completed", rightX, headerY + 58);

    doc.moveDown(4);

    // --------------------------------------------------
    // TABLE COLUMN POSITIONS (8 COLS)
    // --------------------------------------------------
    const tableTopY = 130;
    const tableWidth = 780;
    const tableBottomY = 520;

    const col = {
      sku: 40,
      name: 120,
      category: 300,
      qty: 400,
      cost: 460,
      price: 530,
      value: 620,
      revenue: 720
    };

    // --------------------------------------------------
    // OUTER BORDER BOX
    // --------------------------------------------------
    doc.lineWidth(0.8);
    doc.rect(40, tableTopY, tableWidth, tableBottomY - tableTopY).stroke();

    // --------------------------------------------------
    // VERTICAL COLUMN LINES (Border Style B)
    // --------------------------------------------------
    const columnLines = [
      col.name - 5,
      col.category - 5,
      col.qty - 5,
      col.cost - 5,
      col.price - 5,
      col.value - 5,
      col.revenue - 5
    ];
    columnLines.forEach(x => doc.moveTo(x, tableTopY).lineTo(x, tableBottomY).stroke());

    // --------------------------------------------------
    // HEADER ROW
    // --------------------------------------------------
    const headerHeight = 20;
    doc.font("Helvetica-Bold").fontSize(10);

    doc.text("SKU", col.sku, tableTopY + 5);
    doc.text("Name", col.name, tableTopY + 5);
    doc.text("Category", col.category, tableTopY + 5);
    doc.text("Qty", col.qty, tableTopY + 5);
    doc.text("Unit Cost", col.cost, tableTopY + 5);
    doc.text("Unit Price", col.price, tableTopY + 5);
    doc.text("Value", col.value, tableTopY + 5);
    doc.text("Revenue", col.revenue, tableTopY + 5);

    // Header underline
    doc.moveTo(40, tableTopY + headerHeight)
       .lineTo(40 + tableWidth, tableTopY + headerHeight)
       .stroke();

    // --------------------------------------------------
    // TABLE ROWS — Medium Density, Zebra Style
    // --------------------------------------------------
    const rowHeight = 13;  
    let y = tableTopY + headerHeight;

    doc.font("Helvetica").fontSize(9.2);

    items.forEach((it, index) => {
      if (y + rowHeight > tableBottomY) return; // ensure ONE PAGE ONLY

      // Zebra background
      if (index % 2 === 1) {
        doc.save();
        doc.fillColor("#f2f2f2");
        doc.rect(40, y, tableWidth, rowHeight).fill();
        doc.restore();
      }

      // Compute financials
      const qty = Number(it.quantity || 0);
      const uc = Number(it.unitCost || 0);
      const up = Number(it.unitPrice || 0);
      const value = (qty * uc).toFixed(2);
      const revenue = (qty * up).toFixed(2);

      // Row text
      doc.fillColor("black");
      doc.text(it.sku || "", col.sku, y + 3, { width: 70 });
      doc.text(it.name || "", col.name, y + 3, { width: 160 });
      doc.text(it.category || "", col.category, y + 3, { width: 80 });
      doc.text(String(qty), col.qty, y + 3);
      doc.text(`RM ${uc.toFixed(2)}`, col.cost, y + 3);
      doc.text(`RM ${up.toFixed(2)}`, col.price, y + 3);
      doc.text(`RM ${value}`, col.value, y + 3);
      doc.text(`RM ${revenue}`, col.revenue, y + 3);

      y += rowHeight;
    });

    // --------------------------------------------------
    // FOOTER
    // --------------------------------------------------
    doc.fontSize(10).font("Helvetica")
      .text("Thank you.", 0, 560, { align: "center" })
      .text("Generated by L&B Inventory System", { align: "center" });

    doc.end();

  } catch (err) {
    console.error("PDF generate error", err);
    return res.status(500).json({ message: "PDF generation failed" });
  }
});
// ============================================================================
// XLSX REPORT (ORIGINAL FORMAT — UNCHANGED)
// ============================================================================
app.get('/api/inventory/report', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const filenameBase = `Inventory_Report_${new Date().toISOString().slice(0,10)}`;
    const filename = `${filenameBase}.xlsx`;
    const dateOnly = new Date().toISOString().slice(0,10);

    const ws_data = [
      ["L&B Company - Inventory Report"],
      ["Date:", dateOnly],
      [],
      ["SKU","Name","Category","Quantity","Unit Cost","Unit Price","Total Inventory Value","Total Potential Revenue"]
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

    const wb_out = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });

    await Doc.create({
      name: filename,
      size: wb_out.length,
      date: new Date()
    });

    await logActivity(req.headers['x-username'], `Generated and saved Inventory Report: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    return res.send(wb_out);

  } catch (err) {
    console.error("XLSX report error", err);
    return res.status(500).json({ message: "Report generation failed" });
  }
});

// ============================================================================
// DOCUMENTS CRUD
// ============================================================================
app.get('/api/documents', async (req, res) => {
  try {
    const docs = await Doc.find({}).sort({ date: -1 }).lean();
    const normalized = docs.map(d => ({ ...d, id: d._id.toString() }));
    return res.json(normalized);
  } catch (err) {
    console.error("Docs fetch error", err);
    return res.status(500).json({ message: "Server error" });
  }
});

app.post('/api/documents', async (req, res) => {
  try {
    const docItem = await Doc.create({ ...req.body, date: new Date() });

    await logActivity(
      req.headers['x-username'],
      `Uploaded document metadata: ${docItem.name}`
    );

    const normalized = { ...docItem.toObject(), id: docItem._id.toString() };
    return res.status(201).json(normalized);

  } catch (err) {
    console.error("Docs upload error", err);
    return res.status(500).json({ message: "Server error" });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const docItem = await Doc.findByIdAndDelete(req.params.id);

    if (!docItem)
      return res.status(404).json({ message: "Document not found" });

    await logActivity(
      req.headers['x-username'],
      `Deleted document metadata: ${docItem.name}`
    );

    return res.status(204).send();

  } catch (err) {
    console.error("Docs delete error", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Mock download system
app.get('/api/documents/download/:filename', (req, res) => {
  const filename = req.params.filename || "";

  if (filename.startsWith("Inventory_Report")) {
    return res.redirect("/api/inventory/report");
  }

  return res.status(404).json({
    message: "File not found or download unavailable on this mock server."
  });
});

// ============================================================================
// ACTIVITY LOGS
// ============================================================================
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({})
      .sort({ time: -1 })
      .limit(500)
      .lean();

    const formatted = logs.map(l => ({
      user: l.user,
      action: l.action,
      time: l.time
        ? new Date(l.time).toISOString()
        : new Date().toISOString()
    }));

    return res.json(formatted);

  } catch (err) {
    console.error("Log fetch error", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
// FRONTEND STATIC SERVE
// ============================================================================
app.use(express.static(path.join(__dirname, "../public")));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/"))
    return res.status(404).json({ message: "API route not found" });

  return res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ============================================================================
// DEFAULT ADMIN + STARTUP LOG
// ============================================================================
async function ensureDefaultAdminAndStartupLog() {
  try {
    const count = await User.countDocuments({}).exec();

    if (count === 0) {
      await User.create({ username: "admin", password: "password" });
      await logActivity("System", "Default admin user created.");
      console.log("Default admin user created.");
    }

    await logActivity("System", `Server is live on port ${PORT}`);

  } catch (err) {
    console.error("Startup helper error:", err);
  }
}

// ============================================================================
// START SERVER
// ============================================================================
(async () => {
  await ensureDefaultAdminAndStartupLog();

  console.log("Starting server...");
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
})();
