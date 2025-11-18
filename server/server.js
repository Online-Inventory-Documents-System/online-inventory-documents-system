// server/server.js
// MongoDB (Mongoose) based server for Online Inventory & Documents Management System
'use strict';

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || "1234";

// ---------------- CORS (explicit - allow custom headers & preflight) ----------------
const corsOptions = {
  origin: true, // allow all origins; change to specific origin(s) in production
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','X-File-Name','X-Filename','X-Username','Authorization'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // handle preflight

// Body parsers for JSON/urlencoded - upload route uses express.raw() at route level
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Specialized middleware for handling raw file uploads (apply only on upload route)
const rawBodyMiddleware = express.raw({
  type: '*/*', // accept any content type
  limit: '200mb' // increase if needed
});

// ---------------- MongoDB Connection ----------------
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set.");
  process.exit(1);
}

mongoose.set("strictQuery", false);
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("MongoDB connected"))
.catch(err => {
  console.error("MongoDB connect error:", err);
  process.exit(1);
});

const { Schema } = mongoose;

// ---------------- Schemas & Models ----------------
const UserSchema = new Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const InventorySchema = new Schema({
  sku: String, name: String, category: String,
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
  data: Buffer,              // binary file content
  contentType: String
});
const Doc = mongoose.model('Doc', DocumentSchema);

const LogSchema = new Schema({
  user: String, action: String, time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model('ActivityLog', LogSchema);

// ---------------- Utilities ----------------
const DUPLICATE_WINDOW_MS = 30 * 1000;
async function logActivity(user, action) {
  try {
    const safeUser = (user || "Unknown").toString();
    const safeAction = (action || "").toString();
    const now = Date.now();
    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean().exec();
    if (last) {
      const lastUser = last.user || "Unknown";
      const lastAction = last.action || "";
      const lastTime = last.time ? new Date(last.time).getTime() : 0;
      if (lastUser === safeUser && lastAction === safeAction && now - lastTime <= DUPLICATE_WINDOW_MS) return;
    }
    await ActivityLog.create({ user: safeUser, action: safeAction, time: new Date() });
  } catch (err) {
    console.error("logActivity error:", err);
  }
}

function normalizeToBuffer(dbData) {
  if (!dbData) return null;
  if (Buffer.isBuffer(dbData)) return dbData;
  if (dbData && dbData.buffer && typeof dbData.byteLength === 'number') {
    try { return Buffer.from(dbData.buffer, dbData.byteOffset || 0, dbData.byteLength); } catch (e) {}
  }
  if (dbData instanceof ArrayBuffer) return Buffer.from(new Uint8Array(dbData));
  try { return Buffer.from(dbData); } catch (e) { return null; }
}

function sanitizeFilename(name) {
  if (!name) return 'file';
  const s = String(name).replace(/[\r\n"]/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  return s.length > 200 ? s.slice(-200) : s;
}

// ---------------- Health check ----------------
app.get('/api/test', (req, res) => res.json({ success: true, time: new Date().toISOString() }));

// ---------------- Auth ----------------
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, securityCode } = req.body || {};
    if (securityCode !== SECURITY_CODE) return res.status(403).json({ message: 'Invalid security code' });
    if (!username || !password) return res.status(400).json({ message: 'Missing username or password' });
    const exists = await User.findOne({ username }).lean();
    if (exists) return res.status(409).json({ message: 'Username already exists' });
    await User.create({ username, password });
    await logActivity('System', `Registered user: ${username}`);
    res.json({ success: true, message: 'Registered' });
  } catch (err) {
    console.error('register error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'Missing credentials' });
    const user = await User.findOne({ username, password }).lean();
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    await logActivity(username, 'Logged in');
    res.json({ success: true, user: username });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------- Inventory CRUD ----------------
app.get('/api/inventory', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    res.json(items.map(i => ({ ...i, id: i._id.toString() })));
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
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

// ---------------- PDF report (preserve layout) ----------------
app.get('/api/inventory/report/pdf', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const now = new Date();
    const printDate = new Date(now).toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur', hour12: true });
    const reportId = `REP-${Date.now()}`;
    const printedBy = req.headers['x-username'] || 'System';
    const filename = `Inventory_Report_${now.toISOString().slice(0,10)}_${Date.now()}.pdf`;

    let pdfChunks = [];
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, bufferPages: true });
    doc.on('data', c => pdfChunks.push(c));
    doc.on('end', async () => {
      try {
        const buffer = Buffer.concat(pdfChunks);
        await Doc.create({ name: filename, size: buffer.length, date: new Date(), data: buffer, contentType: 'application/pdf' });
        await logActivity(printedBy, `Generated PDF report: ${filename}`);
      } catch (err) {
        console.error('Error saving PDF to DB:', err);
      }
    });

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);

    // --- header & layout (preserve exactly) ---
    doc.fontSize(20).font('Helvetica-Bold').text('L&B Company', 40, 40);
    doc.fontSize(10).font('Helvetica').text('Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', 40, 68);
    doc.text('Phone: 01133127622', 40, 82);
    doc.text('Email: lbcompany@gmail.com', 40, 96);

    doc.fontSize(16).font('Helvetica-Bold').text('INVENTORY REPORT', 620, 40);
    doc.fontSize(10).font('Helvetica').text(`Print Date: ${printDate}`, 620, 66);
    doc.text(`Report ID: ${reportId}`, 620, 80);
    doc.text(`Status: Generated`, 620, 94);
    doc.text(`Printed by: ${printedBy}`, 620, 108);

    doc.moveTo(40, 130).lineTo(800, 130).stroke();

    const rowH = 18;
    const colX = { sku: 40, name: 100, cat: 260, qty: 340, cost: 400, price: 480, val: 560, rev: 650 };
    const colW = { sku: 60, name: 160, cat: 80, qty: 60, cost: 80, price: 80, val: 90, rev: 100 };
    let y = 150;

    function drawHeader() {
      doc.font('Helvetica-Bold').fontSize(10);
      Object.keys(colX).forEach(k => doc.rect(colX[k], y, colW[k], rowH).stroke());
      doc.text('SKU', colX.sku + 3, y + 4);
      doc.text('Product Name', colX.name + 3, y + 4);
      doc.text('Category', colX.cat + 3, y + 4);
      doc.text('Quantity', colX.qty + 3, y + 4);
      doc.text('Unit Cost', colX.cost + 3, y + 4);
      doc.text('Unit Price', colX.price + 3, y + 4);
      doc.text('Total Inventory Value', colX.val + 3, y + 4);
      doc.text('Total Potential Revenue', colX.rev + 3, y + 4);
      y += rowH;
      doc.font('Helvetica').fontSize(9);
    }

    drawHeader();

    let subtotalQty = 0, totalValue = 0, totalRevenue = 0, rowsOnCurrentPage = 0;
    for (const it of items) {
      if (rowsOnCurrentPage === 10) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 40 });
        y = 40;
        rowsOnCurrentPage = 0;
        drawHeader();
      }

      const qty = Number(it.quantity || 0);
      const uc = Number(it.unitCost || 0);
      const up = Number(it.unitPrice || 0);
      const val = qty * uc;
      const rev = qty * up;
      subtotalQty += qty;
      totalValue += val;
      totalRevenue += rev;

      Object.keys(colX).forEach(k => doc.rect(colX[k], y, colW[k], rowH).stroke());
      doc.text(it.sku || '', colX.sku + 3, y + 4);
      doc.text(it.name || '', colX.name + 3, y + 4);
      doc.text(it.category || '', colX.cat + 3, y + 4);
      doc.text(String(qty), colX.qty + 3, y + 4);
      doc.text(`RM ${uc.toFixed(2)}`, colX.cost + 3, y + 4);
      doc.text(`RM ${up.toFixed(2)}`, colX.price + 3, y + 4);
      doc.text(`RM ${val.toFixed(2)}`, colX.val + 3, y + 4);
      doc.text(`RM ${rev.toFixed(2)}`, colX.rev + 3, y + 4);

      y += rowH;
      rowsOnCurrentPage++;
    }

    const lastPageIndex = doc.bufferedPageRange().count - 1;
    doc.switchToPage(lastPageIndex);
    let boxY = y + 20; if (boxY > 480) boxY = 480;
    doc.rect(560, boxY, 240, 72).stroke();
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text(`Subtotal (Quantity): ${subtotalQty} units`, 570, boxY + 10);
    doc.text(`Total Inventory Value: RM ${totalValue.toFixed(2)}`, 570, boxY + 28);
    doc.text(`Total Potential Revenue: RM ${totalRevenue.toFixed(2)}`, 570, boxY + 46);

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(9).font('Helvetica').text(`Page ${i + 1} of ${pages.count}`, 0, doc.page.height - 25, { align: 'center' });
      doc.text('Generated by L&B Company Inventory System', 0, doc.page.height - 40, { align: 'center' });
    }

    doc.end();
  } catch (err) {
    console.error('PDF gen error', err);
    res.status(500).json({ message: 'PDF generation failed' });
  }
});

// ---------------- XLSX report ----------------
app.get('/api/inventory/report', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const now = new Date();
    const filename = `Inventory_Report_${now.toISOString().slice(0,10)}_${Date.now()}.xlsx`;

    const ws_data = [
      ["L&B Company - Inventory Report"],
      ["Date:", new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })],
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
      ws_data.push([it.sku || "", it.name || "", it.category || "", qty, uc.toFixed(2), up.toFixed(2), invVal.toFixed(2), rev.toFixed(2)]);
    });

    ws_data.push([]);
    ws_data.push(["", "", "", "Totals", "", "", totalValue.toFixed(2), totalRevenue.toFixed(2)]);

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Inventory Report");
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    await Doc.create({ name: filename, size: buf.length, date: new Date(), data: buf, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await logActivity(req.headers['x-username'] || 'System', `Generated XLSX: ${filename}`);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error('XLSX error', err);
    res.status(500).json({ message: 'XLSX generation failed' });
  }
});

// ---------------- Documents: Upload / List / Delete / Download ----------------

// Upload (rawBodyMiddleware + stream fallback)
app.post('/api/documents', rawBodyMiddleware, async (req, res) => {
  try {
    console.log("UPLOAD request headers:", {
      ct: req.headers['content-type'],
      xfile: req.headers['x-file-name'] || req.headers['x-filename'],
      xuser: req.headers['x-username'],
      origin: req.headers['origin']
    });

    // Normalize req.body -> Buffer
    let fileBuffer = null;
    if (Buffer.isBuffer(req.body)) {
      fileBuffer = req.body;
      console.log("UPLOAD: req.body is Buffer length=", fileBuffer.length);
    } else if (req.body instanceof ArrayBuffer) {
      fileBuffer = Buffer.from(new Uint8Array(req.body));
      console.log("UPLOAD: req.body is ArrayBuffer length=", fileBuffer.length);
    } else if (req.body && req.body.buffer && typeof req.body.byteLength === 'number') {
      fileBuffer = Buffer.from(req.body.buffer, req.body.byteOffset || 0, req.body.byteLength);
      console.log("UPLOAD: req.body typed-array-like length=", fileBuffer.length);
    } else if (req.body && Object.keys(req.body).length === 0) {
      console.log("UPLOAD: req.body is empty object {} - attempting stream fallback");
      fileBuffer = null;
    } else if (req.body) {
      try { fileBuffer = Buffer.from(req.body); console.log("UPLOAD: Buffer.from(req.body) length=", fileBuffer.length); } catch(e) { fileBuffer = null; }
    } else {
      fileBuffer = null;
    }

    // stream fallback if no buffer
    if (!fileBuffer || fileBuffer.length === 0) {
      console.log("UPLOAD: starting stream fallback to collect raw bytes...");
      fileBuffer = await new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        const MAX_BYTES = 500 * 1024 * 1024;
        let finished = false;

        req.on('data', (chunk) => {
          chunks.push(chunk);
          total += chunk.length;
          if (total > MAX_BYTES) {
            reject(new Error('Upload exceeded max allowed bytes'));
            req.pause();
          }
        });

        req.on('end', () => {
          finished = true;
          if (chunks.length === 0) return resolve(null);
          resolve(Buffer.concat(chunks));
        });

        req.on('error', (err) => { reject(err); });

        setTimeout(() => { if (!finished && chunks.length === 0) resolve(null); }, 1500);
      }).catch(err => {
        console.error("UPLOAD stream fallback error:", err && err.message);
        return res.status(500).json({ message: "Server error while reading upload stream." });
      });

      if (fileBuffer && fileBuffer.length) console.log("UPLOAD: fallback read bytes=", fileBuffer.length);
      else console.log("UPLOAD: fallback read no bytes");
    }

    const contentType = (req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
    const fileName = req.headers['x-file-name'] || req.headers['x-filename'] || `file_${Date.now()}`;
    const username = req.headers['x-username'] || 'Unknown';

    if (!fileBuffer || fileBuffer.length === 0) {
      console.warn("UPLOAD: no fileBuffer received after fallback.");
      return res.status(400).json({
        message: "No file content received or file is empty. Ensure client sends raw bytes (ArrayBuffer) and 'X-File-Name' header."
      });
    }

    const docu = await Doc.create({
      name: String(fileName),
      size: fileBuffer.length,
      date: new Date(),
      data: fileBuffer,
      contentType: String(contentType)
    });

    console.log(`Upload: saved ${docu.name} size=${docu.size} bytes by user=${username}`);
    await logActivity(username, `Uploaded document: ${docu.name} (${contentType})`);
    return res.status(201).json([{ ...docu.toObject(), id: docu._id.toString() }]);
  } catch (err) {
    console.error("Document upload error:", err);
    return res.status(500).json({ message: "Server error during file storage." });
  }
});

// List docs (metadata only)
app.get('/api/documents', async (req, res) => {
  try {
    const docs = await Doc.find({}).select('-data').sort({ date: -1 }).lean();
    res.json(docs.map(d => ({ ...d, id: d._id.toString() })));
  } catch (err) {
    console.error("GET /api/documents error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete
app.delete('/api/documents/:id', async (req, res) => {
  try {
    const docu = await Doc.findByIdAndDelete(req.params.id).lean();
    if (!docu) return res.status(404).json({ message: "Document not found" });
    await logActivity(req.headers['x-username'] || 'Unknown', `Deleted document: ${docu.name}`);
    console.log(`Deleted doc ${docu.name} (${docu._id})`);
    return res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/documents/:id error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Download by id (streamed)
app.get('/api/documents/download/:id', async (req, res) => {
  try {
    const inline = String(req.query.inline || '') === '1';
    const id = req.params.id;
    if (!id) return res.status(400).json({ message: "Missing document id" });

    const docu = await Doc.findById(id).lean();
    if (!docu) return res.status(404).json({ message: "Document not found" });

    const buf = normalizeToBuffer(docu.data);
    if (!buf) {
      console.warn("Download: missing/invalid buffer for doc", { id, name: docu.name });
      return res.status(400).json({ message: "File content not present or invalid. Try re-uploading the file." });
    }

    const filename = sanitizeFilename(docu.name || `file-${docu._id}`);
    const disposition = inline ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Type', docu.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'no-transform');

    const stream = new PassThrough();
    stream.end(buf);
    stream.pipe(res);

    console.log(`Download: streaming ${filename} size=${buf.length} bytes`);
    await logActivity(req.headers['x-username'] || 'Unknown', `Downloaded document: ${filename}`);
  } catch (err) {
    console.error("Document download error (stream):", err);
    return res.status(500).json({ message: "Server error during download" });
  }
});

// Download by name (exact match)
app.get('/api/documents/download/name/:name', async (req, res) => {
  try {
    const rawName = req.params.name || '';
    const decoded = decodeURIComponent(rawName);
    const docu = await Doc.findOne({ name: decoded }).lean();
    if (!docu) return res.status(404).json({ message: "Document not found by name" });

    const buf = normalizeToBuffer(docu.data);
    if (!buf) {
      console.warn("Download by name: invalid buffer", { name: decoded, id: docu._id });
      return res.status(400).json({ message: "File content not present or invalid. Try re-uploading the file." });
    }

    const inline = String(req.query.inline || '') === '1';
    const filename = sanitizeFilename(docu.name || `file-${docu._id}`);
    const disposition = inline ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Type', docu.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'no-transform');

    const stream = new PassThrough();
    stream.end(buf);
    stream.pipe(res);

    console.log(`Download by name: streaming ${filename} size=${buf.length} bytes`);
    await logActivity(req.headers['x-username'] || 'Unknown', `Downloaded document by name: ${filename}`);
  } catch (err) {
    console.error("Document download by name error:", err);
    return res.status(500).json({ message: "Server error during download by name" });
  }
});

// Debug route (inspect stored bytes) - remove in production when done
app.get('/debug/doc/:id', async (req, res) => {
  try {
    const doc = await Doc.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ message: 'Not found' });
    const buf = normalizeToBuffer(doc.data);
    const firstHex = buf ? buf.slice(0, 32).toString('hex') : null;
    const firstAscii = buf ? buf.slice(0, 32).toString('utf8').replace(/[^\x20-\x7E]/g, '.') : null;
    const base64Preview = buf ? buf.slice(0, 128).toString('base64') : null;
    res.json({ id: doc._id, name: doc.name, size: doc.size, contentType: doc.contentType, hasBuffer: !!buf, firstHex, firstAscii, base64Preview });
  } catch (e) {
    console.error('debug doc error', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------- Activity logs ----------------
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(500).lean();
    res.json(logs.map(l => ({ user: l.user, action: l.action, time: l.time ? new Date(l.time).toISOString() : new Date().toISOString() })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------- Serve frontend ----------------
app.use(express.static(path.join(__dirname, '../public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message: 'API route not found' });
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ---------------- Startup helper ----------------
async function ensureDefaultAdminAndStartupLog() {
  try {
    const count = await User.countDocuments({}).exec();
    if (count === 0) {
      await User.create({ username: 'admin', password: 'password' });
      await logActivity('System', 'Default admin user created');
      console.log('Default admin created (admin/password)');
    }
    await logActivity('System', `Server started on port ${PORT}`);
  } catch (err) {
    console.error('Startup error:', err);
  }
}

(async () => {
  await ensureDefaultAdminAndStartupLog();
  console.log('Starting server...');
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
})();
