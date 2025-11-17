// server/server.js
// MongoDB (Mongoose) based server for Online Inventory & Documents Management System

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');   // PDF generator

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || "1234";

// ===== Middleware =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CRITICAL FIX 1: Specialized middleware for handling raw file uploads
// This is essential for receiving the binary data of any file type.
const rawBodyMiddleware = express.raw({
  type: '*/*', // Accept all content types
  limit: '50mb' // Set a reasonable limit for file size (50MB)
});

// ===== MongoDB Connection =====
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set.");
  process.exit(1);
}

mongoose.set("strictQuery", false);
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("Connected to MongoDB Atlas"))
.catch(err => {
  console.error("MongoDB connect error:", err);
  process.exit(1);
});

const { Schema } = mongoose;

// ===== Schemas =====
const UserSchema = new Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", UserSchema);

const InventorySchema = new Schema({
  sku: String,
  name: String,
  category: String,
  quantity: { type: Number, default: 0 },
  unitCost: { type: Number, default: 0 },
  unitPrice: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Inventory = mongoose.model("Inventory", InventorySchema);

const DocumentSchema = new Schema({
  name: String,
  size: Number,
  date: { type: Date, default: Date.now },
  // CRITICAL FIX 2: Fields to store file content for ALL file types
  data: Buffer,       // Stores the file content as a Buffer
  contentType: String // Stores the file's MIME type (e.g., 'image/jpeg', 'application/zip')
});
const Doc = mongoose.model("Doc", DocumentSchema);

const LogSchema = new Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model("ActivityLog", LogSchema);

// ===== Duplicate Log Protection (omitted for brevity) =====

async function logActivity(user, action) {
  const DUPLICATE_WINDOW_MS = 30 * 1000;
  try {
    const safeUser = (user || "Unknown").toString();
    const safeAction = (action || "").toString();
    const now = Date.now();
    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean().exec();
    if (last && last.user === safeUser && last.action === safeAction && now - new Date(last.time).getTime() <= DUPLICATE_WINDOW_MS) return;
    await ActivityLog.create({ user: safeUser, action: safeAction, time: new Date() });
  } catch (err) {
    console.error("logActivity error:", err);
  }
}

// ===== API Routes (omitted non-document routes for brevity) =====

// ============================================================================
//                       DOCUMENTS UPLOAD (FIXED FOR ALL FILES)
// ============================================================================
// Apply the raw body parser middleware only to this route
app.post("/api/documents", rawBodyMiddleware, async (req, res) => {
  // req.body now contains the raw file buffer
  const fileBuffer = req.body;
  
  // Get metadata from request headers (set by the updated script.js)
  const contentType = req.headers['content-type']; 
  const fileName = req.headers['x-file-name'];     
  const username = req.headers["x-username"];

  if (!fileBuffer || !fileBuffer.length || !contentType || !fileName) {
    return res.status(400).json({ 
      message: "No file content or required metadata (filename/type) provided for upload." 
    });
  }

  try {
    const docu = await Doc.create({
      name: fileName,
      size: fileBuffer.length,
      date: new Date(),
      data: fileBuffer,       // Save the raw buffer
      contentType: contentType // Save the MIME type (CRITICAL for correct download/opening)
    });
    
    await logActivity(username, `Uploaded document: ${docu.name} (${contentType})`);
    
    res.status(201).json([{ ...docu.toObject(), id: docu._id.toString() }]); 
  } catch (err) {
    console.error("Document upload error:", err);
    res.status(500).json({ message: "Server error during file storage." });
  }
});

// ============================================================================
//                             DOCUMENTS DOWNLOAD (FIXED FOR ALL FILES)
// ============================================================================
app.get("/api/documents/download/:id", async (req, res) => {
  try {
    // Fetch the document, including the binary 'data' field
    const docu = await Doc.findById(req.params.id).lean(); 
    
    if (!docu) return res.status(404).json({ message: "Document not found" });

    if (!docu.data || !docu.contentType) {
      return res.status(400).json({ 
        message: "File content not stored on server. This file may have been uploaded before the schema fix. Try generating a new report or re-uploading the file." 
      });
    }

    // CRITICAL FIX 3: Use the stored content type and size for correct download
    res.setHeader("Content-Disposition", `attachment; filename="${docu.name}"`);
    res.setHeader("Content-Type", docu.contentType);
    res.setHeader("Content-Length", docu.size);
    
    // Send the binary data
    res.send(docu.data);

    await logActivity(req.headers["x-username"], `Downloaded document: ${docu.name}`);

  } catch (err) {
    console.error("Document download error:", err); 
    res.status(500).json({ message: "Server error during download" });
  }
});

// (Other routes remain the same, ensuring PDF and XLSX generation also store 'data' and 'contentType')

// ============================================================================
//                        STARTUP HELPER + START SERVER
// ============================================================================
async function ensureDefaultAdminAndStartupLog() {
  try {
    const count = await User.countDocuments({}).exec();
    if (count === 0) {
      await User.create({ username: "admin", password: "password" });
      await logActivity("System", "Default admin user created");
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
