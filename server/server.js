// server/server.js
// Final server using MongoDB (Mongoose), bcrypt, compression, CORS.
// Serves ../public static files and the API used by the frontend.

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const xlsx = require('xlsx');
const path = require('path');
const bcrypt = require('bcryptjs');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || '1234';

// Sanity: require MONGODB_URI
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Set it as environment variable before starting.');
  process.exit(1);
}

// Middleware
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS allowlist - add GitHub Pages origin or your custom domains here
const allowedOrigins = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  // Add your GitHub Pages URL or custom frontend domain:
  'https://<your-github-username>.github.io',
  'https://<your-custom-domain>', 
  // Allow Render origin to call itself (optional)
  // 'https://online-inventory-documents-system-olzt.onrender.com'
];

app.use(cors({
  origin: function(origin, callback){
    // allow requests with no origin (like curl, mobile apps, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    // fallback: allow all in development (optional), change to strict in production
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    return callback(new Error('CORS policy: Origin not allowed'));
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Username']
}));

// Mongoose connection
mongoose.set('strictQuery', false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> {
    console.log('Connected to MongoDB Atlas');
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Schemas & models
const { Schema } = mongoose;

const UserSchema = new Schema({
  username: { type: String, unique: true, required: true, index: true },
  passwordHash: { type: String, required: true },
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

// Utility: log activity
async function logActivity(user, action) {
  try {
    await ActivityLog.create({ user: user || 'Unknown', action, time: new Date() });
  } catch (err) {
    console.error('logActivity error:', err);
  }
}

// Health check
app.get('/api/test', (req, res) => res.json({ success: true, message: 'API is up', time: new Date().toISOString() }));

// ----------------- Auth -----------------

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, securityCode } = req.body || {};
    if (securityCode !== SECURITY_CODE) return res.status(403).json({ success:false, message: 'Invalid security code' });
    if (!username || !password) return res.status(400).json({ success:false, message: 'Missing username or password' });

    const exists = await User.findOne({ username }).lean();
    if (exists) return res.status(409).json({ success:false, message: 'Username already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({ username, passwordHash });
    await logActivity('System', `Registered new user: ${username}`);
    return res.json({ success:true, message: 'Registration successful' });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ success:false, message: 'Server error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ success:false, message: 'Missing credentials' });

    const user = await User.findOne({ username }).lean();
    if (!user) return res.status(401).json({ success:false, message: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ success:false, message: 'Invalid credentials' });

    await logActivity(username, 'Logged in');
    return res.json({ success:true, user: username });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ success:false, message: 'Server error' });
  }
});

// Change password
app.put('/api/account/password', async (req, res) => {
  try {
    const { username, newPassword, securityCode } = req.body || {};
    if (securityCode !== SECURITY_CODE) return res.status(403).json({ message: 'Invalid Admin Security Code' });
    if (!username || !newPassword) return res.status(400).json({ message: 'Missing fields' });

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();
    await logActivity(username, 'Changed account password');
    return res.json({ success:true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('change password error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Delete account
app.delete('/api/account', async (req, res) => {
  try {
    const { username, securityCode } = req.body || {};
    if (securityCode !== SECURITY_CODE) return res.status(403).json({ message: 'Invalid Admin Security Code' });
    if (!username) return res.status(400).json({ message: 'Missing username' });

    const result = await User.deleteOne({ username });
    if (result.deletedCount === 0) return res.status(404).json({ message: 'User not found' });

    await logActivity('System', `Deleted account for user: ${username}`);
    return res.json({ success:true, message: 'Account deleted successfully' });
  } catch (err) {
    console.error('delete account error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ----------------- Inventory -----------------

app.get('/api/inventory', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    return res.json(items);
  } catch (err) {
    console.error('get inventory error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    await logActivity(req.headers['x-username'], `Added product: ${item.name}`);
    return res.status(201).json(item);
  } catch (err) {
    console.error('add inventory error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const updated = await Inventory.findByIdAndUpdate(id, req.body, { new:true, runValidators:true });
    if (!updated) return res.status(404).json({ message: 'Item not found' });
    await logActivity(req.headers['x-username'], `Updated product: ${updated.name}`);
    return res.json(updated);
  } catch (err) {
    console.error('update inventory error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const deleted = await Inventory.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: 'Item not found' });
    await logActivity(req.headers['x-username'], `Deleted product: ${deleted.name}`);
    return res.status(204).send();
  } catch (err) {
    console.error('delete inventory error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Inventory report - generate XLSX, save doc record, return file
app.get('/api/inventory/report', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const nowIso = new Date().toISOString();
    const filename = `Inventory_Report_${nowIso.slice(0,10)}.xlsx`;

    const ws_data = [
      ["L&B Company - Inventory Report"],
      ["Date:", nowIso],
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
      ws_data.push([it.sku || '', it.name || '', it.category || '', qty, uc.toFixed(2), up.toFixed(2), invVal.toFixed(2), rev.toFixed(2)]);
    });

    ws_data.push([]);
    ws_data.push(["", "", "", "Totals", "", "", totalValue.toFixed(2), totalRevenue.toFixed(2)]);

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Inventory Report");
    const wb_out = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Save as document record
    await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated Inventory Report: ${filename}`);

    // Expose header for client to read (CORS)
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);
  } catch (err) {
    console.error('report generation error:', err);
    return res.status(500).json({ message: 'Report generation failed' });
  }
});

// ----------------- Documents -----------------

app.get('/api/documents', async (req, res) => {
  try {
    const docs = await Doc.find({}).sort({ date: -1 }).lean();
    // send ISO date strings
    const out = docs.map(d => ({
      id: d._id.toString(),
      name: d.name,
      size: d.size,
      date: (d.date instanceof Date) ? d.date.toISOString() : new Date(d.date).toISOString()
    }));
    return res.json(out);
  } catch (err) {
    console.error('get documents error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/documents', async (req, res) => {
  try {
    const doc = await Doc.create({ ...req.body, date: new Date() });
    await logActivity(req.headers['x-username'], `Uploaded document metadata: ${doc.name}`);
    return res.status(201).json({ id: doc._id.toString(), name: doc.name, size: doc.size, date: doc.date.toISOString() });
  } catch (err) {
    console.error('post document error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const deleted = await Doc.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Document not found' });
    await logActivity(req.headers['x-username'], `Deleted document metadata: ${deleted.name}`);
    return res.status(204).send();
  } catch (err) {
    console.error('delete document error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/documents/download/:filename', async (req, res) => {
  const filename = req.params.filename || '';
  if (filename.startsWith('Inventory_Report')) {
    return res.redirect('/api/inventory/report');
  }
  return res.status(404).json({ message: 'File not available for download on this server.' });
});

// ----------------- Logs -----------------

app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(500).lean();
    // return ISO timestamps so client can localize
    const out = logs.map(l => ({
      user: l.user,
      action: l.action,
      time: (l.time instanceof Date) ? l.time.toISOString() : new Date(l.time).toISOString()
    }));
    return res.json(out);
  } catch (err) {
    console.error('get logs error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ----------------- Serve frontend -----------------

// Serve static with caching for faster loads
app.use(express.static(path.join(__dirname, '../public'), { maxAge: '1d' }));

// Return index for other non-API routes (SPA fallback)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ message: 'API route not found' });
  }
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  logActivity('System', `Server started on port ${PORT}`);
});
