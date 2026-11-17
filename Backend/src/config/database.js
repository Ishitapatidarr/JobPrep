const mongoose = require("mongoose")
require("./env")

/**
 * Connects to MongoDB. Rejects (instead of swallowing the error) so the caller
 * can decide what to do — server.js refuses to start without a database.
 */
async function connectToDB() {
    const uri = process.env.MONGO_URI

    if (!uri || !uri.trim()) {
        throw new Error("MONGO_URI is not set in Backend/.env")
    }

    // Fail within 10s instead of the 30s default when the cluster is unreachable
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 })
    console.log("Connected to MongoDB")
}

module.exports = connectToDB;
