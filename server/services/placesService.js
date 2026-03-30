const { summarizePlaceExperience } = require('./geminiService');
const {
  buildPlacePhotoUrl,
  extractTextValue,
  toDisplayText,
  formatPriceLevel,
  buildPlaceHighlights
} = require('../utils/placeFormatting');
const { estimateVisitWindow } = require('../utils/planning');

// Looks up the geographic center of a city. Called at the start of every
// planning request — all place searches radiate outward from this point.
async function findCityCenter(city, mapsApiKey) {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsApiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location'
    },
    body: JSON.stringify({
      textQuery: `${city} city center`,
      maxResultCount: 1
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Places city search failed: ${err}`);
  }

  const data = await response.json();
  const place = data?.places?.[0];
  const location = place?.location;

  if (!location?.latitude || !location?.longitude) {
    throw new Error('Could not resolve city center coordinates.');
  }

  return {
    lat: Number(location.latitude),
    lng: Number(location.longitude)
  };
}

// City autocomplete — backs GET /api/planning/cities. Tries a strict
// "locality" search first, falls back to an unfiltered search if empty.
// Returns up to 6 city objects with coordinates and a photo.
async function searchCities(query, mapsApiKey) {
  const runSearch = async (payload) => {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': mapsApiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.types,places.location,places.photos'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Places city suggestions failed: ${err}`);
    }

    return response.json();
  };

  const toCities = (places) => {
    const unique = new Map();

    places.forEach((place) => {
      const id = String(place?.id || '').trim();
      const name = String(place?.displayName?.text || '').trim();
      if (!id || !name) {
        return;
      }

      const types = Array.isArray(place?.types) ? place.types : [];
      const isCityLike =
        types.includes('locality') ||
        types.includes('administrative_area_level_3') ||
        types.includes('postal_town') ||
        types.includes('sublocality');

      if (!isCityLike) {
        return;
      }

      if (!unique.has(id)) {
        const latitude = Number(place?.location?.latitude);
        const longitude = Number(place?.location?.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return;
        }

        unique.set(id, {
          id,
          name,
          formattedAddress: String(place?.formattedAddress || '').trim(),
          location: { lat: latitude, lng: longitude },
          photoUrl: buildPlacePhotoUrl(place?.photos?.[0]?.name, mapsApiKey)
        });
      }
    });

    return Array.from(unique.values());
  };

  const strictData = await runSearch({
    textQuery: `${query} city`,
    maxResultCount: 8,
    includedType: 'locality'
  });

  let cities = toCities(Array.isArray(strictData?.places) ? strictData.places : []);
  if (cities.length) {
    return cities.slice(0, 6);
  }

  const fallbackData = await runSearch({ textQuery: query, maxResultCount: 10 });
  cities = toCities(Array.isArray(fallbackData?.places) ? fallbackData.places : []);
  return cities.slice(0, 6);
}

// Searches the Places API for places matching a category's query near the
// provided search center. Planning can call this multiple times with different
// search centers so the candidate pool covers more of the city.
async function searchCategoryPlaces(city, categoryId, center, mapsApiKey, categoryConfig, options = {}) {
  const config = categoryConfig[categoryId] || { query: 'top places to visit', visitMinutes: 75 };
  const maxResultCount = Math.max(1, Math.min(10, Number(options?.maxResultCount) || 6));
  const radiusMeters = Math.max(3000, Math.min(30000, Number(options?.radiusMeters) || 12000));

  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsApiKey,
      'X-Goog-FieldMask':
        'places.id,places.name,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.location,places.photos,places.primaryType,places.primaryTypeDisplayName'
    },
    body: JSON.stringify({
      textQuery: `${config.query} in ${city}`,
      maxResultCount,
      locationBias: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: radiusMeters
        }
      }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Places category search failed: ${err}`);
  }

  const data = await response.json();
  const places = data?.places || [];

  return places
    .filter((place) => place?.id && place?.location?.latitude && place?.location?.longitude)
    .map((place) => {
      const candidate = {
        id: place.id,
        resourceName: place.name,
        name: place.displayName?.text || 'Unknown place',
        address: place.formattedAddress || '',
        rating: Number(place.rating || 0),
        userRatingCount: Number(place.userRatingCount || 0),
        location: {
          lat: Number(place.location.latitude),
          lng: Number(place.location.longitude)
        },
        photoName: place?.photos?.[0]?.name || '',
        categoryId,
        primaryType: String(place?.primaryType || '').trim(),
        primaryTypeDisplayName: toDisplayText(place?.primaryTypeDisplayName?.text || place?.primaryType || ''),
        suggestedVisitMinutes: config.visitMinutes
      };

      return {
        ...candidate,
        ...estimateVisitWindow(candidate),
      };
    });
}

async function getPlanningPlaceSnapshot(placeId, mapsApiKey) {
  const normalizedPlaceId = String(placeId || '').trim();
  if (!normalizedPlaceId) {
    throw new Error('Place id is required.');
  }

  const response = await fetch(`https://places.googleapis.com/v1/places/${normalizedPlaceId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsApiKey,
      'X-Goog-FieldMask': [
        'id',
        'displayName',
        'primaryType',
        'primaryTypeDisplayName',
        'editorialSummary',
        'currentOpeningHours',
        'regularOpeningHours',
        'reviews'
      ].join(',')
    }
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Planning place snapshot failed: ${err}`);
  }

  const place = await response.json();

  return {
    placeId: String(place?.id || normalizedPlaceId),
    name: extractTextValue(place?.displayName),
    primaryType: String(place?.primaryType || '').trim(),
    primaryTypeDisplayName: toDisplayText(place?.primaryTypeDisplayName?.text || place?.primaryType || ''),
    editorialSummary: extractTextValue(place?.editorialSummary),
    openNow:
      typeof place?.currentOpeningHours?.openNow === 'boolean'
        ? place.currentOpeningHours.openNow
        : undefined,
    weekdayDescriptions: Array.isArray(place?.regularOpeningHours?.weekdayDescriptions)
      ? place.regularOpeningHours.weekdayDescriptions.slice(0, 7)
      : [],
    reviews: Array.isArray(place?.reviews)
      ? place.reviews.slice(0, 3).map((review) => ({
          rating: Number(review?.rating || 0),
          text: extractTextValue(review?.originalText || review?.text)
        }))
      : []
  };
}

// Fetches 30+ fields from the Places API (New) for a single place, then calls
// summarizePlaceExperience to generate the AI Overview via Gemini.
// Called by GET /api/planning/place-details when a user clicks a stop card.
async function getPlaceDetails(placeId, mapsApiKey, aiApiKey) {
  const normalizedPlaceId = String(placeId || '').trim();
  if (!normalizedPlaceId) {
    throw new Error('Place id is required.');
  }

  const response = await fetch(`https://places.googleapis.com/v1/places/${normalizedPlaceId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsApiKey,
      'X-Goog-FieldMask': [
        'id',
        'displayName',
        'formattedAddress',
        'rating',
        'userRatingCount',
        'priceLevel',
        'primaryType',
        'primaryTypeDisplayName',
        'editorialSummary',
        'websiteUri',
        'googleMapsUri',
        'nationalPhoneNumber',
        'regularOpeningHours',
        'currentOpeningHours',
        'photos',
        'reviews',
        'paymentOptions',
        'parkingOptions',
        'goodForChildren',
        'outdoorSeating',
        'liveMusic',
        'menuForChildren',
        'reservable',
        'delivery',
        'takeout',
        'dineIn',
        'servesCoffee',
        'servesDessert',
        'servesBeer',
        'servesWine',
        'servesBreakfast',
        'servesLunch',
        'servesDinner'
      ].join(',')
    }
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Places details failed: ${err}`);
  }

  const place = await response.json();
  const aiSummary = await summarizePlaceExperience(place, aiApiKey);
  const editorialSummary = extractTextValue(place?.editorialSummary);

  return {
    placeId: String(place?.id || normalizedPlaceId),
    name: extractTextValue(place?.displayName),
    address: String(place?.formattedAddress || '').trim(),
    rating: Number(place?.rating || 0),
    userRatingCount: Number(place?.userRatingCount || 0),
    priceLevel: formatPriceLevel(place?.priceLevel),
    primaryType: toDisplayText(place?.primaryTypeDisplayName?.text || place?.primaryType || ''),
    aiOverview: aiSummary.aiOverview || editorialSummary,
    summary: aiSummary.aiOverview || editorialSummary,
    whatToDo: aiSummary.whatToDo,
    highlights: buildPlaceHighlights(place),
    websiteUri: String(place?.websiteUri || '').trim(),
    googleMapsUri: String(place?.googleMapsUri || '').trim(),
    phoneNumber: String(place?.nationalPhoneNumber || '').trim(),
    openNow:
      typeof place?.currentOpeningHours?.openNow === 'boolean'
        ? place.currentOpeningHours.openNow
        : undefined,
    weekdayDescriptions: Array.isArray(place?.regularOpeningHours?.weekdayDescriptions)
      ? place.regularOpeningHours.weekdayDescriptions.slice(0, 7)
      : [],
    photos: Array.isArray(place?.photos)
      ? place.photos
          .map((photo) => buildPlacePhotoUrl(photo?.name, mapsApiKey, 420, 640))
          .filter(Boolean)
          .slice(0, 6)
      : [],
    reviews: Array.isArray(place?.reviews)
      ? place.reviews.slice(0, 5).map((review) => ({
          authorName: String(review?.authorAttribution?.displayName || 'Visitor').trim(),
          rating: Number(review?.rating || 0),
          relativePublishTimeDescription: String(review?.relativePublishTimeDescription || '').trim(),
          text: extractTextValue(review?.originalText || review?.text)
        }))
      : []
  };
}

module.exports = {
  findCityCenter,
  searchCities,
  searchCategoryPlaces,
  getPlanningPlaceSnapshot,
  getPlaceDetails,
};
