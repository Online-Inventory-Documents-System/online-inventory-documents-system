// ======================================================================
// FINAL SERVER.JS — MONGODB ATLAS VERSION (OPTION A)
// With correct Render path + dotenv path
// ======================================================================

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const PDFDocument = require("pdfkit");

const app = express();

// ----------------------------------------------------------------------
// ENVIRONMENT VARIABLES
// ----------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || "123456";

// ----------------------------------------------------------------------
// MIDDLEWARE
// ----------------------------------------------------------------------
app.use(express.json({ limit: "20mb" }));
app.use(cors());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ✅ FIXED STATIC PATH FOR YOUR FOLDER STRUCTURE
// /server/server.js → ../public
app.use("/", express.static(path.join(__dirname, "../public")));

if (!fs.existsSync(path.join(__dirname, "uploads"))) {
  fs.mkdirSync(path.join(__dirname, "uploads"));
}

// ----------------------------------------------------------------------
// MONGODB CONNECTION
// ----------------------------------------------------------------------
mongoose
  .connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB Atlas Connected"))
  .catch((err) => console.error("MongoDB Connection Error:", err));

// ----------------------------------------------------------------------
// MONGOOSE SCHEMAS AND MODELS
// ----------------------------------------------------------------------
const userSchema = new mongoose.Schema({
  username: String,
  password: String
});

const inventorySchema = new mongoose.Schema({
  sku: String,
  name: String,
  category: String,
  quantity: Number,
  unitCost: Number,
  unitPrice: Number
});

const orderSchema = new mongoose.Schema({
  orderNo: String,
  customer: String,
  contact: String,
  items: Array,
  subtotal: Number,
  total: Number,
  status: String,
  date: String
});

const saleSchema = new mongoose.Schema({
  saleNo: String,
  customer: String,
  contact: String,
  items: Array,
  subtotal: Number,
  total: Number,
  status: String,
  date: String
});

const documentSchema = new mongoose.Schema({
  filename: String,
  originalname: String,
  uploadDate: String
});

const companySchema = new mongoose.Schema({
  name: String,
  address: String,
  phone: String,
  email: String,
  tax: String
});

const logSchema = new mongoose.Schema({
  user: String,
  action: String,
  time: String
});

const User = mongoose.model("User", userSchema);
const Inventory = mongoose.model("Inventory", inventorySchema);
const Order = mongoose.model("Order", orderSchema);
const Sale = mongoose.model("Sale", saleSchema);
const DocumentFile = mongoose.model("Document", documentSchema);
const Company = mongoose.model("Company", companySchema);
const Log = mongoose.model("Log", logSchema);

// ----------------------------------------------------------------------
// MULTER — File Uploads
// ----------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "uploads")),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 99999);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// ======================================================================
// AUTHENTICATION
// ======================================================================
app.post("/api/auth/login", async (req, res) => {
  const found = await User.findOne({
    username: req.body.username,
    password: req.body.password
  });

  if (!found) return res.json({ success: false, message: "Invalid login" });
  res.json({ success: true });
});

app.post("/api/auth/register", async (req, res) => {
  if (req.body.code !== SECURITY_CODE)
    return res.json({ success: false, message: "Security code incorrect" });

  const exists = await User.findOne({ username: req.body.username });
  if (exists) return res.json({ success: false, message: "User exists" });

  await User.create({ username: req.body.username, password: req.body.password });
  res.json({ success: true });
});

// ======================================================================
// INVENTORY CRUD
// ======================================================================
app.get("/api/inventory", async (req, res) => {
  res.json(await Inventory.find());
});

app.post("/api/inventory", async (req, res) => {
  res.json(await Inventory.create(req.body));
});

app.put("/api/inventory/:id", async (req, res) => {
  await Inventory.findByIdAndUpdate(req.params.id, req.body);
  res.json({ success: true });
});

app.delete("/api/inventory/:id", async (req, res) => {
  await Inventory.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ======================================================================
// ORDERS CRUD
// ======================================================================
app.get("/api/orders", async (req, res) => {
  res.json(await Order.find());
});

app.post("/api/orders", async (req, res) => {
  const count = await Order.countDocuments();
  const orderNo = "ORD-" + (100000 + count);
  res.json(await Order.create({ ...req.body, orderNo }));
});

app.put("/api/orders/:id", async (req, res) => {
  await Order.findByIdAndUpdate(req.params.id, req.body);
  res.json({ success: true });
});

app.delete("/api/orders/:id", async (req, res) => {
  await Order.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ======================================================================
// SALES CRUD
// ======================================================================
app.get("/api/sales", async (req, res) => {
  res.json(await Sale.find());
});

app.post("/api/sales", async (req, res) => {
  const count = await Sale.countDocuments();
  const saleNo = "SAL-" + (100000 + count);
  res.json(await Sale.create({ ...req.body, saleNo }));
});

app.put("/api/sales/:id", async (req, res) => {
  await Sale.findByIdAndUpdate(req.params.id, req.body);
  res.json({ success: true });
});

app.delete("/api/sales/:id", async (req, res) => {
  await Sale.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ======================================================================
// DOCUMENTS
// ======================================================================
app.get("/api/documents", async (req, res) => {
  res.json(await DocumentFile.find());
});

app.post("/api/documents", upload.single("file"), async (req, res) => {
  res.json(
    await DocumentFile.create({
      filename: req.file.filename,
      originalname: req.file.originalname,
      uploadDate: new Date().toISOString()
    })
  );
});

app.delete("/api/documents/:id", async (req, res) => {
  const doc = await DocumentFile.findById(req.params.id);
  if (doc) {
    const pathFile = path.join(__dirname, "uploads", doc.filename);
    if (fs.existsSync(pathFile)) fs.unlinkSync(pathFile);
  }
  await DocumentFile.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ======================================================================
// COMPANY
// ======================================================================
app.get("/api/company", async (req, res) => {
  res.json((await Company.findOne()) || {});
});

app.post("/api/company", async (req, res) => {
  await Company.deleteMany({});
  await Company.create(req.body);
  res.json({ success: true });
});

// ======================================================================
// LOGS
// ======================================================================
app.get("/api/logs", async (req, res) => {
  res.json(await Log.find());
});

app.post("/api/logs", async (req, res) => {
  await Log.create(req.body);
  res.json({ success: true });
});

// ======================================================================
// PDF HELPERS
// ======================================================================
function pdfHeader(doc, company, title, meta) {
  doc.fontSize(16).text(company.name || "L&B Company");
  doc.fontSize(10).text(company.address || "");
  doc.text(company.phone || "");
  doc.text(company.email || "");
  doc.moveDown();
  doc.fontSize(16).text(title, { align: "right" });
  doc.fontSize(10).text(`No: ${meta.no}`, { align: "right" });
  doc.text(`Date: ${meta.date}`, { align: "right" });
  doc.text(`Status: ${meta.status}`, { align: "right" });
}

function pdfTable(doc) {
  doc.moveDown();
  doc.fontSize(12).text("Items", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10);
  doc.text("Item", 50);
  doc.text("SKU", 200);
  doc.text("Qty", 300);
  doc.text("Unit Price", 350);
  doc.text("Total", 450);
  doc.moveDown();
}

// ======================================================================
// PDF ROUTES
// ======================================================================
app.get("/api/report/inventory/pdf", async (req, res) => {
  const inventory = await Inventory.find();
  const company = (await Company.findOne()) || {};
  const doc = new PDFDocument({ margin: 40 });

  res.setHeader("Content-Type", "application/pdf");
  doc.pipe(res);

  pdfHeader(doc, company, "INVENTORY REPORT", {
    no: "INV-REPORT",
    date: new Date().toLocaleString(),
    status: "Generated"
  });

  pdfTable(doc);

  inventory.forEach((i) => {
    doc.text(i.name, 50);
    doc.text(i.sku, 200);
    doc.text(i.quantity, 300);
    doc.text(i.unitPrice, 350);
    doc.text(i.quantity * i.unitPrice, 450);
    doc.moveDown();
  });

  doc.end();
});

app.get("/api/report/order/:id/pdf", async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.sendStatus(404);
  const company = (await Company.findOne()) || {};
  const doc = new PDFDocument({ margin: 40 });

  res.setHeader("Content-Type", "application/pdf");
  doc.pipe(res);

  pdfHeader(doc, company, "ORDER SUMMARY", {
    no: order.orderNo,
    date: new Date(order.date).toLocaleString(),
    status: order.status
  });

  pdfTable(doc);

  order.items.forEach((i) => {
    doc.text(i.name, 50);
    doc.text(i.sku, 200);
    doc.text(i.qty, 300);
    doc.text(i.price, 350);
    doc.text(i.qty * i.price, 450);
    doc.moveDown();
  });

  doc.text(`Subtotal: RM ${order.subtotal}`);
  doc.text(`Total: RM ${order.total}`);

  doc.end();
});

app.get("/api/report/sale/:id/pdf", async (req, res) => {
  const sale = await Sale.findById(req.params.id);
  if (!sale) return res.sendStatus(404);
  const company = (await Company.findOne()) || {};
  const doc = new PDFDocument({ margin: 40 });

  res.setHeader("Content-Type", "application/pdf");
  doc.pipe(res);

  pdfHeader(doc, company, "SALES SUMMARY", {
    no: sale.saleNo,
    date: new Date(sale.date).toLocaleString(),
    status: sale.status
  });

  pdfTable(doc);

  sale.items.forEach((i) => {
    doc.text(i.name, 50);
    doc.text(i.sku, 200);
    doc.text(i.qty, 300);
    doc.text(i.price, 350);
    doc.text(i.qty * i.price, 450);
    doc.moveDown();
  });

  doc.text(`Subtotal: RM ${sale.subtotal}`);
  doc.text(`Total: RM ${sale.total}`);

  doc.end();
});

// ======================================================================
// START SERVER
// ======================================================================
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
