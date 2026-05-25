import { Hotel, type HotelDoc } from '@/models/Hotel.model';
import { Provider } from '@/models/Provider.model';
import { Room, type RoomDoc } from '@/models/Room.model';
import { RoomInventory } from '@/models/RoomInventory.model';

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
  | 'description'
  | 'amenities'
  | 'bedrooms'
  | 'bathrooms'
  | 'max_guests'
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

type LeanRoom = Pick<RoomDoc, '_id' | 'hotel_id' | 'room_type' | 'capacity' | 'base_price' | 'image'>;

type RoomAvailability = {
  roomId: number;
  availableQty: number | null;
  date: string | null;
};

export interface AdminListingRoomSummary {
  id: number;
  roomType: string;
  capacity: number | null;
  basePrice: number;
  basePriceLabel: string;
  imageUrl: string | null;
  availableQty: number | null;
  availabilityDate: string | null;
}

export interface AdminListingSummary {
  id: number;
  providerId: string;
  providerName: string;
  title: string;
  location: string;
  category: string;
  status: ListingReviewStatus;
  imageUrl: string | null;
  description: string | null;
  amenities: string[];
  bedrooms: number | null;
  bathrooms: number | null;
  maxGuests: number | null;
  roomCount: number;
  priceFrom: number | null;
  priceTo: number | null;
  priceRangeLabel: string;
  totalAvailableQty: number | null;
  rooms: AdminListingRoomSummary[];
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

function formatCurrency(value: number): string {
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

function priceRangeLabel(priceFrom: number | null, priceTo: number | null): string {
  if (priceFrom == null) return 'No room price';
  if (priceTo == null || priceTo === priceFrom) return formatCurrency(priceFrom);
  return `${formatCurrency(priceFrom)} - ${formatCurrency(priceTo)}`;
}

function serializeListing(
  hotel: LeanHotel,
  provider: LeanProvider | undefined,
  rooms: LeanRoom[],
  availability: Map<number, RoomAvailability>,
): AdminListingSummary {
  const roomSummaries = rooms
    .slice()
    .sort((a, b) => (a.base_price ?? 0) - (b.base_price ?? 0))
    .map((room) => {
      const roomAvailability = availability.get(room._id);
      const basePrice = Math.max(0, Math.round(room.base_price ?? 0));
      return {
        id: room._id,
        roomType: room.room_type?.trim() || 'Room',
        capacity: typeof room.capacity === 'number' ? room.capacity : null,
        basePrice,
        basePriceLabel: formatCurrency(basePrice),
        imageUrl: room.image?.trim() || null,
        availableQty: roomAvailability?.availableQty ?? null,
        availabilityDate: roomAvailability?.date ?? null,
      };
    });
  const prices = roomSummaries.map((room) => room.basePrice).filter((price) => price > 0);
  const priceFrom = prices.length > 0 ? Math.min(...prices) : null;
  const priceTo = prices.length > 0 ? Math.max(...prices) : null;
  const availableValues = roomSummaries
    .map((room) => room.availableQty)
    .filter((qty): qty is number => typeof qty === 'number');

  return {
    id: hotel._id,
    providerId: hotel.provider_id,
    providerName: provider?.business_name?.trim() || 'Tripwise Provider',
    title: hotel.name?.trim() || 'Untitled listing',
    location: hotel.address?.trim() || 'Tripwise location',
    category: hotel.listing_category?.trim() || 'Hotel',
    status: statusOf(hotel),
    imageUrl: hotel.image?.trim() || null,
    description: hotel.description?.trim() || null,
    amenities: Array.isArray(hotel.amenities) ? hotel.amenities.filter(Boolean) : [],
    bedrooms: typeof hotel.bedrooms === 'number' ? hotel.bedrooms : null,
    bathrooms: typeof hotel.bathrooms === 'number' ? hotel.bathrooms : null,
    maxGuests: typeof hotel.max_guests === 'number' ? hotel.max_guests : null,
    roomCount: roomSummaries.length,
    priceFrom,
    priceTo,
    priceRangeLabel: priceRangeLabel(priceFrom, priceTo),
    totalAvailableQty:
      availableValues.length > 0 ? availableValues.reduce((sum, qty) => sum + qty, 0) : null,
    rooms: roomSummaries,
    submittedAt: hotel.created_at ?? null,
    reviewedAt: hotel.reviewed_at ?? null,
    reviewedBy: hotel.reviewed_by ?? null,
    rejectionReason: hotel.rejection_reason ?? null,
  };
}

function groupRoomsByHotel(rooms: LeanRoom[]): Map<number, LeanRoom[]> {
  const result = new Map<number, LeanRoom[]>();
  for (const room of rooms) {
    const list = result.get(room.hotel_id) ?? [];
    list.push(room);
    result.set(room.hotel_id, list);
  }
  return result;
}

async function roomAvailabilityMap(roomIds: number[]): Promise<Map<number, RoomAvailability>> {
  if (roomIds.length === 0) return new Map();
  const today = new Date().toISOString().slice(0, 10);
  const rows = await RoomInventory.aggregate<{ _id: number; availableQty: number; date: string }>([
    { $match: { room_id: { $in: roomIds }, date: { $gte: today } } },
    { $sort: { date: 1 } },
    {
      $group: {
        _id: '$room_id',
        availableQty: { $first: '$available_qty' },
        date: { $first: '$date' },
      },
    },
  ]);
  return new Map(
    rows.map((row) => [
      row._id,
      {
        roomId: row._id,
        availableQty: row.availableQty,
        date: row.date,
      },
    ]),
  );
}

export async function listAdminListings(statusRaw: unknown): Promise<AdminListingsResponse> {
  const status = parseStatus(statusRaw);
  const docs = (await Hotel.find({ deleted_at: null })
    .sort({ updated_at: -1, created_at: -1, _id: -1 })
    .lean()) as LeanHotel[];

  const hotelIds = docs.map((item) => item._id);
  const [providers, rooms] = await Promise.all([
    providerMap(Array.from(new Set(docs.map((item) => item.provider_id)))),
    Room.find({ hotel_id: { $in: hotelIds }, deleted_at: null })
      .select({ _id: 1, hotel_id: 1, room_type: 1, capacity: 1, base_price: 1, image: 1 })
      .lean() as Promise<LeanRoom[]>,
  ]);
  const roomsByHotel = groupRoomsByHotel(rooms);
  const availability = await roomAvailabilityMap(rooms.map((room) => room._id));
  const all = docs.map((hotel) =>
    serializeListing(
      hotel,
      providers.get(hotel.provider_id),
      roomsByHotel.get(hotel._id) ?? [],
      availability,
    ),
  );
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
  const [providers, rooms] = await Promise.all([
    providerMap([hotel.provider_id]),
    Room.find({ hotel_id: hotel._id, deleted_at: null })
      .select({ _id: 1, hotel_id: 1, room_type: 1, capacity: 1, base_price: 1, image: 1 })
      .lean() as Promise<LeanRoom[]>,
  ]);
  const availability = await roomAvailabilityMap(rooms.map((room) => room._id));
  return serializeListing(hotel, providers.get(hotel.provider_id), rooms, availability);
}
