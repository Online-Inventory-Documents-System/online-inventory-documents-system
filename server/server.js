// server/server.js
// MongoDB (Mongoose) based server for Online Inventory & Documents System

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');   // PDF Reports

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

// ===== safer logActivity =====
const DUPLICATE_WINDOW_MS = 30 * 1000;

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
        return;
      }
    }
    await ActivityLog.create({ user: safeUser, action: safeAction, time: new Date() });
  } catch (err) {
    console.error('logActivity error:', err);
  }
}

// ============================================================================
// AUTH SYSTEM
// ============================================================================
app.post('/api/register', async (req, res) => {
  const { username, password, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ success:false, message:'Invalid security code' });
  if (!username || !password)
    return res.status(400).json({ success:false, message:'Missing username or password' });

  try {
    const exists = await User.findOne({ username }).lean();
    if (exists)
      return res.status(409).json({ success:false, message:'Username already exists' });

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
  if (!username || !password)
    return res.status(400).json({ success:false, message:'Missing credentials' });

  try {
    const user = await User.findOne({ username, password }).lean();
    if (!user)
      return res.status(401).json({ success:false, message:'Invalid credentials' });

    await logActivity(username, 'Logged in');
    return res.json({ success:true, user: username });
  } catch(err){
    console.error('login error', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

app.put('/api/account/password', async (req, res) => {
  const { username, newPassword, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ message: 'Invalid Admin Security Code' });

  try {
    const user = await User.findOne({ username });
    if (!user)
      return res.status(404).json({ message:'User not found' });

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
  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ message:'Invalid Admin Security Code' });

  try {
    const result = await User.deleteOne({ username });
    if (result.deletedCount === 0)
      return res.status(404).json({ message:'User not found' });

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
    if (!item)
      return res.status(404).json({ message:'Item not found' });

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
    if (!item)
      return res.status(404).json({ message:'Item not found' });

    await logActivity(req.headers['x-username'], `Deleted product: ${item.name}`);
    return res.status(204).send();
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});
// ============================================================================
// PDF REPORT — A4 LANDSCAPE — SINGLE PAGE — TINY TABLE — 8 COLUMNS
// ============================================================================
app.get('/api/inventory/report/pdf', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const now = new Date();
    const filename = `Inventory_Report_${now.toISOString().slice(0,10)}.pdf`;

    // A4 Landscape, single page
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 25,
    });

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    // ====== FIXED HEADER ======
    doc.font("Helvetica-Bold").fontSize(20).text("L&B Company", 25, 25);
    doc.font("Helvetica").fontSize(10);
    doc.text("Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka", 25, 50);
    doc.text("Phone: 01133127622", 25, 64);
    doc.text("Email: lbcompany@gmail.com", 25, 78);

    doc.font("Helvetica-Bold").fontSize(18).text("INVENTORY REPORT", 500, 25);
    doc.font("Helvetica").fontSize(10);
    doc.text(`Report #: REP-${Date.now()}`, 500, 50);
    doc.text(`Date: ${now.toLocaleDateString()}`, 500, 64);

    // ====== TABLE COLUMNS (8 COLS) ======
    const col = {
      sku: 25,
      name: 110,
      cat: 330,
      qty: 420,
      cost: 475,
      price: 540,
      value: 610,
      revenue: 710
    };

    let y = 115;

    // ====== TABLE HEADER ======
    doc.font("Helvetica-Bold").fontSize(9);

    doc.text("SKU", col.sku, y);
    doc.text("NAME", col.name, y);
    doc.text("CAT", col.cat, y);
    doc.text("QTY", col.qty, y);
    doc.text("UNIT COST", col.cost, y);
    doc.text("UNIT PRICE", col.price, y);
    doc.text("INVENTORY VALUE", col.value, y);
    doc.text("REVENUE", col.revenue, y);

    y += 12;

    // Header border
    doc.moveTo(25, y).lineTo(820, y).stroke();

    // ====== TABLE ROWS ======
    let totalValue = 0;
    let totalRevenue = 0;

    doc.font("Helvetica").fontSize(8);

    items.forEach((it, idx) => {
      const qty = Number(it.quantity || 0);
      const uc = Number(it.unitCost || 0);
      const up = Number(it.unitPrice || 0);
      const invVal = qty * uc;
      const rev = qty * up;

      totalValue += invVal;
      totalRevenue += rev;

      // Zebra stripe
      if (idx % 2 === 1) {
        doc.save();
        doc.fillOpacity(0.12);
        doc.rect(25, y - 2, 795, 12).fill("#cccccc");
        doc.restore();
      }

      // Row text
      doc.text(it.sku || "", col.sku, y);
      doc.text(it.name || "", col.name, y, { width: 200 });
      doc.text(it.category || "", col.cat, y, { width: 80 });
      doc.text(String(qty), col.qty, y);
      doc.text(`RM ${uc.toFixed(2)}`, col.cost, y);
      doc.text(`RM ${up.toFixed(2)}`, col.price, y);
      doc.text(`RM ${invVal.toFixed(2)}`, col.value, y);
      doc.text(`RM ${rev.toFixed(2)}`, col.revenue, y);

      y += 12;
    });

    // Bottom border
    doc.moveTo(25, y).lineTo(820, y).stroke();

    // ===== TOTALS =====
    y += 10;
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(`TOTAL INVENTORY VALUE: RM ${totalValue.toFixed(2)}`, 25, y, { align: "left" });
    y += 12;
    doc.text(`TOTAL POTENTIAL REVENUE: RM ${totalRevenue.toFixed(2)}`, 25, y, { align: "left" });

    // ===== FOOTER =====
    doc.font("Helvetica").fontSize(9);
    doc.text("Thank you for your business.", 0, 550, { align: "center" });
    doc.text("Generated by L&B Inventory System", 0, 565, { align: "center" });

    doc.end();

  } catch (err) {
    console.error("PDF generate error", err);
    return res.status(500).json({ message: "PDF generation failed" });
  }
});


// ============================================================================
// XLSX REPORT (unchanged)
// ============================================================================
app.get('/api/inventory/report', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const filenameBase = `Inventory_Report_${new Date().toISOString().slice(0,10)}`

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

    await Doc.create({ name: filename, size: wb_out.length, date:new Date() });

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);

  } catch(err){
    console.error('report error', err);
    return res.status(500).json({ message:'Report generation failed' });
  }
});


// ============================================================================
// DOCUMENTS CRUD
// ============================================================================
app.get('/api/documents', async (req, res) => {
  try {
    const docs = await Doc.find({}).sort({ date:-1 }).lean();
    const normalized = docs.map(d => ({ ...d, id: d._id.toString() }));
    return res.json(normalized);
  } catch (err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.post('/api/documents', async (req, res) => {
  try {
    const docItem = await Doc.create({ ...req.body, date:new Date() });
    const normalized = { ...docItem.toObject(), id: docItem._id.toString() };
    return res.status(201).json(normalized);
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const docItem = await Doc.findByIdAndDelete(req.params.id);
    if (!docItem)
      return res.status(404).json({ message:'Document not found' });

    return res.status(204).send();
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});


// ============================================================================
// LOGS
// ============================================================================
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time:-1 }).limit(500).lean();
    const formatted = logs.map(l => ({
      user: l.user,
      action: l.action,
      time: l.time ? new Date(l.time).toISOString() : new Date().toISOString()
    }));
    return res.json(formatted);
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});


// ============================================================================
// FRONTEND SERVE
// ============================================================================
app.use(express.static(path.join(__dirname, '../public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/'))
    return res.status(404).json({ message:'API route not found' });

  return res.sendFile(path.join(__dirname, '../public/index.html'));
});


// ============================================================================
// START SERVER
// ============================================================================
async function ensureDefaultAdminAndStartupLog() {
  try {
    const count = await User.countDocuments({}).exec();
    if (count === 0) {
      await User.create({ username:'admin', password:'password' });
      console.log('Default admin user created.');
    }

    await logActivity('System', `Server is live on port ${PORT}`);
  } catch (err) {
    console.error('Startup helper error:', err);
  }
}

(async () => {
  await ensureDefaultAdminAndStartupLog();

  console.log(`Starting server...`);
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
})();
