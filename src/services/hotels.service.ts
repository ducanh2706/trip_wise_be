import { Hotel } from '@/models/Hotel.model';
import { Room } from '@/models/Room.model';
import { Location } from '@/models/Location.model';
import { Provider } from '@/models/Provider.model';
import { Booking } from '@/models/Booking.model';
import { BookingItem } from '@/models/BookingItem.model';
import {
  getHotelReviewSummary,
  ReviewResponse,
} from '@/services/reviews.service';

export interface HotelDetailResponse {
  id: number;
  name: string;
  category: string;
  address: string;
  locationPath: string;
  starRating: number;
  rating: number;
  reviewCount: number;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  images: string[];
  amenities: string[];
  priceFrom: number | null;
  currency: string;
  host: { id: string; name: string } | null;
  policies: { freeCancellation: boolean };
  isFavoritedByMe: boolean;
  googleMapUrl: string | null;
  reviewsPreview: ReviewResponse[];
  existingBooking: {
    bookingId: string;
    bookingItemId: string;
    status: string;
    canCancel: boolean;
  } | null;
}

const ACTIVE_ITEM_STATUSES = [
  'PENDING',
  'REQUESTED',
  'AWAITING_APPROVAL',
  'CONFIRMED',
  'PAID',
  'ACCEPTED',
  'APPROVED',
];

async function resolveExistingBookingForHotel(
  userId: string | undefined,
  hotelId: number,
): Promise<HotelDetailResponse['existingBooking']> {
  if (!userId) return null;

  const rooms = await Room.find({ hotel_id: hotelId, deleted_at: null })
    .select({ _id: 1 })
    .lean();
  const roomIds = rooms
    .map((room) => room._id)
    .filter((id): id is number => typeof id === 'number');
  if (roomIds.length === 0) return null;

  const candidateItems = await BookingItem.find({
    room_id: { $in: roomIds },
    item_status: { $in: ACTIVE_ITEM_STATUSES },
  })
    .sort({ created_at: -1, _id: -1 })
    .lean();
  if (candidateItems.length === 0) return null;

  const bookingIds = Array.from(new Set(candidateItems.map((item) => item.booking_id)));
  const bookings = await Booking.find({
    _id: { $in: bookingIds },
    user_id: userId,
  })
    .select({ _id: 1, status: 1 })
    .lean();
  const bookingSet = new Set(bookings.map((booking) => String(booking._id)));
  const matchedItem = candidateItems.find((item) => bookingSet.has(item.booking_id));
  if (!matchedItem) return null;

  return {
    bookingId: matchedItem.booking_id,
    bookingItemId: matchedItem._id,
    status: matchedItem.item_status ?? 'CONFIRMED',
    canCancel: true,
  };
}

function deriveCategory(starRating: number): string {
  if (starRating >= 5) return 'LUXURY RESORT';
  if (starRating >= 4) return 'PREMIUM HOTEL';
  if (starRating >= 3) return 'HOTEL';
  return 'BUDGET STAY';
}

async function buildLocationPath(startId: number): Promise<string> {
  const names: string[] = [];
  let current: number | null = startId;
  for (let depth = 0; depth < 6 && current !== null; depth++) {
    const loc: { name: string; parent_id?: number | null } | null =
      await Location.findById(current).lean();
    if (!loc) break;
    names.push(loc.name);
    current = loc.parent_id ?? null;
  }
  return names.join(', ');
}

export async function getHotelDetail(
  id: number,
  userId?: string,
): Promise<HotelDetailResponse | null> {
  const hotel = await Hotel.findOne({ _id: id, deleted_at: null }).lean();
  if (!hotel) return null;

  const [cheapestRoom, provider, locationPath, reviewSummary, existingBooking] =
    await Promise.all([
      Room.findOne({ hotel_id: id, deleted_at: null })
        .sort({ base_price: 1 })
        .lean(),
      Provider.findById(hotel.provider_id).lean(),
      buildLocationPath(hotel.location_id),
      getHotelReviewSummary(id, 2),
      resolveExistingBookingForHotel(userId, id),
    ]);

  return {
    id: hotel._id,
    name: hotel.name,
    category: deriveCategory(hotel.star_rating),
    address: hotel.address,
    locationPath,
    starRating: hotel.star_rating,
    // Real average from the reviews collection; fall back to the
    // star_rating proxy only when a hotel has no reviews yet.
    rating: reviewSummary.count > 0 ? reviewSummary.average : hotel.star_rating,
    reviewCount: reviewSummary.count,
    latitude: hotel.latitude ?? null,
    longitude: hotel.longitude ?? null,
    description: hotel.description ?? null,
    images:
      hotel.images && hotel.images.length > 0
        ? hotel.images
        : hotel.image
          ? [hotel.image]
          : [],
    amenities: hotel.amenities ?? [],
    priceFrom: cheapestRoom?.base_price ?? null,
    currency: 'VND',
    host: provider ? { id: provider._id, name: provider.business_name } : null,
    policies: { freeCancellation: true },
    isFavoritedByMe: false,
    googleMapUrl: hotel.google_map_url ?? null,
    reviewsPreview: reviewSummary.preview,
    existingBooking,
  };
}
