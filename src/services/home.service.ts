import { Hotel, type HotelDoc } from '@/models/Hotel.model';
import {
  HomeContent,
  type HomeCategoryDoc,
  type HomeContentDoc,
  type HomeOfferOverrideDoc,
  type HomeRecommendedOverrideDoc,
  type HomeSearchCardDoc,
  type HomeSectionsDoc,
  type HomeTrendingOverrideDoc,
} from '@/models/HomeContent.model';
import { Location, type LocationDoc } from '@/models/Location.model';
import { Room } from '@/models/Room.model';
import { getHotelReviewStats } from '@/services/reviews.service';

const HOME_KEY = 'home';
const HOME_SOURCE_LIMIT = 36;
const FEATURED_LIMIT = 2;
const RECOMMENDED_LIMIT = 4;
const TRENDING_LIMIT = 6;
const MAX_LOCATION_DEPTH = 6;
const DEFAULT_RECOMMENDED_CARD_HEIGHTS = [240, 180, 180, 240];
const DEFAULT_OFFER_CTA_LABELS = ['BOOK NOW', 'VIEW STAY'];
const DEFAULT_OFFER_ACCENT_TONES = ['primary', 'primary'];
const DEFAULT_HOME_SEARCH_ROUTE = '/add_location_search?category=all';
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
  | '_id'
  | 'location_id'
  | 'name'
  | 'address'
  | 'star_rating'
  | 'image'
  | 'images'
  | 'status'
  | 'listing_status'
> & {
  reviewed_at?: string | null;
};

type LeanLocation = Pick<LocationDoc, '_id' | 'name' | 'parent_id' | 'type'>;

interface BaseHomeHotel {
  hotelId: number;
  hotelName: string;
  imageUrl: string | null;
  destinationName: string;
  locationLabel: string;
  priceFrom: number | null;
  priceLabel: string | null;
  currency: 'USD';
  rating: number;
  ratingLabel: string;
}

interface HomeSourceHotel extends BaseHomeHotel {
  hasImage: boolean;
  isApproved: boolean;
  reviewedAtTs: number;
}

function keepNewestApprovedFirst(items: HomeSourceHotel[]): HomeSourceHotel[] {
  if (items.length <= 1) return items;
  const newestApproved = items.find((item) => item.isApproved && item.reviewedAtTs > 0);
  if (!newestApproved) return items;
  return [
    newestApproved,
    ...items.filter((item) => item.hotelId !== newestApproved.hotelId),
  ];
}

export interface HomeSearchDetailItem {
  icon: string;
  label: string;
  value: string;
}

export interface HomeSearchCard {
  headline: string;
  destinationPlaceholder: string;
  destinationRoute: string;
  searchButtonLabel: string;
  searchButtonRoute: string;
  detailItems: HomeSearchDetailItem[];
}

export interface HomeCategoryItem {
  key: string;
  icon: string;
  label: string;
  route: string;
  backgroundTone: string;
  iconTone: string;
}

export interface HomeOffersSection {
  badgeLabel: string;
}

export interface HomeRecommendedSection {
  title: string;
  subtitle: string;
  actionLabel: string;
  actionRoute: string;
}

export interface HomeTrendingSection {
  title: string;
  detailsActionLabel: string;
  actionLabel: string | null;
  actionRoute: string | null;
}

export interface HomeSections {
  offers: HomeOffersSection;
  recommended: HomeRecommendedSection;
  trending: HomeTrendingSection;
}

export interface HomeOfferItem extends BaseHomeHotel {
  title: string;
  subtitle: string;
  badgeLabel: string;
  ctaLabel: string;
  accentTone: string;
  route: string;
}

export interface HomeRecommendedItem extends BaseHomeHotel {
  title: string;
  caption: string;
  cardHeight: number;
  route: string;
}

export interface HomeTrendingHotelItem extends BaseHomeHotel {
  name: string;
  location: string;
  detailsLabel: string;
  route: string;
}

export interface HomeResponse {
  searchCard: HomeSearchCard;
  categories: HomeCategoryItem[];
  sections: HomeSections;
  featuredOffers: HomeOfferItem[];
  recommendedDestinations: HomeRecommendedItem[];
  trendingHotels: HomeTrendingHotelItem[];
}

function buildDefaultHomeContent(): HomeContentDoc {
  return {
    key: HOME_KEY,
    searchCard: {
      headline: 'Where to next?',
      destinationPlaceholder: 'Destination',
      destinationRoute: '/add_location_search',
      searchButtonLabel: 'Search Destinations',
      searchButtonRoute: DEFAULT_HOME_SEARCH_ROUTE,
      detailItems: [
        {
          icon: 'calendar_today_rounded',
          label: 'DATES',
          value: 'Oct 12 - 18',
        },
        {
          icon: 'group_rounded',
          label: 'GUESTS',
          value: '2 Adults',
        },
      ],
    },
    categories: [
      {
        key: 'hotels',
        icon: 'bed_rounded',
        label: 'HOTELS',
        route: '/add_location_search?category=hotels',
        backgroundTone: 'primary_soft',
        iconTone: 'primary',
      },
      {
        key: 'flights',
        icon: 'flight_rounded',
        label: 'FLIGHTS',
        route: '/add_location_search?category=flights',
        backgroundTone: 'primary_soft',
        iconTone: 'primary',
      },
      {
        key: 'tours',
        icon: 'explore_rounded',
        label: 'TOURS',
        route: '/add_location_search?category=tours',
        backgroundTone: 'primary_soft',
        iconTone: 'primary',
      },
      {
        key: 'train',
        icon: 'train_rounded',
        label: 'TRAIN',
        route: '/add_location_search?category=train',
        backgroundTone: 'primary_soft',
        iconTone: 'primary',
      },
    ],
    sections: {
      offers: {
        badgeLabel: 'LIMITED OFFER',
        ctaLabels: DEFAULT_OFFER_CTA_LABELS,
        accentTones: DEFAULT_OFFER_ACCENT_TONES,
      },
      recommended: {
        title: 'Recommended',
        subtitle: 'Curated escapes for your style',
        actionLabel: 'See all',
        actionRoute: '/search_filter',
        cardHeights: DEFAULT_RECOMMENDED_CARD_HEIGHTS,
      },
      trending: {
        title: 'Trending Hotels',
        detailsActionLabel: 'DETAILS',
        actionLabel: null,
        actionRoute: null,
      },
    },
    curated: {
      featuredHotelIds: [],
      recommendedHotelIds: [],
      trendingHotelIds: [],
    },
    offerOverrides: [],
    recommendedOverrides: [],
    trendingOverrides: [],
  };
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

function buildHotelRoute(hotelId: number): string {
  return `/service_details/${hotelId}`;
}

function formatVndPrice(value: number): string {
  return `$${priceFormatter.format(value)}`;
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
  const approvedDelta = Number(b.isApproved) - Number(a.isApproved);
  if (approvedDelta !== 0) {
    return approvedDelta;
  }

  if (b.reviewedAtTs !== a.reviewedAtTs) {
    return b.reviewedAtTs - a.reviewedAtTs;
  }

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

function pickByIds<T extends { hotelId: number }>(
  ids: number[] | undefined,
  itemByHotelId: Map<number, T>,
): T[] {
  if (!ids || ids.length === 0) {
    return [];
  }

  const results: T[] = [];
  const seenHotelIds = new Set<number>();

  for (const hotelId of ids) {
    const item = itemByHotelId.get(hotelId);
    if (!item || seenHotelIds.has(hotelId)) {
      continue;
    }

    seenHotelIds.add(hotelId);
    results.push(item);
  }

  return results;
}

function mapOverrides<T extends { hotelId: number }>(
  overrides: T[] | undefined,
): Map<number, T> {
  return new Map((overrides ?? []).map((override) => [override.hotelId, override] as const));
}

function normalizeSearchCard(searchCard: HomeSearchCardDoc): HomeSearchCard {
  return {
    headline: searchCard.headline,
    destinationPlaceholder: searchCard.destinationPlaceholder,
    destinationRoute: searchCard.destinationRoute,
    searchButtonLabel: searchCard.searchButtonLabel,
    searchButtonRoute:
      searchCard.searchButtonRoute === '/search_filter'
        ? DEFAULT_HOME_SEARCH_ROUTE
        : searchCard.searchButtonRoute,
    detailItems: (searchCard.detailItems ?? []).map((item) => ({
      icon: item.icon,
      label: item.label,
      value: item.value,
    })),
  };
}

function normalizeCategories(categories: HomeCategoryDoc[]): HomeCategoryItem[] {
  return categories.map((category) => ({
    key: category.key,
    icon: category.icon,
    label: category.label,
    route: normalizeCategoryRoute(category.key, category.route),
    backgroundTone: category.backgroundTone,
    iconTone: category.iconTone,
  }));
}

function normalizeCategoryRoute(key: string, route: string): string {
  const normalizedKey = key.trim().toLowerCase();
  const normalizedRoute = route.trim();

  if (
    normalizedRoute.startsWith('/service_details/') ||
    normalizedRoute === '/search_filter'
  ) {
    switch (normalizedKey) {
      case 'hotels':
        return '/add_location_search?category=hotels';
      case 'flights':
        return '/add_location_search?category=flights';
      case 'tours':
        return '/add_location_search?category=tours';
      case 'train':
        return '/add_location_search?category=train';
    }
  }

  return normalizedRoute;
}

function normalizeSections(sections: HomeSectionsDoc): HomeSections {
  return {
    offers: {
      badgeLabel: sections.offers.badgeLabel,
    },
    recommended: {
      title: sections.recommended.title,
      subtitle: sections.recommended.subtitle,
      actionLabel: sections.recommended.actionLabel,
      actionRoute: sections.recommended.actionRoute,
    },
    trending: {
      title: sections.trending.title,
      detailsActionLabel: sections.trending.detailsActionLabel,
      actionLabel: sections.trending.actionLabel ?? null,
      actionRoute: sections.trending.actionRoute ?? null,
    },
  };
}

function mergeHomeConfig(config: HomeContentDoc | null): HomeContentDoc {
  const defaults = buildDefaultHomeContent();

  return {
    key: HOME_KEY,
    searchCard: {
      headline: config?.searchCard?.headline ?? defaults.searchCard.headline,
      destinationPlaceholder:
        config?.searchCard?.destinationPlaceholder ??
        defaults.searchCard.destinationPlaceholder,
      destinationRoute:
        config?.searchCard?.destinationRoute ?? defaults.searchCard.destinationRoute,
      searchButtonLabel:
        config?.searchCard?.searchButtonLabel ?? defaults.searchCard.searchButtonLabel,
      searchButtonRoute:
        config?.searchCard?.searchButtonRoute ?? defaults.searchCard.searchButtonRoute,
      detailItems:
        config?.searchCard?.detailItems && config.searchCard.detailItems.length > 0
          ? config.searchCard.detailItems
          : defaults.searchCard.detailItems,
    },
    categories:
      config?.categories && config.categories.length > 0
        ? config.categories
        : defaults.categories,
    sections: {
      offers: {
        badgeLabel:
          config?.sections?.offers?.badgeLabel ?? defaults.sections.offers.badgeLabel,
        ctaLabels:
          config?.sections?.offers?.ctaLabels &&
          config.sections.offers.ctaLabels.length > 0
            ? config.sections.offers.ctaLabels
            : defaults.sections.offers.ctaLabels,
        accentTones:
          config?.sections?.offers?.accentTones &&
          config.sections.offers.accentTones.length > 0
            ? config.sections.offers.accentTones
            : defaults.sections.offers.accentTones,
      },
      recommended: {
        title:
          config?.sections?.recommended?.title ?? defaults.sections.recommended.title,
        subtitle:
          config?.sections?.recommended?.subtitle ??
          defaults.sections.recommended.subtitle,
        actionLabel:
          config?.sections?.recommended?.actionLabel ??
          defaults.sections.recommended.actionLabel,
        actionRoute:
          config?.sections?.recommended?.actionRoute ??
          defaults.sections.recommended.actionRoute,
        cardHeights:
          config?.sections?.recommended?.cardHeights &&
          config.sections.recommended.cardHeights.length > 0
            ? config.sections.recommended.cardHeights
            : defaults.sections.recommended.cardHeights,
      },
      trending: {
        title: config?.sections?.trending?.title ?? defaults.sections.trending.title,
        detailsActionLabel:
          config?.sections?.trending?.detailsActionLabel ??
          defaults.sections.trending.detailsActionLabel,
        actionLabel:
          config?.sections?.trending?.actionLabel ??
          defaults.sections.trending.actionLabel,
        actionRoute:
          config?.sections?.trending?.actionRoute ??
          defaults.sections.trending.actionRoute,
      },
    },
    curated: {
      featuredHotelIds:
        config?.curated?.featuredHotelIds ?? defaults.curated.featuredHotelIds,
      recommendedHotelIds:
        config?.curated?.recommendedHotelIds ??
        defaults.curated.recommendedHotelIds,
      trendingHotelIds:
        config?.curated?.trendingHotelIds ?? defaults.curated.trendingHotelIds,
    },
    offerOverrides: config?.offerOverrides ?? defaults.offerOverrides,
    recommendedOverrides:
      config?.recommendedOverrides ?? defaults.recommendedOverrides,
    trendingOverrides: config?.trendingOverrides ?? defaults.trendingOverrides,
  };
}

async function getHomeConfig(): Promise<HomeContentDoc> {
  const defaultContent = buildDefaultHomeContent();
  const config = await HomeContent.findOneAndUpdate(
    { key: HOME_KEY },
    { $setOnInsert: defaultContent },
    {
      returnDocument: 'after',
      upsert: true,
      lean: true,
    },
  );

  const mergedConfig = mergeHomeConfig((config as HomeContentDoc | null) ?? null);

  const needsBackfill =
    !config?.searchCard ||
    !config.categories ||
    config.categories.length === 0 ||
    !config.sections?.offers ||
    !config.sections?.recommended ||
    !config.sections?.trending;

  if (needsBackfill) {
    await HomeContent.updateOne(
      { key: HOME_KEY },
      { $set: mergedConfig },
      { upsert: true },
    );
  }

  return mergedConfig;
}

export async function getHomeData(): Promise<HomeResponse> {
  const [config, hotels] = await Promise.all([
    getHomeConfig(),
    Hotel.find({ deleted_at: null })
      .select({
        _id: 1,
        location_id: 1,
        name: 1,
        address: 1,
        star_rating: 1,
        image: 1,
        images: 1,
        status: 1,
        listing_status: 1,
        reviewed_at: 1,
      })
      .sort({ reviewed_at: -1, updated_at: -1, _id: -1 })
      .limit(HOME_SOURCE_LIMIT)
      .lean(),
  ]);

  const leanHotels = hotels as LeanHotel[];
  const searchCard = normalizeSearchCard(config.searchCard);
  const categories = normalizeCategories(config.categories ?? []);
  const sections = normalizeSections(config.sections);

  if (leanHotels.length === 0) {
    return {
      searchCard,
      categories,
      sections,
      featuredOffers: [],
      recommendedDestinations: [],
      trendingHotels: [],
    };
  }

  const hotelIds = leanHotels.map((hotel) => hotel._id);
  const [cheapestPrices, locationMap, reviewStats] = await Promise.all([
    getCheapestRoomPrices(hotelIds),
    loadLocationMap(leanHotels.map((hotel) => hotel.location_id)),
    getHotelReviewStats(hotelIds),
  ]);

  const sourceHotels: HomeSourceHotel[] = leanHotels.map((hotel) => {
    const locationTrail = buildLocationTrail(hotel.location_id, locationMap);
    const locationLabel =
      (isFilledString(hotel.address) ? hotel.address.trim() : '') ||
      buildLocationLabel(locationTrail);
    const priceFrom = cheapestPrices.get(hotel._id) ?? null;
    const imageUrl = pickPrimaryImage(hotel.images, hotel.image);
    const rating = reviewStats.get(hotel._id)?.average ?? 0;

    const rawStatus = String(hotel.status ?? '').trim().toUpperCase();
    const rawListingStatus = String(hotel.listing_status ?? '').trim().toLowerCase();
    const isApproved =
      rawStatus === 'LIVE' || rawStatus === 'APPROVED' || rawListingStatus === 'active';
    const reviewedAtTs = Date.parse(String(hotel.reviewed_at ?? ''));

    return {
      hotelId: hotel._id,
      hotelName: hotel.name,
      imageUrl,
      destinationName: getDestinationName(locationTrail, hotel.name),
      locationLabel,
      priceFrom,
      priceLabel: getPriceLabel(priceFrom),
      currency: 'USD',
      rating,
      ratingLabel: rating.toFixed(1),
      hasImage: imageUrl !== null,
      isApproved,
      reviewedAtTs: Number.isFinite(reviewedAtTs) ? reviewedAtTs : 0,
    };
  });

  const hotelById = new Map(
    sourceHotels.map((hotel) => [hotel.hotelId, hotel] as const),
  );
  const prioritizedHotels = sourceHotels.slice().sort(compareHomePriority);
  const offerOverrideByHotelId = mapOverrides<HomeOfferOverrideDoc>(
    config.offerOverrides,
  );
  const recommendedOverrideByHotelId = mapOverrides<HomeRecommendedOverrideDoc>(
    config.recommendedOverrides,
  );
  const trendingOverrideByHotelId = mapOverrides<HomeTrendingOverrideDoc>(
    config.trendingOverrides,
  );

  const curated = config.curated ?? {
    featuredHotelIds: [],
    recommendedHotelIds: [],
    trendingHotelIds: [],
  };

  const featuredSource = fillMissingHotels(
    pickByIds(curated.featuredHotelIds, hotelById),
    prioritizedHotels,
    FEATURED_LIMIT,
  );
  const featuredSourceWithNewest = keepNewestApprovedFirst(featuredSource);
  const featuredIds = new Set(featuredSourceWithNewest.map((hotel) => hotel.hotelId));
  const remainingHotels = prioritizedHotels.filter(
    (hotel) => !featuredIds.has(hotel.hotelId),
  );

  const recommendedSeed = pickByIds(curated.recommendedHotelIds, hotelById);
  const recommendedSource = fillMissingHotels(
    recommendedSeed.length > 0
      ? recommendedSeed
      : takeUniqueByKey(
          remainingHotels,
          RECOMMENDED_LIMIT,
          (hotel) => hotel.destinationName.toLowerCase(),
        ),
    takeUniqueByKey(
      prioritizedHotels,
      RECOMMENDED_LIMIT,
      (hotel) => hotel.destinationName.toLowerCase(),
    ),
    RECOMMENDED_LIMIT,
  );
  const recommendedSourceWithNewest = keepNewestApprovedFirst(recommendedSource);

  const trendingSeed = pickByIds(curated.trendingHotelIds, hotelById);
  const trendingSource = fillMissingHotels(
    trendingSeed.length > 0 ? trendingSeed : remainingHotels.slice(0, TRENDING_LIMIT),
    prioritizedHotels,
    TRENDING_LIMIT,
  );
  const trendingSourceWithNewest = keepNewestApprovedFirst(trendingSource);

  const offerCtaLabels = config.sections.offers.ctaLabels?.length
    ? config.sections.offers.ctaLabels
    : DEFAULT_OFFER_CTA_LABELS;
  const offerAccentTones = config.sections.offers.accentTones?.length
    ? config.sections.offers.accentTones
    : DEFAULT_OFFER_ACCENT_TONES;
  const cardHeights = config.sections.recommended.cardHeights?.length
    ? config.sections.recommended.cardHeights
    : DEFAULT_RECOMMENDED_CARD_HEIGHTS;

  const featuredOffers = featuredSourceWithNewest.map<HomeOfferItem>((hotel, index) => {
    const override = offerOverrideByHotelId.get(hotel.hotelId);
    const {
      hasImage: _hasImage,
      isApproved: _isApproved,
      reviewedAtTs: _reviewedAtTs,
      ...hotelPayload
    } = hotel;

    return {
      ...hotelPayload,
      title:
        override && isFilledString(override.title)
          ? override.title.trim()
          : hotel.destinationName,
      subtitle:
        override && isFilledString(override.subtitle)
          ? override.subtitle.trim()
          : hotel.priceLabel
            ? `${hotel.locationLabel} from ${hotel.priceLabel}`
            : `Discover ${hotel.hotelName} in ${hotel.locationLabel}`,
      badgeLabel:
        override && isFilledString(override.badgeLabel)
          ? override.badgeLabel.trim()
          : sections.offers.badgeLabel,
      ctaLabel:
        override && isFilledString(override.ctaLabel)
          ? override.ctaLabel.trim()
          : offerCtaLabels[index % offerCtaLabels.length],
      accentTone:
        override && isFilledString(override.accentTone)
          ? override.accentTone.trim()
          : offerAccentTones[index % offerAccentTones.length],
      route:
        override && isFilledString(override.route)
          ? override.route.trim()
          : buildHotelRoute(hotel.hotelId),
    };
  });

  const recommendedDestinations = recommendedSourceWithNewest.map<HomeRecommendedItem>(
    (hotel, index) => {
      const override = recommendedOverrideByHotelId.get(hotel.hotelId);
      const {
        hasImage: _hasImage,
        isApproved: _isApproved,
        reviewedAtTs: _reviewedAtTs,
        ...hotelPayload
      } = hotel;

      return {
        ...hotelPayload,
        title:
          override && isFilledString(override.title)
            ? override.title.trim()
            : hotel.destinationName,
        caption:
          override && isFilledString(override.caption)
            ? override.caption.trim()
            : hotel.hotelName,
        priceLabel:
          override && isFilledString(override.priceLabel)
            ? override.priceLabel.trim()
            : hotel.priceLabel,
        cardHeight:
          override?.cardHeight && override.cardHeight > 0
            ? override.cardHeight
            : cardHeights[index % cardHeights.length],
        route:
          override && isFilledString(override.route)
            ? override.route.trim()
            : buildHotelRoute(hotel.hotelId),
      };
    },
  );

  const trendingHotels = trendingSourceWithNewest.map<HomeTrendingHotelItem>((hotel) => {
    const override = trendingOverrideByHotelId.get(hotel.hotelId);
    const {
      hasImage: _hasImage,
      isApproved: _isApproved,
      reviewedAtTs: _reviewedAtTs,
      ...hotelPayload
    } = hotel;

    return {
      ...hotelPayload,
      name: hotel.hotelName,
      location: hotel.locationLabel,
      detailsLabel:
        override && isFilledString(override.detailsLabel)
          ? override.detailsLabel.trim()
          : sections.trending.detailsActionLabel,
      route:
        override && isFilledString(override.route)
          ? override.route.trim()
          : buildHotelRoute(hotel.hotelId),
    };
  });

  return {
    searchCard,
    categories,
    sections,
    featuredOffers,
    recommendedDestinations,
    trendingHotels,
  };
}
