import { Activity, type ActivityDoc } from '@/models/Activity.model';
import { Airport, type AirportDoc } from '@/models/Airport.model';
import { Flight, type FlightDoc } from '@/models/Flight.model';
import { Hotel, type HotelDoc } from '@/models/Hotel.model';
import { Location, type LocationDoc } from '@/models/Location.model';
import { Room } from '@/models/Room.model';

const MAX_LOCATION_DEPTH = 6;
const SEARCH_SOURCE_LIMIT = 24;
const DESTINATION_LIMIT = 30;
const HOTEL_LIMIT = 8;
const FLIGHT_LIMIT = 8;
const TOUR_LIMIT = 8;
const LOCATION_SEARCH_CACHE_TTL_MS = 30_000;
const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80';
const priceFormatter = new Intl.NumberFormat('en-US');

type SearchCategory = 'all' | 'hotels' | 'flights' | 'tours' | 'train';

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
>;

type LeanLocation = Pick<LocationDoc, '_id' | 'name' | 'parent_id' | 'type'>;

type LocationSearchEntry = {
  location: LeanLocation;
  label: string;
  foldedName: string;
  foldedLabel: string;
};

type LeanAirport = Pick<AirportDoc, '_id' | 'name' | 'location_id'>;

type LeanFlight = Pick<
  FlightDoc,
  | '_id'
  | 'flight_number'
  | 'departure_airport'
  | 'arrival_airport'
  | 'departure_time'
  | 'arrival_time'
  | 'base_price'
  | 'available_seats'
  | 'image'
>;

type LeanActivity = Pick<
  ActivityDoc,
  '_id' | 'location_id' | 'title' | 'type' | 'base_price' | 'status' | 'image'
>;

export interface SearchDestinationItem {
  id: number;
  name: string;
  subtitle: string;
  queryValue: string;
}

export interface SearchHotelItem {
  id: number;
  name: string;
  locationLabel: string;
  imageUrl: string | null;
  ratingLabel: string;
  priceLabel: string | null;
  route: string;
}

export interface SearchFlightItem {
  id: number;
  title: string;
  subtitle: string;
  valueLabel: string;
  metaLabel: string;
  imageUrl: string | null;
}

export interface SearchTourItem {
  id: number;
  title: string;
  subtitle: string;
  valueLabel: string;
  metaLabel: string;
  imageUrl: string | null;
}

export interface SearchResponse {
  query: string;
  category: SearchCategory;
  categories: Array<{
    key: SearchCategory;
    label: string;
    enabled: boolean;
  }>;
  destinations: SearchDestinationItem[];
  hotels: SearchHotelItem[];
  flights: SearchFlightItem[];
  tours: SearchTourItem[];
  trains: never[];
}

function normalizeCategory(value: string): SearchCategory {
  switch (value.trim().toLowerCase()) {
    case 'hotels':
      return 'hotels';
    case 'flights':
      return 'flights';
    case 'tours':
      return 'tours';
    case 'train':
      return 'train';
    default:
      return 'all';
  }
}

function normalizeQuery(value: string): string {
  return foldSearchText(value);
}

let locationSearchCache:
  | {
      expiresAt: number;
      entries: LocationSearchEntry[];
    }
  | null = null;

function foldSearchText(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ');
}

function formatVnd(value: number | null): string | null {
  if (value === null) {
    return null;
  }

  return `$${priceFormatter.format(Math.round(value))}`;
}

function pickPrimaryImage(
  images?: string[] | null,
  fallbackImage?: string | null,
): string | null {
  for (const candidate of [...(images ?? []), fallbackImage]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
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

function buildLocationLabel(locationTrail: LeanLocation[]): string {
  return locationTrail
    .map((location) => location.name.trim())
    .filter(Boolean)
    .join(', ');
}

function matchesQuery(values: Array<string | null | undefined>, query: string): boolean {
  if (!query) {
    return true;
  }

  return values.some((value) => foldSearchText(value).includes(query));
}

function buildLocationTrailFromMap(
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

async function loadLocationSearchEntries(): Promise<LocationSearchEntry[]> {
  if (locationSearchCache && locationSearchCache.expiresAt > Date.now()) {
    return locationSearchCache.entries;
  }

  const locations = (await Location.find({})
    .select({ _id: 1, name: 1, parent_id: 1, type: 1 })
    .sort({ _id: -1 })
    .lean()) as LeanLocation[];

  const locationMap = new Map(locations.map((location) => [location._id, location]));
  const entries = locations.map<LocationSearchEntry>((location) => {
    const label = buildLocationLabel(buildLocationTrailFromMap(location._id, locationMap));

    return {
      location,
      label: label || location.name,
      foldedName: foldSearchText(location.name),
      foldedLabel: foldSearchText(label || location.name),
    };
  });

  locationSearchCache = {
    expiresAt: Date.now() + LOCATION_SEARCH_CACHE_TTL_MS,
    entries,
  };

  return entries;
}

function scoreLocationEntry(entry: LocationSearchEntry, query: string): number {
  if (!query) {
    return 0;
  }

  if (entry.foldedName === query) return 100;
  if (entry.foldedName.startsWith(query)) return 90;
  if (entry.foldedName.includes(query)) return 80;
  if (entry.foldedLabel.startsWith(query)) return 70;
  if (entry.foldedLabel.includes(query)) return 60;

  const tokens = query.split(' ').filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => entry.foldedLabel.includes(token))) {
    return 50;
  }

  return 0;
}

async function searchLocations(query: string): Promise<LeanLocation[]> {
  const entries = await loadLocationSearchEntries();

  if (!query) {
    return entries.slice(0, DESTINATION_LIMIT).map((entry) => entry.location);
  }

  return entries
    .map((entry) => ({ entry, score: scoreLocationEntry(entry, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.entry.foldedLabel.length - b.entry.foldedLabel.length;
    })
    .slice(0, DESTINATION_LIMIT)
    .map((item) => item.entry.location);
}

async function getCheapestRoomPrices(hotelIds: number[]): Promise<Map<number, number>> {
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

  return new Map(cheapestRooms.map((room) => [room._id, room.priceFrom] as const));
}

async function buildAirportMap(): Promise<Map<string, LeanAirport>> {
  const airports = (await Airport.find({})
    .select({ _id: 1, name: 1, location_id: 1 })
    .lean()) as LeanAirport[];

  return new Map(airports.map((airport) => [airport._id, airport] as const));
}

function buildFlightTitle(
  flight: LeanFlight,
  airportMap: Map<string, LeanAirport>,
): string {
  const departure = airportMap.get(flight.departure_airport);
  const arrival = airportMap.get(flight.arrival_airport);
  const departureCode = departure?._id ?? flight.departure_airport;
  const arrivalCode = arrival?._id ?? flight.arrival_airport;

  return `${departureCode} -> ${arrivalCode}`;
}

function buildFlightSubtitle(
  flight: LeanFlight,
  airportMap: Map<string, LeanAirport>,
  locationMap: Map<number, LeanLocation>,
): string {
  const departureAirport = airportMap.get(flight.departure_airport);
  const arrivalAirport = airportMap.get(flight.arrival_airport);
  const departureLocation = departureAirport
    ? buildLocationLabel(buildLocationTrail(departureAirport.location_id, locationMap))
    : null;
  const arrivalLocation = arrivalAirport
    ? buildLocationLabel(buildLocationTrail(arrivalAirport.location_id, locationMap))
    : null;

  if (departureLocation && arrivalLocation) {
    return `${departureLocation} -> ${arrivalLocation}`;
  }

  return flight.flight_number;
}

function buildFlightMetaLabel(flight: LeanFlight): string {
  const departure = new Date(flight.departure_time);
  const arrival = new Date(flight.arrival_time);
  const seats = flight.available_seats ?? 0;

  return `${departure.toLocaleDateString('en-US')} • ${departure.toLocaleTimeString(
    'en-US',
    { hour: '2-digit', minute: '2-digit' },
  )} - ${arrival.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })} • ${seats} seats`;
}

function uniqueByKey<T>(items: T[], keyOf: (item: T) => string, limit: number): T[] {
  const results: T[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const key = keyOf(item);
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

export async function getSearchData(input: {
  query: string;
  category: string;
}): Promise<SearchResponse> {
  const query = normalizeQuery(input.query);
  const category = normalizeCategory(input.category);

  const shouldLoadHotels = category === 'all' || category === 'hotels';
  const shouldLoadFlights = category === 'all' || category === 'flights';
  const shouldLoadTours = category === 'all' || category === 'tours';
  const shouldLoadDestinations = category !== 'flights';

  const [hotels, flights, tours, directLocations, airportMap] = await Promise.all([
    shouldLoadHotels
      ? Hotel.find({
          deleted_at: null,
          status: 'LIVE',
          listing_status: { $in: ['active', 'ACTIVE', 'live', 'LIVE', null] },
        })
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
          })
          .sort({ star_rating: -1, _id: 1 })
          .limit(query ? SEARCH_SOURCE_LIMIT * 10 : SEARCH_SOURCE_LIMIT)
          .lean()
      : Promise.resolve([]),
    shouldLoadFlights
      ? Flight.find({ deleted_at: null })
          .select({
            _id: 1,
            flight_number: 1,
            departure_airport: 1,
            arrival_airport: 1,
            departure_time: 1,
            arrival_time: 1,
            base_price: 1,
            available_seats: 1,
            image: 1,
          })
          .sort({ departure_time: 1, _id: 1 })
          .limit(SEARCH_SOURCE_LIMIT)
          .lean()
      : Promise.resolve([]),
    shouldLoadTours
      ? Activity.find({
          deleted_at: null,
          status: 'LIVE',
          type: 'TOUR',
        })
          .select({
            _id: 1,
            location_id: 1,
            title: 1,
            type: 1,
            base_price: 1,
            status: 1,
            image: 1,
          })
          .sort({ _id: 1 })
          .limit(SEARCH_SOURCE_LIMIT)
          .lean()
      : Promise.resolve([]),
    shouldLoadDestinations ? searchLocations(query) : Promise.resolve([]),
    shouldLoadFlights ? buildAirportMap() : Promise.resolve(new Map<string, LeanAirport>()),
  ]);

  const leanHotels = hotels as LeanHotel[];
  const leanFlights = flights as LeanFlight[];
  const leanTours = tours as LeanActivity[];
  const leanDirectLocations = directLocations as LeanLocation[];

  const locationIds = [
    ...leanHotels.map((hotel) => hotel.location_id),
    ...leanTours.map((tour) => tour.location_id),
    ...leanDirectLocations.map((location) => location._id),
    ...Array.from(airportMap.values()).map((airport) => airport.location_id),
  ];

  const locationMap = await loadLocationMap(locationIds);
  const cheapestRoomPrices = shouldLoadHotels
    ? await getCheapestRoomPrices(leanHotels.map((hotel) => hotel._id))
    : new Map<number, number>();

  const hotelItems = leanHotels
    .map<SearchHotelItem | null>((hotel) => {
      const locationLabel =
        buildLocationLabel(buildLocationTrail(hotel.location_id, locationMap)) ||
        hotel.address;

      if (!matchesQuery([hotel.name, locationLabel, hotel.address], query)) {
        return null;
      }

      return {
        id: hotel._id,
        name: hotel.name,
        locationLabel,
        imageUrl: pickPrimaryImage(hotel.images, hotel.image),
        ratingLabel: hotel.star_rating.toFixed(1),
        priceLabel: formatVnd(cheapestRoomPrices.get(hotel._id) ?? null),
        route: `/service_details/${hotel._id}`,
      };
    })
    .filter((hotel): hotel is SearchHotelItem => hotel !== null)
    .slice(0, HOTEL_LIMIT);

  const directDestinationItems = leanDirectLocations
    .map<SearchDestinationItem>((location) => {
      const trail = buildLocationTrail(location._id, locationMap);
      const locationLabel = buildLocationLabel(trail) || location.name;

      return {
        id: location._id,
        name: location.name,
        subtitle: locationLabel,
        queryValue: location.name,
      };
    })
    .filter((item) => matchesQuery([item.name, item.subtitle], query));

  const hotelDestinationItems = leanHotels
      .map<SearchDestinationItem | null>((hotel) => {
        const trail = buildLocationTrail(hotel.location_id, locationMap);
        const locationLabel = buildLocationLabel(trail);
        const destinationName = trail[0]?.name ?? hotel.address;

        if (!matchesQuery([destinationName, locationLabel], query)) {
          return null;
        }

        return {
          id: hotel.location_id,
          name: destinationName,
          subtitle: locationLabel,
          queryValue: destinationName,
        };
      })
      .filter((item): item is SearchDestinationItem => item !== null);

  const destinationItems = uniqueByKey(
    [...directDestinationItems, ...hotelDestinationItems],
    (item) => item.name.toLowerCase(),
    DESTINATION_LIMIT,
  );

  const flightItems = leanFlights
    .map<SearchFlightItem | null>((flight) => {
      const title = buildFlightTitle(flight, airportMap);
      const subtitle = buildFlightSubtitle(flight, airportMap, locationMap);

      if (!matchesQuery([title, subtitle, flight.flight_number], query)) {
        return null;
      }

      return {
        id: flight._id,
        title,
        subtitle,
        valueLabel: formatVnd(flight.base_price) ?? 'N/A',
        metaLabel: buildFlightMetaLabel(flight),
        imageUrl: flight.image ?? DEFAULT_IMAGE,
      };
    })
    .filter((flight): flight is SearchFlightItem => flight !== null)
    .slice(0, FLIGHT_LIMIT);

  const tourItems = leanTours
    .map<SearchTourItem | null>((tour) => {
      const locationLabel = buildLocationLabel(
        buildLocationTrail(tour.location_id, locationMap),
      );

      if (!matchesQuery([tour.title, locationLabel, tour.type], query)) {
        return null;
      }

      return {
        id: tour._id,
        title: tour.title,
        subtitle: locationLabel,
        valueLabel: formatVnd(tour.base_price) ?? 'N/A',
        metaLabel: tour.status ?? tour.type,
        imageUrl: tour.image ?? DEFAULT_IMAGE,
      };
    })
    .filter((tour): tour is SearchTourItem => tour !== null)
    .slice(0, TOUR_LIMIT);

  return {
    query: input.query.trim(),
    category,
    categories: [
      { key: 'all', label: 'All', enabled: true },
      { key: 'hotels', label: 'Hotels', enabled: true },
      { key: 'flights', label: 'Flights', enabled: true },
      { key: 'tours', label: 'Tours', enabled: true },
      { key: 'train', label: 'Train', enabled: false },
    ],
    destinations: category === 'flights' ? [] : destinationItems,
    hotels: category === 'all' || category === 'hotels' ? hotelItems : [],
    flights: category === 'all' || category === 'flights' ? flightItems : [],
    tours: category === 'all' || category === 'tours' ? tourItems : [],
    trains: [],
  };
}
