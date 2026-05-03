 const express = require("express");
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString("utf8");
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ============================
// Middleware
// ============================
app.use(
  cors({
    origin: ["http://localhost:5173", "https://art-gallery-85d90.web.app"],
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
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.decoded_email = decodedToken.email;
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
    //await client.connect();

    const db = client.db("art_gallery_db");
    const userCollection = db.collection("users");
    const listCollection = db.collection("listing");
    const paymentsCollection = db.collection("payments");
    const artistsCollection = db.collection("artists");

    console.log("MongoDB Connected ✅");

    // ============================
    // Verify Admin Middleware
    // ============================
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await userCollection.findOne({ email });
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden access!" });
      }
      next();
    };

    // ============================
    // USER ROUTES
    // NOTE: Specific routes MUST come before dynamic /:param routes
    // ============================

    // POST - Create user
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;

        const existingUser = await userCollection.findOne({ email: user.email });
        if (existingUser) {
          return res.send({ message: "User already exists", inserted: false });
        }

        const newUser = {
          name: user.name,
          email: user.email,
          photoURL: user.photoURL,
          role: "user",
          favorites: [],
          createdAt: new Date(),
        };

        const result = await userCollection.insertOne(newUser);
        res.send({ inserted: true, insertedId: result.insertedId });
      } catch (error) {
        console.error("Failed to create user:", error);
        res.status(500).send({ message: "Failed to create user" });
      }
    });

    // GET - All users (with optional search) — requires auth
    app.get("/users", verifyFBToken, async (req, res) => {
      try {
        const searchText = req.query.searchText;
        const query = {};

        if (searchText) {
          query.$or = [
            { name: { $regex: searchText, $options: "i" } },
            { email: { $regex: searchText, $options: "i" } },
          ];
        }

        const result = await userCollection
          .find(query)
          .sort({ createdAt: -1 })
          .limit(3)
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Failed to fetch users:", error);
        res.status(500).send({ message: "Failed to fetch users" });
      }
    });

    // ✅ FIX: This MUST come before /users/:email/role
    // GET - Favorites arts for logged-in user
    app.get("/users/favorites", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;

        const user = await userCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: "User not found" });

        const favoriteArtIds = user.favorites || [];
        if (favoriteArtIds.length === 0) return res.send([]);

        const favoriteArts = await listCollection
          .find({ _id: { $in: favoriteArtIds.map((id) => new ObjectId(id)) } })
          .project({
            title: 1, name: 1, category: 1, medium: 1, dimensions: 1,
            year: 1, price: 1, description: 1, location: 1, country: 1,
            email: 1, image: 1, created_at: 1, updated_at: 1,
            views: 1, likes: 1, featured: 1, rating: 1, ratingCount: 1,
          })
          .toArray();

        res.send(favoriteArts);
      } catch (error) {
        console.error("Failed to fetch favorites:", error);
        res.status(500).send({ message: "Failed to fetch favorites" });
      }
    });

    // GET - User role by email
    app.get("/users/:email/role", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await userCollection.findOne({ email });
        res.send({ role: user?.role || "user" });
      } catch (error) {
        console.error("Failed to fetch role:", error);
        res.status(500).send({ message: "Failed to fetch role" });
      }
    });

    // ✅ FIX: All specific PATCH /users/... routes before PATCH /users/:id/role
    // PATCH - Initialize favorites for existing users (one-time utility)
    app.patch("/favorites", async (req, res) => {
      try {
        const result = await userCollection.updateMany(
          { favorites: { $exists: false } },
          { $set: { favorites: [] } }
        );
        res.send({
          message: "Favorites initialized for existing users",
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("Failed to initialize favorites:", error);
        res.status(500).send({ message: "Failed to initialize favorites" });
      }
    });

    // PATCH - Toggle favorite art
    app.patch("/users/favorite/:artId", verifyFBToken, async (req, res) => {
      try {
        const artId = req.params.artId;
        const email = req.decoded_email;

        const user = await userCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: "User not found" });

        let favorites = user.favorites || [];

        if (favorites.includes(artId)) {
          favorites = favorites.filter((id) => id !== artId);
        } else {
          favorites.push(artId);
        }

        await userCollection.updateOne({ email }, { $set: { favorites } });
        res.send({ success: true, favorites });
      } catch (error) {
        console.error("Failed to update favorites:", error);
        res.status(500).send({ success: false, message: "Failed to update favorites" });
      }
    });

    // PATCH - Update notifications
    app.patch("/users/notifications/:id", verifyFBToken, async (req, res) => {
      try {
        const { notifications } = req.body;
        const result = await userCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { notifications } }
        );
        res.send(result);
      } catch (error) {
        console.error("Failed to update notifications:", error);
        res.status(500).send({ message: "Failed to update notifications" });
      }
    });

    // PATCH - Update profile photo
    app.patch("/users/update-photo/:id", verifyFBToken, async (req, res) => {
      try {
        const { photoURL } = req.body;
        const result = await userCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { photoURL, updatedAt: new Date() } }
        );
        res.send(result);
      } catch (error) {
        console.error("Failed to update photo:", error);
        res.status(500).send({ message: "Failed to update photo" });
      }
    });

    // PATCH - Change email
    app.patch("/users/change-email/:id", verifyFBToken, async (req, res) => {
      try {
        const { email } = req.body;
        const userId = req.params.id;

        const existingUser = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!existingUser) {
          return res.status(404).send({ message: "User not found" });
        }

        if (req.decoded_email !== existingUser.email) {
          return res.status(403).send({ message: "Forbidden: Cannot change another user's email" });
        }

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

    // PATCH - Update user profile (name, bio)
    app.patch("/users/update/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const data = req.body;

        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { name: data.name, bio: data.bio || "", updatedAt: new Date() } }
        );

        res.send(result);
      } catch (error) {
        console.error("Profile update failed:", error);
        res.status(500).send({ message: "Profile update failed" });
      }
    });

    // ✅ FIX: Dynamic role patch AFTER all specific /users/... routes
    // PATCH - Update user role (admin only)
    app.patch("/users/:id/role", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const { role } = req.body;

        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );

        res.send(result);
      } catch (error) {
        console.error("Failed to update role:", error);
        res.status(500).send({ message: "Failed to update role" });
      }
    });

    // DELETE - Delete user
    app.delete("/users/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        await userCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ message: "Account deleted successfully" });
      } catch (error) {
        console.error("Failed to delete user:", error);
        res.status(500).send({ message: "Failed to delete user" });
      }
    });

    // ============================
    // LISTING ROUTES
    // NOTE: Specific routes before dynamic /:id routes
    // ============================

    // GET - Latest 6 listings
    app.get("/latest-list", async (req, res) => {
      
      try {
        const result = await listCollection
          .find()
          .sort({ created_at: -1 })
          .limit(6)
          .toArray();
        res.send(result);
        console.log(result);
      } catch (error) {
        console.error("Failed to fetch latest listings:", error);
        res.status(500).send({ message: "Failed to fetch latest listings" });
      }
    });

    // GET - All listings (search + category filter)
    app.get("/listing", async (req, res) => {
      try {
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
      } catch (error) {
        console.error("Failed to fetch listings:", error);
        res.status(500).send({ message: "Failed to fetch listings" });
      }
    });

    // GET - My arts (logged-in user)
    app.get("/my-arts", verifyFBToken, async (req, res) => {
      try {
        const email = req.query.email;

        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        const myArts = await listCollection.find({ email }).toArray();
        res.send(myArts);
      } catch (error) {
        console.error("Failed to fetch my arts:", error);
        res.status(500).send({ message: "Failed to fetch my arts" });
      }
    });

    // GET - Category filter
    app.get("/category/:categoryName", async (req, res) => {
      try {
        const categoryName = req.params.categoryName;
        const result = await listCollection.find({ category: categoryName }).toArray();
        res.send(result);
      } catch (error) {
        console.error("Failed to fetch category:", error);
        res.status(500).send({ message: "Failed to fetch category" });
      }
    });

    // ✅ FIX: Specific listing sub-routes BEFORE /listing/:id
    // PATCH - Increment view count (unique by IP)
    app.patch("/listing/views/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid ID" });
        }

        const ip = req.ip;

        const result = await listCollection.updateOne(
          { _id: new ObjectId(id), viewers: { $ne: ip } },
          { $inc: { views: 1 }, $addToSet: { viewers: ip } }
        );

        res.send({ success: true, message: "View updated", modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("View counter error:", error);
        res.status(500).send({ success: false, message: "Server error" });
      }
    });

    // PATCH - Like a listing
    app.patch("/listing/like/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await listCollection.updateOne(
          { _id: new ObjectId(id) },
          [{ $set: { likes: { $add: [{ $toInt: "$likes" }, 1] } } }]
        );
        res.send(result);
      } catch (error) {
        console.error("Like error:", error);
        res.status(500).send({ message: "Failed to like" });
      }
    });

    // PATCH - Rate a listing
    app.patch("/listing/rate/:id", async (req, res) => {
      try {
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
      } catch (error) {
        console.error("Rating error:", error);
        res.status(500).send({ message: "Failed to rate" });
      }
    });

    // ✅ FIX: /listing/:id routes AFTER all specific /listing/... routes
    // GET - Single listing
    app.get("/listing/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await listCollection.findOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (error) {
        console.error("Failed to fetch listing:", error);
        res.status(500).send({ message: "Failed to fetch listing" });
      }
    });

    // POST - Add listing
    app.post("/listing", async (req, res) => {
      try {
        const data = req.body;
        data.created_at = new Date();
        data.updated_at = new Date();
        data.views = Number(data.views) || 0;
        data.likes = Number(data.likes) || 0;
        data.rating = Number(data.rating) || 0;
        data.ratingCount = Number(data.ratingCount) || 0;

        const result = await listCollection.insertOne(data);
        res.send(result);
      } catch (error) {
        console.error("Failed to add listing:", error);
        res.status(500).send({ message: "Failed to add listing" });
      }
    });

    // PUT - Update listing
    app.put("/listing/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updatedData = req.body;
        updatedData.updated_at = new Date();

        if (updatedData.views !== undefined) updatedData.views = Number(updatedData.views);
        if (updatedData.likes !== undefined) updatedData.likes = Number(updatedData.likes);
        if (updatedData.rating !== undefined) updatedData.rating = Number(updatedData.rating);
        if (updatedData.ratingCount !== undefined) updatedData.ratingCount = Number(updatedData.ratingCount);

        const result = await listCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );
        res.send(result);
      } catch (error) {
        console.error("Failed to update listing:", error);
        res.status(500).send({ message: "Failed to update listing" });
      }
    });

    // DELETE - Delete listing
    app.delete("/listing/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await listCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (error) {
        console.error("Failed to delete listing:", error);
        res.status(500).send({ message: "Failed to delete listing" });
      }
    });

    // ============================
    // TRENDING ROUTES
    // ============================
    app.get("/trending/views", async (req, res) => {
      try {
        const result = await listCollection.find().sort({ views: -1 }).limit(6).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch trending by views" });
      }
    });

    app.get("/trending/likes", async (req, res) => {
      try {
        const result = await listCollection.find().sort({ likes: -1 }).limit(6).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch trending by likes" });
      }
    });

    app.get("/trending/rating", async (req, res) => {
      try {
        const result = await listCollection.find().sort({ rating: -1 }).limit(6).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch trending by rating" });
      }
    });

    // GET - Smart trending score
    app.get("/trending", async (req, res) => {
      try {
        const result = await listCollection
          .aggregate([
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
          ])
          .toArray();
        res.send(result);
      } catch (error) {
        console.error("Failed to fetch trending:", error);
        res.status(500).send({ message: "Failed to fetch trending" });
      }
    });

    // ============================
    // PAYMENT ROUTES
    // ============================

    // POST - Create Stripe checkout session
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const { price, name, artId, email } = req.body;
        const amount = Math.round(Number(price) * 100);

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: { currency: "usd", unit_amount: amount, product_data: { name } },
              quantity: 1,
            },
          ],
          mode: "payment",
          customer_email: email,
          metadata: { artId },
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (error) {
        console.error("Stripe session error:", error);
        res.status(500).send({ error: "Stripe session failed" });
      }
    });

    // GET - Payment success (stores payment in DB)
    app.get("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;

        if (!sessionId) {
          return res.status(400).send({ success: false, message: "Session ID missing" });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res.status(400).send({ success: false, message: "Payment not completed" });
        }

        const transactionId = session.payment_intent;
        const artId = String(session.metadata.artId);
        const email = session.customer_email;

        if (!transactionId || !artId || !email) {
          return res.status(400).send({ success: false, message: "Invalid session data" });
        }

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

        res.send({ success: true, message: "Payment stored successfully", transactionId });
      } catch (error) {
        console.error("Payment Success Error:", error);
        res.status(500).send({ success: false, message: "Payment processing failed" });
      }
    });

    // GET - Payment cancelled
    app.get("/dashboard/payment-cancelled", (req, res) => {
      res.send({ success: false, message: "Payment was cancelled by the user." });
    });

    // GET - My purchases
    app.get("/myPurchases", verifyFBToken, async (req, res) => {
      try {
        const email = req.query.email;

        if (!email || email !== req.decoded_email) {
          return res.status(403).send({ success: false, message: "Forbidden access" });
        }

        const result = await paymentsCollection
          .aggregate([
            { $match: { email } },
            {
              $addFields: {
                artObjectId: {
                  $cond: [
                    { $regexMatch: { input: "$artId", regex: /^[0-9a-fA-F]{24}$/ } },
                    { $toObjectId: "$artId" },
                    null,
                  ],
                },
              },
            },
            {
              $lookup: {
                from: "listing",
                localField: "artObjectId",
                foreignField: "_id",
                as: "art",
              },
            },
            { $unwind: { path: "$art", preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id: 1, artId: 1, amount: 1, transactionId: 1,
                paymentStatus: 1, created_at: 1,
                artTitle: "$art.title", image: "$art.image", category: "$art.category",
              },
            },
            { $sort: { created_at: -1 } },
          ])
          .toArray();

        res.send({ success: true, data: result });
      } catch (error) {
        console.error("My Purchases Error:", error);
        res.status(500).send({ success: false, message: "Failed to fetch purchases" });
      }
    });

    // GET - Check if user purchased an art
    app.get("/check-purchase/:artId", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;
        const artId = req.params.artId;

        if (!ObjectId.isValid(artId)) {
          return res.status(400).send({ success: false, purchased: false });
        }

        const purchase = await paymentsCollection.findOne({ email, artId: String(artId) });
        res.send({ success: true, purchased: !!purchase });
      } catch (error) {
        console.error("Check purchase error:", error);
        res.status(500).send({ success: false, purchased: false });
      }
    });

    // GET - Download art (after purchase)
    app.get("/download/:artId", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;
        const artId = req.params.artId;

        if (!ObjectId.isValid(artId)) {
          return res.status(400).send({ success: false, message: "Invalid artId" });
        }

        const payment = await paymentsCollection.findOne({
          email,
          artId,
          downloadAllowed: true,
        });

        if (!payment) {
          return res.status(403).send({ success: false, message: "You have not purchased this item" });
        }

        const art = await listCollection.findOne({ _id: new ObjectId(artId) });

        if (!art) {
          return res.status(404).send({ success: false, message: "Art not found" });
        }

        res.send({ success: true, downloadUrl: art.image, title: art.title });
      } catch (error) {
        console.error("Download error:", error);
        res.status(500).send({ success: false, message: "Server error" });
      }
    });

    // ============================
    // ARTIST ROUTES
    // NOTE: Specific routes before dynamic /:id routes
    // ============================

    // GET - Latest approved artists (home page)
    app.get("/latest-artists", async (req, res) => {
      try {
        const result = await artistsCollection
          .find({ status: "approved" })
          .sort({ created_at: -1 })
          .limit(6)
          .toArray();
        res.send(result);
      } catch (error) {
        console.error("Failed to fetch latest artists:", error);
        res.status(500).send({ message: "Failed to fetch latest artists" });
      }
    });

    // GET - My artist profile
    app.get("/my-artist", verifyFBToken, async (req, res) => {
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

    // GET - All artists (optional status filter)
    app.get("/artists", async (req, res) => {
      try {
        const query = {};
        if (req.query.status) query.status = req.query.status;

        const result = await artistsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error("Failed to fetch artists:", error);
        res.status(500).send({ message: "Failed to fetch artists" });
      }
    });

    // POST - Submit artist request
    app.post("/artists", async (req, res) => {
      try {
        const data = req.body;

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
        res.send({ insertedId: result.insertedId, message: "Artist request submitted successfully" });
      } catch (error) {
        console.error("Failed to insert artist:", error);
        res.status(500).send({ message: "Failed to submit artist request" });
      }
    });

    // ✅ FIX: Specific artist sub-routes BEFORE /artists/:id
    // PATCH - Approve artist (admin)
    app.patch("/artists/approve/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const { email } = req.body;

        const result = await artistsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "approved", approvedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Artist not found" });
        }

        await userCollection.updateOne({ email }, { $set: { role: "artist" } });

        res.send({ success: true, message: "Artist approved and role updated" });
      } catch (error) {
        console.error("Failed to approve artist:", error);
        res.status(500).send({ message: "Failed to approve artist" });
      }
    });

    // PATCH - Reject artist (admin)
    app.patch("/artists/reject/:id", verifyFBToken, verifyAdmin, async (req, res) => {
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

    // PATCH - Update artist profile
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
              updated_at: new Date(),
            },
          }
        );

        res.send(result);
      } catch (error) {
        console.error("Artist profile update failed:", error);
        res.status(500).send({ message: "Artist update failed" });
      }
    });

    // ✅ FIX: /artists/:id AFTER all specific /artists/... routes
    // GET - Single artist by ID
    app.get("/artists/:id", async (req, res) => {
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

    // DELETE - Delete artist (admin)
    app.delete("/artists/:id", verifyFBToken, verifyAdmin, async (req, res) => {
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
    // PROFILE ROUTES
    // ============================

    // GET - Full profile (user + artist if applicable)
    app.get("/profile", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;

        const user = await userCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: "User not found" });

        let artistProfile = null;
        if (user.role === "artist") {
          artistProfile = await artistsCollection.findOne({ email });
        }

        res.send({ user, artist: artistProfile });
      } catch (error) {
        console.error("Failed to fetch profile:", error);
        res.status(500).send({ message: "Failed to fetch profile" });
      }
    });

    // ============================
    // SALES ROUTES
    // ============================

    // GET - My sales (for logged-in artist)
    app.get("/my-sales", verifyFBToken, async (req, res) => {
      try {
        const email = req.query.email;

        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        const payments = await paymentsCollection
          .find({})
          .sort({ created_at: -1 })
          .toArray();

        const listings = await listCollection.find({ email }).toArray();

        const mySales = payments.filter((p) =>
          listings.some((art) => art._id.toString() === p.artId)
        );

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

    // GET - Sales summary
    app.get("/sales-summary", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;

        const listings = await listCollection.find({ email }).toArray();
        const payments = await paymentsCollection
          .find({ artId: { $in: listings.map((a) => a._id.toString()) } })
          .toArray();

        const mySales = payments.filter((p) =>
          listings.some((art) => art._id.toString() === p.artId)
        );

        const totalRevenue = mySales.reduce((sum, p) => sum + p.amount, 0);

        res.send({ totalSales: mySales.length, totalRevenue });
      } catch (error) {
        console.error("Failed to fetch sales summary:", error);
        res.status(500).send({ message: "Failed to fetch sales summary" });
      }
    });
  } finally {
    // keep connection open
  }
}

run().catch(console.dir);

// ============================
// Default Route
// ============================
app.get("/", (req, res) => res.send("Art Gallery API Running 🚀"));
//app.listen(port,()=>console.log(`server running on port ${port}`));

module.exports = app;