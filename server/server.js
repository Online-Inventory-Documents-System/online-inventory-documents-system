// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ================= MONGODB CONNECTION =================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://leongjiawei357:pass360@cluster0.2ykgu86.mongodb.net/?appName=Cluster0';

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('MongoDB connected'))
  .catch(err=> console.error('MongoDB connection error:', err));

// ================= MIDDLEWARE =================
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================= MODELS =================
const userSchema = new mongoose.Schema({
  username: { type: String, required:true, unique:true },
  passwordHash: { type:String, required:true }
});
const User = mongoose.model('User', userSchema);

const inventorySchema = new mongoose.Schema({
  sku: String,
  name: String,
  category: String,
  quantity: Number,
  unitCost: Number,
  unitPrice: Number
});
const Inventory = mongoose.model('Inventory', inventorySchema);

const documentSchema = new mongoose.Schema({
  name: String,
  type: String,
  sizeBytes: Number,
  date: { type: Date, default: Date.now }
});
const Document = mongoose.model('Document', documentSchema);

const logSchema = new mongoose.Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
});
const Log = mongoose.model('Log', logSchema);

// ================= HELPERS =================
async function logActivity(user, action){
  const log = new Log({ user, action });
  await log.save();
}

// ================= ROUTES =================

// Health check
app.get('/api/_health', async (req,res)=>{
  const state = mongoose.connection.readyState;
  res.json({ success:true, time:new Date(), mongoose_state: state });
});

// LOGIN
app.post('/api/login', async (req,res)=>{
  try{
    const { username, password } = req.body;
    if(!username || !password) return res.status(400).json({ message:'Missing credentials' });
    const user = await User.findOne({ username });
    if(!user) return res.status(401).json({ message:'Invalid username or password' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if(!ok) return res.status(401).json({ message:'Invalid username or password' });
    await logActivity(username, 'Logged in');
    res.json({ message:'Login success', user: username });
  } catch(e){
    console.error(e);
    res.status(500).json({ message:'Internal server error' });
  }
});

// REGISTER
app.post('/api/register', async (req,res)=>{
  try{
    const { username, password, securityCode } = req.body;
    if(securityCode !== (process.env.SECURITY_CODE || '1234')) 
      return res.status(403).json({ message:'Invalid security code' });

    if(!username || !password) return res.status(400).json({ message:'Missing fields' });
    const exists = await User.findOne({ username });
    if(exists) return res.status(409).json({ message:'Username exists' });

    const hash = await bcrypt.hash(password,10);
    await User.create({ username, passwordHash: hash });
    await logActivity('System', `Registered new user: ${username}`);
    res.json({ message:'Registration successful' });
  } catch(e){
    console.error(e);
    res.status(500).json({ message:'Internal server error' });
  }
});

// ================= INVENTORY =================
app.get('/api/inventory', async (req,res)=>{
  try{
    const items = await Inventory.find({});
    res.json(items);
  } catch(e){ res.status(500).json({ message:'Failed to get inventory' }); }
});

app.post('/api/inventory', async (req,res)=>{
  try{
    const newItem = req.body;
    const item = new Inventory(newItem);
    await item.save();
    await logActivity(req.headers['x-username'] || 'Admin', `Added item: ${newItem.name}`);
    res.json({ message:'Item added' });
  } catch(e){ res.status(500).json({ message:'Failed to add item' }); }
});

app.put('/api/inventory/:id', async (req,res)=>{
  try{
    const { id } = req.params;
    const updated = req.body;
    await Inventory.findByIdAndUpdate(id, updated);
    await logActivity(req.headers['x-username'] || 'Admin', `Updated item: ${updated.name}`);
    res.json({ message:'Item updated' });
  } catch(e){ res.status(500).json({ message:'Failed to update item' }); }
});

app.delete('/api/inventory/:id', async (req,res)=>{
  try{
    const { id } = req.params;
    await Inventory.findByIdAndDelete(id);
    await logActivity(req.headers['x-username'] || 'Admin', `Deleted item id: ${id}`);
    res.status(204).end();
  } catch(e){ res.status(500).json({ message:'Failed to delete item' }); }
});

// ================= DOCUMENTS =================
app.get('/api/documents', async (req,res)=>{
  try{
    const docs = await Document.find({});
    res.json(docs);
  } catch(e){ res.status(500).json({ message:'Failed to get documents' }); }
});

app.post('/api/documents', async (req,res)=>{
  try{
    const doc = new Document(req.body);
    await doc.save();
    await logActivity(req.headers['x-username'] || 'Admin', `Added document: ${doc.name}`);
    res.json({ message:'Document added' });
  } catch(e){ res.status(500).json({ message:'Failed to add document' }); }
});

app.delete('/api/documents/:id', async (req,res)=>{
  try{
    const { id } = req.params;
    await Document.findByIdAndDelete(id);
    await logActivity(req.headers['x-username'] || 'Admin', `Deleted document id: ${id}`);
    res.status(204).end();
  } catch(e){ res.status(500).json({ message:'Failed to delete document' }); }
});

// ================= LOGS =================
app.get('/api/logs', async (req,res)=>{
  try{
    const logs = await Log.find({}).sort({ time: -1 });
    res.json(logs);
  } catch(e){ res.status(500).json({ message:'Failed to get logs' }); }
});

// ================= SETTINGS =================
app.put('/api/account/password', async (req,res)=>{
  try{
    const { username, newPassword, securityCode } = req.body;
    if(securityCode !== (process.env.SECURITY_CODE || '1234')) 
      return res.status(403).json({ message:'Invalid security code' });

    const hash = await bcrypt.hash(newPassword,10);
    await User.findOneAndUpdate({ username }, { passwordHash: hash });
    await logActivity(username, 'Changed password');
    res.json({ message:'Password updated' });
  } catch(e){ res.status(500).json({ message:'Failed to change password' }); }
});

app.delete('/api/account', async (req,res)=>{
  try{
    const { username, securityCode } = req.body;
    if(securityCode !== (process.env.SECURITY_CODE || '1234')) 
      return res.status(403).json({ message:'Invalid security code' });
    await User.findOneAndDelete({ username });
    await logActivity('System', `Deleted account: ${username}`);
    res.json({ message:'Account deleted' });
  } catch(e){ res.status(500).json({ message:'Failed to delete account' }); }
});

// ================= START SERVER =================
app.listen(PORT, ()=> console.log(`Server running on port ${PORT}`));
