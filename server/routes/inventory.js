const express = require("express");
const fs = require("fs");
const router = express.Router();

const INV_FILE = __dirname + "/../data/inventory.json";
const MOV_FILE = __dirname + "/../data/movements.json";

// Ensure data files exist
if (!fs.existsSync(INV_FILE)) fs.writeFileSync(INV_FILE, "[]");
if (!fs.existsSync(MOV_FILE)) fs.writeFileSync(MOV_FILE, "[]");

// Helper: Load JSON
function load(file) {
    return JSON.parse(fs.readFileSync(file));
}

// Helper: Save JSON
function save(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/* ============================================================
   ✅ GET INVENTORY LIST (with live stock balance)
   ============================================================ */
router.get("/", (req, res) => {
    const inventory = load(INV_FILE);
    const movements = load(MOV_FILE);

    // calculate dynamic stock balance
    const finalList = inventory.map(item => {
        const qtyIn = movements
            .filter(m => m.itemId === item.id && m.type === "IN")
            .reduce((a, b) => a + b.quantity, 0);

        const qtyOut = movements
            .filter(m => m.itemId === item.id && m.type === "OUT")
            .reduce((a, b) => a + b.quantity, 0);

        return {
            ...item,
            currentStock: qtyIn - qtyOut
        };
    });

    res.json(finalList);
});

/* ============================================================
   ✅ ADD NEW ITEM
   ============================================================ */
router.post("/add", (req, res) => {
    const { name, sku, category, minStock } = req.body;

    const inventory = load(INV_FILE);

    const newItem = {
        id: Date.now().toString(),
        name,
        sku,
        category,
        minStock: Number(minStock || 0),
        createdAt: new Date()
    };

    inventory.push(newItem);
    save(INV_FILE, inventory);

    res.json({ success: true, message: "Item added", item: newItem });
});

/* ============================================================
   ✅ STOCK IN
   ============================================================ */
router.post("/stock-in", (req, res) => {
    const { itemId, quantity, user } = req.body;

    const movements = load(MOV_FILE);

    const record = {
        id: Date.now().toString(),
        itemId,
        quantity: Number(quantity),
        type: "IN",
        user,
        date: new Date()
    };

    movements.push(record);
    save(MOV_FILE, movements);

    res.json({ success: true, message: "Stock In recorded" });
});

/* ============================================================
   ✅ STOCK OUT
   ============================================================ */
router.post("/stock-out", (req, res) => {
    const { itemId, quantity, user } = req.body;

    const movements = load(MOV_FILE);

    const record = {
        id: Date.now().toString(),
        itemId,
        quantity: Number(quantity),
        type: "OUT",
        user,
        date: new Date()
    };

    movements.push(record);
    save(MOV_FILE, movements);

    res.json({ success: true, message: "Stock Out recorded" });
});

/* ============================================================
   ✅ GET MOVEMENT HISTORY (for one item)
   ============================================================ */
router.get("/history/:itemId", (req, res) => {
    const { itemId } = req.params;
    const movements = load(MOV_FILE);
    res.json(movements.filter(m => m.itemId === itemId));
});

module.exports = router;
