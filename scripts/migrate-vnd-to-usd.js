const path = require('path');
const { MongoClient } = require('mongodb');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGO_URI;
const MIGRATION_ID = '2026-05-25-vnd-to-usd';
const VND_PER_USD = Number(process.env.VND_PER_USD || 25000);
const force = process.argv.includes('--force');

if (!MONGO_URI) {
  throw new Error('MONGO_URI is missing in .env');
}
if (!Number.isFinite(VND_PER_USD) || VND_PER_USD <= 0) {
  throw new Error('VND_PER_USD must be a positive number');
}

const moneyFieldsByCollection = {
  activities: ['base_price'],
  flights: ['base_price'],
  rooms: ['base_price'],
  room_inventory: ['price_override'],
  bookings: ['total_price', 'total_amount', 'discount_amount', 'final_amount'],
  booking_items: [
    'price_per_unit',
    'total_price',
    'gross_amount',
    'commission_amount',
    'provider_net_amount',
    'refund_amount',
  ],
  payments: ['amount'],
  wallets: ['balance'],
  cards: ['balance'],
  wallet_transactions: ['amount'],
  provider_payout_requests: ['amount', 'gross_amount', 'commission_amount'],
};

const currencyCollections = ['bookings', 'provider_payout_requests'];

function toUsd(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  return Math.round((value / VND_PER_USD) * 100) / 100;
}

function hasConvertibleField(doc, fields) {
  return fields.some((field) => typeof doc[field] === 'number' && Number.isFinite(doc[field]));
}

async function convertCollection(db, collectionName, fields) {
  const collection = db.collection(collectionName);
  const cursor = collection.find({}, { projection: Object.fromEntries(fields.map((f) => [f, 1])) });
  let scanned = 0;
  let modified = 0;
  const ops = [];

  for await (const doc of cursor) {
    scanned += 1;
    if (!hasConvertibleField(doc, fields)) continue;
    const $set = {};
    for (const field of fields) {
      if (typeof doc[field] === 'number' && Number.isFinite(doc[field])) {
        $set[field] = toUsd(doc[field]);
      }
    }
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set } } });
    if (ops.length >= 500) {
      const result = await collection.bulkWrite(ops, { ordered: false });
      modified += result.modifiedCount;
      ops.length = 0;
    }
  }

  if (ops.length) {
    const result = await collection.bulkWrite(ops, { ordered: false });
    modified += result.modifiedCount;
  }

  return { scanned, modified };
}

async function recomputeWalletPoints(db) {
  const wallets = await db.collection('wallets').find({}).project({ user_id: 1 }).toArray();
  let modified = 0;

  for (const wallet of wallets) {
    const userId = wallet.user_id;
    if (!userId) continue;

    const bookings = await db
      .collection('bookings')
      .find({ user_id: userId })
      .project({ _id: 1 })
      .toArray();
    const bookingIds = bookings.map((booking) => String(booking._id));

    let completedInvoice = 0;
    if (bookingIds.length > 0) {
      const items = await db
        .collection('booking_items')
        .find({
          booking_id: { $in: bookingIds },
          item_status: { $in: ['COMPLETED', 'DONE'] },
        })
        .project({ total_price: 1, gross_amount: 1 })
        .toArray();
      completedInvoice = items.reduce((sum, item) => {
        const amount =
          typeof item.total_price === 'number'
            ? item.total_price
            : typeof item.gross_amount === 'number'
              ? item.gross_amount
              : 0;
        return sum + Math.max(0, amount);
      }, 0);
    }

    const redemptions = await db
      .collection('wallet_transactions')
      .find({ user_id: userId, type: 'POINT_REDEEM', status: 'SUCCESS' })
      .project({ amount: 1 })
      .toArray();
    const redeemed = redemptions.reduce((sum, tx) => sum + Math.max(0, tx.amount || 0), 0);
    const earned = Math.round(completedInvoice * 0.01);
    const loyaltyPoints = Math.max(earned - Math.round(redeemed), 0);

    const result = await db.collection('wallets').updateOne(
      { _id: wallet._id },
      {
        $set: {
          loyalty_points: loyaltyPoints,
          updated_at: new Date().toISOString(),
        },
      },
    );
    modified += result.modifiedCount;
  }

  return { scanned: wallets.length, modified };
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();
  const meta = db.collection('migration_meta');

  const existing = await meta.findOne({ _id: MIGRATION_ID });
  if (existing && !force) {
    console.log(`Migration ${MIGRATION_ID} already ran at ${existing.ran_at}.`);
    console.log('Use --force only if you intentionally need to divide money fields again.');
    await client.close();
    return;
  }

  const summary = {};
  for (const [collectionName, fields] of Object.entries(moneyFieldsByCollection)) {
    summary[collectionName] = await convertCollection(db, collectionName, fields);
  }

  for (const collectionName of currencyCollections) {
    await db.collection(collectionName).updateMany({}, { $set: { currency: 'USD' } });
  }

  const homeContent = db.collection('home_content');
  for await (const doc of homeContent.find({ recommendedOverrides: { $type: 'array' } })) {
    await homeContent.updateOne(
      { _id: doc._id },
      {
        $set: {
          recommendedOverrides: doc.recommendedOverrides.map((item) => ({
            ...item,
            priceLabel: null,
          })),
        },
      },
    );
  }

  summary.wallet_points = await recomputeWalletPoints(db);

  await meta.updateOne(
    { _id: MIGRATION_ID },
    {
      $set: {
        _id: MIGRATION_ID,
        rate: VND_PER_USD,
        ran_at: new Date().toISOString(),
        summary,
      },
    },
    { upsert: true },
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        migration: MIGRATION_ID,
        db: db.databaseName,
        rate: VND_PER_USD,
        summary,
      },
      null,
      2,
    ),
  );

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
