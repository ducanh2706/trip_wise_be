import { Review, ReviewDoc } from '@/models/Review.model';
import { Booking } from '@/models/Booking.model';
import { BookingItem } from '@/models/BookingItem.model';
import { Room } from '@/models/Room.model';
import { User } from '@/models/User.model';
import { deleteCacheKey } from '@/config/redis';

export interface ReviewResponse {
  id: number;
  authorName: string;
  authorImage: string | null;
  rating: number;
  comment: string;
  tripType: string | null;
  createdAt: string | null;
}

export interface ReviewListResponse {
  items: ReviewResponse[];
  total: number;
  hasMore: boolean;
  nextOffset: number;
}

export interface HotelReviewSummary {
  average: number;
  count: number;
  preview: ReviewResponse[];
}

export interface HotelReviewStats {
  average: number;
  count: number;
}

export class ReviewError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function mapReview(doc: ReviewDoc): ReviewResponse {
  return {
    id: doc._id,
    authorName: doc.author_name,
    authorImage: doc.author_image ?? null,
    rating: doc.rating,
    comment: doc.comment,
    tripType: doc.trip_type ?? null,
    createdAt: doc.created_at ?? null,
  };
}

// Newest first; _id as tiebreaker keeps pagination stable.
const SORT = { created_at: -1, _id: -1 } as const;
const HOTEL_DETAIL_CACHE_KEY_VERSION = 1;
const COMPLETED_STATUSES = new Set(['COMPLETED', 'DONE']);
const BLOCKED_STATUSES = new Set([
  'CANCELLED',
  'CANCELED',
  'REJECTED',
  'CANCELLATION_PENDING',
]);

function normalizeStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function hasEnded(end?: string | null): boolean {
  if (!end) return false;
  const date = end.length <= 10 ? new Date(`${end}T00:00:00.000Z`) : new Date(end);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < Date.now();
}

function canReviewCompletedItem(input: {
  itemStatus?: string | null;
  bookingStatus?: string | null;
  endDate?: string | null;
}): boolean {
  const raw = normalizeStatus(input.itemStatus || input.bookingStatus);
  if (BLOCKED_STATUSES.has(raw)) return false;
  if (COMPLETED_STATUSES.has(raw)) return true;
  return hasEnded(input.endDate);
}

function cleanComment(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function createReviewId(): number {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

/**
 * Aggregate rating + count + the newest few reviews, in one round trip pair.
 * Used by the hotel detail endpoint so the screen can render the preview
 * without a second request.
 */
export async function getHotelReviewSummary(
  hotelId: number,
  previewLimit = 2,
): Promise<HotelReviewSummary> {
  const [stats, preview] = await Promise.all([
    Review.aggregate<{ avg: number; count: number }>([
      { $match: { hotel_id: hotelId, deleted_at: null } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]),
    Review.find({ hotel_id: hotelId, deleted_at: null })
      .sort(SORT)
      .limit(previewLimit)
      .lean<ReviewDoc[]>(),
  ]);

  const agg = stats[0];
  return {
    average: agg ? Math.round(agg.avg * 10) / 10 : 0,
    count: agg ? agg.count : 0,
    preview: preview.map(mapReview),
  };
}

export async function getHotelReviewStats(
  hotelIds: number[],
): Promise<Map<number, HotelReviewStats>> {
  const ids = Array.from(
    new Set(hotelIds.filter((id) => Number.isInteger(id) && id > 0)),
  );
  if (ids.length === 0) return new Map();

  const rows = await Review.aggregate<{
    _id: number;
    average: number;
    count: number;
  }>([
    { $match: { hotel_id: { $in: ids }, deleted_at: null } },
    {
      $group: {
        _id: '$hotel_id',
        average: { $avg: '$rating' },
        count: { $sum: 1 },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      row._id,
      {
        average: Math.round(row.average * 10) / 10,
        count: row.count,
      },
    ]),
  );
}

export async function getReviewForBookingItem(
  bookingItemId: string,
): Promise<ReviewResponse | null> {
  const doc = await Review.findOne({
    booking_item_id: bookingItemId,
    deleted_at: null,
  }).lean<ReviewDoc | null>();
  return doc ? mapReview(doc) : null;
}

export async function createHotelReview(input: {
  userId: string;
  bookingItemId: string;
  rating: unknown;
  comment: unknown;
}): Promise<ReviewResponse> {
  const bookingItemId = input.bookingItemId.trim();
  const rating = Number(input.rating);
  const comment = cleanComment(input.comment);

  if (!bookingItemId) {
    throw new ReviewError(400, 'Invalid booking item id');
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ReviewError(400, 'Rating must be between 1 and 5 stars.');
  }
  if (comment.length < 3) {
    throw new ReviewError(400, 'Please write a short review comment.');
  }
  if (comment.length > 1000) {
    throw new ReviewError(400, 'Review comment is too long.');
  }

  const item = await BookingItem.findById(bookingItemId).lean();
  if (!item) {
    throw new ReviewError(404, 'Trip not found');
  }

  const booking = await Booking.findOne({
    _id: item.booking_id,
    user_id: input.userId,
  }).lean();
  if (!booking) {
    throw new ReviewError(404, 'Trip not found');
  }
  if (item.room_id == null) {
    throw new ReviewError(409, 'Only hotel bookings can be reviewed.');
  }
  if (
    !canReviewCompletedItem({
      itemStatus: item.item_status,
      bookingStatus: booking.status,
      endDate: item.end_date,
    })
  ) {
    throw new ReviewError(409, 'Only completed bookings can be reviewed.');
  }

  const room = await Room.findOne({ _id: item.room_id, deleted_at: null })
    .select({ hotel_id: 1 })
    .lean();
  if (!room) {
    throw new ReviewError(404, 'Hotel room not found');
  }

  const existing = await Review.findOne({
    booking_item_id: bookingItemId,
    deleted_at: null,
  }).lean<ReviewDoc | null>();
  if (existing) {
    throw new ReviewError(409, 'You have already reviewed this booking.');
  }

  const user = await User.findById(input.userId)
    .select({ full_name: 1, image: 1 })
    .lean();
  const now = new Date().toISOString();
  const created = await Review.create({
    _id: createReviewId(),
    hotel_id: room.hotel_id,
    booking_item_id: bookingItemId,
    user_id: input.userId,
    author_name: user?.full_name?.trim() || 'Guest',
    author_image: user?.image ?? null,
    rating,
    comment,
    trip_type: 'Verified stay',
    created_at: now,
    deleted_at: null,
  });

  await deleteCacheKey(`hotel:detail:v${HOTEL_DETAIL_CACHE_KEY_VERSION}:${room.hotel_id}`);
  return mapReview(created);
}

/**
 * Offset-paginated review list backing the "See All" lazy-loading screen.
 */
export async function listHotelReviews(
  hotelId: number,
  limit: number,
  offset: number,
): Promise<ReviewListResponse> {
  const [total, docs] = await Promise.all([
    Review.countDocuments({ hotel_id: hotelId, deleted_at: null }),
    Review.find({ hotel_id: hotelId, deleted_at: null })
      .sort(SORT)
      .skip(offset)
      .limit(limit)
      .lean<ReviewDoc[]>(),
  ]);

  const nextOffset = offset + docs.length;
  return {
    items: docs.map(mapReview),
    total,
    hasMore: nextOffset < total,
    nextOffset,
  };
}
