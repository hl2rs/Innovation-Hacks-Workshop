const { callGemini } = require('./geminiService');
const { parseJsonFromModelText, normalizeCityName, normalizeRank } = require('../utils/planning');
const { buildPlacePhotoUrl } = require('../utils/placeFormatting');

// Asks Gemini for 8 ranked popular cities in the given country.
// Step 1 of the city selection flow — called by the country-popular-cities route.
async function getPopularCitiesForCountry(country, aiApiKey) {
  const prompt = [
    'Return ONLY JSON in this shape: {"cities":[{"name":"City 1","rank":1}]}.',
    `Country: ${country}`,
    'Provide exactly 8 cities in this country ranked by real-world tourism popularity.',
    'Prefer the cities international and domestic travelers most commonly visit.',
    'Rules: rank is an integer from 1 to 8 where 1 is most popular.',
    'Use canonical short city names only.',
    'Do not return regions, districts, neighborhoods, provinces, or duplicate city names.',
    'Do not include explanations, markdown, or extra keys.'
  ].join('\n');

  const raw = await callGemini(aiApiKey, prompt);
  const parsed = parseJsonFromModelText(raw);
  const citiesRaw = Array.isArray(parsed?.cities) ? parsed.cities : [];

  const unique = new Map();
  const cities = [];

  citiesRaw.forEach((value, index) => {
    const isObject = value && typeof value === 'object';
    const name = normalizeCityName(isObject ? value.name : value);
    if (!name) {
      return;
    }

    const fallbackRank = index + 1;
    const rank = normalizeRank(isObject ? value.rank : null, fallbackRank);
    const key = name.toLowerCase();

    if (!unique.has(key)) {
      const entry = { name, popularityRank: rank };
      unique.set(key, entry);
      cities.push(entry);
      return;
    }

    const existing = unique.get(key);
    if (rank < existing.popularityRank) {
      existing.popularityRank = rank;
    }
  });

  return cities
    .sort((a, b) => a.popularityRank - b.popularityRank)
    .slice(0, 8)
    .map((city, index) => ({ ...city, popularityRank: index + 1 }));
}

// Looks up a single city in the Places API to get its id, coordinates,
// formatted address, and photo. Only keeps results with a locality-type.
// Called once per city returned by getPopularCitiesForCountry.
async function resolveCityInCountry(cityName, country, mapsApiKey, popularityRank) {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsApiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.types,places.location,places.photos'
    },
    body: JSON.stringify({
      textQuery: `${cityName}, ${country}`,
      maxResultCount: 5
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Places city resolve failed: ${err}`);
  }

  const data = await response.json();
  const places = Array.isArray(data?.places) ? data.places : [];

  const resolved = places.find((place) => {
    const types = Array.isArray(place?.types) ? place.types : [];
    return (
      types.includes('locality') ||
      types.includes('postal_town') ||
      types.includes('administrative_area_level_3') ||
      types.includes('sublocality')
    );
  });

  if (!resolved?.id || !resolved?.location) {
    return null;
  }

  const lat = Number(resolved.location.latitude);
  const lng = Number(resolved.location.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    id: String(resolved.id),
    name: String(resolved?.displayName?.text || cityName),
    formattedAddress: String(resolved?.formattedAddress || '').trim(),
    location: { lat, lng },
    photoUrl: buildPlacePhotoUrl(resolved?.photos?.[0]?.name, mapsApiKey),
    popularityRank: normalizeRank(popularityRank, 99)
  };
}

module.exports = { getPopularCitiesForCountry, resolveCityInCountry };
