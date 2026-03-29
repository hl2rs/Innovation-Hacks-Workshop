const { Router } = require('express');
const { getPopularCitiesForCountry, resolveCityInCountry } = require('../services/popularCitiesService');
const { findCityCenter, searchCities, searchCategoryPlaces, getPlaceDetails } = require('../services/placesService');
const { getTravelMinutes, computeRoutePolyline } = require('../services/routesService');
const { callGemini } = require('../services/geminiService');
const { toMinutes, formatHour } = require('../utils/time');
const { pickTopCandidates, parseJsonFromModelText } = require('../utils/planning');

const router = Router();

// Planning options and category config are defined here so both the /options
// route and the planning routes can share the same source of truth.
const planningOptions = [
  { id: 'food-dining', label: '🍜 Food & Dining' },
  { id: 'nature-outdoors', label: '🌄 Nature & Outdoors' },
  { id: 'history-landmarks', label: '🏛️ History & Landmarks' },
  { id: 'culture-arts', label: '🎭 Culture & Arts' },
  { id: 'entertainment-attractions', label: '🎢 Entertainment & Attractions' },
  { id: 'shopping', label: '🛍️ Shopping' },
  { id: 'adventure-activities', label: '🧗 Adventure & Activities' },
  { id: 'nightlife', label: '🌙 Nightlife' }
];

const categoryConfig = {
  'food-dining': { query: 'best local restaurants and cafes', visitMinutes: 75 },
  'nature-outdoors': { query: 'parks, trails, scenic viewpoints', visitMinutes: 90 },
  'history-landmarks': { query: 'historical landmarks and monuments', visitMinutes: 70 },
  'culture-arts': { query: 'museums, art galleries, cultural centers', visitMinutes: 80 },
  'entertainment-attractions': { query: 'top attractions and entertainment spots', visitMinutes: 90 },
  shopping: { query: 'shopping areas, markets, malls', visitMinutes: 85 },
  'adventure-activities': { query: 'adventure activities and outdoor experiences', visitMinutes: 105 },
  nightlife: { query: 'nightlife spots, bars, live music', visitMinutes: 95 }
};

// Returns the list of planning category options shown in the UI (step 3).
router.get('/options', (req, res) => {
  res.json({ options: planningOptions });
});

// City autocomplete — called on each keystroke in the city input field.
// Returns up to 6 matching city results with coordinates and photos.
router.get('/cities', async (req, res) => {
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  const query = String(req.query.q || '').trim();

  if (!query || query.length < 2) {
    return res.json({ cities: [] });
  }

  if (!mapsApiKey) {
    return res.status(500).json({ error: 'Server is missing GOOGLE_MAPS_API_KEY.' });
  }

  try {
    const cities = await searchCities(query, mapsApiKey);
    return res.json({ cities });
  } catch (error) {
    console.error('City search error:', error.message);
    return res.status(500).json({ error: 'Failed to search cities.' });
  }
});

// Country popular cities — triggered when the user clicks "Find Cities".
// Asks Gemini for 8 ranked cities, resolves each via the Places API.
router.get('/country-popular-cities', async (req, res) => {
  const aiApiKey = process.env.GOOGLE_AI_API_KEY;
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  const country = String(req.query.country || '').trim();

  if (!country || country.length < 2) {
    return res.status(400).json({ error: 'Country is required.' });
  }

  if (!aiApiKey || !mapsApiKey) {
    return res.status(500).json({
      error: 'Server is missing GOOGLE_AI_API_KEY or GOOGLE_MAPS_API_KEY in environment variables.'
    });
  }

  try {
    const rankedCities = await getPopularCitiesForCountry(country, aiApiKey);
    if (!rankedCities.length) {
      return res.json({ country, cities: [] });
    }

    const resolvedList = await Promise.all(
      rankedCities.map((cityEntry) =>
        resolveCityInCountry(cityEntry.name, country, mapsApiKey, cityEntry.popularityRank)
      )
    );

    const uniqueByName = new Map();
    resolvedList.filter(Boolean).forEach((city) => {
      const key = city.name.toLowerCase();
      if (!uniqueByName.has(key)) {
        uniqueByName.set(key, city);
        return;
      }
      const existing = uniqueByName.get(key);
      if (city.popularityRank < existing.popularityRank) {
        uniqueByName.set(key, city);
      }
    });

    const cities = Array.from(uniqueByName.values())
      .sort((a, b) => a.popularityRank - b.popularityRank)
      .slice(0, 8)
      .map((city, index) => ({ ...city, popularityRank: index + 1 }));

    return res.json({ country, cities });
  } catch (error) {
    console.error('Country popular cities error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch popular cities for country.' });
  }
});

// Place details — called when the user clicks a stop card on the map.
// Fetches rich place data and generates an AI Overview via Gemini.
router.get('/place-details', async (req, res) => {
  const aiApiKey = process.env.GOOGLE_AI_API_KEY;
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  const placeId = String(req.query.placeId || '').trim();

  if (!placeId) {
    return res.status(400).json({ error: 'placeId is required.' });
  }

  if (!mapsApiKey) {
    return res.status(500).json({ error: 'Server is missing GOOGLE_MAPS_API_KEY.' });
  }

  try {
    const details = await getPlaceDetails(placeId, mapsApiKey, aiApiKey);
    return res.json({ details });
  } catch (error) {
    console.error('Place details error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch place details.' });
  }
});

// Helper: normalizes "A"/"AM"/"P"/"PM" period strings to "A" or "P".
function normalizePeriod(value) {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'A' || raw === 'AM') return 'A';
  if (raw === 'P' || raw === 'PM') return 'P';
  return raw;
}

// Helper: resolves a category value from either an id or a label string.
function resolveCategory(value) {
  const str = String(value).trim();
  if (categoryConfig[str]) return str;
  const byLabel = planningOptions.find((opt) => opt.label === str);
  return byLabel ? byLabel.id : str;
}

// Streaming itinerary builder (step-by-step) — called repeatedly by the client,
// once per stop, each call carrying the itinerary built so far.
// Returns the chosen stop, or done:true when time runs out.
router.post('/next', async (req, res) => {
  const aiApiKey = process.env.GOOGLE_AI_API_KEY;
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  const body = req.body || {};

  const city = String(body.city || '').trim();
  const categories = (Array.isArray(body.categories) ? body.categories : [])
    .map((v) => String(v).trim())
    .filter(Boolean)
    .map(resolveCategory);

  const startHour = body.startHour ?? body.startTime ?? '';
  const startPeriod = normalizePeriod(body.startPeriod);
  const endHour = body.endHour ?? body.endTime ?? '';
  const endPeriod = normalizePeriod(body.endPeriod);

  const start = toMinutes(startHour, startPeriod);
  let end = toMinutes(endHour, endPeriod);

  if (!city) return res.status(400).json({ error: 'City is required.' });
  if (!categories.length) return res.status(400).json({ error: 'At least one category is required.' });
  if (!aiApiKey || !mapsApiKey) {
    return res.status(500).json({
      error: 'Server is missing GOOGLE_AI_API_KEY or GOOGLE_MAPS_API_KEY in environment variables.'
    });
  }
  if (start === null || end === null) return res.status(400).json({ error: 'Invalid time inputs.' });
  if (end <= start) end += 12 * 60;

  const itinerary = (Array.isArray(body.itinerary) ? body.itinerary : [])
    .filter((stop) => stop && typeof stop === 'object');
  const chosenPlaceIds = new Set(itinerary.map((stop) => String(stop.placeId || '')).filter(Boolean));

  const currentMinuteRaw = Number(body.currentMinute);
  const currentMinute = Number.isFinite(currentMinuteRaw)
    ? currentMinuteRaw
    : itinerary.length
      ? toMinutes(
          String(itinerary[itinerary.length - 1]?.endTime || '').split(' ')[0],
          String(itinerary[itinerary.length - 1]?.endTime || '').split(' ')[1]
        ) || start
      : start;

  const centerInput = body.center;
  let center =
    Number.isFinite(Number(centerInput?.lat)) && Number.isFinite(Number(centerInput?.lng))
      ? { lat: Number(centerInput.lat), lng: Number(centerInput.lng) }
      : null;

  try {
    if (!center) center = await findCityCenter(city, mapsApiKey);

    const currentLocationInput = body.currentLocation;
    const currentLocation =
      Number.isFinite(Number(currentLocationInput?.lat)) && Number.isFinite(Number(currentLocationInput?.lng))
        ? { lat: Number(currentLocationInput.lat), lng: Number(currentLocationInput.lng) }
        : itinerary.length
          ? itinerary[itinerary.length - 1].location
          : center;

    const remainingMinutes = end - currentMinute;
    if (remainingMinutes <= 0) {
      let routePolyline = '';
      if (itinerary.length > 1) {
        try { routePolyline = await computeRoutePolyline(itinerary, mapsApiKey); } catch { routePolyline = ''; }
      }
      return res.json({ done: true, itinerary, routePolyline, center, currentMinute, currentLocation, message: 'Time window complete.' });
    }

    const groupedResults = await Promise.all(
      categories.map((categoryId) => searchCategoryPlaces(city, categoryId, center, mapsApiKey, categoryConfig))
    );

    const uniqueById = new Map();
    groupedResults.flat().forEach((place) => {
      if (!chosenPlaceIds.has(place.id) && !uniqueById.has(place.id)) {
        uniqueById.set(place.id, place);
      }
    });

    const withTravel = [];
    for (const candidate of uniqueById.values()) {
      const travelMinutes = await getTravelMinutes(currentLocation, candidate.location, mapsApiKey);
      const totalCost = travelMinutes + candidate.suggestedVisitMinutes;
      if (totalCost <= remainingMinutes) {
        withTravel.push({ ...candidate, travelMinutes, totalCost });
      }
    }

    if (!withTravel.length) {
      let routePolyline = '';
      if (itinerary.length > 1) {
        try { routePolyline = await computeRoutePolyline(itinerary, mapsApiKey); } catch { routePolyline = ''; }
      }
      return res.json({ done: true, itinerary, routePolyline, center, currentMinute, currentLocation, message: 'No more stops fit in the remaining time.' });
    }

    const topCandidates = pickTopCandidates(withTravel, remainingMinutes);
    let selected = topCandidates[0];

    try {
      const analysisPrompt = [
        'You are helping build a one-day travel itinerary step by step.',
        `Current city: ${city}`,
        `Time remaining (minutes): ${remainingMinutes}`,
        'Pick the single best next stop from the JSON list and respond ONLY as JSON:',
        '{"selectedId":"<place id>","reason":"<short reason>"}',
        JSON.stringify(topCandidates.map((c) => ({
          id: c.id, name: c.name, categoryId: c.categoryId, rating: c.rating,
          userRatingCount: c.userRatingCount, travelMinutes: c.travelMinutes,
          visitMinutes: c.suggestedVisitMinutes, totalCost: c.totalCost
        })))
      ].join('\n');

      const analysis = await callGemini(aiApiKey, analysisPrompt);
      const parsed = parseJsonFromModelText(analysis);
      const picked = topCandidates.find((c) => c.id === parsed.selectedId);
      if (picked) selected = { ...picked, aiReason: parsed.reason || '' };
    } catch {
      selected = { ...selected, aiReason: '' };
    }

    const arrival = Math.ceil((currentMinute + selected.travelMinutes) / 5) * 5;
    const departure = Math.ceil((arrival + selected.suggestedVisitMinutes) / 5) * 5;

    const stop = {
      placeId: selected.id,
      name: selected.name,
      address: selected.address,
      categoryId: selected.categoryId,
      rating: selected.rating,
      travelMinutes: selected.travelMinutes,
      visitMinutes: selected.suggestedVisitMinutes,
      location: selected.location,
      photoUrl: selected.photoName
        ? `https://places.googleapis.com/v1/${selected.photoName}/media?maxHeightPx=220&maxWidthPx=320&key=${mapsApiKey}`
        : '',
      startTime: formatHour(arrival),
      endTime: formatHour(departure),
      aiReason: selected.aiReason || ''
    };

    const nextItinerary = [...itinerary, stop];
    let routePolyline = '';
    if (nextItinerary.length > 1) {
      try { routePolyline = await computeRoutePolyline(nextItinerary, mapsApiKey); } catch { routePolyline = ''; }
    }

    return res.json({ done: false, stop, itinerary: nextItinerary, routePolyline, center, currentMinute: departure, currentLocation: selected.location });
  } catch (error) {
    console.error('Planning next error:', error.message);
    return res.status(500).json({ error: 'Failed to compute next recommendation.' });
  }
});

// Full itinerary build (single request) — builds the entire itinerary in one
// server-side loop, then asks Gemini for a summary narrative and computes the
// route polyline. Returns the complete itinerary, reply text, and polyline.
router.post('/build', async (req, res) => {
  const aiApiKey = process.env.GOOGLE_AI_API_KEY;
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  const body = req.body || {};

  const cityRaw = body.city ?? body.location ?? body.destinationCity ?? '';
  const city = String(cityRaw).trim();

  const startHour = body.startHour ?? body.startTime ?? body.start ?? '';
  const startPeriod = normalizePeriod(body.startPeriod ?? body.fromPeriod ?? body.startMeridiem ?? '');
  const endHour = body.endHour ?? body.endTime ?? body.end ?? '';
  const endPeriod = normalizePeriod(body.endPeriod ?? body.toPeriod ?? body.endMeridiem ?? '');

  const categoriesInput = body.categories ?? body.categoryIds ?? body.selectedCategories ?? body.interests ?? [];
  const categories = Array.isArray(categoriesInput)
    ? categoriesInput.map((v) => String(v).trim()).filter(Boolean).map(resolveCategory)
    : [];

  if (!city) {
    return res.status(400).json({
      error: 'City is required.',
      detail: 'Expected body.city (or location/destinationCity).',
      received: { city: cityRaw }
    });
  }

  if (!categories.length) {
    return res.status(400).json({
      error: 'At least one category is required.',
      detail: 'Expected categories array (ids like food-dining).',
      received: { categories: categoriesInput }
    });
  }

  if (!aiApiKey || !mapsApiKey) {
    return res.status(500).json({
      error: 'Server is missing GOOGLE_AI_API_KEY or GOOGLE_MAPS_API_KEY in environment variables.'
    });
  }

  const start = toMinutes(startHour, startPeriod);
  let end = toMinutes(endHour, endPeriod);

  if (start === null || end === null) {
    return res.status(400).json({
      error: 'Invalid time inputs.',
      detail: 'Expected 1-12 hour values and A/P (or AM/PM).',
      received: { startHour, startPeriod, endHour, endPeriod }
    });
  }

  if (end <= start) end += 12 * 60;

  const budgetMinutes = end - start;
  if (budgetMinutes < 60) {
    return res.status(400).json({
      error: 'Please provide at least 1 hour for planning.',
      detail: 'The computed time window is too short.',
      received: { startHour, startPeriod, endHour, endPeriod, budgetMinutes }
    });
  }

  try {
    const center = await findCityCenter(city, mapsApiKey);

    const groupedResults = await Promise.all(
      categories.map((categoryId) => searchCategoryPlaces(city, categoryId, center, mapsApiKey, categoryConfig))
    );

    const allCandidates = groupedResults.flat();
    if (!allCandidates.length) {
      return res.status(404).json({ error: 'No places found for selected categories.' });
    }

    const uniqueById = new Map();
    allCandidates.forEach((place) => {
      if (!uniqueById.has(place.id)) uniqueById.set(place.id, place);
    });

    let candidates = Array.from(uniqueById.values());
    let timelineMinute = start;
    let currentLocation = center;
    const itinerary = [];

    while (candidates.length && timelineMinute < end) {
      const remainingMinutes = end - timelineMinute;
      const withTravel = [];

      for (const candidate of candidates) {
        const travelMinutes = await getTravelMinutes(currentLocation, candidate.location, mapsApiKey);
        const totalCost = travelMinutes + candidate.suggestedVisitMinutes;
        if (totalCost <= remainingMinutes) {
          withTravel.push({ ...candidate, travelMinutes, totalCost });
        }
      }

      if (!withTravel.length) break;

      const topCandidates = pickTopCandidates(withTravel, remainingMinutes);
      let selected = topCandidates[0];

      try {
        const analysisPrompt = [
          'You are helping build a one-day travel itinerary step by step.',
          `Current city: ${city}`,
          `Time remaining (minutes): ${remainingMinutes}`,
          'Pick the single best next stop from the JSON list and respond ONLY as JSON:',
          '{"selectedId":"<place id>","reason":"<short reason>"}',
          JSON.stringify(topCandidates.map((c) => ({
            id: c.id, name: c.name, categoryId: c.categoryId, rating: c.rating,
            userRatingCount: c.userRatingCount, travelMinutes: c.travelMinutes,
            visitMinutes: c.suggestedVisitMinutes, totalCost: c.totalCost
          })))
        ].join('\n');

        const analysis = await callGemini(aiApiKey, analysisPrompt);
        const parsed = parseJsonFromModelText(analysis);
        const picked = topCandidates.find((c) => c.id === parsed.selectedId);
        if (picked) selected = { ...picked, aiReason: parsed.reason || '' };
      } catch {
        selected = { ...selected, aiReason: '' };
      }

      const arrival = timelineMinute + selected.travelMinutes;
      const departure = arrival + selected.suggestedVisitMinutes;

      itinerary.push({
        placeId: selected.id,
        name: selected.name,
        address: selected.address,
        categoryId: selected.categoryId,
        rating: selected.rating,
        travelMinutes: selected.travelMinutes,
        visitMinutes: selected.suggestedVisitMinutes,
        location: selected.location,
        photoUrl: selected.photoName
          ? `https://places.googleapis.com/v1/${selected.photoName}/media?maxHeightPx=220&maxWidthPx=320&key=${mapsApiKey}`
          : '',
        startTime: formatHour(arrival),
        endTime: formatHour(departure),
        aiReason: selected.aiReason || ''
      });

      timelineMinute = departure;
      currentLocation = selected.location;
      candidates = candidates.filter((c) => c.id !== selected.id);
    }

    if (!itinerary.length) {
      return res.status(200).json({
        itinerary: [],
        reply: 'I could not fit any stops in the selected timeframe. Try increasing your time window.'
      });
    }

    const summaryPrompt = [
      `Create a practical travel plan narrative for ${city}.`,
      `Time window: ${startHour} ${startPeriod} to ${endHour} ${endPeriod}.`,
      'Use this itinerary JSON and explain why the sequence is efficient based on travel and stay times.',
      'Keep it concise but useful. Use plain text with numbered stops.',
      JSON.stringify(itinerary)
    ].join('\n');

    const reply = await callGemini(aiApiKey, summaryPrompt);

    let routePolyline = '';
    try {
      routePolyline = await computeRoutePolyline(itinerary, mapsApiKey);
    } catch (polylineError) {
      console.error('Route polyline error:', polylineError.message);
    }

    return res.json({ itinerary, reply, routePolyline });
  } catch (error) {
    console.error('Planning build error:', error.message);
    return res.status(500).json({ error: 'Failed to build travel plan.' });
  }
});

module.exports = router;
