const express = require("express");
const fs = require("fs");
const router = express.Router();

const INV_FILE = __dirname + "/../data/inventory.json";
const LOG_FILE = __dirname + "/../data/stock_logs.json";

// Ensure files exist
function loadFile(file, fallback) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
    return JSON.parse(fs.readFileSync(file));
}

function saveFile(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/* ============================================================
   GET ALL INVENTORY ITEMS
============================================================ */
router.get("/", (req, res) => {
    const inventory = loadFile(INV_FILE, []);
    return res.json(inventory);
});

/* ============================================================
   ADD NEW INVENTORY ITEM
   Fields expected:
   { sku, name, category, cost, price, quantity }
============================================================ */
router.post("/add", (req, res) => {
    const { sku, name, category, cost, price, quantity } = req.body;

    if (!sku || !name || !quantity)
        return res.status(400).json({ success: false, message: "Missing required fields" });

    const inventory = loadFile(INV_FILE, []);

    if (inventory.find(i => i.sku === sku))
        return res.status(409).json({ success: false, message: "SKU already exists" });

    const newItem = {
        sku,
        name,
        category: category || "Uncategorized",
        cost: Number(cost) || 0,
        price: Number(price) || 0,
        quantity: Number(quantity),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    inventory.push(newItem);
    saveFile(INV_FILE, inventory);

    return res.json({ success: true, item: newItem });
});

/* ============================================================
   UPDATE ITEM
============================================================ */
router.put("/:sku", (req, res) => {
    const { sku } = req.params;
    const { name, category, cost, price } = req.body;

    const inventory = loadFile(INV_FILE, []);

    const item = inventory.find(i => i.sku === sku);
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });

    if (name) item.name = name;
    if (category) item.category = category;
    if (cost !== undefined) item.cost = Number(cost);
    if (price !== undefined) item.price = Number(price);
    item.updatedAt = new Date().toISOString();

    saveFile(INV_FILE, inventory);

    return res.json({ success: true, item });
});

/* ============================================================
   DELETE ITEM
============================================================ */
router.delete("/:sku", (req, res) => {
    const { sku } = req.params;

    let inventory = loadFile(INV_FILE, []);
    const before = inventory.length;

    inventory = inventory.filter(i => i.sku !== sku);

    if (inventory.length === before)
        return res.status(404).json({ success: false, message: "SKU not found" });

    saveFile(INV_FILE, inventory);

    return res.json({ success: true });
});

/* ============================================================
   STOCK IN / OUT TRACKING
   Body:
   {
     sku,
     type: "in" | "out",
     qty,
     user
   }
============================================================ */
router.post("/stock", (req, res) => {
    const { sku, type, qty, user } = req.body;

    if (!sku || !type || !qty)
        return res.status(400).json({ success: false, message: "Missing fields" });

    const inventory = loadFile(INV_FILE, []);
    const logs = loadFile(LOG_FILE, []);

    const item = inventory.find(i => i.sku === sku);
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });

    const q = Number(qty);

    if (type === "in") item.quantity += q;
    else if (type === "out") {
        if (item.quantity < q)
            return res.status(400).json({ success: false, message: "Insufficient stock" });

        item.quantity -= q;
    } else {
        return res.status(400).json({ success: false, message: "Invalid stock type" });
    }

    item.updatedAt = new Date().toISOString();

    // Log entry
    logs.push({
        sku,
        type,
        qty: q,
        user: user || "system",
        timestamp: new Date().toISOString()
    });

    saveFile(INV_FILE, inventory);
    saveFile(LOG_FILE, logs);

    return res.json({ success: true, item });
});

/* ============================================================
   GET STOCK LOGS
============================================================ */
router.get("/logs/all", (req, res) => {
    const logs = loadFile(LOG_FILE, []);
    return res.json(logs);
});

module.exports = router;
