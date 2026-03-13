const express = require("express");
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const serviceAccount = require("./art-gallery-85d90-firebase-admin.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

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
// Firebase Token Verify
// ============================
const verifyFBToken = async (req, res, next) => {

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  try {

    const token = authHeader.split(" ")[1];

    const decoded = await admin.auth().verifyIdToken(token);

    req.decoded_email = decoded.email;

    next();

  } catch (error) {

    return res.status(401).send({ message: "Invalid token" });

  }
};

// ============================
// MongoDB Connection
// ============================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8v42xkx.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1 });

async function run() {
  try {
    await client.connect();
    const db = client.db("art_gallery_db");
    const userCollection = db.collection('users');
    const listCollection = db.collection("listing");
    const paymentsCollection = db.collection("payments");
    const artistsCollection = db.collection("artists");


    console.log("MongoDB Connected ✅");

    // middle more with database access
const verifyAdmin = async(req,res,next)=>{
  const email = req.decoded_email;
  const query = {email};
  const user = await userCollection.findOne(query);

  if(!user || user.role !=='admin'){
    return res.status(403).send({message: 'forbidden access!'});
    
  }
  next();

}

    // users related api
app.post('/users', async (req, res) => {

  const user = req.body;

  // check existing user
  const existingUser = await userCollection.findOne({
    email: user.email
  });

  if (existingUser) {
    return res.send({
      message: "User already exists",
      inserted: false
    });
  }

  const newUser = {
    name: user.name,
    email: user.email,
    photoURL: user.photoURL,
    role: "user",
    createdAt: new Date()
  };

  const result = await userCollection.insertOne(newUser);

  res.send({
    inserted: true,
    insertedId: result.insertedId
  });

});
app.get('/users', verifyFBToken, async(req, res) => {
  const searchText = req.query.searchText;
  const query = {};
  if(searchText){
    //query.name = { $regex: searchText, $options: 'i' }

    query.$or = [
      {name : { $regex: searchText, $options: 'i' }},
      {email : { $regex: searchText, $options: 'i' }},
    ]
  }

const cursor = userCollection.find(query).sort({createdAt: -1}).limit(3);

  const result = await cursor.toArray();
  res.send(result);

})

app.get('/users/:email/role',async(req, res) =>{
  const email = req.params.email;
  const query = {email}
  const user = await userCollection.findOne(query);
  res.send({role: user?.role || 'user'});
})

app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async(req, res) => {

  const id = req.params.id;
  const roleInfo = req.body;

  const query = { _id: new ObjectId(id) }

  const updateDoc = {
    $set: {
      role: roleInfo.role
    }
  }

  const result = await userCollection.updateOne(query, updateDoc)

  res.send(result)

})


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
app.get("/my-arts", verifyFBToken, async (req, res) => {

  const email = req.query.email;

  if (email !== req.decoded_email) {
    return res.status(403).send({ message: "Forbidden access" });
  }

  const result = await listCollection
    .find({ email })
    .sort({ created_at: -1 })
    .toArray();

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

  const session = await stripe.checkout.sessions.retrieve(sessionId);

  const transactionId = session.payment_intent;

  // check duplicate
  const existingPayment = await paymentsCollection.findOne({
    transactionId
  });

  if (existingPayment) {
    return res.send({
      success: true,
      message: "Already recorded",
      transactionId
    });
  }

  const paymentData = {
    artId: session.metadata.artId,
    email: session.customer_email,
    transactionId,
    amount: session.amount_total / 100,
    paymentStatus: "Paid",
    created_at: new Date()
  };

  await paymentsCollection.insertOne(paymentData);

  res.send({
    success: true,
    transactionId
  });
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
 app.get("/myPurchases", verifyFBToken, async (req, res) => {

  const email = req.query.email;

  if (email !== req.decoded_email) {
    return res.status(403).send({ message: "Forbidden access" });
  }

  const result = await paymentsCollection
    .find({ email })
    .sort({ created_at: -1 })
    .toArray();

  res.send(result);

});


// artists related api

// ============================
// Create new artist
// ============================
app.post('/artists', async (req, res) => {
  try {
    const data = req.body;

    // Mandatory fields চেক
    if (!data.name || !data.email || !data.title) {
      return res.status(400).send({ message: "Name, email, and title are required" });
    }

    const artist = {
      name: data.name,
      email: data.email,
      title: data.title,
      experience: data.experience || "",
      portfolio: data.portfolio || "",
      bio: data.bio || "",
      image: data.image || "",
      status: "pending",
      created_at: new Date(),
    };

    const result = await artistsCollection.insertOne(artist);

    res.send({
      insertedId: result.insertedId,
      message: "Artist request submitted successfully"
    });
  } catch (error) {
    console.error("Failed to insert artist:", error);
    res.status(500).send({ message: "Failed to submit artist request" });
  }
});

// ============================
// Get all artists (optional status filter)
// ============================
app.get('/artists', async (req, res) => {
  try {
    const query = {};
    if (req.query.status) {
      query.status = req.query.status; // pending/approved/rejected
    }

    const result = await artistsCollection.find(query).toArray();

    res.send(result);
  } catch (error) {
    console.error("Failed to fetch artists:", error);
    res.status(500).send({ message: "Failed to fetch artists" });
  }
});

// ============================
// Get single artist by ID
// ============================
app.get('/artists/:id',verifyFBToken,verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;

    const result = await artistsCollection.findOne({ _id: new ObjectId(id) });

    if (!result) {
      return res.status(404).send({ message: "Artist not found" });
    }

    res.send(result);
  } catch (error) {
    console.error("Failed to fetch artist:", error);
    res.status(500).send({ message: "Failed to fetch artist" });
  }
});

// ============================
// Approve Artist (Admin)
// ============================
app.patch('/artists/approve/:id',verifyFBToken,verifyAdmin, async (req, res) => {

  try {

    const id = req.params.id;
    const { email } = req.body;

    // update artist status
    const result = await artistsCollection.updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          status: "approved",
          approvedAt: new Date()
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "Artist not found" });
    }

    // update user role
    await userCollection.updateOne(
      { email: email },
      { $set: { role: "artist" } }
    );

    res.send({
      success: true,
      message: "Artist approved and role updated"
    });

  } catch (error) {

    console.error("Failed to approve artist:", error);

    res.status(500).send({
      message: "Failed to approve artist"
    });

  }

});

// ============================
// Latest Approved Artists (Home Page)
// ============================
app.get("/latest-artists", async (req, res) => {
  try {

    const result = await artistsCollection
      .find({ status: "approved" })   // only approved artists
      .sort({ created_at: -1 })       // latest first
      .limit(6)                       // show only 6
      .toArray();

    res.send(result);

  } catch (error) {

    console.error("Failed to fetch latest artists:", error);

    res.status(500).send({
      message: "Failed to fetch latest artists"
    });

  }
});

// ============================
// Reject Artist (Admin)
// ============================
app.patch('/artists/reject/:id',verifyFBToken,verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;

    const result = await artistsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "rejected" } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "Artist not found" });
    }

    res.send({ message: "Artist rejected successfully" });
  } catch (error) {
    console.error("Failed to reject artist:", error);
    res.status(500).send({ message: "Failed to reject artist" });
  }
});

// ============================
// Delete Artist
// ============================
app.delete('/artists/:id',verifyFBToken,verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;

    const result = await artistsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Artist not found" });
    }

    res.send({ message: "Artist deleted successfully" });
  } catch (error) {
    console.error("Failed to delete artist:", error);
    res.status(500).send({ message: "Failed to delete artist" });
  }
});

// ============================
// Get My Artist Profile
// ============================
app.get('/my-artist', verifyFBToken,verifyAdmin, async (req, res) => {
  try {
    const email = req.query.email;

    if (email !== req.decoded_email) {
      return res.status(403).send({ message: "Forbidden access" });
    }

    const result = await artistsCollection.findOne({ email });

    if (!result) {
      return res.status(404).send({ message: "Artist profile not found" });
    }

    res.send(result);
  } catch (error) {
    console.error("Failed to fetch my artist profile:", error);
    res.status(500).send({ message: "Failed to fetch artist profile" });
  }
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