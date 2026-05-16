// One-off seed: build the `reviews` collection from REAL users in `db.users`.
// Full rebuild (drops existing reviews), deterministic, so re-running is safe.
//
// Run with:
//   mongosh "<MONGO_URI>" --file scripts/backfill-reviews.js
// or, inside an open mongosh session:
//   load("scripts/backfill-reviews.js")

// ---- deterministic PRNG (mulberry32) so re-runs produce identical data ----
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
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const randInt = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

// Travel reviews skew positive — weighted rating buckets.
function weightedRating(r) {
  const x = r();
  if (x < 0.45) return 5;
  if (x < 0.75) return 4;
  if (x < 0.88) return 3;
  if (x < 0.95) return 2;
  return 1;
}

const TRIP_TYPES = ['Solo', 'Couple', 'Family', 'Business', 'Friends'];

const OPENERS = {
  hi: [
    'Absolutely loved our stay here.',
    'Exceeded every expectation.',
    'One of the best hotels we have stayed at.',
    'A truly memorable experience from start to finish.',
    'Fantastic property, would book again in a heartbeat.',
  ],
  mid: [
    'Decent stay overall, with a few things to note.',
    'It was fine — nothing remarkable, nothing terrible.',
    'A reasonable choice for the price.',
    'Mixed feelings about this one.',
  ],
  lo: [
    'Unfortunately this did not live up to expectations.',
    'Disappointing stay, would not return.',
    'Several issues made this a frustrating experience.',
    'Not what was advertised, sadly.',
  ],
};
const BODIES = {
  hi: [
    'The room was spotless, spacious and the bed incredibly comfortable.',
    'Staff went above and beyond — warm, attentive and genuinely helpful.',
    'Location is unbeatable, walking distance to everything we wanted to see.',
    'Breakfast was excellent with a great variety of fresh options.',
    'The view from our room was stunning, especially at sunset.',
    'Check-in was quick and the concierge gave us perfect local tips.',
  ],
  mid: [
    'The room was clean but a little smaller than the photos suggested.',
    'Service was polite though a bit slow at peak times.',
    'Good location, but the area gets noisy in the evening.',
    'Breakfast was okay, the selection could be wider.',
    'Wi-Fi was reliable in the lobby but weak in the room.',
  ],
  lo: [
    'The room was not as clean as we had hoped on arrival.',
    'Front desk was unhelpful and check-in took far too long.',
    'There was constant noise and the walls felt paper-thin.',
    'Several amenities listed were unavailable during our stay.',
    'Value for money simply was not there.',
  ],
};
const CLOSERS = {
  hi: [
    'Highly recommended — we will definitely be back.',
    'Worth every dong. Five stars.',
    'Cannot wait to return on our next trip.',
    'Thank you to the whole team for a wonderful stay.',
  ],
  mid: [
    'Would consider staying again if the price is right.',
    'Fine for a short stay, manage your expectations.',
    'Okay for the money, but I would shop around.',
  ],
  lo: [
    'I expected much more for the price paid.',
    'Would not recommend without significant improvements.',
    'We cut our stay short and moved elsewhere.',
  ],
};
function tier(rating) {
  if (rating >= 4) return 'hi';
  if (rating === 3) return 'mid';
  return 'lo';
}
function buildComment(r, rating) {
  const t = tier(rating);
  const parts = [pick(r, OPENERS[t]), pick(r, BODIES[t])];
  if (r() < 0.65) parts.push(pick(r, BODIES[t]));
  parts.push(pick(r, CLOSERS[t]));
  // de-dup accidental repeats
  return parts.filter((p, i) => parts.indexOf(p) === i).join(' ');
}

// ---- real users as authors ----
let users = db.users
  .find(
    { full_name: { $exists: true, $ne: null, $ne: '' } },
    { full_name: 1, image: 1, role: 1 },
  )
  .toArray();
const EXCLUDE = ['PROVIDER', 'ADMIN', 'HOST'];
const customers = users.filter(
  (u) => !EXCLUDE.includes(String(u.role || '').toUpperCase()),
);
if (customers.length >= 5) users = customers;
if (users.length === 0) {
  throw new Error('No users found in db.users — cannot author real reviews.');
}
print(`Authoring reviews from ${users.length} real users.`);

const NOW = Date.now();
const DAY = 86400000;

db.reviews.deleteMany({});

let id = 0;
let hotelCount = 0;
const batch = [];
db.hotels.find({ deleted_at: null }, { _id: 1 }).forEach((h) => {
  const r = rng(h._id * 2654435761);
  const n = 6 + ((h._id * 7) % 23); // 6..28 reviews per hotel
  for (let i = 0; i < n; i++) {
    const rating = weightedRating(r);
    const u = users[Math.floor(r() * users.length)];
    const daysAgo = randInt(r, 1, 540);
    batch.push({
      _id: ++id,
      hotel_id: h._id,
      user_id: u._id,
      author_name: u.full_name,
      author_image: u.image || null,
      rating,
      comment: buildComment(r, rating),
      trip_type: pick(r, TRIP_TYPES),
      created_at: new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10),
      deleted_at: null,
    });
  }
  hotelCount++;
});

if (batch.length) db.reviews.insertMany(batch);
db.reviews.createIndex({ hotel_id: 1, created_at: -1, _id: -1 });

print(`Inserted ${batch.length} reviews across ${hotelCount} hotels.`);
printjson(db.reviews.find({ hotel_id: 1 }).sort({ created_at: -1 }).limit(2).toArray());
