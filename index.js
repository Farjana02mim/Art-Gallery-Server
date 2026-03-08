const express = require("express");
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);

app.use(express.json());

// mongodb connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8v42xkx.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: ServerApiVersion.v1,
});

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
      const result = await listCollection
        .find()
        .sort({ created_at: -1 })
        .limit(6)
        .toArray();

      res.send(result);
    });

    // ============================
    // All Listings
    // ============================

    app.get("/listing", async (req, res) => {
      const category = req.query.category;
      const search = req.query.search || "";

      let query = {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { title: { $regex: search, $options: "i" } },
        ],
      };

      if (category && category !== "All") {
        query.category = category;
      }

      const result = await listCollection.find(query).toArray();
      res.send(result);
    });

    // ============================
    // Category Filter
    // ============================

    app.get("/category/:categoryName", async (req, res) => {
      const categoryName = req.params.categoryName;

      const result = await listCollection
        .find({ category: categoryName })
        .toArray();

      res.send(result);
    });

    // ============================
    // Single Listing
    // ============================

    app.get("/listing/:id", async (req, res) => {
      const id = req.params.id;

      const result = await listCollection.findOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    // ============================
    // Add Listing
    // ============================

    app.post("/listing", async (req, res) => {
      const data = req.body;

      data.created_at = new Date();
      data.updated_at = new Date();

      const result = await listCollection.insertOne(data);

      res.send(result);
    });

    // ============================
    // Update Listing
    // ============================

    app.put("/listing/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      const filter = { _id: new ObjectId(id) };

      const updateDoc = {
        $set: {
          ...updatedData,
          updated_at: new Date(),
        },
      };

      const result = await listCollection.updateOne(filter, updateDoc);

      res.send(result);
    });

    // ============================
    // Delete Listing
    // ============================

    app.delete("/listing/:id", async (req, res) => {
      const id = req.params.id;

      const result = await listCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    // ============================
    // My Arts
    // ============================

    app.get("/my-arts", async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(400).send({ error: "Email required" });
      }

      const result = await listCollection
        .find({ email })
        .sort({ created_at: -1 })
        .toArray();

      res.send(result);
    });

    // ============================
    // View Counter
    // ============================

    app.patch("/listing/views/:id", async (req, res) => {
      const id = req.params.id;

      const result = await listCollection.updateOne(
        { _id: new ObjectId(id) },
        { $inc: { views: 1 } }
      );

      res.send(result);
    });

    // ============================
    // Like System
    // ============================

    app.patch("/listing/like/:id", async (req, res) => {
      const id = req.params.id;

      const result = await listCollection.updateOne(
        { _id: new ObjectId(id) },
        { $inc: { likes: 1 } }
      );

      res.send(result);
    });

    // ============================
    // Stripe Checkout Session
    // ============================

    app.post("/create-checkout-session", async (req, res) => {
      try {
        const { price, name, artId, email } = req.body;

        if (!price || !name || !email || !artId) {
          return res.status(400).send({
            error: "Missing required fields",
          });
        }

        const amount = Math.round(Number(price) * 100);

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],

          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: amount,
                product_data: {
                  name: name,
                },
              },
              quantity: 1,
            },
          ],

          mode: "payment",

          customer_email: email,

          metadata: {
            artId: artId,
          },

          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (error) {
        console.error("Stripe Error:", error);
        res.status(500).send({
          error: "Failed to create checkout session",
        });
      }
    });

    // ============================
    // Payment Success
    // ============================

    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;

        if (!sessionId) {
          return res.status(400).send({
            error: "Session ID missing",
          });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res.send({
            success: false,
            message: "Payment not completed",
          });
        }

        const artId = session.metadata.artId;
        const transactionId = session.payment_intent;

        const existingPayment = await paymentsCollection.findOne({
          transactionId,
        });

        if (existingPayment) {
          return res.send({
            success: true,
            message: "Payment already saved",
          });
        }

        const paymentData = {
          artId,
          transactionId,
          email: session.customer_email,
          amount: session.amount_total / 100,
          created_at: new Date(),
        };

        await paymentsCollection.insertOne(paymentData);

        res.send({
          success: true,
          message: "Payment verified and saved",
        });
      } catch (error) {
        console.error(error);

        res.status(500).send({
          error: "Payment verification failed",
        });
      }
    });

    // ============================
    // My Purchases
    // ============================

    app.get("/myPurchases", async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(400).send({
          error: "Email required",
        });
      }

      const purchases = await paymentsCollection
        .find({ email })
        .sort({ created_at: -1 })
        .toArray();

      res.send(purchases);
    });
  } finally {
  }
}

run().catch(console.dir);

// default route

app.get("/", (req, res) => {
  res.send("Art Gallery API Running 🚀");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});