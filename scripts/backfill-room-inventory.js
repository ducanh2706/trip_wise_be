// Seed room_inventory for the demo provider's rooms across
// 2026-05-01 .. 2026-07-31 so the Inventory & Pricing calendar has a full,
// realistic month (mix of available / surge / closed days).
// Deterministic (hash of room+date) and idempotent (clears the window for
// these rooms first, so re-running does not duplicate).
//
// Run with:  node scripts/backfill-room-inventory.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const PROVIDER_ID = '51bbb04b-196e-4cb1-ba61-6fa4e42fdf68';
const WINDOW = [
  { year: 2026, month: 5 },
  { year: 2026, month: 6 },
  { year: 2026, month: 7 },
];

const pad2 = (n) => String(n).padStart(2, '0');

// Small stable string hash → non-negative int (deterministic per room+date).
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const hotelsCol = db.collection('hotels');
  const roomsCol = db.collection('rooms');
  const invCol = db.collection('room_inventory');

  const hotels = await hotelsCol
    .find({ provider_id: PROVIDER_ID, deleted_at: null }, { projection: { _id: 1 } })
    .toArray();
  const hotelIds = hotels.map((h) => h._id);
  const rooms = await roomsCol
    .find(
      { hotel_id: { $in: hotelIds }, deleted_at: null },
      { projection: { _id: 1, base_price: 1 } },
    )
    .toArray();

  if (rooms.length === 0) {
    console.log(`No rooms for provider ${PROVIDER_ID} — nothing to do.`);
    await mongoose.disconnect();
    return;
  }
  const roomIds = rooms.map((r) => r._id);

  // Build the date window once.
  const dates = [];
  for (const { year, month } of WINDOW) {
    const days = new Date(year, month, 0).getDate();
    for (let d = 1; d <= days; d++) dates.push(`${year}-${pad2(month)}-${pad2(d)}`);
  }
  const winStart = dates[0];
  const winEnd = dates[dates.length - 1];

  // Idempotent: clear this window for these rooms before re-inserting.
  const del = await invCol.deleteMany({
    room_id: { $in: roomIds },
    date: { $gte: winStart, $lte: winEnd },
  });

  const top = await invCol.find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).toArray();
  let nextId = (top.length ? top[0]._id : 0) + 1;
  const now = new Date().toISOString();

  const docs = [];
  for (const room of rooms) {
    const base = room.base_price || 0;
    for (const date of dates) {
      const h = hash(`${room._id}-${date}`);
      const bucket = h % 100;
      let available_qty;
      let price_override;
      if (bucket < 15) {
        available_qty = 0; // ~15% closed
        price_override = null;
      } else if (bucket < 30) {
        available_qty = 1 + (h % 20); // ~15% surge → "highPrice"
        price_override = Math.round(base * 1.2);
      } else {
        available_qty = 5 + (h % 21); // ~70% available at base price
        price_override = null;
      }
      docs.push({
        _id: nextId++,
        room_id: room._id,
        date,
        available_qty,
        price_override,
        created_at: now,
        updated_at: now,
      });
    }
  }

  const ins = await invCol.insertMany(docs);

  console.log(
    `Provider ${PROVIDER_ID}: ${hotelIds.length} hotels, ${rooms.length} rooms.`,
  );
  console.log(`Window ${winStart} .. ${winEnd} (${dates.length} days/room).`);
  console.log(
    `Deleted ${del.deletedCount} old rows, inserted ${ins.insertedCount} new rows.`,
  );
  console.log(
    JSON.stringify(
      await invCol.find({ room_id: roomIds[0] }).sort({ date: 1 }).limit(3).toArray(),
      null,
      2,
    ),
  );
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
