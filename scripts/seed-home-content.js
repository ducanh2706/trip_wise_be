// One-off seed: create/backfill the home_content document used by /api/home.
// Run with:
//   mongosh "<MONGO_URI>" --file scripts/seed-home-content.js

const HOME_KEY = 'home';

const defaultDoc = {
  key: HOME_KEY,
  searchCard: {
    headline: 'Where to next?',
    destinationPlaceholder: 'Destination',
    destinationRoute: '/add_location_search',
    searchButtonLabel: 'Search Destinations',
    searchButtonRoute: '/add_location_search?category=all',
    detailItems: [
      {
        icon: 'calendar_today_rounded',
        label: 'DATES',
        value: 'Oct 12 - 18',
      },
      {
        icon: 'group_rounded',
        label: 'GUESTS',
        value: '2 Adults',
      },
    ],
  },
  categories: [
    {
      key: 'hotels',
      icon: 'bed_rounded',
      label: 'HOTELS',
      route: '/add_location_search?category=hotels',
      backgroundTone: 'primary_soft',
      iconTone: 'primary',
    },
    {
      key: 'flights',
      icon: 'flight_rounded',
      label: 'FLIGHTS',
      route: '/add_location_search?category=flights',
      backgroundTone: 'secondary_soft',
      iconTone: 'secondary',
    },
    {
      key: 'tours',
      icon: 'explore_rounded',
      label: 'TOURS',
      route: '/add_location_search?category=tours',
      backgroundTone: 'primary_soft',
      iconTone: 'primary',
    },
    {
      key: 'train',
      icon: 'train_rounded',
      label: 'TRAIN',
      route: '/add_location_search?category=train',
      backgroundTone: 'primary_soft',
      iconTone: 'primary',
    },
  ],
  sections: {
    offers: {
      badgeLabel: 'LIMITED OFFER',
      ctaLabels: ['BOOK NOW', 'VIEW STAY'],
      accentTones: ['primary', 'secondary'],
    },
    recommended: {
      title: 'Recommended',
      subtitle: 'Curated escapes for your style',
      actionLabel: 'See all',
      actionRoute: '/search_filter',
      cardHeights: [240, 180, 180, 240],
    },
    trending: {
      title: 'Trending Hotels',
      detailsActionLabel: 'DETAILS',
      actionLabel: null,
      actionRoute: null,
    },
  },
  curated: {
    featuredHotelIds: [],
    recommendedHotelIds: [],
    trendingHotelIds: [],
  },
  offerOverrides: [],
  recommendedOverrides: [],
  trendingOverrides: [],
};

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function mergeDefaults(existing, defaults) {
  if (Array.isArray(defaults)) {
    return Array.isArray(existing) && existing.length > 0 ? existing : defaults;
  }

  if (!isObject(defaults)) {
    return existing === undefined ? defaults : existing;
  }

  const result = {};
  const keys = new Set([
    ...Object.keys(defaults),
    ...Object.keys(isObject(existing) ? existing : {}),
  ]);

  for (const key of keys) {
    const defaultValue = defaults[key];
    const existingValue = isObject(existing) ? existing[key] : undefined;
    result[key] = mergeDefaults(existingValue, defaultValue);
  }

  return result;
}

const existing = db.home_content.findOne({ key: HOME_KEY }) || {};
const merged = mergeDefaults(existing, defaultDoc);
merged.key = HOME_KEY;

const result = db.home_content.updateOne(
  { key: HOME_KEY },
  { $set: merged },
  { upsert: true },
);

print('Seeded home_content');
printjson({
  matchedCount: result.matchedCount,
  modifiedCount: result.modifiedCount,
  upsertedId: result.upsertedId,
});
printjson(
  db.home_content.findOne(
    { key: HOME_KEY },
    {
      _id: 0,
      key: 1,
      searchCard: 1,
      categories: 1,
      sections: 1,
      curated: 1,
    },
  ),
);
