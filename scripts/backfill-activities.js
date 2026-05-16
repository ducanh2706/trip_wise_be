// Enrich the REAL `activities` collection with UI fields for the
// "Add Activity" screen: description / rating / image / category.
// Deterministic (seeded by _id) so re-running is idempotent.
//
// Run with:  node scripts/backfill-activities.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

// ---- deterministic PRNG (mulberry32) ----
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Travel ratings skew positive: weighted 3.5 .. 5.0 (one decimal).
function weightedRating(r) {
  const x = r();
  let v;
  if (x < 0.45) v = 4.6 + r() * 0.4;
  else if (x < 0.8) v = 4.1 + r() * 0.5;
  else if (x < 0.94) v = 3.6 + r() * 0.5;
  else v = 3.5 + r() * 0.3;
  return Math.round(v * 10) / 10;
}

const CATEGORIES = ['FOOD', 'SIGHTSEEING', 'TRANSPORT', 'OUTDOORS'];
const KW = [
  ['FOOD', /(ẩm thực|ăn|food|nhà hàng|gelato|cà phê|coffee|buffet|đặc sản)/i],
  ['TRANSPORT', /(xe|đưa đón|transfer|shuttle|coach|tàu|phà|vé máy bay|sân bay|airport)/i],
  ['OUTDOORS', /(trekking|leo núi|lặn|biển|beach|hike|hiking|surf|kayak|cắm trại|camping|thác|đảo|island|rừng)/i],
  ['SIGHTSEEING', /(tham quan|bảo tàng|di tích|chùa|đền|tour|city|phố cổ|cung điện|lâu đài|museum)/i],
];
function deriveCategory(title, id) {
  for (const [cat, re] of KW) if (re.test(title || '')) return cat;
  return CATEGORIES[id % CATEGORIES.length];
}

const CAT_BLURB = {
  FOOD: 'A guided tasting experience celebrating authentic local flavours and family recipes.',
  SIGHTSEEING: 'A curated walk through the area’s landmarks with stories from expert local guides.',
  TRANSPORT: 'Comfortable, stress-free transfers with reliable pickup and friendly drivers.',
  OUTDOORS: 'An active outdoor adventure with stunning scenery and small, well-led groups.',
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.db.collection('activities');
  const all = await col.find({}).sort({ _id: 1 }).toArray();
  let modified = 0;
  for (const a of all) {
    const r = rng(a._id * 2654435761);
    const category = deriveCategory(a.title, a._id);
    const rating = weightedRating(r);
    const description =
      `${a.title}. ${CAT_BLURB[category]} ` +
      `Highly rated by travellers (${rating.toFixed(1)}★) and easy to add to your trip.`;
    const image = `https://picsum.photos/seed/activity_${a._id}/800/600`;
    const res = await col.updateOne(
      { _id: a._id },
      { $set: { category, rating, description, image } },
    );
    modified += res.modifiedCount;
  }
  console.log(`activities enriched: matched ${all.length}, modified ${modified}`);
  console.log(
    JSON.stringify(
      await col
        .find({}, { projection: { title: 1, category: 1, rating: 1, image: 1 } })
        .limit(3)
        .toArray(),
      null,
      2,
    ),
  );
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
