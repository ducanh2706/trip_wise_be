const path = require('path');
const { MongoClient } = require('mongodb');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGO_URI;
const minPrice = Math.max(1, Math.round(Number(process.argv[2] || 50)));
const maxPrice = Math.max(minPrice, Math.round(Number(process.argv[3] || 2000)));

if (!MONGO_URI) {
  throw new Error('MONGO_URI is missing in .env');
}

function numericId(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value) {
  return Math.min(maxPrice, Math.max(minPrice, Math.round(value)));
}

function roomPrice(room, hotel) {
  const star = Number(hotel?.star_rating || 4);
  const tierBase = star >= 4.8 ? 260 : star >= 4.4 ? 180 : star >= 4 ? 120 : 70;
  const spread = (numericId(room._id) * 97 + numericId(room.hotel_id) * 53) % (maxPrice - minPrice);
  return clamp(tierBase + spread);
}

function inventoryOverride(basePrice, row) {
  const bucket = (numericId(row._id) * 37 + numericId(row.room_id) * 11) % 7;
  const multiplier = 0.85 + bucket * 0.05;
  return clamp(basePrice * multiplier);
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();

  const hotels = await db.collection('hotels').find({ deleted_at: null }).toArray();
  const hotelById = new Map(hotels.map((hotel) => [hotel._id, hotel]));
  const rooms = await db.collection('rooms').find({ deleted_at: null }).toArray();
  const now = new Date().toISOString();

  let roomUpdates = 0;
  let inventoryUpdates = 0;
  const priceByRoomId = new Map();

  for (const room of rooms) {
    const hotel = hotelById.get(room.hotel_id);
    if (!hotel) continue;

    const price = roomPrice(room, hotel);
    priceByRoomId.set(room._id, price);
    const result = await db.collection('rooms').updateOne(
      { _id: room._id },
      {
        $set: {
          base_price: price,
          updated_at: now,
        },
      },
    );
    roomUpdates += result.modifiedCount;
  }

  const inventoryRows = db.collection('room_inventory').find({
    room_id: { $in: Array.from(priceByRoomId.keys()) },
    price_override: { $ne: null },
  });

  for await (const row of inventoryRows) {
    const basePrice = priceByRoomId.get(row.room_id);
    if (!basePrice) continue;
    const price = inventoryOverride(basePrice, row);
    const result = await db.collection('room_inventory').updateOne(
      { _id: row._id },
      {
        $set: {
          price_override: price,
          updated_at: now,
        },
      },
    );
    inventoryUpdates += result.modifiedCount;
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

  console.log(
    JSON.stringify(
      {
        ok: true,
        db: db.databaseName,
        range: { min: minPrice, max: maxPrice, currency: 'USD' },
        rooms: rooms.length,
        roomUpdates,
        inventoryUpdates,
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
