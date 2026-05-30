import { BookingItem } from '@/models/BookingItem.model';
import { Hotel } from '@/models/Hotel.model';
import { Location } from '@/models/Location.model';
import { Payment } from '@/models/Payment.model';
import { Review } from '@/models/Review.model';
import { Room } from '@/models/Room.model';
import { invalidateHotelDetailCache } from '@/services/hotels.service';
import {
  getHotelReviewSummary,
  ReviewResponse,
} from '@/services/reviews.service';

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
  rating: number;
  reviewCount: number;
  reviews: ReviewResponse[];
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

const MAX_LISTING_IMAGE_BYTES = 5 * 1024 * 1024;
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function listStatus(raw: unknown): ListingStatus {
  if (typeof raw !== 'string') return 'pending';
  const value = raw.trim().toLowerCase();
  if (value === 'inactive') return 'inactive';
  if (value === 'pending' || value === 'pending_review') return 'pending';
  if (value === 'active' || value === 'live' || value === 'approved') return 'active';
  return 'pending';
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

function firstString(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0)),
  );
}

function pickImage(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return '';
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
  _publicBaseUrl: string,
): Promise<string> {
  const directUrl = textValue(input.imageUrl, '');
  if (directUrl) return directUrl;

  const upload =
    input.imageUpload && typeof input.imageUpload === 'object'
      ? (input.imageUpload as Record<string, unknown>)
      : null;
  if (!upload) return '';

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
  return `data:${mimeType};base64,${base64Data}`;
}

async function listingBase(providerId: string) {
  const [hotels, rooms] = await Promise.all([
    Hotel.find({
      provider_id: providerId,
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
  providerId: string;
  query?: unknown;
  status?: unknown;
}): Promise<ProviderListingsResponse> {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  const status =
    input.status === 'active' || input.status === 'inactive' || input.status === 'pending'
      ? input.status
      : 'all';

  const { hotels, roomsByHotel } = await listingBase(input.providerId);
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

export async function getProviderListingDetail(
  providerId: string,
  idRaw: unknown,
): Promise<ProviderListingDetail> {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ProviderListingError(400, 'Invalid listing id');
  }

  const hotel = await Hotel.findOne({
    _id: id,
    provider_id: providerId,
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

  const reviewSummary = await getHotelReviewSummary(id, 5);

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
    rating: reviewSummary.average,
    reviewCount: reviewSummary.count,
    reviews: reviewSummary.preview,
  };
}

function cleanProviderReply(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export async function replyToProviderListingReview(
  providerId: string,
  listingIdRaw: unknown,
  reviewIdRaw: unknown,
  input: Record<string, unknown>,
): Promise<ReviewResponse> {
  const listingId = Number(listingIdRaw);
  const reviewId = Number(reviewIdRaw);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    throw new ProviderListingError(400, 'Invalid listing id');
  }
  if (!Number.isInteger(reviewId) || reviewId <= 0) {
    throw new ProviderListingError(400, 'Invalid review id');
  }

  const reply = cleanProviderReply(input.reply);
  if (reply.length === 0) {
    throw new ProviderListingError(400, 'Reply cannot be empty.');
  }
  if (reply.length > 1000) {
    throw new ProviderListingError(400, 'Reply is too long.');
  }

  const hotel = await Hotel.findOne({
    _id: listingId,
    provider_id: providerId,
    deleted_at: null,
  })
    .select({ _id: 1 })
    .lean();
  if (!hotel) throw new ProviderListingError(404, 'Listing not found');

  const updated = await Review.findOneAndUpdate(
    { _id: reviewId, hotel_id: listingId, deleted_at: null },
    {
      $set: {
        provider_reply: reply,
        provider_replied_at: new Date().toISOString(),
      },
    },
    { new: true },
  ).lean();

  if (!updated) throw new ProviderListingError(404, 'Review not found');
  await invalidateHotelDetailCache(listingId);

  return {
    id: updated._id,
    authorName: updated.author_name,
    authorImage: updated.author_image ?? null,
    rating: updated.rating,
    comment: updated.comment,
    providerReply: updated.provider_reply ?? null,
    providerRepliedAt: updated.provider_replied_at ?? null,
    tripType: updated.trip_type ?? null,
    createdAt: updated.created_at ?? null,
  };
}

export async function createProviderListing(
  providerId: string,
  input: Record<string, unknown>,
  publicBaseUrl: string,
) {
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
  const status: ListingStatus = 'pending';
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
    provider_id: providerId,
    location_id: fallbackLocation._id,
    name: title,
    address,
    star_rating: 4.6,
    status: 'PENDING',
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
  await invalidateHotelDetailCache(hotelId);

  return getProviderListingDetail(providerId, hotelId);
}

export async function updateProviderListing(
  providerId: string,
  idRaw: unknown,
  input: Record<string, unknown>,
  publicBaseUrl: string,
) {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ProviderListingError(400, 'Invalid listing id');
  }
  const hotel = await Hotel.findOne({
    _id: id,
    provider_id: providerId,
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
    const nextStatus = status === 'inactive' ? 'inactive' : 'pending';
    updates.listing_status = nextStatus;
    updates.status = nextStatus === 'inactive' ? 'INACTIVE' : 'PENDING';
    updates.reviewed_at = null;
    updates.reviewed_by = null;
    updates.rejection_reason = null;
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
  if (input.imageUpload !== undefined || input.imageUrl !== undefined) {
    const imageUrl = await saveListingImage(input, publicBaseUrl);
    updates.image = imageUrl;
    updates.images = [imageUrl];
  }

  await Hotel.updateOne({ _id: id }, { $set: updates });

  if (
    input.pricePerNight !== undefined ||
    input.price !== undefined ||
    input.maxGuests !== undefined ||
    input.roomType !== undefined ||
    input.imageUpload !== undefined ||
    input.imageUrl !== undefined
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
      if (updates.image !== undefined) {
        room.image = textValue(updates.image, room.image ?? '');
      }
      await room.save();
    }
  }
  await invalidateHotelDetailCache(id);

  return getProviderListingDetail(providerId, id);
}

export async function deleteProviderListing(
  providerId: string,
  idRaw: unknown,
): Promise<{ ok: true }> {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ProviderListingError(400, 'Invalid listing id');
  }
  const now = new Date().toISOString();
  const res = await Hotel.updateOne(
    { _id: id, provider_id: providerId, deleted_at: null },
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
  await invalidateHotelDetailCache(id);
  return { ok: true };
}

function rangeDays(period: AnalyticsPeriod): number {
  if (period === '7d') return 7;
  if (period === '90d') return 90;
  if (period === '1y') return 365;
  return 30;
}

export async function getProviderListingAnalytics(
  providerId: string,
  idRaw: unknown,
  periodRaw: unknown,
): Promise<ProviderListingAnalytics> {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ProviderListingError(400, 'Invalid listing id');
  }
  const period = parsePeriod(periodRaw);
  const detail = await getProviderListingDetail(providerId, id);
  const hotel = await Hotel.findOne({ _id: id, provider_id: providerId, deleted_at: null })
    .select({ analytics_views: 1 })
    .lean();
  const totalViews = Math.max(0, Math.round(numberValue(hotel?.analytics_views, 0)));

  const roomIds = (await Room.find({ hotel_id: id }).select({ _id: 1 }).lean()).map(
    (room) => room._id,
  );
  const bookingItems = await BookingItem.find({ room_id: { $in: roomIds } })
    .select({ booking_id: 1, total_price: 1 })
    .lean();

  const bookingIds = firstString(bookingItems.map((item) => item.booking_id));
  const now = new Date();
  const since = new Date(now);
  since.setDate(now.getDate() - rangeDays(period));
  const previousSince = new Date(since);
  previousSince.setDate(previousSince.getDate() - rangeDays(period));

  const payments = await Payment.find({
    booking_id: { $in: bookingIds },
    status: 'SUCCESS',
  })
    .select({ booking_id: 1, created_at: 1, updated_at: 1 })
    .lean();

  const revenueByBooking = new Map<string, number>();
  for (const item of bookingItems) {
    const bookingId = item.booking_id;
    revenueByBooking.set(
      bookingId,
      (revenueByBooking.get(bookingId) ?? 0) + numberValue(item.total_price, 0),
    );
  }

  const inCurrentWindow = new Set<string>();
  const inPreviousWindow = new Set<string>();
  for (const payment of payments) {
    const bookingId = payment.booking_id;
    if (typeof bookingId !== 'string' || bookingId.length === 0) continue;
    const timeRaw = payment.updated_at ?? payment.created_at;
    const ts = new Date(typeof timeRaw === 'string' ? timeRaw : '').getTime();
    if (Number.isNaN(ts)) continue;
    if (ts >= since.getTime() && ts <= now.getTime()) {
      inCurrentWindow.add(bookingId);
    } else if (ts >= previousSince.getTime() && ts < since.getTime()) {
      inPreviousWindow.add(bookingId);
    }
  }

  const bookings = inCurrentWindow.size;
  const prevBookings = inPreviousWindow.size;
  const revenue = Array.from(inCurrentWindow).reduce(
    (sum, bookingId) => sum + (revenueByBooking.get(bookingId) ?? 0),
    0,
  );
  const prevRevenue = Array.from(inPreviousWindow).reduce(
    (sum, bookingId) => sum + (revenueByBooking.get(bookingId) ?? 0),
    0,
  );

  const delta = (cur: number, prev: number): number => {
    if (prev <= 0) return cur > 0 ? 100 : 0;
    return Math.round(((cur - prev) / prev) * 1000) / 10;
  };

  return {
    listingId: detail.id,
    period,
    kpis: {
      totalViews,
      viewsDeltaPct: 0,
      bookings,
      bookingsDeltaPct: delta(bookings, prevBookings),
      revenue,
      revenueDeltaPct: delta(revenue, prevRevenue),
      averageRating: 5,
      ratingDelta: 0,
    },
    trend: [],
    topDays: [],
    bookingSources: [],
    guestStats: {
      repeatGuestsPct: 0,
      averageStayNights: 0,
    },
  };
}
