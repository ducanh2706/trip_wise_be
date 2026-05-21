import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '@/config/env';
import { Booking } from '@/models/Booking.model';
import { BookingItem } from '@/models/BookingItem.model';
import { Hotel } from '@/models/Hotel.model';
import { Location } from '@/models/Location.model';
import { Payment } from '@/models/Payment.model';
import { Review } from '@/models/Review.model';
import { Room } from '@/models/Room.model';

type ListingStatus = 'active' | 'inactive' | 'pending';
type AnalyticsPeriod = '7d' | '30d' | '90d' | '1y';

export interface ProviderListingSummary {
  id: number;
  title: string;
  location: string;
  status: ListingStatus;
  statusLabel: string;
  imageUrl: string;
  category: string;
  tierLabel: string;
  roomType: string;
  pricePerNight: number;
  priceLabel: string;
  editRoute: string;
  analyticsRoute: string;
}

export interface ProviderListingsResponse {
  query: string;
  status: 'all' | ListingStatus;
  counts: Record<'all' | ListingStatus, number>;
  featured: ProviderListingSummary | null;
  items: ProviderListingSummary[];
}

export interface ProviderListingDetail {
  id: number;
  title: string;
  description: string;
  location: string;
  address: string;
  status: ListingStatus;
  category: string;
  imageUrl: string;
  images: string[];
  pricePerNight: number;
  currency: string;
  roomType: string;
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  amenities: string[];
}

export interface ProviderListingAnalytics {
  listingId: number;
  period: AnalyticsPeriod;
  kpis: {
    totalViews: number;
    viewsDeltaPct: number;
    bookings: number;
    bookingsDeltaPct: number;
    revenue: number;
    revenueDeltaPct: number;
    averageRating: number;
    ratingDelta: number;
  };
  trend: Array<{ label: string; views: number; bookings: number }>;
  topDays: Array<{ day: string; views: number; bookings: number; revenue: number }>;
  bookingSources: Array<{ label: string; percentage: number; count: number }>;
  guestStats: {
    repeatGuestsPct: number;
    averageStayNights: number;
  };
}

export class ProviderListingError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80';
const LISTING_IMAGE_DIR = path.resolve(process.cwd(), 'uploads/listings');
const MAX_LISTING_IMAGE_BYTES = 5 * 1024 * 1024;
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function listStatus(raw: unknown): ListingStatus {
  if (typeof raw !== 'string') return 'active';
  const value = raw.trim().toLowerCase();
  if (value === 'inactive') return 'inactive';
  if (value === 'pending' || value === 'pending_review') return 'pending';
  if (value === 'live') return 'active';
  return 'active';
}

function statusLabel(status: ListingStatus): string {
  if (status === 'inactive') return 'Inactive';
  if (status === 'pending') return 'Pending Review';
  return 'Active';
}

function parsePeriod(raw: unknown): AnalyticsPeriod {
  if (typeof raw !== 'string') return '30d';
  if (raw === '7d' || raw === '90d' || raw === '1y') return raw;
  return '30d';
}

function formatUsd(value: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(Math.round(value));
  } catch {
    return `$${Math.round(value).toLocaleString('en-US')}`;
  }
}

function firstNumber(values: Array<number | null | undefined>): number[] {
  return Array.from(new Set(values.filter((v): v is number => typeof v === 'number')));
}

function firstString(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0)),
  );
}

function pickImage(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return DEFAULT_IMAGE;
}

function resolveLocationName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

function textValue(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  return raw.trim();
}

function numberValue(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function normalizeFileName(value: unknown): string {
  if (typeof value !== 'string') return 'listing';
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return normalized.length > 0 ? normalized : 'listing';
}

function normalizeBase64(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx > 0 && trimmed.slice(0, commaIdx).includes('base64')) {
    return trimmed.slice(commaIdx + 1).trim();
  }
  return trimmed;
}

async function saveListingImage(
  input: Record<string, unknown>,
  publicBaseUrl: string,
): Promise<string> {
  const directUrl = textValue(input.imageUrl, '');
  if (directUrl) return directUrl;

  const upload =
    input.imageUpload && typeof input.imageUpload === 'object'
      ? (input.imageUpload as Record<string, unknown>)
      : null;
  if (!upload) return DEFAULT_IMAGE;

  const mimeType = textValue(upload.mimeType, '').toLowerCase();
  const ext = MIME_TO_EXT[mimeType];
  if (!ext) {
    throw new ProviderListingError(400, 'Only JPG, PNG, WEBP listing images are supported');
  }

  const base64Data = normalizeBase64(upload.dataBase64);
  if (!base64Data) {
    throw new ProviderListingError(400, 'Listing image data is required');
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Data, 'base64');
  } catch {
    throw new ProviderListingError(400, 'Invalid listing image data');
  }

  if (!buffer.length) {
    throw new ProviderListingError(400, 'Listing image data is empty');
  }
  if (buffer.length > MAX_LISTING_IMAGE_BYTES) {
    throw new ProviderListingError(413, 'Listing image exceeds 5MB limit');
  }

  await mkdir(LISTING_IMAGE_DIR, { recursive: true });
  const fileName = `${randomUUID()}-${normalizeFileName(upload.fileName)}.${ext}`;
  await writeFile(path.join(LISTING_IMAGE_DIR, fileName), buffer);
  return `${publicBaseUrl}/uploads/listings/${fileName}`;
}

async function ensureProviderListing(): Promise<void> {
  const existing = await Hotel.findOne({
    provider_id: env.demoProviderId,
    deleted_at: null,
  })
    .select({ _id: 1 })
    .lean();
  if (existing) return;

  const [maxHotel, maxRoom, fallbackLocation] = await Promise.all([
    Hotel.findOne({}).sort({ _id: -1 }).select({ _id: 1 }).lean(),
    Room.findOne({}).sort({ _id: -1 }).select({ _id: 1 }).lean(),
    Location.findOne({}).sort({ _id: 1 }).select({ _id: 1, name: 1 }).lean(),
  ]);
  if (!fallbackLocation) return;

  const now = new Date().toISOString();
  const hotelId = (maxHotel?._id ?? 0) + 1;
  const roomId = (maxRoom?._id ?? 0) + 1;

  await Hotel.create({
    _id: hotelId,
    provider_id: env.demoProviderId,
    location_id: fallbackLocation._id,
    name: 'Tripwise Signature Residence',
    address: fallbackLocation.name,
    star_rating: 4.8,
    status: 'LIVE',
    listing_status: 'active',
    listing_category: 'Hotel',
    image: DEFAULT_IMAGE,
    images: [DEFAULT_IMAGE],
    description: 'Premium provider listing auto-created for dashboard completeness.',
    amenities: ['WiFi', 'Pool', 'Parking'],
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
    room_type: 'Deluxe Suite',
    capacity: 4,
    base_price: 299,
    image: DEFAULT_IMAGE,
    deleted_at: null,
  });
}

async function listingBase() {
  await ensureProviderListing();

  const [hotels, rooms] = await Promise.all([
    Hotel.find({
      provider_id: env.demoProviderId,
      deleted_at: null,
    }).lean(),
    Room.find({ deleted_at: null }).lean(),
  ]);

  const roomsByHotel = new Map<number, Array<(typeof rooms)[number]>>();
  for (const room of rooms) {
    const list = roomsByHotel.get(room.hotel_id) ?? [];
    list.push(room);
    roomsByHotel.set(room.hotel_id, list);
  }

  return { hotels, roomsByHotel };
}

function listingSummary(
  hotel: Record<string, unknown>,
  room: Record<string, unknown> | undefined,
): ProviderListingSummary {
  const id = numberValue(hotel._id, 0);
  const status = listStatus(
    hotel.listing_status ?? hotel.status ?? (room?.deleted_at ? 'inactive' : 'active'),
  );
  const price = numberValue(room?.base_price, 0);
  const title = textValue(hotel.name, 'Untitled listing');
  const location = resolveLocationName(hotel.address) || 'Tripwise location';
  const category = textValue(hotel.listing_category, 'Hotel');
  const star = numberValue(hotel.star_rating, 4.5);

  return {
    id,
    title,
    location,
    status,
    statusLabel: statusLabel(status),
    imageUrl: pickImage(
      typeof room?.image === 'string' ? room.image : null,
      Array.isArray(hotel.images) ? String(hotel.images[0] ?? '') : null,
      typeof hotel.image === 'string' ? hotel.image : null,
    ),
    category,
    tierLabel: star >= 4.8 ? 'Premium' : star >= 4.0 ? 'Standard' : 'Classic',
    roomType: textValue(room?.room_type, 'Room'),
    pricePerNight: price,
    priceLabel: formatUsd(price),
    editRoute: `/provider_listing_edit?id=${id}&title=${encodeURIComponent(title)}`,
    analyticsRoute: `/provider_analytics?id=${id}&title=${encodeURIComponent(title)}`,
  };
}

export async function listProviderListings(input: {
  query?: unknown;
  status?: unknown;
}): Promise<ProviderListingsResponse> {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  const status =
    input.status === 'active' || input.status === 'inactive' || input.status === 'pending'
      ? input.status
      : 'all';

  const { hotels, roomsByHotel } = await listingBase();
  const all = hotels.map((hotel) => {
    const rooms = roomsByHotel.get(numberValue(hotel._id, 0)) ?? [];
    const room = rooms
      .slice()
      .sort((a, b) => numberValue(a.base_price, 0) - numberValue(b.base_price, 0))[0];
    return listingSummary(
      hotel as unknown as Record<string, unknown>,
      room as unknown as Record<string, unknown> | undefined,
    );
  });

  const counts = {
    all: all.length,
    active: all.filter((item) => item.status === 'active').length,
    inactive: all.filter((item) => item.status === 'inactive').length,
    pending: all.filter((item) => item.status === 'pending').length,
  };

  const filtered = all
    .filter((item) => {
      if (status !== 'all' && item.status !== status) return false;
      if (!query) return true;
      return `${item.title} ${item.location} ${item.category}`
        .toLowerCase()
        .includes(query.toLowerCase());
    })
    .sort((left, right) => {
      if (left.status !== right.status) {
        const order: Record<ListingStatus, number> = {
          active: 0,
          pending: 1,
          inactive: 2,
        };
        return order[left.status] - order[right.status];
      }
      return right.pricePerNight - left.pricePerNight;
    });

  const featured = filtered.find((item) => item.status === 'active') ?? filtered[0] ?? null;
  return { query, status, counts, featured, items: filtered };
}

export async function getProviderListingDetail(idRaw: unknown): Promise<ProviderListingDetail> {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ProviderListingError(400, 'Invalid listing id');
  }

  const hotel = await Hotel.findOne({
    _id: id,
    provider_id: env.demoProviderId,
    deleted_at: null,
  }).lean();
  if (!hotel) throw new ProviderListingError(404, 'Listing not found');

  const room = await Room.findOne({ hotel_id: id, deleted_at: null })
    .sort({ base_price: 1, _id: 1 })
    .lean();

  const images = Array.isArray(hotel.images)
    ? hotel.images.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];
  const imageUrl = pickImage(room?.image ?? null, images[0] ?? null, hotel.image ?? null);

  return {
    id,
    title: textValue(hotel.name, 'Untitled listing'),
    description: textValue(hotel.description, ''),
    location: resolveLocationName(hotel.address) || 'Tripwise location',
    address: resolveLocationName(hotel.address) || '',
    status: listStatus(hotel.listing_status ?? hotel.status),
    category: textValue(hotel.listing_category, 'Hotel'),
    imageUrl,
    images: images.length > 0 ? images : [imageUrl],
    pricePerNight: numberValue(room?.base_price, 0),
    currency: 'USD',
    roomType: textValue(room?.room_type, 'Room'),
    bedrooms: numberValue(hotel.bedrooms, 1),
    bathrooms: numberValue(hotel.bathrooms, 1),
    maxGuests: numberValue(hotel.max_guests ?? room?.capacity, 2),
    amenities: Array.isArray(hotel.amenities)
      ? hotel.amenities.filter((x): x is string => typeof x === 'string')
      : [],
  };
}

export async function createProviderListing(input: Record<string, unknown>, publicBaseUrl: string) {
  const [maxHotel, maxRoom, fallbackLocation] = await Promise.all([
    Hotel.findOne({}).sort({ _id: -1 }).select({ _id: 1 }).lean(),
    Room.findOne({}).sort({ _id: -1 }).select({ _id: 1 }).lean(),
    Location.findOne({}).sort({ _id: 1 }).select({ _id: 1 }).lean(),
  ]);
  if (!fallbackLocation) throw new ProviderListingError(500, 'No location found');

  const title = textValue(input.title, 'New Listing');
  const category = textValue(input.category, 'Hotel');
  const address = textValue(input.location ?? input.address, 'Tripwise destination');
  const description = textValue(input.description, '');
  const status = listStatus(input.status);
  const price = Math.max(1, Math.round(numberValue(input.pricePerNight ?? input.price, 200)));
  const roomsCount = Math.max(1, Math.round(numberValue(input.roomsCount, 1)));
  const maxGuests = Math.max(1, Math.round(numberValue(input.maxGuests, 2)));
  const bedrooms = Math.max(1, Math.round(numberValue(input.bedrooms, 1)));
  const bathrooms = Math.max(1, Math.round(numberValue(input.bathrooms, 1)));
  const amenities = Array.isArray(input.amenities)
    ? input.amenities.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  const imageUrl = await saveListingImage(input, publicBaseUrl);
  const now = new Date().toISOString();
  const hotelId = (maxHotel?._id ?? 0) + 1;
  const roomIdStart = (maxRoom?._id ?? 0) + 1;

  await Hotel.create({
    _id: hotelId,
    provider_id: env.demoProviderId,
    location_id: fallbackLocation._id,
    name: title,
    address,
    star_rating: 4.6,
    status: status === 'active' ? 'LIVE' : status === 'pending' ? 'PENDING' : 'INACTIVE',
    listing_status: status,
    listing_category: category,
    image: imageUrl,
    images: [imageUrl],
    description,
    amenities,
    bedrooms,
    bathrooms,
    max_guests: maxGuests,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });

  const roomDocs = Array.from({ length: roomsCount }, (_, index) => ({
    _id: roomIdStart + index,
    hotel_id: hotelId,
    room_type: index === 0 ? `${category} Suite` : `${category} Room ${index + 1}`,
    capacity: maxGuests,
    base_price: price,
    image: imageUrl,
    deleted_at: null,
  }));
  await Room.insertMany(roomDocs);

  return getProviderListingDetail(hotelId);
}

export async function updateProviderListing(idRaw: unknown, input: Record<string, unknown>) {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ProviderListingError(400, 'Invalid listing id');
  }
  const hotel = await Hotel.findOne({
    _id: id,
    provider_id: env.demoProviderId,
    deleted_at: null,
  });
  if (!hotel) throw new ProviderListingError(404, 'Listing not found');

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) updates.name = textValue(input.title, hotel.name);
  if (input.description !== undefined) updates.description = textValue(input.description, '');
  if (input.location !== undefined || input.address !== undefined) {
    updates.address = textValue(input.location ?? input.address, hotel.address);
  }
  if (input.category !== undefined) updates.listing_category = textValue(input.category, 'Hotel');
  if (input.status !== undefined) {
    const status = listStatus(input.status);
    updates.listing_status = status;
    updates.status = status === 'active' ? 'LIVE' : status === 'pending' ? 'PENDING' : 'INACTIVE';
  }
  if (input.amenities !== undefined && Array.isArray(input.amenities)) {
    updates.amenities = input.amenities.filter(
      (x): x is string => typeof x === 'string' && x.trim().length > 0,
    );
  }
  if (input.bedrooms !== undefined)
    updates.bedrooms = Math.max(1, Math.round(numberValue(input.bedrooms, 1)));
  if (input.bathrooms !== undefined)
    updates.bathrooms = Math.max(1, Math.round(numberValue(input.bathrooms, 1)));
  if (input.maxGuests !== undefined)
    updates.max_guests = Math.max(1, Math.round(numberValue(input.maxGuests, 2)));

  await Hotel.updateOne({ _id: id }, { $set: updates });

  if (
    input.pricePerNight !== undefined ||
    input.price !== undefined ||
    input.maxGuests !== undefined ||
    input.roomType !== undefined
  ) {
    const room = await Room.findOne({ hotel_id: id, deleted_at: null }).sort({
      base_price: 1,
      _id: 1,
    });
    if (room) {
      if (input.pricePerNight !== undefined || input.price !== undefined) {
        room.base_price = Math.max(
          1,
          Math.round(numberValue(input.pricePerNight ?? input.price, room.base_price)),
        );
      }
      if (input.maxGuests !== undefined) {
        room.capacity = Math.max(1, Math.round(numberValue(input.maxGuests, room.capacity ?? 2)));
      }
      if (input.roomType !== undefined) {
        room.room_type = textValue(input.roomType, room.room_type ?? 'Room');
      }
      await room.save();
    }
  }

  return getProviderListingDetail(id);
}

export async function deleteProviderListing(idRaw: unknown): Promise<{ ok: true }> {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ProviderListingError(400, 'Invalid listing id');
  }
  const now = new Date().toISOString();
  const res = await Hotel.updateOne(
    { _id: id, provider_id: env.demoProviderId, deleted_at: null },
    {
      $set: {
        deleted_at: now,
        updated_at: now,
        listing_status: 'inactive',
        status: 'INACTIVE',
      },
    },
  );
  if (res.matchedCount === 0) throw new ProviderListingError(404, 'Listing not found');
  await Room.updateMany({ hotel_id: id, deleted_at: null }, { $set: { deleted_at: now } });
  return { ok: true };
}

function rangeDays(period: AnalyticsPeriod): number {
  if (period === '7d') return 7;
  if (period === '90d') return 90;
  if (period === '1y') return 365;
  return 30;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function truncateDayLabel(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

export async function getProviderListingAnalytics(
  idRaw: unknown,
  periodRaw: unknown,
): Promise<ProviderListingAnalytics> {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ProviderListingError(400, 'Invalid listing id');
  }
  const period = parsePeriod(periodRaw);
  const detail = await getProviderListingDetail(id);
  const roomIds = (await Room.find({ hotel_id: id }).select({ _id: 1 }).lean()).map(
    (room) => room._id,
  );
  const items = await BookingItem.find({ room_id: { $in: roomIds } }).lean();

  const now = new Date();
  const since = new Date(now);
  since.setDate(now.getDate() - rangeDays(period));
  const beforeSince = new Date(since);
  beforeSince.setDate(beforeSince.getDate() - rangeDays(period));

  const inWindow = items.filter((item) => {
    const t = new Date(item.created_at ?? item.start_date ?? '1970-01-01').getTime();
    return t >= since.getTime() && t <= now.getTime();
  });
  const prevWindow = items.filter((item) => {
    const t = new Date(item.created_at ?? item.start_date ?? '1970-01-01').getTime();
    return t >= beforeSince.getTime() && t < since.getTime();
  });

  const revenue = inWindow.reduce((sum, item) => sum + numberValue(item.total_price, 0), 0);
  const prevRevenue = prevWindow.reduce((sum, item) => sum + numberValue(item.total_price, 0), 0);
  const bookings = inWindow.length;
  const prevBookings = prevWindow.length;
  const totalViews = bookings * 68 + 120;
  const prevViews = prevBookings * 68 + 120;

  const reviews = await Review.find({ hotel_id: id, deleted_at: null }).lean();
  const avgRating =
    reviews.length > 0
      ? Math.round(
          (reviews.reduce((sum, review) => sum + numberValue(review.rating, 0), 0) /
            reviews.length) *
            10,
        ) / 10
      : 0;

  const trendMap = new Map<string, { views: number; bookings: number }>();
  for (const item of inWindow) {
    const key = dayKey(new Date(item.created_at ?? item.start_date ?? now.toISOString()));
    const existing = trendMap.get(key) ?? { views: 0, bookings: 0 };
    existing.bookings += 1;
    existing.views += 68;
    trendMap.set(key, existing);
  }
  const trend = Array.from(trendMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-7)
    .map(([key, value]) => ({
      label: truncateDayLabel(key),
      views: value.views,
      bookings: value.bookings,
    }));
  while (trend.length < 7) {
    trend.unshift({ label: '—', views: 0, bookings: 0 });
  }

  const byDay = Array.from(trendMap.entries())
    .map(([key, value]) => ({
      key,
      day: truncateDayLabel(key),
      views: value.views,
      bookings: value.bookings,
      revenue: inWindow
        .filter(
          (item) =>
            dayKey(new Date(item.created_at ?? item.start_date ?? now.toISOString())) === key,
        )
        .reduce((sum, item) => sum + numberValue(item.total_price, 0), 0),
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3);

  const bookingIds = firstString(inWindow.map((item) => item.booking_id));
  const paymentRows = await Payment.find({
    booking_id: { $in: bookingIds },
  }).lean();
  const sourceCount = {
    direct: paymentRows.filter((row) => row.payment_method === 'CREDIT_CARD').length,
    app: paymentRows.filter((row) => row.payment_method === 'WALLET').length,
    partner: paymentRows.filter((row) => row.payment_method === 'PAYPAL').length,
  };
  const sourceTotal = sourceCount.direct + sourceCount.app + sourceCount.partner;
  const toPct = (count: number): number =>
    sourceTotal > 0 ? Math.round((count / sourceTotal) * 100) : 0;

  const bookingUserRows = await Booking.find({
    _id: { $in: bookingIds },
  })
    .select({ _id: 1, user_id: 1 })
    .lean();
  const guestCounts = new Map<string, number>();
  for (const booking of bookingUserRows) {
    const key = booking.user_id ?? 'anonymous';
    guestCounts.set(key, (guestCounts.get(key) ?? 0) + 1);
  }
  const repeatGuests = Array.from(guestCounts.values()).filter((v) => v >= 2).length;
  const totalGuests = guestCounts.size;
  const repeatGuestsPct = totalGuests > 0 ? Math.round((repeatGuests / totalGuests) * 100) : 0;
  const averageStayNights =
    inWindow.length > 0
      ? Math.round(
          (inWindow.reduce((sum, item) => {
            const start = new Date(
              item.start_date ?? item.created_at ?? now.toISOString(),
            ).getTime();
            const end = new Date(item.end_date ?? item.start_date ?? now.toISOString()).getTime();
            if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return sum + 1;
            return sum + Math.max(1, Math.round((end - start) / 86_400_000));
          }, 0) /
            inWindow.length) *
            10,
        ) / 10
      : 0;

  const delta = (cur: number, prev: number): number => {
    if (prev <= 0) return cur > 0 ? 100 : 0;
    return Math.round(((cur - prev) / prev) * 1000) / 10;
  };

  return {
    listingId: detail.id,
    period,
    kpis: {
      totalViews,
      viewsDeltaPct: delta(totalViews, prevViews),
      bookings,
      bookingsDeltaPct: delta(bookings, prevBookings),
      revenue,
      revenueDeltaPct: delta(revenue, prevRevenue),
      averageRating: avgRating,
      ratingDelta: avgRating > 0 ? 0.2 : 0,
    },
    trend,
    topDays: byDay.map((x) => ({
      day: x.day,
      views: x.views,
      bookings: x.bookings,
      revenue: x.revenue,
    })),
    bookingSources: [
      {
        label: 'Direct Bookings',
        percentage: toPct(sourceCount.direct),
        count: sourceCount.direct,
      },
      { label: 'Tripwise App', percentage: toPct(sourceCount.app), count: sourceCount.app },
      { label: 'Partners', percentage: toPct(sourceCount.partner), count: sourceCount.partner },
    ],
    guestStats: {
      repeatGuestsPct,
      averageStayNights,
    },
  };
}
