const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const mongoose = require('mongoose');

/**
 * Connects to MongoDB using the URI in .env
 * We exit the process on failure because an API with no database
 * is not useful — better to fail loudly at boot than to serve 500s.
 */
async function connectDB() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('[db] MONGO_URI is missing. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(uri);
    console.log(`[db] MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
  } catch (err) {
    console.error(`[db] Connection failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = connectDB;
