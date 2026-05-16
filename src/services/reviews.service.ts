import { Review, ReviewDoc } from '@/models/Review.model';

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
