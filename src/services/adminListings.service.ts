import { Hotel, type HotelDoc } from '@/models/Hotel.model';
import { Provider } from '@/models/Provider.model';

type ListingReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';

type LeanHotel = Pick<
  HotelDoc,
  | '_id'
  | 'provider_id'
  | 'name'
  | 'address'
  | 'status'
  | 'listing_status'
  | 'listing_category'
  | 'image'
  | 'created_at'
  | 'updated_at'
> & {
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  rejection_reason?: string | null;
};

type LeanProvider = {
  _id: string;
  business_name?: string | null;
  user_id?: string | null;
};

export interface AdminListingSummary {
  id: number;
  providerId: string;
  providerName: string;
  title: string;
  location: string;
  category: string;
  status: ListingReviewStatus;
  imageUrl: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
}

export interface AdminListingsResponse {
  status: ListingReviewStatus;
  counts: Record<'PENDING' | 'APPROVED' | 'REJECTED', number>;
  listings: AdminListingSummary[];
}

export class AdminListingError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function parseStatus(value: unknown): ListingReviewStatus {
  if (typeof value !== 'string') return 'PENDING';
  const normalized = value.trim().toUpperCase();
  if (normalized === 'APPROVED') return 'APPROVED';
  if (normalized === 'REJECTED') return 'REJECTED';
  if (normalized === 'ALL') return 'ALL';
  return 'PENDING';
}

function statusOf(hotel: LeanHotel): ListingReviewStatus {
  const raw = String(hotel.listing_status ?? hotel.status ?? '').trim().toUpperCase();
  if (raw === 'ACTIVE' || raw === 'LIVE' || raw === 'APPROVED') return 'APPROVED';
  if (raw === 'INACTIVE' || raw === 'REJECTED') return 'REJECTED';
  return 'PENDING';
}

async function providerMap(providerIds: string[]): Promise<Map<string, LeanProvider>> {
  if (providerIds.length === 0) return new Map();
  const providers = (await Provider.find({ _id: { $in: providerIds } })
    .select({ _id: 1, business_name: 1, user_id: 1 })
    .lean()) as LeanProvider[];
  return new Map(providers.map((provider) => [provider._id, provider] as const));
}

function serializeListing(hotel: LeanHotel, provider?: LeanProvider): AdminListingSummary {
  return {
    id: hotel._id,
    providerId: hotel.provider_id,
    providerName: provider?.business_name?.trim() || 'Tripwise Provider',
    title: hotel.name?.trim() || 'Untitled listing',
    location: hotel.address?.trim() || 'Tripwise location',
    category: hotel.listing_category?.trim() || 'Hotel',
    status: statusOf(hotel),
    imageUrl: hotel.image?.trim() || null,
    submittedAt: hotel.created_at ?? null,
    reviewedAt: hotel.reviewed_at ?? null,
    reviewedBy: hotel.reviewed_by ?? null,
    rejectionReason: hotel.rejection_reason ?? null,
  };
}

export async function listAdminListings(statusRaw: unknown): Promise<AdminListingsResponse> {
  const status = parseStatus(statusRaw);
  const docs = (await Hotel.find({ deleted_at: null })
    .sort({ updated_at: -1, created_at: -1, _id: -1 })
    .lean()) as LeanHotel[];

  const providers = await providerMap(Array.from(new Set(docs.map((item) => item.provider_id))));
  const all = docs.map((hotel) => serializeListing(hotel, providers.get(hotel.provider_id)));
  const counts = {
    PENDING: all.filter((item) => item.status === 'PENDING').length,
    APPROVED: all.filter((item) => item.status === 'APPROVED').length,
    REJECTED: all.filter((item) => item.status === 'REJECTED').length,
  };

  return {
    status,
    counts,
    listings: status === 'ALL' ? all : all.filter((item) => item.status === status),
  };
}

export async function reviewAdminListing(input: {
  actorId: string;
  listingId: unknown;
  decision: unknown;
  reason?: unknown;
}): Promise<AdminListingSummary> {
  const id = Number(input.listingId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AdminListingError(400, 'Invalid listing id');
  }

  const decision = typeof input.decision === 'string' ? input.decision.trim().toUpperCase() : '';
  const isApproved = decision === 'APPROVED';
  const isRejected = decision === 'REJECTED';
  if (!isApproved && !isRejected) {
    throw new AdminListingError(400, 'Decision must be APPROVED or REJECTED');
  }

  const now = new Date().toISOString();
  const reason =
    typeof input.reason === 'string' && input.reason.trim().length > 0
      ? input.reason.trim()
      : isRejected
        ? 'Rejected by admin'
        : null;

  const hotel = (await Hotel.findOneAndUpdate(
    { _id: id, deleted_at: null },
    {
      $set: {
        status: isApproved ? 'LIVE' : 'INACTIVE',
        listing_status: isApproved ? 'active' : 'inactive',
        reviewed_at: now,
        reviewed_by: input.actorId,
        rejection_reason: reason,
        updated_at: now,
      },
    },
    { new: true },
  ).lean()) as LeanHotel | null;

  if (!hotel) throw new AdminListingError(404, 'Listing not found');
  const providers = await providerMap([hotel.provider_id]);
  return serializeListing(hotel, providers.get(hotel.provider_id));
}
