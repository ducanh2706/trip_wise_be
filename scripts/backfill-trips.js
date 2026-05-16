// Seed a `trips` collection (itineraries) for the demo user — no trip data
// exists. Each trip embeds days -> timed items referencing REAL activities
// + REAL users (companions). Full rebuild, deterministic, safe to re-run.
//
// Run with:  node scripts/backfill-trips.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

// Demo user — same one slice 2 (wallet) pins; see src/config/env.ts.
const DEMO_USER_ID = '337b6ec4-bd20-474c-9318-5898cfba516e';

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

const CATEGORIES = ['FOOD', 'SIGHTSEEING', 'TRANSPORT', 'OUTDOORS'];
function deriveCategory(title, id) {
  const t = title || '';
  if (/(ẩm thực|ăn|food|nhà hàng|gelato|cà phê|buffet|đặc sản)/i.test(t)) return 'FOOD';
  if (/(xe|đưa đón|transfer|shuttle|tàu|phà|sân bay|airport)/i.test(t)) return 'TRANSPORT';
  if (/(trekking|leo núi|lặn|biển|beach|hike|surf|kayak|camping|thác|đảo|rừng)/i.test(t)) return 'OUTDOORS';
  if (/(tham quan|bảo tàng|di tích|chùa|đền|tour|phố cổ|cung điện|museum)/i.test(t)) return 'SIGHTSEEING';
  return CATEGORIES[id % CATEGORIES.length];
}

const TIMES = ['08:30', '10:00', '12:30', '15:00', '17:30', '20:00'];
const DESTS = [
  { name: 'Đà Nẵng, Việt Nam', title: 'Khám phá Đà Nẵng' },
  { name: 'Nha Trang, Khánh Hòa', title: 'Kỳ nghỉ biển Nha Trang' },
  { name: 'Hà Nội, Việt Nam', title: 'Hành trình Hà Nội' },
];
const TRIPS = [
  { status: 'ONGOING', start: '2026-05-14', end: '2026-05-19' },
  { status: 'UPCOMING', start: '2026-06-02', end: '2026-06-06' },
  { status: 'COMPLETED', start: '2026-04-03', end: '2026-04-08' },
];

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const locs = await db.collection('locations').find({}).toArray();
  const locById = {};
  for (const l of locs) locById[l._id] = l;
  const locName = (id) => {
    const l = locById[id];
    if (!l) return 'Việt Nam';
    const p = l.parent_id != null ? locById[l.parent_id] : null;
    return p ? `${l.name}, ${p.name}` : l.name;
  };

  const activities = (
    await db
      .collection('activities')
      .find({ status: 'LIVE', deleted_at: null })
      .sort({ _id: 1 })
      .toArray()
  ).map((a) => ({
    _id: a._id,
    title: a.title,
    category: a.category || deriveCategory(a.title, a._id),
    location_name: locName(a.location_id),
  }));

  const companionPool = (
    await db
      .collection('users')
      .find({ role: 'USER', _id: { $ne: DEMO_USER_ID } })
      .sort({ _id: 1 })
      .limit(16)
      .toArray()
  ).map((u) => ({ user_id: u._id, name: u.full_name, image: u.image }));

  const docs = TRIPS.map((meta, ti) => {
    const r = rng((ti + 1) * 0x9e3779b1);
    const dest = DESTS[ti % DESTS.length];
    const nDays =
      Math.round((new Date(meta.end) - new Date(meta.start)) / 86400000) ||
      randInt(r, 3, 5);
    const days = [];
    for (let d = 0; d < nDays; d++) {
      const nItems = randInt(r, 2, 4);
      const items = TIMES.slice(0, nItems).map((time) => {
        const act = pick(r, activities);
        const nComp = randInt(r, 0, 3);
        const companions = [];
        for (let c = 0; c < nComp; c++) companions.push(pick(r, companionPool));
        return {
          time,
          title: act.title,
          location_name: act.location_name,
          category: act.category,
          activity_id: act._id,
          companions,
        };
      });
      days.push({ day_index: d + 1, date: addDays(meta.start, d), items });
    }
    return {
      _id: `TRIP${String(ti + 1).padStart(8, '0')}`,
      user_id: DEMO_USER_ID,
      title: dest.title,
      destination: dest.name,
      status: meta.status,
      cover_image: `https://picsum.photos/seed/trip_${ti + 1}_cover/1200/800`,
      map_image: `https://picsum.photos/seed/trip_${ti + 1}_map/400/400`,
      start_date: meta.start,
      end_date: meta.end,
      days,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  const col = db.collection('trips');
  await col.deleteMany({});
  await col.insertMany(docs);
  await col.createIndex({ user_id: 1, status: 1 });
  console.log(
    `trips rebuilt: inserted ${docs.length} for demo user ${DEMO_USER_ID}`,
  );
  for (const t of docs) {
    const items = t.days.reduce((s, d) => s + d.items.length, 0);
    console.log(
      `  ${t._id} ${t.status} "${t.title}" days=${t.days.length} items=${items}`,
    );
  }
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
