// =======================
// AUTO-INSTALL MULTER
// =======================
const child_process = require("child_process");

try {
  require.resolve("multer");
} catch (e) {
  console.log("\n⏳ Multer not found. Installing automatically...\n");
  try {
    child_process.execSync("npm install multer", { stdio: "inherit" });
    console.log("\n✅ Multer installed successfully.\n");
  } catch (err) {
    console.error("\n❌ Failed to install multer automatically.", err);
  }
}

// =======================
// server.js
// =======================
const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const os = require('os');
const PDFDocument = require('pdfkit');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || "1234";

// ---------- middleware ----------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------- multer setup ----------
const uploadsDir = path.join(os.tmpdir(), "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_ ]/g, '_')}`;
    cb(null, safeName);
  }
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB

// ---------- MongoDB ----------
if (!MONGODB_URI) {
  console.error("MONGODB_URI not set. Exiting.");
  process.exit(1);
}

mongoose.set("strictQuery", false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB connected"))
  .catch(err => { console.error(err); process.exit(1); });

const db = mongoose.connection;
let gfsBucket = null;
db.once('open', () => {
  gfsBucket = new mongoose.mongo.GridFSBucket(db.db, { bucketName: 'uploads' });
  console.log("GridFS ready");
});

// ---------- Schemas ----------
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
  date: { type: Date, default: Date.now },
  data: Buffer,
  contentType: String,
  gridFsId: Schema.Types.ObjectId
});
const Doc = mongoose.model('Doc', DocumentSchema);

const LogSchema = new Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model('ActivityLog', LogSchema);

// ---------- log activity ----------
const DUPLICATE_WINDOW_MS = 30 * 1000;
async function logActivity(user, action) {
  try {
    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean();
    const now = Date.now();
    if (last && last.user === user && last.action === action && (now - new Date(last.time).getTime()) <= DUPLICATE_WINDOW_MS) return;
    await ActivityLog.create({ user: user || 'Unknown', action, time: new Date() });
  } catch (err) { console.error('logActivity error', err); }
}

// ---------- Health check ----------
app.get('/api/test', (req, res) => res.json({ success: true, time: new Date().toISOString() }));

// ---------- AUTH ----------
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, securityCode } = req.body || {};
    if (securityCode !== SECURITY_CODE) return res.status(403).json({ message: 'Invalid security code' });
    if (!username || !password) return res.status(400).json({ message: 'Missing username or password' });
    if (await User.exists({ username })) return res.status(409).json({ message: 'Username exists' });

    await User.create({ username, password });
    await logActivity('System', `Registered user: ${username}`);
    res.json({ success: true, message: 'Registered' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'Missing credentials' });

    const user = await User.findOne({ username, password }).lean();
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    await logActivity(username, 'Logged in');
    res.json({ success: true, user: username });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// ---------- Inventory CRUD ----------
app.get('/api/inventory', async (req, res) => {
  try { const items = await Inventory.find({}).lean(); res.json(items.map(i => ({ ...i, id: i._id.toString() }))); }
  catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    await logActivity(req.headers['x-username'] || 'Unknown', `Added product: ${item.name}`);
    res.status(201).json({ ...item.toObject(), id: item._id.toString() });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    await logActivity(req.headers['x-username'] || 'Unknown', `Updated product: ${item.name}`);
    res.json({ ...item.toObject(), id: item._id.toString() });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const item = await Inventory.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    await logActivity(req.headers['x-username'] || 'Unknown', `Deleted product: ${item.name}`);
    res.status(204).send();
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});
// ============================================================================
//                 PDF REPORT — SAVE TO DOCUMENTS + LOG USER ACTION
// ============================================================================
app.get("/api/inventory/report/pdf", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();

    const now = new Date();
    const printDate = now.toLocaleString();
    const reportId = `REP-${Date.now()}`;
    const printedBy = req.headers["x-username"] || "System";

    const filename = `Inventory_Report_${now.toISOString().slice(0, 10)}_${Date.now()}.pdf`;

    // ============================
    // Prepare PDF buffer collector
    // ============================
    let pdfChunks = [];
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 40,
      bufferPages: true
    });

    // Capture PDF buffer
    doc.on("data", chunk => pdfChunks.push(chunk));
    doc.on("end", async () => {
      const pdfBuffer = Buffer.concat(pdfChunks);

      // Save PDF record in Document database
      await Doc.create({
        name: filename,
        size: pdfBuffer.length,
        date: new Date()
      });

      // Log user action
      await logActivity(
        printedBy,
        `Generated Inventory Report PDF: ${filename}`
      );
    });

    // Also send PDF to user
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    // =====================================================
    // HEADER (Only shown on First Page)
    // =====================================================
    doc.fontSize(22).font("Helvetica-Bold").text("L&B Company", 40, 40);
    doc.fontSize(10).font("Helvetica");
    doc.text("Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka", 40, 70);
    doc.text("Phone: 01133127622", 40, 85);
    doc.text("Email: lbcompany@gmail.com", 40, 100);

    doc.font("Helvetica-Bold").fontSize(15)
       .text("INVENTORY REPORT", 620, 40);

    doc.font("Helvetica").fontSize(10);
    doc.text(`Print Date: ${printDate}`, 620, 63);
    doc.text(`Report ID: ${reportId}`, 620, 78);
    doc.text(`Status: Generated`, 620, 93);
    doc.text(`Printed by: ${printedBy}`, 620, 108);

    doc.moveTo(40, 130).lineTo(800, 130).stroke();

    // =====================================================
    // TABLE SETTINGS
    // =====================================================
    const rowHeight = 18;
    const colX = {
      sku: 40, name: 100, category: 260, qty: 340,
      cost: 400, price: 480, value: 560, revenue: 670
    };
    const width = {
      sku: 60, name: 160, category: 80, qty: 60,
      cost: 80, price: 80, value: 110, revenue: 120
    };

    let y = 150;
    let rowsOnPage = 0;

    function drawHeader() {
      doc.font("Helvetica-Bold").fontSize(10);
      for (const col of Object.keys(colX)) {
        doc.rect(colX[col], y, width[col], rowHeight).stroke();
      }
      doc.text("SKU", colX.sku + 3, y + 4);
      doc.text("Product Name", colX.name + 3, y + 4);
      doc.text("Category", colX.category + 3, y + 4);
      doc.text("Quantity", colX.qty + 3, y + 4);
      doc.text("Unit Cost", colX.cost + 3, y + 4);
      doc.text("Unit Price", colX.price + 3, y + 4);
      doc.text("Total Inventory Value", colX.value + 3, y + 4);
      doc.text("Total Potential Revenue", colX.revenue + 3, y + 4);

      y += rowHeight;
      doc.font("Helvetica").fontSize(9);
    }

    drawHeader();

    let subtotalQty = 0, totalValue = 0, totalRevenue = 0;

    // =====================================================
    // TABLE ROWS — max 10 per page
    // =====================================================
    for (const it of items) {
      if (rowsOnPage === 10) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 40 });
        y = 40;
        rowsOnPage = 0;
        drawHeader();
      }

      const qty = Number(it.quantity || 0);
      const cost = Number(it.unitCost || 0);
      const price = Number(it.unitPrice || 0);
      const val = qty * cost;
      const rev = qty * price;

      subtotalQty += qty;
      totalValue += val;
      totalRevenue += rev;

      for (const col of Object.keys(colX)) {
        doc.rect(colX[col], y, width[col], rowHeight).stroke();
      }

      doc.text(it.sku || "", colX.sku + 3, y + 4);
      doc.text(it.name || "", colX.name + 3, y + 4);
      doc.text(it.category || "", colX.category + 3, y + 4);
      doc.text(String(qty), colX.qty + 3, y + 4);
      doc.text(`RM ${cost.toFixed(2)}`, colX.cost + 3, y + 4);
      doc.text(`RM ${price.toFixed(2)}`, colX.price + 3, y + 4);
      doc.text(`RM ${val.toFixed(2)}`, colX.value + 3, y + 4);
      doc.text(`RM ${rev.toFixed(2)}`, colX.revenue + 3, y + 4);

      y += rowHeight;
      rowsOnPage++;
    }

    // =====================================================
    // TOTAL BOX (Last Page)
    // =====================================================
    const last = doc.bufferedPageRange().count - 1;
    doc.switchToPage(last);

    let boxY = y + 20;
    if (boxY > 480) boxY = 480;

    doc.rect(560, boxY, 230, 68).stroke();

    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(`Subtotal (Quantity): ${subtotalQty} units`, 570, boxY + 10);
    doc.text(`Total Inventory Value: RM ${totalValue.toFixed(2)}`, 570, boxY + 28);
    doc.text(`Total Potential Revenue: RM ${totalRevenue.toFixed(2)}`, 570, boxY + 46);

    doc.flushPages();

    // =====================================================
    // FOOTER + PAGE NUMBER
    // =====================================================
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(9).text(
        "Generated by L&B Company Inventory System",
        0, doc.page.height - 40,
        { align: "center" }
      );
      doc.text(`Page ${i + 1} of ${pages.count}`,
        0, doc.page.height - 25,
        { align: "center" }
      );
    }

    doc.end();

  } catch (err) {
    console.error("PDF Error:", err);
    res.status(500).json({ message: "PDF generation failed" });
  }
});

// ============================================================================
//                                   XLSX REPORT
// ============================================================================
app.get("/api/inventory/report", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const filenameBase = `Inventory_Report_${new Date().toISOString().slice(0, 10)}`;
    const filename = `${filenameBase}.xlsx`;

    const ws_data = [
      ["L&B Company - Inventory Report"],
      ["Date:", new Date().toISOString().slice(0, 10)],
      [],
      ["SKU", "Name", "Category", "Quantity", "Unit Cost", "Unit Price", "Total Inventory Value", "Total Potential Revenue"]
    ];

    let totalValue = 0;
    let totalRevenue = 0;

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
    const wb_out = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers["x-username"], `Generated Inventory Report XLSX`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(wb_out);

  } catch (err) {
    console.error("XLSX error", err);
    return res.status(500).json({ message: "Report generation failed" });
  }
});

// ---------- Document upload/download/list/delete ----------
app.post('/api/documents', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Use form field 'file'" });
    const uploadedPath = req.file.path;
    const originalName = req.body.name || req.file.originalname;
    const mimeType = req.file.mimetype || 'application/octet-stream';
    const fileSize = req.file.size;

    if (!gfsBucket) {
      const buffer = fs.readFileSync(uploadedPath);
      const doc = await Doc.create({ name: originalName, size: buffer.length, date: new Date(), data: buffer, contentType: mimeType });
      await logActivity(req.headers['x-username'] || 'System', `Uploaded ${originalName} (inline)`);
      fs.unlinkSync(uploadedPath);
      return res.status(201).json({ id: doc._id.toString(), name: doc.name });
    }

    const readStream = fs.createReadStream(uploadedPath);
    const uploadStream = gfsBucket.openUploadStream(originalName, { contentType: mimeType });
    readStream.pipe(uploadStream)
      .on('error', err => { console.error(err); fs.unlinkSync(uploadedPath); res.status(500).json({ message: 'Upload failed' }); })
      .on('finish', async file => {
        try {
          const doc = await Doc.create({ name: originalName, size: fileSize, date: new Date(), contentType: mimeType, gridFsId: file._id });
          await logActivity(req.headers['x-username'] || 'System', `Uploaded ${originalName}`);
          fs.unlinkSync(uploadedPath);
          res.status(201).json({ id: doc._id.toString(), name: doc.name });
        } catch (err) { console.error(err); fs.unlinkSync(uploadedPath); res.status(500).json({ message: 'Server error' }); }
      });

  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

app.get('/api/documents/download/:filename', async (req, res) => {
  try {
    const fname = req.params.filename;
    const doc = await Doc.findOne({ name: fname }).lean();
    if (!doc) return res.status(404).json({ message: 'Document not found' });

    if (doc.gridFsId && gfsBucket) {
      res.setHeader('Content-Disposition', `attachment; filename="${doc.name}"`);
      res.setHeader('Content-Type', doc.contentType || 'application/octet-stream');
      const downloadStream = gfsBucket.openDownloadStream(doc.gridFsId);
      return downloadStream.pipe(res);
    }

    if (doc.data && doc.data.length) {
      res.setHeader('Content-Disposition', `attachment; filename="${doc.name}"`);
      res.setHeader('Content-Type', doc.contentType || 'application/octet-stream');
      return res.send(doc.data);
    }

    return res.status(404).json({ message: 'Document has no data' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

app.get('/api/documents', async (req, res) => {
  try {
    const docs = await Doc.find({}).sort({ date: -1 }).lean();
    res.json(docs.map(d => ({ id: d._id.toString(), name: d.name, sizeBytes: d.size || 0, date: d.date, hasData: !!(d.data || d.gridFsId) })));
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const doc = await Doc.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    if (doc.gridFsId && gfsBucket) {
      try { await gfsBucket.delete(doc.gridFsId); } catch (e) { console.warn(e); }
    }
    await Doc.deleteOne({ _id: doc._id });
    await logActivity(req.headers['x-username'] || 'System', `Deleted document: ${doc.name}`);
    res.status(204).send();
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// ---------- Activity logs ----------
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(1000).lean();
    res.json(logs.map(l => ({ user: l.user, action: l.action, time: l.time?.toISOString() || null })));
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// ---------- Serve frontend ----------
app.use(express.static(path.join(__dirname, '../public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message: 'API route not found' });
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ---------- Default admin ----------
async function ensureDefaultAdmin() {
  try {
    const count = await User.countDocuments();
    if (!count) {
      await User.create({ username: 'admin', password: 'password' });
      await logActivity('System', 'Default admin created');
      console.log('Default admin created (admin/password)');
    }
  } catch (e) { console.error(e); }
}

// ---------- Start server ----------
(async () => { await ensureDefaultAdmin(); app.listen(PORT, () => console.log(`Server running on port ${PORT}`)); })();
