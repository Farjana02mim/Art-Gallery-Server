const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173'], // frontend URL
  credentials: true
}));
app.use(express.json());

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8v42xkx.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1 });

async function run() {
  try {
    await client.connect();
    const db = client.db("art_gallery_db");
    const listCollection = db.collection("listing");

    // 1️⃣ Latest 6 listings
    app.get("/latest-list", async (req, res) => {
      try {
        const result = await listCollection
          .find()
          .sort({ created_at: -1 })
          .limit(6)
          .toArray();
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // 2️⃣ All listings with optional category & search
    app.get("/listing", async (req, res) => {
      try {
        const category = req.query.category;
        const search = req.query.search || "";

        let query = { title: { $regex: search, $options: "i" } };
        if (category && category !== "All") query.category = category;

        const result = await listCollection.find(query).toArray();
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // 3️⃣ Single listing by ID
    app.get("/listing/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await listCollection.findOne({ _id: new ObjectId(id) });
        if (!result) return res.status(404).json({ success: false, message: "Listing not found" });
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // 4️⃣ Add new listing
    app.post("/listing", async (req, res) => {
      try {
        const data = req.body;
        data.created_at = new Date();
        const result = await listCollection.insertOne(data);
        res.json({ success: true, result });
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    console.log("MongoDB Connected ✅");
  } finally {
    // do not close client
  }
}

run().catch(console.dir);

app.get('/', (req, res) => res.send('Art Gallery API Running!'));

app.listen(port, () => console.log(`Server running on port ${port}`));