const express = require('express')
const cors = require('cors');

const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');


const port = process.env.PORT || 3000

//middleware
app.use(express.json());
app.use(cors());

const uri = "mongodb+srv://<db_username>:<db_password>@cluster0.8v42xkx.mongodb.net/?appName=Cluster0";

app.get('/', (req, res) => {
  res.send('zap shift!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})