/*
  Usage:
    node scripts/adjust-room-prices.js <factor> [cap]

  Examples:
    node scripts/adjust-room-prices.js 0.5         # halve all room prices
    node scripts/adjust-room-prices.js 0.8 200     # multiply prices by 0.8, then cap at 200

  The script reads `MONGO_URI` from environment (use .env in repo).
*/
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config();

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required in environment');
  }

  const factor = Number(process.argv[2]);
  const capArg = process.argv[3];
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error('Pass a valid numeric <factor> (e.g. 0.5 to halve prices)');
  }

  const cap = capArg ? Number(capArg) : null;
  if (capArg && !Number.isFinite(cap)) {
    throw new Error('If provided, [cap] must be a valid number');
  }

  await mongoose.connect(process.env.MONGO_URI, { dbName: undefined });
  const db = mongoose.connection.db;

  const cursor = db.collection('rooms').find({}, { projection: { _id: 1, base_price: 1 } });
  const ops = [];
  let read = 0;
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    read++;
    const oldPrice = Number(doc.base_price) || 0;
    let newPrice = Math.round(oldPrice * factor);
    if (cap !== null && newPrice > cap) newPrice = Math.round(cap);
    if (newPrice !== oldPrice) {
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { base_price: newPrice } } } });
    }
    if (ops.length >= 500) {
      await db.collection('rooms').bulkWrite(ops);
      ops.length = 0;
    }
  }

  if (ops.length) await db.collection('rooms').bulkWrite(ops);

  console.log(JSON.stringify({ ok: true, factor, cap, scanned: read }, null, 2));

  await mongoose.disconnect();
}

main()
  .catch((err) => {
    console.error(err && (err.stack || err.message || err));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (e) {}
  });
