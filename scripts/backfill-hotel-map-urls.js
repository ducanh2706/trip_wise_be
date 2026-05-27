// One-off seed: rebuild hotels.google_map_url as a Google Maps TEXT search
// (name + address + city + country) instead of the lat/lng query that used
// to be here. The seed lat/lngs are fake and put the pin in the ocean — a
// text query lets Google geocode to the actual place.
//
// Run with:
//   node scripts/backfill-hotel-map-urls.js
//
// (mongosh --file works too, but Node + dotenv avoids the URI-on-cmdline
//  permission issue noted in CLAUDE.md.)

require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // Build a quick lookup: location id → { name, parent_id, type }
  const locationDocs = await db
    .collection('locations')
    .find({})
    .project({ _id: 1, name: 1, parent_id: 1, type: 1 })
    .toArray();
  const locById = new Map(locationDocs.map((l) => [l._id, l]));

  function walkTrail(startId) {
    const trail = [];
    let id = startId;
    for (let i = 0; i < 8 && id != null; i++) {
      const loc = locById.get(id);
      if (!loc) break;
      trail.push(loc);
      id = loc.parent_id;
    }
    return trail;
  }

  function pickByType(trail, types) {
    for (const t of types) {
      const hit = trail.find(
        (l) => (l.type || '').toUpperCase() === t.toUpperCase(),
      );
      if (hit && hit.name) return hit.name.trim();
    }
    return null;
  }

  const hotels = await db
    .collection('hotels')
    .find({ deleted_at: null })
    .project({ _id: 1, name: 1, address: 1, location_id: 1 })
    .toArray();

  let updated = 0;
  let skipped = 0;
  for (const h of hotels) {
    const trail = walkTrail(h.location_id);
    const city =
      pickByType(trail, ['CITY']) ||
      pickByType(trail, ['DISTRICT', 'PROVINCE']);
    const country = pickByType(trail, ['COUNTRY']) || 'Vietnam';

    const parts = [h.name, h.address, city, country]
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter(Boolean);

    if (parts.length === 0) {
      skipped++;
      continue;
    }

    const query = parts.join(', ');
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

    await db
      .collection('hotels')
      .updateOne({ _id: h._id }, { $set: { google_map_url: url } });
    updated++;
  }

  console.log(`Updated: ${updated}, Skipped: ${skipped}`);

  // Show 5 samples
  const samples = await db
    .collection('hotels')
    .find({ _id: { $in: [1, 8, 38, 84, 97] } })
    .project({ _id: 1, name: 1, address: 1, google_map_url: 1 })
    .toArray();
  for (const s of samples) {
    console.log(`#${s._id}  ${s.name}`);
    console.log(`    ${s.address}`);
    console.log(`    ${s.google_map_url}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
