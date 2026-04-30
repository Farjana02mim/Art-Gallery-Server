const express = require("express");
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

//const serviceAccount = require("./art-gallery-85d90-firebase-admin.json");

// const serviceAccount = require("./firebase-admin-key.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// ============================
// Middleware
// ============================
app.use(
  cors({
    origin: [
  "http://localhost:5173",
  "https://art-gallery-85d90.web.app"
],
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
let client;

async function connectDB() {
  if (!client) {
    client = new MongoClient(uri, { serverApi: ServerApiVersion.v1 });
    await client.connect();
    console.log("MongoDB Connected ✅");
  }
  return client;
}

async function createIndexes() {
  const db = client.db("art_gallery_db");

  await db.collection("listing").createIndex({ category: 1 });
  await db.collection("listing").createIndex({ created_at: -1 });
  await db.collection("listing").createIndex({ name: "text", title: "text" });

  await db.collection("users").createIndex({ email: 1 });

  console.log("Indexes created ✅");
}

async function run() {
  try {
    const client = await connectDB();
    await createIndexes(); 
    const db = client.db("art_gallery_db");
    const userCollection = db.collection('users');
    const listCollection = db.collection("listing");
    const paymentsCollection = db.collection("payments");
    const artistsCollection = db.collection("artists");

    function getAuctionStatus(auction) {
  const now = new Date();

  if (!auction.isAuction) return "none";

  if (auction.startTime > now) return "upcoming";

  if (auction.startTime <= now && auction.endTime >= now) return "live";

  if (auction.endTime < now) return "ended";

  return "unknown";
}

    // ============================
// AUTO AUCTION JOB
// ============================
const cron = require("node-cron");

cron.schedule("* * * * *", async () => { // every 1 minute
  try {
    const now = new Date();

    await listCollection.updateMany(
      {
        "auction.isAuction": true,
        "auction.status": "upcoming",
        "auction.startTime": { $lte: now }
      },
      { $set: { "auction.status": "live" } }
    );

    await listCollection.updateMany(
      {
        "auction.isAuction": true,
        "auction.status": "live",
        "auction.endTime": { $lt: now }
      },
      { $set: { "auction.status": "ended" } }
    );

    console.log("Auction job ran:", now);
  } catch (error) {
    console.log("Auction job error:", error.message);
  }
});

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
    favorites: [],      
    createdAt: new Date()
  };

  const result = await userCollection.insertOne(newUser);

  res.send({
    inserted: true,
    insertedId: result.insertedId
  });

});

// ============================
// Initialize favorites for existing users (one-time)
// ============================
app.patch("/favorites", async (req, res) => {
  try {
    const result = await userCollection.updateMany(
      { favorites: { $exists: false } },
      { $set: { favorites: [] } }
    );

    res.send({
      message: "Favorites initialized for existing users",
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error("Failed to initialize favorites:", error);
    res.status(500).send({ message: "Failed to initialize favorites" });
  }
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

const cursor = userCollection
  .find(query)
  .project({ name: 1, email: 1, role: 1, photoURL: 1 })
  .sort({ createdAt: -1 })
  .limit(3);
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

});

app.patch("/users/notifications/:id", verifyFBToken, async (req, res) => {
  const { notifications } = req.body;

  const result = await userCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { notifications } }
  );

  res.send(result);
});

// profile image update
app.patch("/users/update-photo/:id", verifyFBToken, async (req, res) => {
  const { photoURL } = req.body;

  const result = await userCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { photoURL, updatedAt: new Date() } }
  );

  res.send(result);
});

app.patch("/users/change-email/:id", verifyFBToken, async (req, res) => {
  try {
    const { email } = req.body;
    const userId = req.params.id;

    // ১. DB থেকে current user fetch
    const existingUser = await userCollection.findOne({ _id: new ObjectId(userId) });

    if (!existingUser) {
      return res.status(404).send({ message: "User not found" });
    }

    // ২. Check: logged-in user কি এই user এর owner?
    if (req.decoded_email !== existingUser.email) {
      return res.status(403).send({ message: "Forbidden: Cannot change another user's email" });
    }

    // ৩. Update email
    const result = await userCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { email, updatedAt: new Date() } }
    );

    res.send({ success: true, message: "Email updated successfully", result });

  } catch (error) {
    console.error("Failed to update email:", error);
    res.status(500).send({ success: false, message: "Failed to update email" });
  }
});

app.delete("/users/:id", verifyFBToken, async (req, res) => {
  const id = req.params.id;

  await userCollection.deleteOne({ _id: new ObjectId(id) });

  res.send({ message: "Account deleted successfully" });
});

// Toggle favorite art for logged-in user
app.patch("/users/favorite/:artId", verifyFBToken, async (req, res) => {
  try {
    const artId = req.params.artId;
    const email = req.decoded_email;

    const user = await userCollection.findOne({ email });
    if (!user) return res.status(404).send({ message: "User not found" });

    let favorites = user.favorites || [];

    if (favorites.includes(artId)) {
      // Remove from favorites
      favorites = favorites.filter(id => id !== artId);
    } else {
      // Add to favorites
      favorites.push(artId);
    }

    await userCollection.updateOne({ email }, { $set: { favorites } });

    res.send({ success: true, favorites }); // শুধু ids পাঠাবে
  } catch (error) {
    console.error(error);
    res.status(500).send({ success: false, message: "Failed to update favorites" });
  }
});

// Get full favorite arts for logged-in user
app.get("/users/favorites", verifyFBToken, async (req, res) => {
  try {
    const email = req.decoded_email;

    const user = await userCollection.findOne({ email });
    if (!user) return res.status(404).send({ message: "User not found" });

    const favoriteArtIds = user.favorites || [];

    if (favoriteArtIds.length === 0) return res.send([]);

    const favoriteArts = await listCollection
      .find({ _id: { $in: favoriteArtIds.map(id => new ObjectId(id)) } })
      .project({
        title: 1,
        name: 1,
        category: 1,
        medium: 1,
        dimensions: 1,
        year: 1,
        price: 1,
        description: 1,
        location: 1,
        country: 1,
        email: 1,
        image: 1,
        created_at: 1,
        updated_at: 1,
        views: 1,
        likes: 1,
        featured: 1,
        rating: 1,
        ratingCount: 1
      })
      .toArray();

    res.send(favoriteArts);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to fetch favorites" });
  }
});


    // ============================
    // Latest 6 Listings
    // ============================
    app.get("/latest-list", async (req, res) => {
      const result = await listCollection
  .find({}, { projection: { title: 1, image: 1, price: 1, category: 1 } })
  .sort({ created_at: -1 })
  .limit(6)
  .toArray();
  res.send(result);
    });

    // ============================
    // All Listings with optional search & category
    // ============================
app.get("/listing", async (req, res) => {
  const category = req.query.category;
  const search = req.query.search || "";

  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;

  let query = {
    $or: [
      { name: { $regex: search, $options: "i" } },
      { title: { $regex: search, $options: "i" } }
    ]
  };

  if (category && category !== "All") {
    query.category = category;
  }

  const result = await listCollection
  .find(query)
  .project({
    title: 1,
    name: 1,
    price: 1,
    image: 1,
    category: 1,
    auction: 1,
    views: 1,
    likes: 1,
    rating: 1
  })
  .skip((page - 1) * limit)
  .limit(limit)
  .toArray();

  // 🔥 এখানে add করো
  const updated = result.map(item => {
    if (item.auction) {
      item.auction.status = getAuctionStatus(item.auction);
    }
    return item;
  });

  res.send(updated);
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

  if (result?.auction) {
    result.auction.status = getAuctionStatus(result.auction);
  }

  res.send(result);
});

    // ============================
    // Add Listing
    // ============================
    app.post("/listing", async (req, res) => {
      const data = req.body;

      // ================== AUCTION FIELD ADD ==================
data.auction = {
  isAuction: data.isAuction || false,
  startPrice: Number(data.startPrice) || 0,
  currentBid: Number(data.startPrice) || 0,
  highestBidder: null,
  bids: [],
  startTime: data.startTime ? new Date(data.startTime) : null,
  endTime: data.endTime ? new Date(data.endTime) : null,
  status: "upcoming"
};

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
// PLACE BID
// ============================
app.patch("/auction/bid/:id", verifyFBToken, async (req, res) => {
  try {
    const id = req.params.id;
    const { bidAmount } = req.body;
    const email = req.decoded_email;

    // 🔍 find item
    const art = await listCollection.findOne({ _id: new ObjectId(id) });

    if (!art) {
      return res.status(404).send({ message: "Item not found" });
    }

    // ❌ not auction
    if (!art.auction?.isAuction) {
      return res.status(400).send({ message: "Not auction item" });
    }

    // ⏱️ time validation
    const now = new Date();

    if (
      !art.auction.startTime ||
      !art.auction.endTime ||
      art.auction.startTime > now ||
      art.auction.endTime < now
    ) {
      return res.status(400).send({ message: "Auction not live" });
    }

    // 💰 amount validation
    const amount = Number(bidAmount);

    if (!amount || isNaN(amount)) {
      return res.status(400).send({ message: "Invalid bid amount" });
    }

    if (amount <= art.auction.currentBid) {
      return res.status(400).send({ message: "Bid must be higher" });
    }

    // 🔥 ATOMIC UPDATE (race condition safe)
    const result = await listCollection.updateOne(
      {
        _id: new ObjectId(id),
        "auction.currentBid": { $lt: amount } // critical condition
      },
      {
        $set: {
          "auction.currentBid": amount,
          "auction.highestBidder": email
        },
        $push: {
          "auction.bids": {
            bidder: email,
            amount: amount,
            time: new Date()
          }
        }
      }
    );

    // ❌ যদি অন্য কেউ আগে bid করে ফেলে
    if (result.modifiedCount === 0) {
      return res.status(400).send({
        message: "Bid too low or already updated by another user"
      });
    }

    // ✅ success
    res.send({ success: true, currentBid: amount });

  } catch (error) {
    console.error("Bid error:", error);
    res.status(500).send({ message: "Bid failed" });
  }
});

    // My Arts for logged-in user
app.get("/my-arts", verifyFBToken, async (req, res) => {
  try {
    const email = req.query.email;

    if (email !== req.decoded_email) {
      return res.status(403).send({ message: "Forbidden access" });
    }

    const myArts = await listCollection
  .find({ email }, { projection: { title: 1, image: 1, price: 1 } })
  .toArray();

    res.send(myArts);
  } catch (error) {
    console.error("Failed to fetch my arts:", error);
    res.status(500).send({ message: "Failed to fetch my arts" });
  }
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
// View Counter (Clean & Error-Free)
// ============================
app.patch("/listing/views/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ success: false, message: "Invalid ID" });
    }

    const ip = req.ip;

    const result = await listCollection.updateOne(
      {
        _id: new ObjectId(id),
        viewers: { $ne: ip }
      },
      {
        $inc: { views: 1 },
        $addToSet: { viewers: ip } // duplicate prevent
      }
    );

    res.send({
      success: true,
      message: "View updated",
      modifiedCount: result.modifiedCount
    });

  } catch (error) {
    console.error("View counter error:", error);
    res.status(500).send({
      success: false,
      message: "Server error"
    });
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
// Payment Success (UPGRADED)
// ============================
app.get("/payment-success", async (req, res) => {
  try {
    const sessionId = req.query.session_id;

    if (!sessionId) {
      return res.status(400).send({
        success: false,
        message: "Session ID missing"
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return res.status(400).send({
        success: false,
        message: "Payment not completed"
      });
    }

    const transactionId = session.payment_intent;
    const artId = String(session.metadata.artId);
    const email = session.customer_email;

    if (!transactionId || !artId || !email) {
      return res.status(400).send({
        success: false,
        message: "Invalid session data"
      });
    }

    // prevent duplicate
    const existing = await paymentsCollection.findOne({ transactionId });

    if (!existing) {
      await paymentsCollection.insertOne({
        artId,
        email,
        transactionId,
        amount: session.amount_total / 100,
        paymentStatus: "Paid",
        downloadAllowed: true,
        created_at: new Date(),
        purchasedAt: new Date(),
      });
    }

    res.send({
      success: true,
      message: "Payment stored successfully",
      transactionId
    });

  } catch (error) {
    console.error("Payment Success Error:", error);
    res.status(500).send({
      success: false,
      message: "Payment processing failed"
    });
  }
});

// ============================
// Download Art (UPGRADED)
// ============================
app.get("/download/:artId", verifyFBToken, async (req, res) => {
  try {
    const email = req.decoded_email;
    const artId = req.params.artId;

    if (!email) {
      return res.status(401).send({
        success: false,
        message: "Unauthorized"
      });
    }

    if (!ObjectId.isValid(artId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid artId"
      });
    }

    const payment = await paymentsCollection.findOne({
      email,
      artId: artId,
      downloadAllowed: true
    });

    if (!payment) {
      return res.status(403).send({
        success: false,
        message: "You have not purchased this item"
      });
    }

    const art = await listCollection.findOne({
      _id: new ObjectId(artId)
    });

    if (!art) {
      return res.status(404).send({
        success: false,
        message: "Art not found"
      });
    }

    res.send({
      success: true,
      downloadUrl: art.image,
      title: art.title
    });

  } catch (error) {
    console.error("Download error:", error);
    res.status(500).send({
      success: false,
      message: "Server error"
    });
  }
});
    // ============================
    // Payment Cancelled
    // ============================
    app.get("/dashboard/payment-cancelled", (req, res) => {
      res.send({ success: false, message: "Payment was cancelled by the user." });
    });

// ============================
// My Purchases (UPGRADED)
// ============================
app.get("/myPurchases", verifyFBToken, async (req, res) => {
  try {
    const email = req.query.email;

    if (!email || email !== req.decoded_email) {
      return res.status(403).send({
        success: false,
        message: "Forbidden access"
      });
    }

    const result = await paymentsCollection.aggregate([
      {
        $match: { email }
      },
      {
        $addFields: {
          artObjectId: {
            $cond: [
              { $regexMatch: { input: "$artId", regex: /^[0-9a-fA-F]{24}$/ } },
              { $toObjectId: "$artId" },
              null
            ]
          }
        }
      },
      {
        $lookup: {
          from: "listing",
          localField: "artObjectId",
          foreignField: "_id",
          as: "art"
        }
      },
      {
        $unwind: {
          path: "$art",
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          _id: 1,
          artId: 1,
          amount: 1,
          transactionId: 1,
          paymentStatus: 1,
          created_at: 1,

          artTitle: "$art.title",
          image: "$art.image",
          category: "$art.category"
        }
      },
      {
        $sort: { created_at: -1 }
      }
    ]).toArray();

    res.send({
      success: true,
      data: result
    });

  } catch (error) {
    console.error("My Purchases Error:", error);
    res.status(500).send({
      success: false,
      message: "Failed to fetch purchases"
    });
  }
});
// ============================
// Check Purchase (UPGRADED)
// ============================
app.get("/check-purchase/:artId", verifyFBToken, async (req, res) => {
  try {
    const email = req.decoded_email;
    const artId = req.params.artId;

    if (!ObjectId.isValid(artId)) {
      return res.status(400).send({
        success: false,
        purchased: false
      });
    }

    const purchase = await paymentsCollection.findOne({
      email,
      artId: String(artId)
    });

    res.send({
      success: true,
      purchased: !!purchase
    });

  } catch (error) {
    console.error("Check purchase error:", error);
    res.status(500).send({
      success: false,
      purchased: false
    });
  }
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
      socials: data.socials,
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
app.get('/artists/:id', async (req, res) => {
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
app.get('/my-artist', verifyFBToken, async (req, res) => {
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

// ============================
// Get My Full Profile
// ============================
app.get("/profile", verifyFBToken, async (req, res) => {

  try {

    const email = req.decoded_email;

    const user = await userCollection.findOne({ email });

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    let artistProfile = null;

    if (user.role === "artist") {
      artistProfile = await artistsCollection.findOne({ email });
    }

    res.send({
      user,
      artist: artistProfile
    });

  } catch (error) {

    console.error("Failed to fetch profile:", error);

    res.status(500).send({ message: "Failed to fetch profile" });

  }

});

// ============================
// Update User Profile
// ============================
app.patch("/users/update/:id", verifyFBToken, async (req, res) => {
  try {

    const id = req.params.id;
    const data = req.body;

    const result = await userCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          name: data.name,
          bio: data.bio || "",
          updatedAt: new Date()
        }
      }
    );

    res.send(result);

  } catch (error) {

    console.error("Profile update failed:", error);

    res.status(500).send({
      message: "Profile update failed"
    });

  }
});

// ============================
// Update Artist Profile
// ============================
app.patch("/artists/update/:id", verifyFBToken, async (req, res) => {

  try {

    const id = req.params.id;
    const data = req.body;

    const result = await artistsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          title: data.title,
          bio: data.bio,
          experience: data.experience,
          portfolio: data.portfolio,
          image: data.image,
          updated_at: new Date()
        }
      }
    );

    res.send(result);

  } catch (error) {

    console.error("Artist profile update failed:", error);

    res.status(500).send({
      message: "Artist update failed"
    });

  }

});

// ============================
// My Sales for logged-in artist
// ============================
app.get("/my-sales", verifyFBToken, async (req, res) => {
  try {
    const email = req.query.email;

    if (email !== req.decoded_email) {
      return res.status(403).send({ message: "Forbidden access" });
    }

    // fetch all payments
    const payments = await paymentsCollection
  .find({ artId: { $in: listingIds } })
  .toArray();

    // fetch listings to match artist email
    const listings = await listCollection
  .find({ email })
  .project({ _id: 1, title: 1, category: 1, medium: 1 })
  .toArray();

const listingIds = listings.map(a => a._id.toString());

    // filter payments where artId belongs to this artist
    const mySales = payments.filter((p) =>
      listings.some((art) => art._id.toString() === p.artId)
    );

    // enrich with art title
    const result = mySales.map((p) => {
  const art = listings.find((a) => a._id.toString() === p.artId);
  return {
    _id: p._id,
    buyerEmail: p.email,
    artTitle: art?.title || "Unknown",
    category: art?.category || "-",
    medium: art?.medium || "-",
    price: p.amount,
    date: p.created_at,
    transactionId: p.transactionId,
    status: p.paymentStatus,
  };
});

    res.send(result);
  } catch (error) {
    console.error("Failed to fetch my sales:", error);
    res.status(500).send({ message: "Failed to fetch my sales" });
  }
});


app.get("/sales-summary", verifyFBToken, async (req, res) => {
  const email = req.decoded_email;

  const listings = await listCollection.find({ email }).toArray();
  const payments = await paymentsCollection.find({
  artId: { $in: listings.map(a => a._id.toString()) }
}).toArray();

  const mySales = payments.filter((p) =>
    listings.some((art) => art._id.toString() === p.artId)
  );

  const totalRevenue = mySales.reduce((sum, p) => sum + p.amount, 0);

  res.send({
    totalSales: mySales.length,
    totalRevenue,
  });
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
//app.listen(port, () => console.log(`Server running on port ${port}`));

const serverless = require("serverless-http");
module.exports = serverless(app);

