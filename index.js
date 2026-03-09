const express = require("express");
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// ============================
// Middleware
// ============================
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json());

// ============================
// MongoDB Connection
// ============================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8v42xkx.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1 });

async function run() {
  try {
    await client.connect();
    const db = client.db("art_gallery_db");
    const listCollection = db.collection("listing");
    const paymentsCollection = db.collection("payments");

    console.log("MongoDB Connected ✅");

    // ============================
    // Latest 6 Listings
    // ============================
    app.get("/latest-list", async (req, res) => {
      const result = await listCollection.find().sort({ created_at: -1 }).limit(6).toArray();
      res.send(result);
    });

    // ============================
    // All Listings with optional search & category
    // ============================
    app.get("/listing", async (req, res) => {
      const category = req.query.category;
      const search = req.query.search || "";

      let query = { $or: [{ name: { $regex: search, $options: "i" } }, { title: { $regex: search, $options: "i" } }] };
      if (category && category !== "All") query.category = category;

      const result = await listCollection.find(query).toArray();
      res.send(result);
    });

    // ============================
    // Category Filter
    // ============================
    app.get("/category/:categoryName", async (req, res) => {
      const categoryName = req.params.categoryName;
      const result = await listCollection.find({ category: categoryName }).toArray();
      res.send(result);
    });

    // ============================
    // Single Listing
    // ============================
    app.get("/listing/:id", async (req, res) => {
      const id = req.params.id;
      const result = await listCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // ============================
    // Add Listing
    // ============================
    app.post("/listing", async (req, res) => {
      const data = req.body;
      data.created_at = new Date();
      data.updated_at = new Date();

      data.views = Number(data.views) || 0;
      data.likes = Number(data.likes) || 0;
      data.rating = Number(data.rating) || 0;
      data.ratingCount = Number(data.ratingCount) || 0;

      const result = await listCollection.insertOne(data);
      res.send(result);
    });

    // ============================
    // Update Listing
    // ============================
    app.put("/listing/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      updatedData.updated_at = new Date();

      if (updatedData.views !== undefined) updatedData.views = Number(updatedData.views);
      if (updatedData.likes !== undefined) updatedData.likes = Number(updatedData.likes);
      if (updatedData.rating !== undefined) updatedData.rating = Number(updatedData.rating);
      if (updatedData.ratingCount !== undefined) updatedData.ratingCount = Number(updatedData.ratingCount);

      const result = await listCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedData });
      res.send(result);
    });

    // ============================
    // Delete Listing
    // ============================
    app.delete("/listing/:id", async (req, res) => {
      const id = req.params.id;
      const result = await listCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // ============================
    // My Arts
    // ============================
    app.get("/my-arts", async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ error: "Email required" });

      const result = await listCollection.find({ email }).sort({ created_at: -1 }).toArray();
      res.send(result);
    });

 // ============================
// View Counter (updated)
// ============================
app.patch("/listing/views/:id", async (req, res) => {
  const id = req.params.id;

  try {
    // Increment views and return updated document
    const result = await listCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $inc: { views: 1 } },
      { returnDocument: "after" } // returns updated document
    );

    res.send({ success: true, views: result.value.views });
  } catch (err) {
    console.log(err);
    res.status(500).send({ success: false, error: "Failed to increment view" });
  }
});
    // ============================
    // Like System
    // ============================
    app.patch("/listing/like/:id", async (req, res) => {
      const id = req.params.id;
      const result = await listCollection.updateOne(
        { _id: new ObjectId(id) },
        [{ $set: { likes: { $add: [{ $toInt: "$likes" }, 1] } } }]
      );
      res.send(result);
    });

    // ============================
    // Rating System
    // ============================
    app.patch("/listing/rate/:id", async (req, res) => {
      const id = req.params.id;
      const { rating } = req.body;

      const art = await listCollection.findOne({ _id: new ObjectId(id) });
      const oldRating = Number(art.rating) || 0;
      const ratingCount = Number(art.ratingCount) || 0;

      const newCount = ratingCount + 1;
      const newAverage = (oldRating * ratingCount + Number(rating)) / newCount;

      const result = await listCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { rating: Number(newAverage.toFixed(1)), ratingCount: newCount } }
      );
      res.send(result);
    });

    // ============================
    // Trending Routes
    // ============================
    app.get("/trending/views", async (req, res) => {
      const result = await listCollection.find().sort({ views: -1 }).limit(6).toArray();
      res.send(result);
    });

    app.get("/trending/likes", async (req, res) => {
      const result = await listCollection.find().sort({ likes: -1 }).limit(6).toArray();
      res.send(result);
    });

    app.get("/trending/rating", async (req, res) => {
      const result = await listCollection.find().sort({ rating: -1 }).limit(6).toArray();
      res.send(result);
    });

    // ============================
    // Smart Trending (views*0.5 + likes*0.3 + rating*0.2)
    // ============================
    app.get("/trending", async (req, res) => {
      const result = await listCollection.aggregate([
        {
          $addFields: {
            trendingScore: {
              $add: [
                { $multiply: [{ $toInt: "$views" }, 0.5] },
                { $multiply: [{ $toInt: "$likes" }, 0.3] },
                { $multiply: [{ $toDouble: "$rating" }, 0.2] },
              ],
            },
          },
        },
        { $sort: { trendingScore: -1 } },
        { $limit: 6 },
      ]).toArray();
      res.send(result);
    });

    // ============================
    // Stripe Checkout
    // ============================
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const { price, name, artId, email } = req.body;
        const amount = Math.round(Number(price) * 100);

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [{ price_data: { currency: "usd", unit_amount: amount, product_data: { name } }, quantity: 1 }],
          mode: "payment",
          customer_email: email,
          metadata: { artId },
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (error) {
        console.log(error);
        res.status(500).send({ error: "Stripe session failed" });
      }
    });

    // ============================
    // Payment Success
    // ============================
    app.patch("/payment-success", async (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) return res.status(400).send({ success: false, message: "No session ID" });

  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (session.payment_status !== "paid") 
    return res.send({ success: false, message: "Payment not completed" });

  // Check if payment already recorded
  const existingPayment = await paymentsCollection.findOne({
    transactionId: session.payment_intent
  });

  if (existingPayment) 
    return res.send({ success: true, message: "Payment already recorded" });

  // Insert new payment
  const paymentData = {
    artId: session.metadata.artId,
    transactionId: session.payment_intent,
    email: session.customer_email,
    amount: session.amount_total / 100,
    paymentStatus: "Paid",
    created_at: new Date(),
  };

  await paymentsCollection.insertOne(paymentData);
  res.send({ success: true, message: "Payment recorded successfully" });
});
    // ============================
    // Payment Cancelled
    // ============================
    app.get("/dashboard/payment-cancelled", (req, res) => {
      res.send({ success: false, message: "Payment was cancelled by the user." });
    });

    // ============================
    // My Purchases
    // ============================
    app.get("/myPurchases", async (req, res) => {
      const email = req.query.email;
      const result = await paymentsCollection.find({ email }).sort({ created_at: -1 }).toArray();
      res.send(result);
    });

  } finally {
    // optionally close client
  }
}

run().catch(console.dir);

// ============================
// Default Route
// ============================
app.get("/", (req, res) => res.send("Art Gallery API Running 🚀"));

app.listen(port, () => console.log(`Server running on port ${port}`));