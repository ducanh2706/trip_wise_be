// One-off seed: populate hotels.description, hotels.amenities, hotels.images
// Run with:
//   mongosh "<MONGO_URI>" --file scripts/backfill-hotels.js

const AMENITY_POOL = [
  'Free Wi-Fi',
  'Swimming Pool',
  'Gym',
  'Restaurant',
  'Spa',
  'Air Conditioning',
  'Parking',
  'Bar',
  'Room Service',
  'Pet Friendly',
  'Beach Access',
  'Business Center',
  'Concierge',
  'Laundry Service',
];

let count = 0;
db.hotels.find({}).forEach((h) => {
  // amenities: 5–8 items, deterministic-ish per hotel id
  const k = 5 + (h._id % 4);
  const pool = AMENITY_POOL.slice();
  const amenities = [];
  for (let i = 0; i < k && pool.length > 0; i++) {
    const idx = (h._id * 7919 + i * 31) % pool.length;
    amenities.push(pool.splice(idx, 1)[0]);
  }

  // 5 distinct images per hotel, seeded by hotel id
  const images = [1, 2, 3, 4, 5].map(
    (n) => `https://picsum.photos/seed/hotel_${h._id}_${n}/1200/800`,
  );

  const description =
    `Welcome to ${h.name}, located at ${h.address}. ` +
    `Enjoy modern comfort, attentive service, and easy access to local attractions. ` +
    `Whether you're traveling for business or leisure, our team ensures a memorable ` +
    `stay with curated experiences and around-the-clock support.`;

  db.hotels.updateOne(
    { _id: h._id },
    { $set: { description, amenities, images } },
  );
  count++;
});

print(`Updated ${count} hotels`);
printjson(
  db.hotels.findOne(
    { _id: 1 },
    { name: 1, description: 1, amenities: 1, images: 1 },
  ),
);
