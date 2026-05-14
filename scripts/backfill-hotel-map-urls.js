// One-off seed: populate hotels.google_map_url from latitude/longitude.
// Run with:
//   mongosh "<MONGO_URI>" --file scripts/backfill-hotel-map-urls.js

const result = db.hotels.updateMany(
  { latitude: { $ne: null }, longitude: { $ne: null } },
  [
    {
      $set: {
        google_map_url: {
          $concat: [
            'https://www.google.com/maps/search/?api=1&query=',
            { $toString: '$latitude' },
            ',',
            { $toString: '$longitude' },
          ],
        },
      },
    },
  ],
);

print(`Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
printjson(
  db.hotels.findOne({ _id: 1 }, { name: 1, latitude: 1, longitude: 1, google_map_url: 1 }),
);
