import { randomUUID } from 'node:crypto';
import { env } from '@/config/env';
import { Booking } from '@/models/Booking.model';
import { BookingItem } from '@/models/BookingItem.model';
import { Hotel } from '@/models/Hotel.model';
import { Location } from '@/models/Location.model';
import { Payment } from '@/models/Payment.model';
import { Provider } from '@/models/Provider.model';
import { Room } from '@/models/Room.model';
import { Trip } from '@/models/Trip.model';
import { User } from '@/models/User.model';
import { Wallet } from '@/models/Wallet.model';

function isoNow(): string {
  return new Date().toISOString();
}

function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function ensureUserAndWallet(): Promise<void> {
  const now = isoNow();

  await User.updateOne(
    { _id: env.demoUserId },
    {
      $setOnInsert: {
        _id: env.demoUserId,
        full_name: 'Alex Thompson',
        email: 'alex.thompson@tripwise.dev',
        phone: '+84 869033688',
        image:
          'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80',
        role: 'USER',
        status: 'ACTIVE',
      },
    },
    { upsert: true },
  );

  await Wallet.updateOne(
    { user_id: env.demoUserId },
    {
      $setOnInsert: {
        _id: `wallet-${env.demoUserId}`,
        user_id: env.demoUserId,
        balance: 8_000_000,
        loyalty_points: 12_500,
        version: 1,
        created_at: now,
        updated_at: now,
      },
    },
    { upsert: true },
  );
}

async function ensureProvider(): Promise<void> {
  await Provider.updateOne(
    { _id: env.demoProviderId },
    {
      $setOnInsert: {
        _id: env.demoProviderId,
        business_name: 'Tripwise Signature Collection',
      },
    },
    { upsert: true },
  );
}

async function ensureLocations(): Promise<void> {
  const count = await Location.countDocuments();
  if (count > 0) return;

  await Location.insertMany([
    { _id: 1, parent_id: null, name: 'Vietnam', type: 'country' },
    { _id: 2, parent_id: 1, name: 'Da Nang', type: 'city' },
    { _id: 3, parent_id: 1, name: 'Ho Chi Minh City', type: 'city' },
  ]);
}

async function ensureHotelsAndRooms(): Promise<{ hotelId: number; roomId: number }> {
  const existing = await Hotel.findOne({
    provider_id: env.demoProviderId,
    deleted_at: null,
  })
    .select({ _id: 1 })
    .lean();

  if (existing) {
    const room = await Room.findOne({ hotel_id: existing._id, deleted_at: null })
      .sort({ _id: 1 })
      .select({ _id: 1 })
      .lean();
    if (room) return { hotelId: existing._id, roomId: room._id };
  }

  const [maxHotel, maxRoom, location] = await Promise.all([
    Hotel.findOne({}).sort({ _id: -1 }).select({ _id: 1 }).lean(),
    Room.findOne({}).sort({ _id: -1 }).select({ _id: 1 }).lean(),
    Location.findOne({}).sort({ _id: 1 }).select({ _id: 1, name: 1 }).lean(),
  ]);

  if (!location) {
    throw new Error('Unable to seed demo listing: no location found');
  }

  const now = isoNow();
  const hotelId = (maxHotel?._id ?? 1000) + 1;
  const roomId = (maxRoom?._id ?? 2000) + 1;
  const image =
    'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80';

  await Hotel.create({
    _id: hotelId,
    provider_id: env.demoProviderId,
    location_id: location._id,
    name: 'Veligandu Island Resort',
    address: location.name,
    star_rating: 4.8,
    status: 'LIVE',
    listing_status: 'active',
    listing_category: 'Hotel',
    image,
    images: [image],
    description: 'Seaside resort used as demo listing data.',
    amenities: ['WiFi', 'Pool', 'Parking', 'Breakfast'],
    bedrooms: 2,
    bathrooms: 2,
    max_guests: 4,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });

  await Room.create({
    _id: roomId,
    hotel_id: hotelId,
    room_type: 'Deluxe Ocean View',
    capacity: 2,
    base_price: 1_200_000,
    image,
    deleted_at: null,
  });

  return { hotelId, roomId };
}

async function ensureTrips(userId: string): Promise<void> {
  const exists = await Trip.findOne({ user_id: userId }).select({ _id: 1 }).lean();
  if (exists) return;

  const now = isoNow();
  await Trip.create({
    _id: randomUUID(),
    user_id: userId,
    title: 'Da Nang Getaway',
    destination: 'Da Nang',
    status: 'UPCOMING',
    cover_image:
      'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=1200&q=80',
    map_image: null,
    start_date: isoPlusDays(10),
    end_date: isoPlusDays(13),
    days: [],
    created_at: now,
    updated_at: now,
  });
}

async function ensureBookings(userId: string, providerId: string, roomId: number): Promise<void> {
  const existingBookings = await Booking.find({ user_id: userId })
    .select({ _id: 1 })
    .lean();
  if (existingBookings.length > 0) {
    const bookingIds = existingBookings.map((row) => String(row._id));
    const existingItems = await BookingItem.countDocuments({
      booking_id: { $in: bookingIds },
    });
    if (existingItems > 0) return;
  }

  const now = isoNow();

  const rows = [
    {
      status: 'CONFIRMED',
      itemStatus: 'CONFIRMED',
      start: isoPlusDays(7),
      end: isoPlusDays(10),
      amount: 3_960_000,
      ticket: 'TW-4921',
    },
    {
      status: 'COMPLETED',
      itemStatus: 'COMPLETED',
      start: isoPlusDays(-21),
      end: isoPlusDays(-18),
      amount: 3_420_000,
      ticket: 'TW-3874',
    },
    {
      status: 'CANCELLED',
      itemStatus: 'CANCELLED',
      start: isoPlusDays(30),
      end: isoPlusDays(32),
      amount: 1_980_000,
      ticket: 'TW-9012',
    },
  ];

  for (const row of rows) {
    const bookingId = randomUUID();
    const bookingItemId = randomUUID();
    const paymentId = randomUUID();

    await Booking.create({
      _id: bookingId,
      user_id: userId,
      total_price: row.amount,
      total_amount: row.amount,
      discount_amount: 0,
      final_amount: row.amount,
      currency: 'VND',
      status: row.status,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });

    await BookingItem.create({
      _id: bookingItemId,
      booking_id: bookingId,
      provider_id: providerId,
      room_id: roomId,
      flight_id: null,
      activity_id: null,
      start_date: row.start,
      end_date: row.end,
      quantity: 2,
      price_per_unit: Math.round(row.amount / 2),
      total_price: row.amount,
      item_status: row.itemStatus,
      e_ticket_code: row.ticket,
      created_at: now,
      updated_at: now,
    });

    if (row.status !== 'CANCELLED') {
      await Payment.create({
        _id: paymentId,
        booking_id: bookingId,
        user_id: userId,
        payment_method: 'CREDIT_CARD',
        amount: row.amount,
        transaction_id: `TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        status: 'SUCCESS',
        created_at: now,
        updated_at: now,
      });
    }
  }
}

export async function ensureDemoData(): Promise<void> {
  await ensureUserAndWallet();
  await ensureProvider();
  await ensureLocations();
  const { roomId } = await ensureHotelsAndRooms();
  await Promise.all([
    ensureTrips(env.demoUserId),
    ensureBookings(env.demoUserId, env.demoProviderId, roomId),
  ]);

  const [bookingCount, bookingItemCount, walletCount] = await Promise.all([
    Booking.countDocuments({ user_id: env.demoUserId }),
    BookingItem.countDocuments({
      booking_id: {
        $in: (
          await Booking.find({ user_id: env.demoUserId }).select({ _id: 1 }).lean()
        ).map((row) => String(row._id)),
      },
    }),
    Wallet.countDocuments({ user_id: env.demoUserId }),
  ]);

  console.log(
    `[seed] demo user=${env.demoUserId} bookings=${bookingCount} bookingItems=${bookingItemCount} wallet=${walletCount}`,
  );
}
