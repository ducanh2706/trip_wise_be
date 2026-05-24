/*
  Usage:
    node scripts/adjust-room-prices-clamp.js [min] [max]

  Examples:
    node scripts/adjust-room-prices-clamp.js         # defaults to 50 2000
    node scripts/adjust-room-prices-clamp.js 100 1500

  The script reads `MONGO_URI` from environment (use .env in repo).
*/
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config();

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required in environment');
  }

  const minArg = process.argv[2];
  const maxArg = process.argv[3];
  const min = minArg ? Number(minArg) : 50;
  const max = maxArg ? Number(maxArg) : 2000;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) {
    throw new Error('Invalid min/max. Usage: node scripts/adjust-room-prices-clamp.js [min] [max]');
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
    let newPrice = oldPrice;
    if (oldPrice < min) newPrice = Math.round(min);
    if (oldPrice > max) newPrice = Math.round(max);
    if (newPrice !== oldPrice) {
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { base_price: newPrice } } } });
    }
    if (ops.length >= 500) {
      await db.collection('rooms').bulkWrite(ops);
      ops.length = 0;
    }
  }

  if (ops.length) await db.collection('rooms').bulkWrite(ops);

  console.log(JSON.stringify({ ok: true, min, max, scanned: read }, null, 2));

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
