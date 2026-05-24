const path = require('path');
const { randomUUID } = require('crypto');
const { MongoClient } = require('mongodb');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  throw new Error('MONGO_URI is missing in .env');
}

const DEMO_USER_ID =
  process.env.DEMO_USER_ID || '337b6ec4-bd20-474c-9318-5898cfba516e';
const DEMO_PROVIDER_ID =
  process.env.DEMO_PROVIDER_ID || '51bbb04b-196e-4cb1-ba61-6fa4e42fdf68';
const ALT_PROVIDER_ID = '2f5f9f0f-8e2e-4f1b-8cc8-77f70d9d9c90';

const nowIso = () => new Date().toISOString();
const usd = (vnd) => Math.round((vnd || 0) / 25000);
const isoWithOffsetDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};
const dateOnlyWithOffsetDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

async function bulkUpsertById(col, docs, setOnInsertOnly = false) {
  if (!docs.length) return { matchedCount: 0, upsertedCount: 0 };
  const ops = docs.map((doc) => {
    const { _id, ...rest } = doc;
    return {
      updateOne: {
        filter: { _id },
        update: setOnInsertOnly
          ? { $setOnInsert: doc }
          : { $set: rest, $setOnInsert: { _id } },
        upsert: true,
      },
    };
  });
  return col.bulkWrite(ops, { ordered: false });
}

function makeHotels() {
  const now = nowIso();
  return [
    {
      _id: 1001,
      provider_id: DEMO_PROVIDER_ID,
      location_id: 2,
      name: 'Veligandu Island Resort',
      address: 'Da Nang, Vietnam',
      star_rating: 4.8,
      status: 'LIVE',
      listing_status: 'active',
      listing_category: 'Hotel',
      image:
        'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1200&q=80',
      ],
      description: 'Ocean-facing resort with premium amenities and family-friendly stay.',
      amenities: ['WiFi', 'Pool', 'Parking', 'Breakfast', 'Spa', 'Airport shuttle'],
      bedrooms: 2,
      bathrooms: 2,
      max_guests: 4,
      latitude: 16.0678,
      longitude: 108.2208,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 1002,
      provider_id: DEMO_PROVIDER_ID,
      location_id: 3,
      name: 'Saigon Skyline Suites',
      address: 'Ho Chi Minh City, Vietnam',
      star_rating: 4.6,
      status: 'LIVE',
      listing_status: 'active',
      listing_category: 'Apartment',
      image:
        'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80',
      ],
      description: 'City-center suites with skyline view, ideal for work and leisure.',
      amenities: ['WiFi', 'Kitchen', 'Gym', 'Washer', '24h Check-in'],
      bedrooms: 1,
      bathrooms: 1,
      max_guests: 3,
      latitude: 10.7769,
      longitude: 106.7009,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 1003,
      provider_id: DEMO_PROVIDER_ID,
      location_id: 4,
      name: 'Old Quarter Heritage House',
      address: 'Ha Noi, Vietnam',
      star_rating: 4.3,
      status: 'PENDING_REVIEW',
      listing_status: 'pending',
      listing_category: 'Homestay',
      image:
        'https://images.unsplash.com/photo-1566669437685-b88d8f2ea7f7?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1566669437685-b88d8f2ea7f7?auto=format&fit=crop&w=1200&q=80',
      ],
      description: 'Traditional townhouse in the old quarter with curated local experiences.',
      amenities: ['WiFi', 'Breakfast', 'Local tour desk'],
      bedrooms: 2,
      bathrooms: 1,
      max_guests: 4,
      latitude: 21.0333,
      longitude: 105.85,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 1004,
      provider_id: DEMO_PROVIDER_ID,
      location_id: 6,
      name: 'Hoi An Riverside Retreat',
      address: 'Hoi An, Vietnam',
      star_rating: 4.1,
      status: 'PAUSED',
      listing_status: 'inactive',
      listing_category: 'Villa',
      image:
        'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80',
      ],
      description: 'Quiet riverside villa currently paused for seasonal renovation.',
      amenities: ['Pool', 'Garden', 'Parking'],
      bedrooms: 3,
      bathrooms: 2,
      max_guests: 6,
      latitude: 15.88,
      longitude: 108.338,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 1005,
      provider_id: DEMO_PROVIDER_ID,
      location_id: 5,
      name: 'Nha Trang Bay Hotel',
      address: 'Nha Trang, Vietnam',
      star_rating: 4.7,
      status: 'LIVE',
      listing_status: 'active',
      listing_category: 'Hotel',
      image:
        'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1200&q=80',
      ],
      description: 'Beachfront property with modern rooms and panoramic bay views.',
      amenities: ['WiFi', 'Pool', 'Breakfast', 'Beach access', 'Kids club'],
      bedrooms: 2,
      bathrooms: 2,
      max_guests: 4,
      latitude: 12.2388,
      longitude: 109.1967,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 1010,
      provider_id: ALT_PROVIDER_ID,
      location_id: 7,
      name: 'Phu Quoc Sunset Bungalows',
      address: 'Phu Quoc, Vietnam',
      star_rating: 4.5,
      status: 'LIVE',
      listing_status: 'active',
      listing_category: 'Bungalow',
      image:
        'https://images.unsplash.com/photo-1455587734955-081b22074882?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1455587734955-081b22074882?auto=format&fit=crop&w=1200&q=80',
      ],
      description: 'Sunset-facing bungalows for island breaks and slow travel.',
      amenities: ['WiFi', 'Beach access', 'Bar', 'Scooter rental'],
      bedrooms: 1,
      bathrooms: 1,
      max_guests: 2,
      latitude: 10.2899,
      longitude: 103.984,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
  ];
}

function makeRooms() {
  return [
    {
      _id: 2001,
      hotel_id: 1001,
      room_type: 'Deluxe Ocean View',
      capacity: 2,
      base_price: usd(1200000),
      image:
        'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80',
      deleted_at: null,
    },
    {
      _id: 2002,
      hotel_id: 1002,
      room_type: 'Skyline Studio',
      capacity: 2,
      base_price: usd(1450000),
      image:
        'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80',
      deleted_at: null,
    },
    {
      _id: 2003,
      hotel_id: 1003,
      room_type: 'Heritage Family Room',
      capacity: 4,
      base_price: usd(980000),
      image:
        'https://images.unsplash.com/photo-1566669437685-b88d8f2ea7f7?auto=format&fit=crop&w=1200&q=80',
      deleted_at: null,
    },
    {
      _id: 2004,
      hotel_id: 1004,
      room_type: 'Riverside Villa Suite',
      capacity: 6,
      base_price: usd(1750000),
      image:
        'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80',
      deleted_at: null,
    },
    {
      _id: 2005,
      hotel_id: 1005,
      room_type: 'Bay Front King',
      capacity: 3,
      base_price: usd(1550000),
      image:
        'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1200&q=80',
      deleted_at: null,
    },
    {
      _id: 2006,
      hotel_id: 1010,
      room_type: 'Sunset Bungalow',
      capacity: 2,
      base_price: usd(1320000),
      image:
        'https://images.unsplash.com/photo-1455587734955-081b22074882?auto=format&fit=crop&w=1200&q=80',
      deleted_at: null,
    },
  ];
}

function makeActivities() {
  const now = nowIso();
  return [
    {
      _id: 4001,
      provider_id: DEMO_PROVIDER_ID,
      location_id: 2,
      title: 'Marble Mountains Sunrise Tour',
      type: 'TOUR',
      base_price: usd(450000),
      status: 'LIVE',
      image:
        'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=1200&q=80',
      category: 'SIGHTSEEING',
      rating: 4.7,
      description: 'Guided sunrise hike with panoramic city and coastline views.',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 4002,
      provider_id: DEMO_PROVIDER_ID,
      location_id: 2,
      title: 'Da Nang Street Food Night',
      type: 'FOOD',
      base_price: usd(390000),
      status: 'LIVE',
      image:
        'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=1200&q=80',
      category: 'FOOD',
      rating: 4.8,
      description: 'Small-group tasting walk through local night markets and hidden stalls.',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 4003,
      provider_id: DEMO_PROVIDER_ID,
      location_id: 3,
      title: 'Saigon Airport Transfer',
      type: 'TRANSFER',
      base_price: usd(280000),
      status: 'LIVE',
      image:
        'https://images.unsplash.com/photo-1494515843206-f3117d3f51b7?auto=format&fit=crop&w=1200&q=80',
      category: 'TRANSPORT',
      rating: 4.5,
      description: 'Reliable private transfer between central districts and SGN airport.',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 4004,
      provider_id: DEMO_PROVIDER_ID,
      location_id: 5,
      title: 'Nha Trang Island Snorkeling',
      type: 'TOUR',
      base_price: usd(620000),
      status: 'LIVE',
      image:
        'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=1200&q=80',
      category: 'OUTDOORS',
      rating: 4.9,
      description: 'Boat trip with snorkeling stops, coral spots and lunch onboard.',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 4005,
      provider_id: DEMO_PROVIDER_ID,
      location_id: 4,
      title: 'Ha Noi Old Quarter Walk',
      type: 'TOUR',
      base_price: usd(320000),
      status: 'LIVE',
      image:
        'https://images.unsplash.com/photo-1583417319070-4a69db38a482?auto=format&fit=crop&w=1200&q=80',
      category: 'SIGHTSEEING',
      rating: 4.6,
      description: 'History-rich walking route through temples, alleys and street corners.',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 4006,
      provider_id: DEMO_PROVIDER_ID,
      location_id: 6,
      title: 'Hoi An Cooking Class',
      type: 'CLASS',
      base_price: usd(540000),
      status: 'LIVE',
      image:
        'https://images.unsplash.com/photo-1466637574441-749b8f19452f?auto=format&fit=crop&w=1200&q=80',
      category: 'FOOD',
      rating: 4.8,
      description: 'Market visit + hands-on Vietnamese cooking with local chefs.',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
  ];
}

function makeAirports() {
  const now = nowIso();
  return [
    { _id: 'DAD', name: 'Da Nang International Airport', location_id: 2, created_at: now, updated_at: now },
    { _id: 'SGN', name: 'Tan Son Nhat International Airport', location_id: 3, created_at: now, updated_at: now },
    { _id: 'HAN', name: 'Noi Bai International Airport', location_id: 4, created_at: now, updated_at: now },
    { _id: 'CXR', name: 'Cam Ranh International Airport', location_id: 5, created_at: now, updated_at: now },
    { _id: 'PQC', name: 'Phu Quoc International Airport', location_id: 7, created_at: now, updated_at: now },
  ];
}

function makeFlights() {
  const now = nowIso();
  return [
    {
      _id: 3001,
      provider_id: DEMO_PROVIDER_ID,
      flight_number: 'VN123',
      departure_airport: 'SGN',
      arrival_airport: 'DAD',
      departure_time: isoWithOffsetDays(6),
      arrival_time: isoWithOffsetDays(6),
      base_price: usd(1350000),
      available_seats: 16,
      image:
        'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=80',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 3002,
      provider_id: DEMO_PROVIDER_ID,
      flight_number: 'VJ401',
      departure_airport: 'HAN',
      arrival_airport: 'CXR',
      departure_time: isoWithOffsetDays(14),
      arrival_time: isoWithOffsetDays(14),
      base_price: usd(1480000),
      available_seats: 22,
      image:
        'https://images.unsplash.com/photo-1490438111844-55d5b4d0162d?auto=format&fit=crop&w=1200&q=80',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 3003,
      provider_id: DEMO_PROVIDER_ID,
      flight_number: 'QH782',
      departure_airport: 'DAD',
      arrival_airport: 'PQC',
      departure_time: isoWithOffsetDays(22),
      arrival_time: isoWithOffsetDays(22),
      base_price: usd(1210000),
      available_seats: 12,
      image:
        'https://images.unsplash.com/photo-1504196606672-aef5c9cefc92?auto=format&fit=crop&w=1200&q=80',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
  ];
}

function makeTrips() {
  const now = nowIso();
  return [
    {
      _id: 'TRIP00000001',
      user_id: DEMO_USER_ID,
      title: 'Da Nang Discovery Week',
      destination: 'Da Nang, Vietnam',
      status: 'ONGOING',
      cover_image:
        'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=1200&q=80',
      map_image:
        'https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=1200&q=80',
      start_date: dateOnlyWithOffsetDays(-1),
      end_date: dateOnlyWithOffsetDays(3),
      days: [
        {
          day_index: 1,
          date: dateOnlyWithOffsetDays(-1),
          items: [
            {
              time: '08:30',
              title: 'Marble Mountains Sunrise Tour',
              location_name: 'Da Nang, Vietnam',
              category: 'SIGHTSEEING',
              activity_id: 4001,
              companions: [{ user_id: 'u-demo-2', name: 'Linh Nguyen', image: null }],
            },
            {
              time: '18:30',
              title: 'Da Nang Street Food Night',
              location_name: 'Da Nang, Vietnam',
              category: 'FOOD',
              activity_id: 4002,
              companions: [],
            },
          ],
        },
      ],
      created_at: now,
      updated_at: now,
    },
    {
      _id: 'TRIP00000002',
      user_id: DEMO_USER_ID,
      title: 'Nha Trang Beach Escape',
      destination: 'Nha Trang, Vietnam',
      status: 'UPCOMING',
      cover_image:
        'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
      map_image:
        'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&w=1200&q=80',
      start_date: dateOnlyWithOffsetDays(11),
      end_date: dateOnlyWithOffsetDays(15),
      days: [],
      created_at: now,
      updated_at: now,
    },
    {
      _id: 'TRIP00000003',
      user_id: DEMO_USER_ID,
      title: 'Ha Noi Culture Weekend',
      destination: 'Ha Noi, Vietnam',
      status: 'COMPLETED',
      cover_image:
        'https://images.unsplash.com/photo-1583417319070-4a69db38a482?auto=format&fit=crop&w=1200&q=80',
      map_image:
        'https://images.unsplash.com/photo-1526481280695-3c4692d3f2f3?auto=format&fit=crop&w=1200&q=80',
      start_date: dateOnlyWithOffsetDays(-40),
      end_date: dateOnlyWithOffsetDays(-36),
      days: [],
      created_at: now,
      updated_at: now,
    },
  ];
}

function makeBookings() {
  const now = nowIso();
  return [
    {
      _id: 'bk-hotel-upcoming-001',
      user_id: DEMO_USER_ID,
      total_price: usd(3960000),
      total_amount: usd(3960000),
      discount_amount: 0,
      final_amount: usd(3960000),
      currency: 'USD',
      status: 'CONFIRMED',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 'bk-flight-upcoming-001',
      user_id: DEMO_USER_ID,
      total_price: usd(1350000),
      total_amount: usd(1350000),
      discount_amount: 0,
      final_amount: usd(1350000),
      currency: 'USD',
      status: 'CONFIRMED',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 'bk-hotel-completed-001',
      user_id: DEMO_USER_ID,
      total_price: usd(2900000),
      total_amount: usd(2900000),
      discount_amount: 0,
      final_amount: usd(2900000),
      currency: 'USD',
      status: 'COMPLETED',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 'bk-activity-completed-001',
      user_id: DEMO_USER_ID,
      total_price: usd(620000),
      total_amount: usd(620000),
      discount_amount: 0,
      final_amount: usd(620000),
      currency: 'USD',
      status: 'COMPLETED',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 'bk-hotel-cancelled-001',
      user_id: DEMO_USER_ID,
      total_price: usd(1980000),
      total_amount: usd(1980000),
      discount_amount: 0,
      final_amount: usd(1980000),
      currency: 'USD',
      status: 'CANCELLED',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      _id: 'bk-hotel-pending-001',
      user_id: DEMO_USER_ID,
      total_price: usd(1750000),
      total_amount: usd(1750000),
      discount_amount: 0,
      final_amount: usd(1750000),
      currency: 'USD',
      status: 'PENDING',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
  ];
}

function makeBookingItems() {
  const now = nowIso();
  return [
    {
      _id: 'bi-hotel-upcoming-001',
      booking_id: 'bk-hotel-upcoming-001',
      provider_id: DEMO_PROVIDER_ID,
      room_id: 2001,
      flight_id: null,
      activity_id: null,
      start_date: isoWithOffsetDays(7),
      end_date: isoWithOffsetDays(10),
      quantity: 2,
      price_per_unit: usd(1980000),
      total_price: usd(3960000),
      item_status: 'CONFIRMED',
      e_ticket_code: 'TW-4921',
      created_at: now,
      updated_at: now,
    },
    {
      _id: 'bi-flight-upcoming-001',
      booking_id: 'bk-flight-upcoming-001',
      provider_id: DEMO_PROVIDER_ID,
      room_id: null,
      flight_id: 3001,
      activity_id: null,
      start_date: isoWithOffsetDays(6),
      end_date: isoWithOffsetDays(6),
      quantity: 1,
      price_per_unit: usd(1350000),
      total_price: usd(1350000),
      item_status: 'CONFIRMED',
      e_ticket_code: 'TW-FL301',
      created_at: now,
      updated_at: now,
    },
    {
      _id: 'bi-hotel-completed-001',
      booking_id: 'bk-hotel-completed-001',
      provider_id: DEMO_PROVIDER_ID,
      room_id: 2002,
      flight_id: null,
      activity_id: null,
      start_date: isoWithOffsetDays(-24),
      end_date: isoWithOffsetDays(-21),
      quantity: 2,
      price_per_unit: usd(1450000),
      total_price: usd(2900000),
      item_status: 'COMPLETED',
      e_ticket_code: 'TW-6224',
      created_at: now,
      updated_at: now,
    },
    {
      _id: 'bi-activity-completed-001',
      booking_id: 'bk-activity-completed-001',
      provider_id: DEMO_PROVIDER_ID,
      room_id: null,
      flight_id: null,
      activity_id: 4004,
      start_date: isoWithOffsetDays(-14),
      end_date: isoWithOffsetDays(-14),
      quantity: 2,
      price_per_unit: usd(310000),
      total_price: usd(620000),
      item_status: 'COMPLETED',
      e_ticket_code: 'TW-A4004',
      created_at: now,
      updated_at: now,
    },
    {
      _id: 'bi-hotel-cancelled-001',
      booking_id: 'bk-hotel-cancelled-001',
      provider_id: DEMO_PROVIDER_ID,
      room_id: 2003,
      flight_id: null,
      activity_id: null,
      start_date: isoWithOffsetDays(20),
      end_date: isoWithOffsetDays(22),
      quantity: 2,
      price_per_unit: usd(990000),
      total_price: usd(1980000),
      item_status: 'CANCELLED',
      e_ticket_code: 'TW-9012',
      created_at: now,
      updated_at: now,
    },
    {
      _id: 'bi-hotel-pending-001',
      booking_id: 'bk-hotel-pending-001',
      provider_id: DEMO_PROVIDER_ID,
      room_id: 2004,
      flight_id: null,
      activity_id: null,
      start_date: isoWithOffsetDays(28),
      end_date: isoWithOffsetDays(30),
      quantity: 3,
      price_per_unit: usd(583333),
      total_price: usd(1750000),
      item_status: 'PENDING',
      e_ticket_code: 'TW-PENDING1',
      created_at: now,
      updated_at: now,
    },
  ];
}

function makePayments() {
  const now = nowIso();
  return [
    {
      _id: 'pay-hotel-upcoming-001',
      booking_id: 'bk-hotel-upcoming-001',
      user_id: DEMO_USER_ID,
      payment_method: 'CREDIT_CARD',
      amount: usd(3960000),
      transaction_id: `TX-${Date.now()}-01`,
      status: 'SUCCESS',
      created_at: now,
      updated_at: now,
    },
    {
      _id: 'pay-flight-upcoming-001',
      booking_id: 'bk-flight-upcoming-001',
      user_id: DEMO_USER_ID,
      payment_method: 'PAYPAL',
      amount: usd(1350000),
      transaction_id: `TX-${Date.now()}-02`,
      status: 'SUCCESS',
      created_at: now,
      updated_at: now,
    },
    {
      _id: 'pay-hotel-completed-001',
      booking_id: 'bk-hotel-completed-001',
      user_id: DEMO_USER_ID,
      payment_method: 'WALLET',
      amount: usd(2900000),
      transaction_id: `TX-${Date.now()}-03`,
      status: 'SUCCESS',
      created_at: now,
      updated_at: now,
    },
    {
      _id: 'pay-activity-completed-001',
      booking_id: 'bk-activity-completed-001',
      user_id: DEMO_USER_ID,
      payment_method: 'CREDIT_CARD',
      amount: usd(620000),
      transaction_id: `TX-${Date.now()}-04`,
      status: 'SUCCESS',
      created_at: now,
      updated_at: now,
    },
    {
      _id: 'pay-hotel-pending-001',
      booking_id: 'bk-hotel-pending-001',
      user_id: DEMO_USER_ID,
      payment_method: 'CREDIT_CARD',
      amount: usd(1750000),
      transaction_id: `TX-${Date.now()}-05`,
      status: 'PENDING',
      created_at: now,
      updated_at: now,
    },
  ];
}

function makeReviews() {
  const authors = [
    { id: DEMO_USER_ID, name: 'Alex Thompson', image: null },
    { id: 'u-demo-2', name: 'Linh Nguyen', image: null },
    { id: 'u-demo-3', name: 'Minh Tran', image: null },
    { id: 'u-demo-4', name: 'Sophie Le', image: null },
    { id: 'u-demo-5', name: 'Quang Vu', image: null },
  ];
  const reviews = [];
  let rid = 5001;
  for (const hotelId of [1001, 1002, 1003, 1004, 1005]) {
    for (let i = 0; i < 4; i++) {
      const author = authors[(hotelId + i) % authors.length];
      const rating = 4 + ((hotelId + i) % 2);
      reviews.push({
        _id: rid++,
        hotel_id: hotelId,
        user_id: author.id,
        author_name: author.name,
        author_image: author.image,
        rating,
        comment:
          rating >= 5
            ? 'Excellent stay with great service and location. Highly recommended.'
            : 'Comfortable rooms and good value. Would consider staying again.',
        trip_type: i % 2 === 0 ? 'Couple' : 'Family',
        created_at: dateOnlyWithOffsetDays(-10 - i),
        deleted_at: null,
      });
    }
  }
  return reviews;
}

function makeNotifications() {
  const now = Date.now();
  const rows = [
    {
      type: 'BOOKING',
      title: 'Booking confirmed',
      body: 'Your Da Nang booking has been confirmed.',
      action_route: '/my_trips',
      read: false,
    },
    {
      type: 'TRIP',
      title: 'Trip reminder',
      body: 'Nha Trang Beach Escape starts in 11 days.',
      action_route: '/trip_planner_dashboard',
      read: false,
    },
    {
      type: 'MESSAGE',
      title: 'New message from Linh Nguyen',
      body: 'I added one more activity to day 1.',
      action_route: '/direct_messaging',
      read: false,
    },
    {
      type: 'SYSTEM',
      title: 'Wallet top-up successful',
      body: '$80 was added to your wallet.',
      action_route: '/wallet_loyalty',
      read: true,
    },
    {
      type: 'PROMO',
      title: 'Points on completed bookings',
      body: 'Earn points equal to 1% of each completed booking.',
      action_route: '/home',
      read: true,
    },
  ];

  return rows.map((row, idx) => ({
    _id: `notif-${idx + 1}`,
    user_id: DEMO_USER_ID,
    ...row,
    created_at: new Date(now - idx * 5 * 3600 * 1000).toISOString(),
  }));
}

function makeWalletTransactions() {
  return [
    {
      _id: 'wtx-001',
      user_id: DEMO_USER_ID,
      type: 'TOPUP',
      amount: usd(2000000),
      card_id: 'card-demo-1',
      card_last4: '4242',
      status: 'SUCCESS',
      created_at: isoWithOffsetDays(-3),
    },
    {
      _id: 'wtx-002',
      user_id: DEMO_USER_ID,
      type: 'WITHDRAW',
      amount: usd(800000),
      card_id: 'card-demo-2',
      card_last4: '1111',
      status: 'SUCCESS',
      created_at: isoWithOffsetDays(-1),
    },
  ];
}

function makeRoomInventory(roomIds) {
  const result = [];
  let nextId = 7001;
  const start = new Date();
  for (const roomId of roomIds) {
    for (let day = 0; day < 75; day++) {
      const d = new Date(start);
      d.setDate(d.getDate() + day);
      const date = d.toISOString().slice(0, 10);
      const bucket = (roomId * 97 + day * 13) % 100;
      let availableQty = 0;
      let priceOverride = null;
      if (bucket < 12) {
        availableQty = 0;
      } else if (bucket < 30) {
        availableQty = 2 + (bucket % 4);
        priceOverride = null;
      } else if (bucket < 55) {
        availableQty = 5 + (bucket % 5);
        priceOverride = usd(1500000 + ((bucket % 3) * 150000));
      } else {
        availableQty = 8 + (bucket % 10);
        priceOverride = null;
      }
      result.push({
        _id: nextId++,
        room_id: roomId,
        date,
        available_qty: availableQty,
        price_override: priceOverride,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }
  }
  return result;
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();

  const users = db.collection('users');
  const providers = db.collection('providers');
  const locations = db.collection('locations');
  const hotels = db.collection('hotels');
  const rooms = db.collection('rooms');
  const activities = db.collection('activities');
  const airports = db.collection('airports');
  const flights = db.collection('flights');
  const trips = db.collection('trips');
  const bookings = db.collection('bookings');
  const bookingItems = db.collection('booking_items');
  const payments = db.collection('payments');
  const wallets = db.collection('wallets');
  const cards = db.collection('cards');
  const walletTx = db.collection('wallet_transactions');
  const profileVerifications = db.collection('profile_verifications');
  const reviews = db.collection('reviews');
  const notifications = db.collection('notifications');
  const notificationPrefs = db.collection('notification_preferences');
  const roomInventory = db.collection('room_inventory');
  const pricingRules = db.collection('pricing_rules');
  const payoutRequests = db.collection('provider_payout_requests');
  const homeContent = db.collection('home_content');

  const userDocs = [
    {
      _id: DEMO_USER_ID,
      full_name: 'Alex Thompson',
      email: 'alex.thompson@tripwise.dev',
      phone: '+84 869033688',
      image:
        'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80',
      role: 'USER',
      status: 'ACTIVE',
    },
    {
      _id: DEMO_PROVIDER_ID,
      full_name: 'Tripwise Host Team',
      email: 'host@tripwise.dev',
      phone: '+84 888000111',
      image:
        'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=300&q=80',
      role: 'PROVIDER',
      status: 'ACTIVE',
    },
    {
      _id: 'u-demo-2',
      full_name: 'Linh Nguyen',
      email: 'linh.nguyen@tripwise.dev',
      phone: '+84 901000002',
      image: null,
      role: 'USER',
      status: 'ACTIVE',
    },
    {
      _id: 'u-demo-3',
      full_name: 'Minh Tran',
      email: 'minh.tran@tripwise.dev',
      phone: '+84 901000003',
      image: null,
      role: 'USER',
      status: 'ACTIVE',
    },
    {
      _id: 'u-demo-4',
      full_name: 'Sophie Le',
      email: 'sophie.le@tripwise.dev',
      phone: '+84 901000004',
      image: null,
      role: 'USER',
      status: 'ACTIVE',
    },
    {
      _id: 'u-demo-5',
      full_name: 'Quang Vu',
      email: 'quang.vu@tripwise.dev',
      phone: '+84 901000005',
      image: null,
      role: 'USER',
      status: 'ACTIVE',
    },
  ];
  await bulkUpsertById(users, userDocs);

  await bulkUpsertById(providers, [
    { _id: DEMO_PROVIDER_ID, business_name: 'Tripwise Signature Collection' },
    { _id: ALT_PROVIDER_ID, business_name: 'Lotus Horizon Retreats' },
  ]);

  await bulkUpsertById(locations, [
    { _id: 1, parent_id: null, name: 'Vietnam', type: 'country' },
    { _id: 2, parent_id: 1, name: 'Da Nang', type: 'city' },
    { _id: 3, parent_id: 1, name: 'Ho Chi Minh City', type: 'city' },
    { _id: 4, parent_id: 1, name: 'Ha Noi', type: 'city' },
    { _id: 5, parent_id: 1, name: 'Nha Trang', type: 'city' },
    { _id: 6, parent_id: 1, name: 'Hoi An', type: 'city' },
    { _id: 7, parent_id: 1, name: 'Phu Quoc', type: 'city' },
    { _id: 8, parent_id: 1, name: 'Sapa', type: 'city' },
  ]);

  const hotelDocs = makeHotels();
  const roomDocs = makeRooms();
  const activityDocs = makeActivities();
  const airportDocs = makeAirports();
  const flightDocs = makeFlights();
  const tripDocs = makeTrips();
  const bookingDocs = makeBookings();
  const bookingItemDocs = makeBookingItems();
  const paymentDocs = makePayments();
  const reviewDocs = makeReviews();
  const notifDocs = makeNotifications();
  const walletTxDocs = makeWalletTransactions();

  await bulkUpsertById(hotels, hotelDocs);
  await bulkUpsertById(rooms, roomDocs);
  await bulkUpsertById(activities, activityDocs);
  await bulkUpsertById(airports, airportDocs);
  await bulkUpsertById(flights, flightDocs);
  await bulkUpsertById(trips, tripDocs);
  await bulkUpsertById(bookings, bookingDocs);
  await bulkUpsertById(bookingItems, bookingItemDocs);
  await bulkUpsertById(payments, paymentDocs);
  await bulkUpsertById(reviews, reviewDocs);
  await bulkUpsertById(notifications, notifDocs);
  await bulkUpsertById(walletTx, walletTxDocs);

  await bulkUpsertById(wallets, [
    {
      _id: `wallet-${DEMO_USER_ID}`,
      user_id: DEMO_USER_ID,
      balance: usd(12500000),
      loyalty_points: 0,
      version: 2,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
  ]);

  await bulkUpsertById(cards, [
    {
      _id: 'card-demo-1',
      user_id: DEMO_USER_ID,
      brand: 'VISA',
      last4: '4242',
      holder_name: 'Alex Thompson',
      balance: usd(28000000),
      is_default: true,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
    {
      _id: 'card-demo-2',
      user_id: DEMO_USER_ID,
      brand: 'MASTERCARD',
      last4: '1111',
      holder_name: 'Alex Thompson',
      balance: usd(35000000),
      is_default: false,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
  ]);

  await bulkUpsertById(profileVerifications, [
    {
      _id: DEMO_USER_ID,
      passport_uploaded: true,
      passport_note: 'Validated',
      address_uploaded: true,
      address_note: 'Validated',
      updated_at: nowIso(),
    },
  ]);

  await bulkUpsertById(notificationPrefs, [
    {
      _id: DEMO_USER_ID,
      push: true,
      email: true,
      tripReminders: true,
      bookingUpdates: true,
      messages: true,
      promotions: false,
      updated_at: nowIso(),
    },
  ]);

  await bulkUpsertById(pricingRules, [
    {
      _id: DEMO_PROVIDER_ID,
      weekend_surge_pct: 20,
      holiday_peak_pct: 35,
      last_minute_disc_pct: -10,
      last_minute_days: 7,
      weekend_enabled: true,
      holiday_enabled: true,
      last_minute_enabled: true,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
  ]);

  await bulkUpsertById(payoutRequests, [
    {
      _id: 'payout-001',
      provider_id: DEMO_PROVIDER_ID,
      amount: usd(4200000),
      currency: 'USD',
      status: 'PENDING',
      requested_at: isoWithOffsetDays(-2),
      scheduled_for: isoWithOffsetDays(5),
      paid_at: null,
      note: 'Weekly payout cycle',
    },
    {
      _id: 'payout-002',
      provider_id: DEMO_PROVIDER_ID,
      amount: usd(3180000),
      currency: 'USD',
      status: 'SCHEDULED',
      requested_at: isoWithOffsetDays(-6),
      scheduled_for: isoWithOffsetDays(2),
      paid_at: null,
      note: 'Auto payout',
    },
  ]);

  const inventoryRooms = roomDocs
    .filter((room) => [1001, 1002, 1003, 1004, 1005].includes(room.hotel_id))
    .map((room) => room._id);
  const invRows = makeRoomInventory(inventoryRooms);
  await bulkUpsertById(roomInventory, invRows, true);

  await homeContent.updateOne(
    { key: 'home' },
    {
      $set: {
        curated: {
          featuredHotelIds: [1001, 1005],
          recommendedHotelIds: [1002, 1005, 1001, 1010],
          trendingHotelIds: [1001, 1002, 1005, 1010],
        },
        offerOverrides: [
          {
            hotelId: 1005,
            title: 'Nha Trang Bay Escape',
            subtitle: 'Beachfront rooms with sunset view',
            badgeLabel: 'LIMITED OFFER',
            ctaLabel: 'BOOK NOW',
            accentTone: 'primary',
            route: '/service_details/1005',
          },
          {
            hotelId: 1002,
            title: 'Saigon Skyline Deal',
            subtitle: 'City suite for quick urban getaway',
            badgeLabel: 'CITY BREAK',
            ctaLabel: 'VIEW STAY',
            accentTone: 'secondary',
            route: '/service_details/1002',
          },
        ],
      },
    },
    { upsert: true },
  );

  const summaryCollections = [
    'users',
    'providers',
    'locations',
    'hotels',
    'rooms',
    'activities',
    'airports',
    'flights',
    'trips',
    'bookings',
    'booking_items',
    'payments',
    'wallets',
    'cards',
    'wallet_transactions',
    'reviews',
    'notifications',
    'room_inventory',
    'provider_payout_requests',
  ];
  const counts = {};
  for (const name of summaryCollections) {
    counts[name] = await db.collection(name).countDocuments();
  }

  console.log('Seed enrich complete.');
  console.log(
    JSON.stringify(
      {
        db: db.databaseName,
        demoUserId: DEMO_USER_ID,
        demoProviderId: DEMO_PROVIDER_ID,
        counts,
      },
      null,
      2,
    ),
  );

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
