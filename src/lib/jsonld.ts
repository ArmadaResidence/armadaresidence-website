/**
 * JSON-LD builders (schema.org). Organization on home, Hotel / LodgingBusiness per branch,
 * HotelRoom + Offer per room page. All values come from content/ via content.ts.
 */
import {
  absoluteUrl,
  branchContact,
  branchPath,
  branches,
  contact,
  legal,
  L,
  localePath,
  minPriceFor,
  pricing,
  roomPath,
  seo,
  siteName,
  visibleRatePlans,
  type Branch,
  type Locale,
  type Room,
} from './content';

const AMENITY_SCHEMA: Record<string, string> = {
  breakfast_buffet_daily: 'Breakfast buffet',
  coffee_shop: 'Café',
  events_hall: 'Meeting hall',
  free_parking: 'Free parking',
  restaurant: 'Restaurant',
  room_service_24h: '24-hour room service',
  wifi: 'Wi-Fi',
};

function logoUrl(): string {
  return absoluteUrl('/brand/logo-horizontal.svg');
}

function ogImage(): string {
  return absoluteUrl(seo.default_og_image);
}

export function organization(locale: Locale) {
  const sameAs = Object.values(contact.social).filter((v): v is string => typeof v === 'string');
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: siteName(locale),
    legalName: locale === 'ar' ? legal.entity_ar : legal.entity_en,
    url: absoluteUrl(localePath(locale, '/')),
    logo: logoUrl(),
    image: ogImage(),
    sameAs,
    contactPoint: branches.map((b) => ({
      '@type': 'ContactPoint',
      contactType: 'reservations',
      telephone: branchContact(b.slug).phone,
      email: b.email,
      areaServed: 'SA',
      availableLanguage: ['ar', 'en'],
    })),
  };
}

function postalAddress(locale: Locale, b: Branch) {
  const na = b.national_address;
  return {
    '@type': 'PostalAddress',
    streetAddress: `${na.building} ${locale === 'ar' ? na.street_ar : na.street_en}, ${locale === 'ar' ? na.district_ar : na.district_en}`,
    addressLocality: locale === 'ar' ? b.city_ar : b.city_en,
    postalCode: b.postal_code,
    addressCountry: 'SA',
  };
}

export function lodging(locale: Locale, b: Branch) {
  const c = branchContact(b.slug);
  const min = minPriceFor(b.slug);
  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': b.slug === 'shafa-road' ? 'Hotel' : 'LodgingBusiness',
    '@id': absoluteUrl(branchPath(locale, b.slug)) + '#lodging',
    name: L(locale, b, 'name'),
    description: L(locale, b, 'tagline'),
    url: absoluteUrl(branchPath(locale, b.slug)),
    image: ogImage(),
    telephone: c.phone,
    email: b.email,
    address: postalAddress(locale, b),
    geo: { '@type': 'GeoCoordinates', latitude: b.lat, longitude: b.lng },
    hasMap: b.maps_url,
    checkinTime: b.check_in,
    checkoutTime: b.check_out,
    currenciesAccepted: pricing.currency,
    parentOrganization: { '@type': 'Organization', name: siteName(locale), url: absoluteUrl(localePath(locale, '/')) },
    amenityFeature: b.amenities.map((a) => ({
      '@type': 'LocationFeatureSpecification',
      name: AMENITY_SCHEMA[a] ?? a,
      value: true,
    })),
  };
  if (min !== null) node.priceRange = `${pricing.currency} ${min}+`;
  return node;
}

export function hotelRoom(locale: Locale, room: Room, b: Branch) {
  const url = absoluteUrl(roomPath(locale, room));
  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'HotelRoom',
    name: L(locale, room, 'name'),
    description: L(locale, room, 'description'),
    url,
    image: ogImage(),
    containedInPlace: {
      '@type': b.slug === 'shafa-road' ? 'Hotel' : 'LodgingBusiness',
      '@id': absoluteUrl(branchPath(locale, b.slug)) + '#lodging',
      name: L(locale, b, 'name'),
    },
  };
  node.floorSize = { '@type': 'QuantitativeValue', value: room.size_m2, unitCode: 'MTK' };
  node.bed = { '@type': 'BedDetails', typeOfBed: L(locale, room, 'bed') };
  node.occupancy = { '@type': 'QuantitativeValue', maxValue: room.capacity, unitCode: 'C62' };
  const FEATURE_NAMES: Record<string, string> = {
    kitchen: 'Kitchen',
    living_room: 'Separate living room',
    balcony: 'Private balcony',
    jacuzzi: 'Jacuzzi',
    fridge: 'Fridge',
    kettle: 'Kettle',
    washer: 'Washing machine',
    wifi: 'Wi-Fi',
    tv: 'TV',
    safe: 'Safe',
    air_conditioning: 'Air conditioning',
  };
  const names = new Set<string>();
  for (const [k, v] of Object.entries(room.features)) if (v === true) names.add(FEATURE_NAMES[k] ?? k);
  for (const k of room.in_room_amenities) names.add(FEATURE_NAMES[k] ?? k);
  node.amenityFeature = Array.from(names).map((name) => ({ '@type': 'LocationFeatureSpecification', name, value: true }));
  const plan = visibleRatePlans(room)[0];
  const price = plan?.base_price ?? room.base_price;
  node.offers = {
    '@type': 'Offer',
    url,
    price,
    priceCurrency: room.currency || pricing.currency,
    availability: room.availability === 'sold_out' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price,
      priceCurrency: room.currency || pricing.currency,
      valueAddedTaxIncluded: true,
      unitText: 'night',
    },
  };
  return node;
}
