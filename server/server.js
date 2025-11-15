// server/server.js
// Full server with Inventory, Documents, Orders, Sales, XLSX + PDF + ZIP endpoints

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');
const archiver = require('archiver'); // zip creation
const stream = require('stream');

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

// ===== Orders Schema =====
const OrderItemSchema = new Schema({
  sku: String,
  name: String,
  qty: Number,
  price: Number
}, { _id: false });

const OrdersSchema = new Schema({
  orderNumber: { type: String, required: true, unique: true },
  customerName: String,
  items: [OrderItemSchema],
  total: { type: Number, default: 0 },
  status: { type: String, default: 'Pending' }, // Pending / Approved / Cancelled
  date: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrdersSchema);

// ===== Sales Schema =====
const SalesSchema = new Schema({
  invoice: { type: String, required: true, unique: true },
  product: String,
  sku: String,
  quantity: { type: Number, default: 1 },
  total: { type: Number, default: 0 },
  date: { type: Date, default: Date.now }
});
const Sale = mongoose.model('Sale', SalesSchema);

// ===== safer logActivity: suppress near-duplicate entries =====
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
        // skip noisy duplicate
        return;
      }
    }

    await ActivityLog.create({ user: safeUser, action: safeAction, time: new Date() });
  } catch (err) {
    console.error('logActivity error:', err);
  }
}

// ===== Health check =====
app.get('/api/test', (req, res) => res.json({ success:true, message:'API is up', time: new Date().toISOString() }));

// ===== Auth =====
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
    if (!user) return res.status(404).json({ message: 'User not found' });
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
  if (securityCode !== SECURITY_CODE) return res.status(403).json({ message: 'Invalid Admin Security Code' });

  try {
    const result = await User.deleteOne({ username });
    if (result.deletedCount === 0) return res.status(404).json({ message: 'User not found' });
    await logActivity('System', `Deleted account for user: ${username}`);
    return res.json({ success:true, message:'Account deleted successfully' });
  } catch (err) {
    console.error('delete account error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

// ===== Inventory CRUD =====
app.get('/api/inventory', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const normalized = items.map(i => ({ ...i, id: i._id.toString() }));
    return res.json(normalized);
  } catch(err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    await logActivity(req.headers['x-username'] || 'Unknown', `Added product: ${item.name}`);
    const normalized = { ...item.toObject(), id: item._id.toString() };
    return res.status(201).json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const item = await Inventory.findByIdAndUpdate(id, req.body, { new:true });
    if (!item) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'] || 'Unknown', `Updated product: ${item.name}`);
    const normalized = { ...item.toObject(), id: item._id.toString() };
    return res.json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const item = await Inventory.findByIdAndDelete(id);
    if (!item) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'] || 'Unknown', `Deleted product: ${item.name}`);
    return res.status(204).send();
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// ===== Orders CRUD =====
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find({}).sort({ date: -1 }).lean();
    const normalized = orders.map(o => ({ ...o, id: o._id.toString() }));
    return res.json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    // ensure unique orderNumber (simple auto scheme if not provided)
    let orderNumber = req.body.orderNumber;
    if (!orderNumber) {
      orderNumber = 'ORD-' + Date.now().toString().slice(-8);
    }
    const payload = { ...req.body, orderNumber };
    const order = await Order.create(payload);
    await logActivity(req.headers['x-username'] || 'Unknown', `Created order: ${order.orderNumber}`);
    const normalized = { ...order.toObject(), id: order._id.toString() };
    return res.status(201).json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const order = await Order.findByIdAndUpdate(id, req.body, { new:true });
    if (!order) return res.status(404).json({ message:'Order not found' });
    await logActivity(req.headers['x-username'] || 'Unknown', `Updated order: ${order.orderNumber}`);
    return res.json({ ...order.toObject(), id: order._id.toString() });
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    await logActivity(req.headers['x-username'] || 'Unknown', `Deleted order: ${order.orderNumber}`);
    return res.status(204).send();
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// ===== Sales CRUD =====
app.get('/api/sales', async (req, res) => {
  try {
    const rows = await Sale.find({}).sort({ date: -1 }).lean();
    const normalized = rows.map(r => ({ ...r, id: r._id.toString() }));
    return res.json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/sales', async (req, res) => {
  try {
    let invoice = req.body.invoice;
    if (!invoice) invoice = 'INV-' + Date.now().toString().slice(-8);
    const payload = { ...req.body, invoice };
    const s = await Sale.create(payload);
    await logActivity(req.headers['x-username'] || 'Unknown', `Recorded sale: ${s.invoice}`);
    return res.status(201).json({ ...s.toObject(), id: s._id.toString() });
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.put('/api/sales/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const s = await Sale.findByIdAndUpdate(id, req.body, { new:true });
    if (!s) return res.status(404).json({ message:'Sale not found' });
    await logActivity(req.headers['x-username'] || 'Unknown', `Updated sale: ${s.invoice}`);
    return res.json({ ...s.toObject(), id: s._id.toString() });
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/sales/:id', async (req, res) => {
  try {
    const s = await Sale.findByIdAndDelete(req.params.id);
    if (!s) return res.status(404).json({ message: 'Sale not found' });
    await logActivity(req.headers['x-username'] || 'Unknown', `Deleted sale: ${s.invoice}`);
    return res.status(204).send();
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// ===== Helper: generate PDF buffer using PDFKit (two-column professional invoice) =====
function generateInvoicePDFBuffer({ title = 'Order Invoice', companyInfo = {}, docMeta = {}, customer = {}, items = [], totals = {}, extraNotes = '' }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 36 });
      const bufs = [];
      doc.on('data', (d) => bufs.push(d));
      doc.on('end', () => resolve(Buffer.concat(bufs)));
      // Header - two column
      doc.fontSize(14).font('Helvetica-Bold').text(companyInfo.name || 'L&B Company', 36, 36);
      doc.fontSize(10).font('Helvetica').text(companyInfo.address || '', { continued: false });
      doc.text(`Phone: ${companyInfo.phone || ''}`);
      doc.text(`Email: ${companyInfo.email || ''}`);
      // Right column meta
      const topY = 36;
      const rightX = 360;
      doc.fontSize(12).font('Helvetica-Bold').text(title, rightX, topY, { align: 'right' });
      doc.fontSize(10).font('Helvetica').text(`No: ${docMeta.reference || ''}`, rightX, topY + 20, { align: 'right' });
      doc.text(`Date: ${docMeta.dateString || new Date().toLocaleString()}`, { align: 'right' });
      doc.text(`Status: ${docMeta.status || ''}`, { align: 'right' });

      doc.moveDown(1);
      // Customer / Bill To
      doc.moveTo(36, 140);
      doc.fontSize(10).font('Helvetica-Bold').text('Bill To:', 36, 140);
      doc.font('Helvetica').fontSize(10).text(customer.name || '', 36, 155);
      if (customer.contact) doc.text(`Contact: ${customer.contact}`, 36, doc.y);

      doc.moveDown(2);

      // Items table header
      const tableTop = 200;
      const colX = { item:36, sku:260, qty:360, price:420, total:500 };
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Item', colX.item, tableTop);
      doc.text('SKU', colX.sku, tableTop);
      doc.text('Qty', colX.qty, tableTop);
      doc.text('Unit', colX.price, tableTop, { width: 70, align: 'right' });
      doc.text('Total', colX.total, tableTop, { width: 70, align: 'right' });

      doc.moveTo(36, tableTop + 16).lineTo(560, tableTop + 16).stroke();

      doc.font('Helvetica').fontSize(10);
      let y = tableTop + 24;
      items.forEach(i => {
        doc.text(i.name || '', colX.item, y, { width: 220 });
        doc.text(i.sku || '', colX.sku, y);
        doc.text(String(i.qty || ''), colX.qty, y);
        doc.text(Number(i.price || 0).toFixed(2), colX.price, y, { width: 70, align: 'right' });
        doc.text(Number((i.qty || 0) * (i.price || 0)).toFixed(2), colX.total, y, { width: 70, align: 'right' });
        y += 18;
        if (y > 720) { doc.addPage(); y = 60; }
      });

      // Totals
      doc.moveTo(300, y + 6).lineTo(560, y + 6).stroke();
      const subtotal = totals.subtotal || totals.total || items.reduce((s,it)=> s + ((it.qty||0)*(it.price||0)), 0);
      const tax = totals.tax || 0;
      const grand = totals.grandTotal || subtotal + tax;
      doc.font('Helvetica-Bold');
      doc.text('Subtotal', 400, y + 18, { width: 90, align: 'right' });
      doc.text(Number(subtotal).toFixed(2), 500, y + 18, { width: 70, align: 'right' });
      doc.text('Tax', 400, y + 36, { width: 90, align: 'right' });
      doc.text(Number(tax).toFixed(2), 500, y + 36, { width: 70, align: 'right' });
      doc.text('Total', 400, y + 54, { width: 90, align: 'right' });
      doc.text(Number(grand).toFixed(2), 500, y + 54, { width: 70, align: 'right' });

      // Footer notes
      if (extraNotes) {
        doc.moveDown(4);
        doc.font('Helvetica').fontSize(9).text(extraNotes, 36, y + 90);
      }

      // small footer
      doc.fontSize(9).text('Thank you for your business. Generated by L&B Inventory System', 36, 760, { align: 'center', width: 520 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ===== Inventory XLSX & PDF endpoints (date-only header; inventory PDF added) =====
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
      ws_data.push([it.sku||'', it.name||'', it.category||'', qty, uc.toFixed(2), up.toFixed(2), invVal.toFixed(2), rev.toFixed(2)]);
    });
    ws_data.push([]);
    ws_data.push(["", "", "", "Totals", "", "", totalValue.toFixed(2), totalRevenue.toFixed(2)]);

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Inventory Report");
    const wb_out = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });

    // Persist document record
    await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers['x-username'] || 'Unknown', `Generated Inventory XLSX: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);
  } catch (err) {
    console.error('inventory report error', err);
    return res.status(500).json({ message:'Report generation failed' });
  }
});

// Inventory PDF endpoint
app.get('/api/inventory/report/pdf', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const docMeta = { reference: `INV-REPORT-${Date.now()}`, dateString: new Date().toLocaleString(), status: 'Report' };
    const companyInfo = { name: 'L&B Company', address: 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', phone: '01133127622', email: 'lbcompany@gmail.com' };
    const customer = { name: 'Inventory Report' };
    const itemsForPdf = items.map(it => ({ name: it.name, sku: it.sku, qty: it.quantity, price: it.unitPrice }));

    const totals = { subtotal: itemsForPdf.reduce((s,i)=> s + (i.qty * i.price), 0), tax: 0, grandTotal: itemsForPdf.reduce((s,i)=> s + (i.qty * i.price), 0) };

    const buffer = await generateInvoicePDFBuffer({ title: 'Inventory Report', companyInfo, docMeta, customer, items: itemsForPdf, totals, extraNotes: 'Inventory listing generated by L&B Inventory System' });

    const filename = `Inventory_Report_${new Date().toISOString().slice(0,10)}.pdf`;
    // persist metadata
    await Doc.create({ name: filename, size: buffer.length, date: new Date() });
    await logActivity(req.headers['x-username'] || 'Unknown', `Generated Inventory PDF: ${filename}`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (err) {
    console.error('inventory pdf error', err);
    return res.status(500).json({ message: 'PDF generation failed' });
  }
});

// ===== Orders XLSX & PDF endpoints =====
app.get('/api/orders/report', async (req, res) => {
  try {
    const orders = await Order.find({}).lean();
    const filenameBase = `Orders_Report_${new Date().toISOString().slice(0,10)}`;
    const filename = `${filenameBase}.xlsx`;
    const ws_data = [
      ["L&B Company - Orders Report"],
      ["Date:", new Date().toISOString().slice(0,10)],
      [],
      ["Order #","Customer","Items (name x qty)","Total","Status","Date"]
    ];
    orders.forEach(o => {
      const itemsSummary = (o.items || []).map(i=> `${i.name} x${i.qty}`).join('; ');
      ws_data.push([o.orderNumber || '', o.customerName || '', itemsSummary, (o.total||0).toFixed(2), o.status || '', new Date(o.date).toLocaleString()]);
    });
    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Orders Report");
    const wb_out = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });

    await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers['x-username'] || 'Unknown', `Generated Orders XLSX: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);
  } catch (err) {
    console.error('orders report error', err);
    return res.status(500).json({ message:'Report generation failed' });
  }
});

app.get('/api/orders/report/pdf', async (req, res) => {
  try {
    const orders = await Order.find({}).sort({ date: -1 }).lean();
    // For PDF: if query id provided, produce single order invoice; otherwise produce consolidated orders report
    if (req.query.id) {
      const ord = await Order.findById(req.query.id).lean();
      if (!ord) return res.status(404).json({ message: 'Order not found' });
      const companyInfo = { name: 'L&B Company', address: 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', phone: '01133127622', email: 'lbcompany@gmail.com' };
      const docMeta = { reference: ord.orderNumber || '', dateString: new Date(ord.date).toLocaleString(), status: ord.status || '' };
      const customer = { name: ord.customerName || '' };
      const itemsForPdf = (ord.items || []).map(i => ({ name: i.name, sku: i.sku, qty: i.qty, price: i.price }));
      const totals = { subtotal: ord.total || itemsForPdf.reduce((s,i)=> s + (i.qty*i.price), 0), tax: 0, grandTotal: ord.total || 0 };
      const buffer = await generateInvoicePDFBuffer({ title: 'Order Invoice', companyInfo, docMeta, customer, items: itemsForPdf, totals, extraNotes: 'Thank you for your order.' });

      const filename = `${ord.orderNumber || 'Order'}_Invoice.pdf`;
      await Doc.create({ name: filename, size: buffer.length, date: new Date() });
      await logActivity(req.headers['x-username'] || 'Unknown', `Generated Order PDF: ${filename}`);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buffer);
    } else {
      // consolidated orders report as PDF (list)
      // convert orders into items rows (each order as a row)
      const itemsForPdf = [];
      orders.forEach(o => {
        itemsForPdf.push({ name: `Order: ${o.orderNumber}`, sku: '', qty: '', price: o.total || 0 });
        (o.items || []).forEach(it => itemsForPdf.push({ name: `  ${it.name} (x${it.qty})`, sku: it.sku || '', qty: it.qty, price: it.price || 0 }));
        itemsForPdf.push({ name: '', sku: '', qty: '', price: 0 }); // spacer
      });

      const companyInfo = { name: 'L&B Company', address: 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', phone: '01133127622', email: 'lbcompany@gmail.com' };
      const docMeta = { reference: `ORD-REPORT-${Date.now()}`, dateString: new Date().toLocaleString(), status: 'Orders Report' };
      const buffer = await generateInvoicePDFBuffer({ title: 'Orders Report', companyInfo, docMeta, customer: { name: 'All Orders' }, items: itemsForPdf, totals: { subtotal: 0, tax: 0, grandTotal: 0 }, extraNotes: 'Consolidated orders report' });

      const filename = `Orders_Report_${new Date().toISOString().slice(0,10)}.pdf`;
      await Doc.create({ name: filename, size: buffer.length, date: new Date() });
      await logActivity(req.headers['x-username'] || 'Unknown', `Generated Orders PDF: ${filename}`);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buffer);
    }
  } catch (err) {
    console.error('orders pdf error', err);
    return res.status(500).json({ message: 'PDF generation failed' });
  }
});

// ===== Sales XLSX & PDF endpoints =====
app.get('/api/sales/report', async (req, res) => {
  try {
    const rows = await Sale.find({}).lean();
    const filenameBase = `Sales_Report_${new Date().toISOString().slice(0,10)}`;
    const filename = `${filenameBase}.xlsx`;
    const ws_data = [
      ["L&B Company - Sales Report"],
      ["Date:", new Date().toISOString().slice(0,10)],
      [],
      ["Invoice","Product","SKU","Qty","Total","Date"]
    ];
    rows.forEach(r => {
      ws_data.push([r.invoice || '', r.product || '', r.sku || '', r.quantity || 0, (r.total||0).toFixed(2), new Date(r.date).toLocaleString()]);
    });
    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Sales Report");
    const wb_out = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });

    await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers['x-username'] || 'Unknown', `Generated Sales XLSX: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);
  } catch (err) {
    console.error('sales report error', err);
    return res.status(500).json({ message:'Report generation failed' });
  }
});

app.get('/api/sales/report/pdf', async (req, res) => {
  try {
    const qid = req.query.id;
    if (qid) {
      const sale = await Sale.findById(qid).lean();
      if (!sale) return res.status(404).json({ message: 'Sale not found' });
      const companyInfo = { name: 'L&B Company', address: 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', phone: '01133127622', email: 'lbcompany@gmail.com' };
      const docMeta = { reference: sale.invoice || '', dateString: new Date(sale.date).toLocaleString(), status: 'Sale' };
      const customer = { name: sale.product || '' };
      const itemsForPdf = [{ name: sale.product || '', sku: sale.sku || '', qty: sale.quantity || 1, price: sale.total || 0 }];
      const totals = { subtotal: sale.total || 0, tax: 0, grandTotal: sale.total || 0 };
      const buffer = await generateInvoicePDFBuffer({ title: 'Sales Invoice', companyInfo, docMeta, customer, items: itemsForPdf, totals, extraNotes: 'Thank you for your purchase.' });

      const filename = `${sale.invoice || 'Sale'}_Invoice.pdf`;
      await Doc.create({ name: filename, size: buffer.length, date: new Date() });
      await logActivity(req.headers['x-username'] || 'Unknown', `Generated Sales PDF: ${filename}`);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buffer);
    } else {
      // consolidated sales PDF
      const rows = await Sale.find({}).lean();
      const itemsForPdf = rows.map(r => ({ name: `${r.product} (${r.invoice})`, sku: r.sku || '', qty: r.quantity || 0, price: r.total || 0 }));
      const companyInfo = { name: 'L&B Company', address: 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', phone: '01133127622', email: 'lbcompany@gmail.com' };
      const docMeta = { reference: `SALES-REPORT-${Date.now()}`, dateString: new Date().toLocaleString(), status: 'Sales Report' };
      const buffer = await generateInvoicePDFBuffer({ title: 'Sales Report', companyInfo, docMeta, customer: { name: 'All Sales' }, items: itemsForPdf, totals: {}, extraNotes: 'Consolidated sales report' });

      const filename = `Sales_Report_${new Date().toISOString().slice(0,10)}.pdf`;
      await Doc.create({ name: filename, size: buffer.length, date: new Date() });
      await logActivity(req.headers['x-username'] || 'Unknown', `Generated Sales PDF: ${filename}`);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buffer);
    }
  } catch (err) {
    console.error('sales pdf error', err);
    return res.status(500).json({ message: 'PDF generation failed' });
  }
});

// ===== ZIP: Bundle latest reports into a zip and return =====
app.get('/api/reports/zip', async (req, res) => {
  try {
    // We'll generate current XLSX + PDF in memory then zip them
    // 1) Inventory XLSX
    const inventory = await Inventory.find({}).lean();
    const invWsData = [
      ["L&B Company - Inventory Report"],
      ["Date:", new Date().toISOString().slice(0,10)],
      [],
      ["SKU","Name","Category","Quantity","Unit Cost","Unit Price","Total Inventory Value","Total Potential Revenue"]
    ];
    inventory.forEach(it => {
      const qty = Number(it.quantity || 0);
      const uc = Number(it.unitCost || 0);
      const up = Number(it.unitPrice || 0);
      const invVal = qty * uc;
      const rev = qty * up;
      invWsData.push([it.sku||'', it.name||'', it.category||'', qty, uc.toFixed(2), up.toFixed(2), invVal.toFixed(2), rev.toFixed(2)]);
    });
    const invWs = xlsx.utils.aoa_to_sheet(invWsData);
    const invWb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(invWb, invWs, "Inventory Report");
    const invBuf = xlsx.write(invWb, { type:'buffer', bookType:'xlsx' });

    // 2) Orders XLSX
    const orders = await Order.find({}).lean();
    const ordWsData = [["L&B Company - Orders Report"], ["Date:", new Date().toISOString().slice(0,10)], [], ["Order #","Customer","Items","Total","Status","Date"]];
    orders.forEach(o => ordWsData.push([o.orderNumber||'', o.customerName||'', (o.items||[]).map(i=>`${i.name}x${i.qty}`).join('; '), (o.total||0).toFixed(2), o.status||'', new Date(o.date).toLocaleString()]));
    const ordWs = xlsx.utils.aoa_to_sheet(ordWsData);
    const ordWb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(ordWb, ordWs, "Orders Report");
    const ordBuf = xlsx.write(ordWb, { type:'buffer', bookType:'xlsx' });

    // 3) Sales XLSX
    const sales = await Sale.find({}).lean();
    const salWsData = [["L&B Company - Sales Report"], ["Date:", new Date().toISOString().slice(0,10)], [], ["Invoice","Product","SKU","Qty","Total","Date"]];
    sales.forEach(s => salWsData.push([s.invoice||'', s.product||'', s.sku||'', s.quantity||0, (s.total||0).toFixed(2), new Date(s.date).toLocaleString()]));
    const salWs = xlsx.utils.aoa_to_sheet(salWsData);
    const salWb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(salWb, salWs, "Sales Report");
    const salBuf = xlsx.write(salWb, { type:'buffer', bookType:'xlsx' });

    // 4) Inventory PDF
    const invPdfBuf = await generateInvoicePDFBuffer({
      title: 'Inventory Report',
      companyInfo: { name: 'L&B Company', address: 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', phone: '01133127622', email: 'lbcompany@gmail.com' },
      docMeta: { reference: `INV-REPORT-${Date.now()}`, dateString: new Date().toLocaleString(), status: 'Report' },
      customer: { name: 'Inventory' },
      items: inventory.map(it => ({ name: it.name, sku: it.sku, qty: it.quantity, price: it.unitPrice })),
      totals: {}
    });

    // 5) Orders PDF (consolidated)
    const ordPdfBuf = await generateInvoicePDFBuffer({
      title: 'Orders Report',
      companyInfo: { name: 'L&B Company', address: 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', phone: '01133127622', email: 'lbcompany@gmail.com' },
      docMeta: { reference: `ORD-REPORT-${Date.now()}`, dateString: new Date().toLocaleString(), status: 'Report' },
      customer: { name: 'Orders' },
      items: orders.flatMap(o => [{ name: `Order: ${o.orderNumber}`, sku:'', qty: '', price: o.total || 0 }].concat((o.items||[]).map(it=> ({ name: `${it.name} x${it.qty}`, sku: it.sku || '', qty: it.qty || 0, price: it.price || 0 }))))
    });

    // 6) Sales PDF (consolidated)
    const salPdfBuf = await generateInvoicePDFBuffer({
      title: 'Sales Report',
      companyInfo: { name: 'L&B Company', address: 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', phone: '01133127622', email: 'lbcompany@gmail.com' },
      docMeta: { reference: `SALES-REPORT-${Date.now()}`, dateString: new Date().toLocaleString(), status: 'Report' },
      customer: { name: 'Sales' },
      items: sales.map(s => ({ name: `${s.product} (${s.invoice})`, sku: s.sku || '', qty: s.quantity || 0, price: s.total || 0 }))
    });

    // Create zip in-memory
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="All_Reports_${new Date().toISOString().slice(0,10)}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);

    archive.append(invBuf, { name: `Inventory_Report_${new Date().toISOString().slice(0,10)}.xlsx` });
    archive.append(ordBuf, { name: `Orders_Report_${new Date().toISOString().slice(0,10)}.xlsx` });
    archive.append(salBuf, { name: `Sales_Report_${new Date().toISOString().slice(0,10)}.xlsx` });

    archive.append(invPdfBuf, { name: `Inventory_Report_${new Date().toISOString().slice(0,10)}.pdf` });
    archive.append(ordPdfBuf, { name: `Orders_Report_${new Date().toISOString().slice(0,10)}.pdf` });
    archive.append(salPdfBuf, { name: `Sales_Report_${new Date().toISOString().slice(0,10)}.pdf` });

    await archive.finalize();

    // Note: docs metadata for zip contents already created above for each saved single report (if desired you'll persist them before zipping)
    await logActivity(req.headers['x-username'] || 'Unknown', 'Downloaded ZIP of all reports');
  } catch (err) {
    console.error('zip error', err);
    return res.status(500).json({ message: 'Failed to create zip' });
  }
});

// ===== Documents endpoints (unchanged) =====
app.get('/api/documents', async (req, res) => {
  try {
    const docs = await Doc.find({}).sort({ date: -1 }).lean();
    const normalized = docs.map(d => ({ ...d, id: d._id.toString() }));
    return res.json(normalized);
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/documents', async (req, res) => {
  try {
    const doc = await Doc.create({ ...req.body, date: new Date() });
    await logActivity(req.headers['x-username'] || 'Unknown', `Uploaded document metadata: ${doc.name}`);
    const normalized = { ...doc.toObject(), id: doc._id.toString() };
    return res.status(201).json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const doc = await Doc.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    await logActivity(req.headers['x-username'] || 'Unknown', `Deleted document metadata: ${doc.name}`);
    return res.status(204).send();
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.get('/api/documents/download/:filename', async (req, res) => {
  const filename = req.params.filename || '';
  if (filename.startsWith('Inventory_Report')) {
    return res.redirect('/api/inventory/report');
  }
  if (filename.startsWith('Orders_Report')) {
    return res.redirect('/api/orders/report');
  }
  if (filename.startsWith('Sales_Report')) {
    return res.redirect('/api/sales/report');
  }
  return res.status(404).json({ message: "File not found or download unavailable on this mock server." });
});

// ===== Logs =====
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(500).lean();
    const formatted = logs.map(l => ({ user: l.user, action: l.action, time: l.time ? new Date(l.time).toISOString() : new Date().toISOString() }));
    return res.json(formatted);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// ===== Serve frontend =====
app.use(express.static(path.join(__dirname, '../public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message:'API route not found' });
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ===== Startup helpers: create default admin if none, single system start log =====
async function ensureDefaultAdminAndStartupLog() {
  try {
    const count = await User.countDocuments({}).exec();
    if (count === 0) {
      await User.create({ username: 'admin', password: 'password' });
      await logActivity('System', 'Default admin user created.');
      console.log('Default admin user created.');
    }
    // Write a single "server live" message (logActivity suppresses near-duplicates)
    await logActivity('System', `Server is live and listening on port ${PORT}`);
  } catch (err) {
    console.error('Startup helper error:', err);
  }
}

// ===== Start =====
(async () => {
  await ensureDefaultAdminAndStartupLog();
  console.log(`Starting server (no DB startup log written to ActivityLog)`);
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
})();
