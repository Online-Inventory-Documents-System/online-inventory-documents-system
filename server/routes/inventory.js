const express = require("express");
const fs = require("fs");
const router = express.Router();
const INV_FILE = __dirname + "/../data/inventory.json";

// ✅ Get all items
router.get("/", (req, res) => {
    if (!fs.existsSync(INV_FILE)) return res.json([]);
    res.json(JSON.parse(fs.readFileSync(INV_FILE)));
});

// ✅ Add new item
router.post("/add", (req, res) => {
    const { name, quantity } = req.body;

    let items = [];
    if (fs.existsSync(INV_FILE)) {
        items = JSON.parse(fs.readFileSync(INV_FILE));
    }

    items.push({ name, quantity, date: new Date() });
    fs.writeFileSync(INV_FILE, JSON.stringify(items, null, 2));

    res.json({ success: true });
});

module.exports = router;
