//-----------------------------------------------
// FULL SERVER.JS (FINAL VERSION)
// Multi-Item Orders + PDF + Users + Inventory
//-----------------------------------------------

require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const PDFDocument = require("pdfkit");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const JWT_SECRET = "INVENTORY_2024_SECRET";

//-----------------------------------------------
// CONNECT MONGODB
//-----------------------------------------------
mongoose
  .connect(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log("MongoDB error:", err));


//-----------------------------------------------
// MONGOOSE MODELS
//-----------------------------------------------

// USERS
const UserSchema = new mongoose.Schema({
  username: String,
  password: String,
  role: { type: String, default: "user" } // admin | user
});
const User = mongoose.model("User", UserSchema);

// INVENTORY
const InventorySchema = new mongoose.Schema({
  name: String,
  sku: String,
  cost: Number,
  price: Number,
  quantity: Number,
  createdAt: { type: Date, default: Date.now }
});
const Inventory = mongoose.model("Inventory", InventorySchema);

// STOCK MOVEMENTS
const StockMovementSchema = new mongoose.Schema({
  sku: String,
  type: String, // IN | OUT
  quantity: Number,
  date: { type: Date, default: Date.now },
  user: String,
  note: String
});
const StockMovement = mongoose.model("StockMovement", StockMovementSchema);

// MULTI-ITEM ORDERS
const OrderSchema = new mongoose.Schema({
  orderNumber: String,
  customerName: String,
  status: String,
  date: { type: Date, default: Date.now },
  items: [
    {
      product: String,
      sku: String,
      qty: Number,
      price: Number,
      total: Number
    }
  ],
  grandTotal: Number
});
const Order = mongoose.model("Order", OrderSchema);

// SALES
const SalesSchema = new mongoose.Schema({
  invoiceNumber: String,
  date: { type: Date, default: Date.now },
  items: Array,
  total: Number,
  customer: String
});
const Sale = mongoose.model("Sale", SalesSchema);

// DOCUMENTS
const DocumentSchema = new mongoose.Schema({
  title: String,
  url: String,
  uploadedAt: { type: Date, default: Date.now }
});
const Document = mongoose.model("Document", DocumentSchema);

// COMPANY
const CompanySchema = new mongoose.Schema({
  name: String,
  address: String,
  phone: String,
  email: String
});
const Company = mongoose.model("Company", CompanySchema);


//-----------------------------------------------
// AUTH MIDDLEWARE
//-----------------------------------------------
function auth(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(403).json({ error: "No token" });

  try {
    req.user = jwt.verify(token.split(" ")[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function admin(req, res, next) {
  if (req.user.role !== "admin")
    return res.status(401).json({ error: "Admin only" });
  next();
}


//-----------------------------------------------
// USER AUTH
//-----------------------------------------------

// LOGIN
app.post("/api/login", async (req, res) => {
  let user = await User.findOne({ username: req.body.username, password: req.body.password });
  if (!user) return res.json({ success: false });

  const token = jwt.sign(
    { username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ success: true, token, role: user.role });
});

// CREATE USER (admin only)
app.post("/api/users", auth, admin, async (req, res) => {
  const u = new User(req.body);
  await u.save();
  res.json({ success: true });
});

// GET USERS (admin)
app.get("/api/users", auth, admin, async (req, res) => {
  res.json(await User.find());
});


//-----------------------------------------------
// INVENTORY
//-----------------------------------------------

// GET ALL
app.get("/api/inventory", auth, async (req, res) => {
  res.json(await Inventory.find());
});

// ADD
app.post("/api/inventory", auth, admin, async (req, res) => {
  const item = new Inventory(req.body);
  await item.save();
  res.json({ success: true });
});

// EDIT
app.put("/api/inventory/:id", auth, admin, async (req, res) => {
  await Inventory.findByIdAndUpdate(req.params.id, req.body);
  res.json({ success: true });
});

// DELETE
app.delete("/api/inventory/:id", auth, admin, async (req, res) => {
  await Inventory.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});


//-----------------------------------------------
// STOCK MOVEMENTS
//-----------------------------------------------

app.post("/api/stock", auth, async (req, res) => {
  const { sku, type, quantity, user, note } = req.body;

  const product = await Inventory.findOne({ sku });
  if (!product) return res.json({ error: "Invalid SKU" });

  if (type === "IN") {
    product.quantity += quantity;
  } else if (type === "OUT") {
    if (product.quantity < quantity)
      return res.json({ error: "Insufficient stock" });
    product.quantity -= quantity;
  }

  await product.save();

  const log = new StockMovement(req.body);
  await log.save();

  res.json({ success: true });
});

// GET LOGS
app.get("/api/stock", auth, async (req, res) => {
  res.json(await StockMovement.find());
});


//-----------------------------------------------
// MULTI-ITEM ORDERS
//-----------------------------------------------

// CREATE ORDER
app.post("/api/orders", auth, async (req, res) => {
  const order = new Order(req.body);
  await order.save();
  res.json({ success: true });
});

// GET ALL
app.get("/api/orders", auth, async (req, res) => {
  res.json(await Order.find());
});

// DELETE ORDER
app.delete("/api/orders/:id", auth, admin, async (req, res) => {
  await Order.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});


//-----------------------------------------------
// PDF INVOICE GENERATOR
//-----------------------------------------------

app.get("/api/orders/:id/pdf", auth, async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.send("Not found");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=invoice-${order.orderNumber}.pdf`);

  const doc = new PDFDocument({ margin: 30 });
  doc.pipe(res);

  //--------------------------------------------------
  // HEADER (Two Columns)
  //--------------------------------------------------
  doc.fontSize(16).text("L&B COMPANY", { align: "left" });
  doc.fontSize(10).text("Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka");
  doc.text("Phone: 01133127622");
  doc.text("Email: lbcompany@gmail.com");

  doc.text("", 300); // move right column
  doc.fontSize(16).text("INVOICE SUMMARY", 300, 30);
  doc.fontSize(10).text(`Order #: ${order.orderNumber}`, 300);
  doc.text(`Date: ${new Date(order.date).toLocaleString()}`, 300);
  doc.text(`Status: ${order.status}`, 300);

  doc.moveDown(2);

  //--------------------------------------------------
  // CUSTOMER INFO
  //--------------------------------------------------
  doc.fontSize(14).text("Bill To:");
  doc.fontSize(12).text(`Customer Name: ${order.customerName}`);
  doc.moveDown();

  //--------------------------------------------------
  // ITEMS TABLE
  //--------------------------------------------------
  doc.fontSize(12);
  doc.text("Item", 30);
  doc.text("SKU", 200);
  doc.text("Qty", 300);
  doc.text("Unit Price", 350);
  doc.text("Total", 450);
  doc.moveDown();

  order.items.forEach(it => {
    doc.text(it.product, 30);
    doc.text(it.sku, 200);
    doc.text(it.qty, 300);
    doc.text(it.price.toFixed(2), 350);
    doc.text(it.total.toFixed(2), 450);
    doc.moveDown();
  });

  //--------------------------------------------------
  // TOTALS
  //--------------------------------------------------
  doc.moveDown();
  doc.fontSize(14).text(`Grand Total: RM ${order.grandTotal.toFixed(2)}`, { align: "right" });

  //--------------------------------------------------
  // FOOTER
  //--------------------------------------------------
  doc.moveDown(2);
  doc.fontSize(10).text("Thank you for your business.");
  doc.text("Generated by L&B Inventory System");

  doc.end();
});


//-----------------------------------------------
// SALES
//-----------------------------------------------
app.post("/api/sales", auth, async (req, res) => {
  const sale = new Sale(req.body);
  await sale.save();
  res.json({ success: true });
});

app.get("/api/sales", auth, async (req, res) => {
  res.json(await Sale.find());
});


//-----------------------------------------------
// DOCUMENTS
//-----------------------------------------------
app.post("/api/documents", auth, admin, async (req, res) => {
  const doc = new Document(req.body);
  await doc.save();
  res.json({ success: true });
});

app.get("/api/documents", auth, async (req, res) => {
  res.json(await Document.find());
});


//-----------------------------------------------
// COMPANY INFO
//-----------------------------------------------
app.get("/api/company", async (req, res) => {
  const c = await Company.findOne();
  res.json(c);
});

app.post("/api/company", auth, admin, async (req, res) => {
  await Company.deleteMany({});
  const c = new Company(req.body);
  await c.save();
  res.json({ success: true });
});


//-----------------------------------------------
// START SERVER
//-----------------------------------------------
app.listen(5000, () => console.log("SERVER RUNNING ON PORT 5000"));
