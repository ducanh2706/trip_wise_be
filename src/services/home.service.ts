import { Hotel, type HotelDoc } from '@/models/Hotel.model';
import { Location, type LocationDoc } from '@/models/Location.model';
import { Room } from '@/models/Room.model';

const HOME_SOURCE_LIMIT = 36;
const FEATURED_LIMIT = 2;
const RECOMMENDED_LIMIT = 4;
const TRENDING_LIMIT = 6;
const MAX_LOCATION_DEPTH = 6;
const LOCATION_TYPE_PRIORITY = [
  'city',
  'province',
  'state',
  'region',
  'district',
  'municipality',
  'destination',
];
const locationNameFallbackTypes = new Set(['ward', 'commune', 'village']);
const priceFormatter = new Intl.NumberFormat('en-US');

type LeanHotel = Pick<
  HotelDoc,
  '_id' | 'location_id' | 'name' | 'address' | 'star_rating' | 'image' | 'images'
>;

type LeanLocation = Pick<LocationDoc, '_id' | 'name' | 'parent_id' | 'type'>;

interface BaseHomeHotel {
  hotelId: number;
  hotelName: string;
  imageUrl: string | null;
  destinationName: string;
  locationLabel: string;
  priceFrom: number | null;
  priceLabel: string | null;
  currency: 'VND';
  rating: number;
  ratingLabel: string;
}

interface HomeSourceHotel extends BaseHomeHotel {
  hasImage: boolean;
}

export interface HomeOfferItem extends BaseHomeHotel {
  title: string;
  subtitle: string;
  ctaLabel: string;
}

export interface HomeRecommendedItem extends BaseHomeHotel {
  title: string;
  caption: string;
}

export interface HomeTrendingHotelItem extends BaseHomeHotel {
  name: string;
  location: string;
}

export interface HomeResponse {
  featuredOffers: HomeOfferItem[];
  recommendedDestinations: HomeRecommendedItem[];
  trendingHotels: HomeTrendingHotelItem[];
}

function isFilledString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function pickPrimaryImage(
  images?: string[] | null,
  fallbackImage?: string | null,
): string | null {
  const candidates = [...(images ?? []), fallbackImage];

  for (const candidate of candidates) {
    if (isFilledString(candidate)) {
      return candidate.trim();
    }
  }

  return null;
}

function formatVndPrice(value: number): string {
  return `VND ${priceFormatter.format(value)}`;
}

function getPriceLabel(priceFrom: number | null): string | null {
  return priceFrom === null ? null : formatVndPrice(priceFrom);
}

function normalizeLocationType(type: string | null | undefined): string {
  return type?.trim().toLowerCase() ?? '';
}

function getDestinationName(locationTrail: LeanLocation[], hotelName: string): string {
  for (const preferredType of LOCATION_TYPE_PRIORITY) {
    const preferredLocation = locationTrail.find((location) =>
      normalizeLocationType(location.type).includes(preferredType),
    );

    if (preferredLocation && isFilledString(preferredLocation.name)) {
      return preferredLocation.name.trim();
    }
  }

  if (locationTrail.length > 1) {
    const firstType = normalizeLocationType(locationTrail[0].type);
    if (locationNameFallbackTypes.has(firstType) && isFilledString(locationTrail[1].name)) {
      return locationTrail[1].name.trim();
    }
  }

  const firstNamedLocation = locationTrail.find((location) => isFilledString(location.name));
  return firstNamedLocation ? firstNamedLocation.name.trim() : hotelName;
}

function buildLocationLabel(locationTrail: LeanLocation[]): string {
  return locationTrail
    .map((location) => location.name.trim())
    .filter(Boolean)
    .join(', ');
}

async function loadLocationMap(startIds: number[]): Promise<Map<number, LeanLocation>> {
  const locationMap = new Map<number, LeanLocation>();
  let pendingIds = Array.from(
    new Set(startIds.filter((id) => Number.isInteger(id) && id > 0)),
  );

  // Walk ancestor chains in batches so the home feed does not fan out into one query per hotel.
  for (let depth = 0; depth < MAX_LOCATION_DEPTH && pendingIds.length > 0; depth++) {
    const idsToFetch = pendingIds.filter((id) => !locationMap.has(id));
    if (idsToFetch.length === 0) {
      break;
    }

    const locations = (await Location.find({ _id: { $in: idsToFetch } })
      .select({ _id: 1, name: 1, parent_id: 1, type: 1 })
      .lean()) as LeanLocation[];

    pendingIds = [];

    for (const location of locations) {
      locationMap.set(location._id, location);

      if (
        typeof location.parent_id === 'number' &&
        location.parent_id > 0 &&
        !locationMap.has(location.parent_id)
      ) {
        pendingIds.push(location.parent_id);
      }
    }

    pendingIds = Array.from(new Set(pendingIds));
  }

  return locationMap;
}

function buildLocationTrail(
  startId: number,
  locationMap: Map<number, LeanLocation>,
): LeanLocation[] {
  const trail: LeanLocation[] = [];
  const visitedIds = new Set<number>();
  let currentId: number | null = startId;

  for (let depth = 0; depth < MAX_LOCATION_DEPTH && currentId !== null; depth++) {
    if (visitedIds.has(currentId)) {
      break;
    }

    visitedIds.add(currentId);

    const location = locationMap.get(currentId);
    if (!location) {
      break;
    }

    trail.push(location);
    currentId = typeof location.parent_id === 'number' ? location.parent_id : null;
  }

  return trail;
}

async function getCheapestRoomPrices(
  hotelIds: number[],
): Promise<Map<number, number>> {
  const cheapestRooms = await Room.aggregate<{ _id: number; priceFrom: number }>([
    {
      $match: {
        hotel_id: { $in: hotelIds },
        deleted_at: null,
      },
    },
    {
      $group: {
        _id: '$hotel_id',
        priceFrom: { $min: '$base_price' },
      },
    },
  ]);

  return new Map(
    cheapestRooms.map((room) => [room._id, room.priceFrom] as const),
  );
}

function compareNullableNumberAsc(a: number | null, b: number | null): number {
  if (a === null && b === null) {
    return 0;
  }

  if (a === null) {
    return 1;
  }

  if (b === null) {
    return -1;
  }

  return a - b;
}

function compareHomePriority(a: HomeSourceHotel, b: HomeSourceHotel): number {
  const imageDelta = Number(b.hasImage) - Number(a.hasImage);
  if (imageDelta !== 0) {
    return imageDelta;
  }

  if (b.rating !== a.rating) {
    return b.rating - a.rating;
  }

  const priceDelta = compareNullableNumberAsc(a.priceFrom, b.priceFrom);
  if (priceDelta !== 0) {
    return priceDelta;
  }

  return a.hotelName.localeCompare(b.hotelName);
}

function takeUniqueByKey<T>(
  items: T[],
  limit: number,
  getKey: (item: T) => string,
): T[] {
  const results: T[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(item);

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

function fillMissingHotels<T extends { hotelId: number }>(
  preferredItems: T[],
  fallbackItems: T[],
  limit: number,
): T[] {
  const mergedItems = [...preferredItems];
  const seenHotelIds = new Set(mergedItems.map((item) => item.hotelId));

  for (const item of fallbackItems) {
    if (seenHotelIds.has(item.hotelId)) {
      continue;
    }

    seenHotelIds.add(item.hotelId);
    mergedItems.push(item);

    if (mergedItems.length >= limit) {
      break;
    }
  }

  return mergedItems.slice(0, limit);
}

export async function getHomeData(): Promise<HomeResponse> {
  const hotels = (await Hotel.find({ deleted_at: null })
    .select({
      _id: 1,
      location_id: 1,
      name: 1,
      address: 1,
      star_rating: 1,
      image: 1,
      images: 1,
    })
    .sort({ star_rating: -1, _id: 1 })
    .limit(HOME_SOURCE_LIMIT)
    .lean()) as LeanHotel[];

  if (hotels.length === 0) {
    return {
      featuredOffers: [],
      recommendedDestinations: [],
      trendingHotels: [],
    };
  }

  const hotelIds = hotels.map((hotel) => hotel._id);
  const [cheapestPrices, locationMap] = await Promise.all([
    getCheapestRoomPrices(hotelIds),
    loadLocationMap(hotels.map((hotel) => hotel.location_id)),
  ]);

  const sourceHotels: HomeSourceHotel[] = hotels.map((hotel) => {
    const locationTrail = buildLocationTrail(hotel.location_id, locationMap);
    const locationLabel = buildLocationLabel(locationTrail) || hotel.address;
    const priceFrom = cheapestPrices.get(hotel._id) ?? null;
    const imageUrl = pickPrimaryImage(hotel.images, hotel.image);

    return {
      hotelId: hotel._id,
      hotelName: hotel.name,
      imageUrl,
      destinationName: getDestinationName(locationTrail, hotel.name),
      locationLabel,
      priceFrom,
      priceLabel: getPriceLabel(priceFrom),
      currency: 'VND',
      rating: hotel.star_rating,
      ratingLabel: hotel.star_rating.toFixed(1),
      hasImage: imageUrl !== null,
    };
  });

  const prioritizedHotels = sourceHotels.slice().sort(compareHomePriority);
  const featuredSource = prioritizedHotels.slice(0, FEATURED_LIMIT);
  const featuredIds = new Set(featuredSource.map((hotel) => hotel.hotelId));
  const remainingHotels = prioritizedHotels.filter(
    (hotel) => !featuredIds.has(hotel.hotelId),
  );

  const featuredOffers = featuredSource.map<HomeOfferItem>((hotel, index) => {
    const { hasImage: _hasImage, ...hotelPayload } = hotel;

    return {
      ...hotelPayload,
      title: hotel.destinationName,
      subtitle: hotel.priceLabel
        ? `${hotel.locationLabel} from ${hotel.priceLabel}`
        : `Discover ${hotel.hotelName} in ${hotel.locationLabel}`,
      ctaLabel: index === 0 ? 'BOOK NOW' : 'VIEW STAY',
    };
  });

  const preferredRecommended = takeUniqueByKey(
    remainingHotels,
    RECOMMENDED_LIMIT,
    (hotel) => hotel.destinationName.toLowerCase(),
  );
  const fallbackRecommended = takeUniqueByKey(
    prioritizedHotels,
    RECOMMENDED_LIMIT,
    (hotel) => hotel.destinationName.toLowerCase(),
  );
  const recommendedSource = fillMissingHotels(
    preferredRecommended,
    fallbackRecommended,
    RECOMMENDED_LIMIT,
  );

  const recommendedDestinations = recommendedSource.map<HomeRecommendedItem>((hotel) => {
    const { hasImage: _hasImage, ...hotelPayload } = hotel;

    return {
      ...hotelPayload,
      title: hotel.destinationName,
      caption: hotel.hotelName,
    };
  });

  const trendingSource = fillMissingHotels(
    remainingHotels.slice(0, TRENDING_LIMIT),
    prioritizedHotels,
    TRENDING_LIMIT,
  );

  const trendingHotels = trendingSource.map<HomeTrendingHotelItem>((hotel) => {
    const { hasImage: _hasImage, ...hotelPayload } = hotel;

    return {
      ...hotelPayload,
      name: hotel.hotelName,
      location: hotel.locationLabel,
    };
  });

  return {
    featuredOffers,
    recommendedDestinations,
    trendingHotels,
  };
}
