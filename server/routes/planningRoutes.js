const { Router } = require('express');
const { getPopularCitiesForCountry, resolveCityInCountry } = require('../services/popularCitiesService');
const { buildPlacePhotoUrl } = require('../utils/placeFormatting');
const {
  findCityCenter,
  searchCities,
  searchCategoryPlaces,
  getPlanningPlaceSnapshot,
  getPlaceDetails
} = require('../services/placesService');
const { getTravelMinutes, computeRoutePolyline } = require('../services/routesService');
const {
  callGemini,
} = require('../services/geminiService');
const { toMinutes, formatHour } = require('../utils/time');
const {
  clampMinutes,
  computeCandidatePriorityScore,
  estimateVisitWindow,
  pickTopCandidates,
  pickCandidatesForTravelEstimates,
  parseJsonFromModelText
} = require('../utils/planning');

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

function getCategoryLabel(categoryId) {
  return planningOptions.find((option) => option.id === categoryId)?.label || categoryId;
}

function buildStopPhotoUrl(photoName, mapsApiKey) {
  return buildPlacePhotoUrl(photoName, mapsApiKey, 640, 960);
}

function buildDestinationContext(cityName, cityQuery, country) {
  const parts = [cityName, cityQuery, country]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  return parts
    .filter((value, index) => {
      const normalized = value.toLowerCase();
      return parts.findIndex((candidate) => candidate.toLowerCase() === normalized) === index;
    })
    .join(', ');
}

function getCurrentWeekdayName(referenceDate = new Date()) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    referenceDate.getDay()
  ];
}

function buildDepartureDateTime(currentMinute, referenceDate = new Date()) {
  const baseDate = new Date(referenceDate);
  if (!Number.isFinite(Number(currentMinute))) {
    baseDate.setMinutes(baseDate.getMinutes() + 5, 0, 0);
    return baseDate.toISOString();
  }

  const totalMinutes = Number(currentMinute);
  const dayOffset = Math.floor(totalMinutes / 1440);
  const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;

  baseDate.setHours(0, 0, 0, 0);
  baseDate.setDate(baseDate.getDate() + dayOffset);
  baseDate.setHours(hours, minutes, 0, 0);

  const minimumFutureTime = new Date(referenceDate);
  minimumFutureTime.setSeconds(0, 0);
  minimumFutureTime.setMinutes(minimumFutureTime.getMinutes() + 1);

  while (baseDate <= minimumFutureTime) {
    baseDate.setDate(baseDate.getDate() + 7);
  }

  return baseDate.toISOString();
}

function getRandomCityStartLocation(center) {
  return getRandomPointAroundCenter(center, {
    minRadiusKm: 1.8,
    maxRadiusKm: 8.5,
  });
}

function getRandomPointAroundCenter(center, options = {}) {
  if (!center || !Number.isFinite(Number(center.lat)) || !Number.isFinite(Number(center.lng))) {
    return center;
  }

  const centerLat = Number(center.lat);
  const centerLng = Number(center.lng);
  const maxRadiusKm = Math.max(0.25, Number(options?.maxRadiusKm) || 8.5);
  const minRadiusKm = Math.max(0, Math.min(maxRadiusKm, Number(options?.minRadiusKm) || 0));
  const randomRadiusKm = minRadiusKm + Math.sqrt(Math.random()) * (maxRadiusKm - minRadiusKm);
  const randomHeading = Math.random() * Math.PI * 2;
  const latOffset = (randomRadiusKm / 111) * Math.cos(randomHeading);
  const lngScale = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180));
  const lngOffset = (randomRadiusKm / (111 * lngScale)) * Math.sin(randomHeading);

  return {
    lat: centerLat + latOffset,
    lng: centerLng + lngOffset,
  };
}

function buildPlanningSearchCenters({ center, itinerary }) {
  if (!center || !Number.isFinite(Number(center.lat)) || !Number.isFinite(Number(center.lng))) {
    return [];
  }

  const isFirstLeg = !Array.isArray(itinerary) || itinerary.length === 0;
  const randomCenterCount = isFirstLeg ? 2 : 1;
  const searchCenters = [
    center,
    ...Array.from({ length: randomCenterCount }, () =>
      getRandomPointAroundCenter(center, {
        minRadiusKm: isFirstLeg ? 2.5 : 1.2,
        maxRadiusKm: isFirstLeg ? 15.5 : 9.5,
      })
    ),
  ];

  const uniqueByGridKey = new Map();
  searchCenters.forEach((point) => {
    if (!point) {
      return;
    }

    const key = `${Number(point.lat).toFixed(3)}:${Number(point.lng).toFixed(3)}`;
    if (!uniqueByGridKey.has(key)) {
      uniqueByGridKey.set(key, point);
    }
  });

  return Array.from(uniqueByGridKey.values());
}

function getCurrentLocationLabel({ city, cityName, itinerary }) {
  if (Array.isArray(itinerary) && itinerary.length) {
    const lastStop = itinerary[itinerary.length - 1];
    return [lastStop?.name, lastStop?.address].filter(Boolean).join(' - ');
  }

  return `${cityName || city} city center`;
}

function getTodayWeekdayDescription(weekdayDescriptions, referenceDate = new Date()) {
  if (!Array.isArray(weekdayDescriptions) || !weekdayDescriptions.length) {
    return '';
  }

  const entries = weekdayDescriptions
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);

  if (!entries.length) {
    return '';
  }

  const weekdayName = getCurrentWeekdayName(referenceDate);
  const directMatch = entries.find((entry) => entry.toLowerCase().startsWith(`${weekdayName.toLowerCase()}:`));

  if (directMatch) {
    return directMatch;
  }

  const mondayFirstIndex = (referenceDate.getDay() + 6) % 7;
  return entries[mondayFirstIndex] || '';
}

// ADD isCandidateOpenToday //
function isCandidateOpenToday(candidate, referenceDate = new Date()) {
  const todayDescription = getTodayWeekdayDescription(candidate?.weekdayDescriptions, referenceDate);

  if (!todayDescription) {
    return true;
  }

  return !/\bclosed\b/i.test(todayDescription);
}

function resolvePlanningStartLocation({ currentLocationInput, itinerary, center }) {
  if (
    Number.isFinite(Number(currentLocationInput?.lat)) &&
    Number.isFinite(Number(currentLocationInput?.lng))
  ) {
    return {
      lat: Number(currentLocationInput.lat),
      lng: Number(currentLocationInput.lng),
    };
  }

  if (Array.isArray(itinerary) && itinerary.length) {
    return itinerary[itinerary.length - 1].location;
  }

  return getRandomCityStartLocation(center);
}

function resolvePlanningSearchCenter({ center, itinerary }) {
  if (Array.isArray(itinerary) && itinerary.length) {
    return center;
  }

  return getRandomCityStartLocation(center);
}

// ADD buildStop //
function buildStop(candidate, arrival, departure, mapsApiKey) {
  return {
    placeId: candidate.id,
    name: candidate.name,
    address: candidate.address,
    categoryId: candidate.categoryId,
    categoryLabel: getCategoryLabel(candidate.categoryId),
    primaryType: candidate.primaryTypeDisplayName || candidate.primaryType || '',
    rating: candidate.rating,
    userRatingCount: candidate.userRatingCount,
    travelMinutes: candidate.travelMinutes,
    visitMinutes: candidate.suggestedVisitMinutes,
    visitDurationRationale: candidate.visitDurationRationale || '',
    location: candidate.location,
    photoUrl: buildStopPhotoUrl(candidate.photoName, mapsApiKey),
    startTime: formatHour(arrival),
    endTime: formatHour(departure),
    aiReason: candidate.aiReason || '',
    nextStep: candidate.nextStep || ''
  };
}

function normalizeAiVisitWindow(rawWindow, fallbackWindow) {
  const minimumVisitMinutes = Math.max(
    30,
    Math.min(
      300,
      Number.isFinite(Number(rawWindow?.minimumVisitMinutes))
        ? Math.round(Number(rawWindow.minimumVisitMinutes))
        : fallbackWindow.minimumVisitMinutes
    )
  );

  const maximumVisitMinutes = Math.max(
    minimumVisitMinutes + 15,
    Math.min(
      360,
      Number.isFinite(Number(rawWindow?.maximumVisitMinutes))
        ? Math.round(Number(rawWindow.maximumVisitMinutes))
        : fallbackWindow.maximumVisitMinutes
    )
  );

  const recommendedVisitMinutes = clampMinutes(
    Number.isFinite(Number(rawWindow?.recommendedVisitMinutes))
      ? Number(rawWindow.recommendedVisitMinutes)
      : fallbackWindow.recommendedVisitMinutes,
    minimumVisitMinutes,
    maximumVisitMinutes
  );

  return {
    minimumVisitMinutes,
    recommendedVisitMinutes,
    maximumVisitMinutes,
    visitDurationRationale:
      String(rawWindow?.rationale || '').trim() || fallbackWindow.visitDurationRationale,
  };
}

function normalizeSelectionKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSelectionTypeKey(candidate) {
  return normalizeSelectionKey(
    candidate?.primaryTypeDisplayName || candidate?.primaryType || candidate?.categoryId || ''
  );
}

function getSelectionAreaKey(candidate) {
  const address = String(candidate?.address || '').trim();
  if (!address) {
    return '';
  }

  const parts = address
    .split(',')
    .map((part) => normalizeSelectionKey(part))
    .filter(Boolean);

  return parts.slice(0, 2).join(' | ');
}

function pickWeightedCandidate(candidates, getWeight) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return null;
  }

  const weightedCandidates = candidates
    .map((candidate, index) => ({
      candidate,
      index,
      weight: Math.max(0, Number(getWeight(candidate, index)) || 0),
    }))
    .filter((entry) => entry.weight > 0);

  if (!weightedCandidates.length) {
    return candidates[Math.floor(Math.random() * candidates.length)] || null;
  }

  const totalWeight = weightedCandidates.reduce((sum, entry) => sum + entry.weight, 0);
  let threshold = Math.random() * totalWeight;

  for (const entry of weightedCandidates) {
    threshold -= entry.weight;
    if (threshold <= 0) {
      return entry.candidate;
    }
  }

  return weightedCandidates[weightedCandidates.length - 1]?.candidate || null;
}

function buildFirstLegPromptCandidates(scoredCandidates, limit = 5) {
  if (!Array.isArray(scoredCandidates) || !scoredCandidates.length) {
    return [];
  }

  const topPool = scoredCandidates.slice(0, Math.min(9, scoredCandidates.length));
  const bestScore = Number(topPool[0]?.priorityScore || 0);
  const selected = [];
  const categoryCounts = new Map();
  const typeCounts = new Map();
  const areaCounts = new Map();
  const workingPool = [...topPool];
  const targetCount = Math.min(limit, workingPool.length);

  while (workingPool.length && selected.length < targetCount) {
    const pickedCandidate = pickWeightedCandidate(workingPool, (candidate) => {
      const scoreGap = Math.max(0, bestScore - Number(candidate.priorityScore || 0));
      const categoryKey = normalizeSelectionKey(candidate.categoryId);
      const typeKey = getSelectionTypeKey(candidate);
      const areaKey = getSelectionAreaKey(candidate);
      const categoryPenalty = (categoryCounts.get(categoryKey) || 0) * 1.8;
      const typePenalty = (typeCounts.get(typeKey) || 0) * 1.6;
      const areaPenalty = (areaCounts.get(areaKey) || 0) * 2.2;
      const baseWeight = Math.max(0.75, 10 - scoreGap * 0.6);
      const randomnessBoost = 0.8 + Math.random() * 0.7;

      return Math.max(0.1, (baseWeight - categoryPenalty - typePenalty - areaPenalty) * randomnessBoost);
    });

    if (!pickedCandidate) {
      break;
    }

    const pickedIndex = workingPool.findIndex((candidate) => candidate.id === pickedCandidate.id);
    if (pickedIndex >= 0) {
      workingPool.splice(pickedIndex, 1);
    }

    selected.push(pickedCandidate);

    const categoryKey = normalizeSelectionKey(pickedCandidate.categoryId);
    const typeKey = getSelectionTypeKey(pickedCandidate);
    const areaKey = getSelectionAreaKey(pickedCandidate);
    categoryCounts.set(categoryKey, (categoryCounts.get(categoryKey) || 0) + 1);
    typeCounts.set(typeKey, (typeCounts.get(typeKey) || 0) + 1);
    if (areaKey) {
      areaCounts.set(areaKey, (areaCounts.get(areaKey) || 0) + 1);
    }
  }

  return selected;
}

// ADD enrichPlanningCandidates //
async function enrichPlanningCandidates(candidates, mapsApiKey) {
  const snapshots = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        return await getPlanningPlaceSnapshot(candidate.id, mapsApiKey);
      } catch {
        return null;
      }
    })
  );

  const mergedCandidates = candidates.map((candidate, index) => {
    const snapshot = snapshots[index];
    const merged = {
      ...candidate,
      primaryType: snapshot?.primaryType || candidate.primaryType,
      primaryTypeDisplayName:
        snapshot?.primaryTypeDisplayName || candidate.primaryTypeDisplayName || candidate.primaryType,
      editorialSummary: snapshot?.editorialSummary || '',
      openNow: snapshot?.openNow,
      weekdayDescriptions: snapshot?.weekdayDescriptions || [],
      reviewSnippets: Array.isArray(snapshot?.reviews)
        ? snapshot.reviews
            .map((review) => ({
              rating: Number(review?.rating || 0),
              text: String(review?.text || '').trim()
            }))
            .filter((review) => review.text)
            .slice(0, 3)
        : []
    };

    return {
      ...merged,
      categoryLabel: getCategoryLabel(candidate.categoryId),
    };
  });

  return mergedCandidates.map((merged) => {
    const fallbackWindow = estimateVisitWindow(merged);
    const visitWindow = normalizeAiVisitWindow(null, fallbackWindow);

    return {
      ...merged,
      ...visitWindow,
      suggestedVisitMinutes: visitWindow.recommendedVisitMinutes,
      totalCost: merged.travelMinutes + visitWindow.recommendedVisitMinutes
    };
  });
}
// ADD chooseNextCandidate // 
async function chooseNextCandidate({
  aiApiKey,
  city,
  cityName,
  destinationContext,
  categories,
  currentMinute,
  endMinute,
  itinerary,
  candidates,
}) {
  const remainingMinutes = endMinute - currentMinute;
  const isFirstLeg = !Array.isArray(itinerary) || itinerary.length === 0;
  if (!candidates.length) {
    return null;
  }

  const scoredCandidates = candidates
    .map((candidate) => {
      const priority = computeCandidatePriorityScore(candidate, remainingMinutes, itinerary);
      return {
        ...candidate,
        priorityScore: priority.score,
        prioritySignals: priority.signals,
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const firstLegPool = isFirstLeg
    ? buildFirstLegPromptCandidates(scoredCandidates, Math.min(5, scoredCandidates.length))
    : [];
  const fallbackPool = isFirstLeg
    ? firstLegPool
    : scoredCandidates.slice(0, Math.min(3, scoredCandidates.length));
  const fallback = isFirstLeg
    ? pickWeightedCandidate(fallbackPool, (candidate) => Math.max(0.2, Number(candidate.priorityScore || 0))) || candidates[0]
    : fallbackPool[Math.floor(Math.random() * fallbackPool.length)] || candidates[0];
  const fallbackMaxVisit = Math.min(
    fallback.maximumVisitMinutes,
    Math.max(fallback.minimumVisitMinutes, remainingMinutes - fallback.travelMinutes)
  );

  try {
    const promptCandidates = isFirstLeg
      ? firstLegPool
      : scoredCandidates.slice(0, Math.min(5, scoredCandidates.length)).sort((left, right) => {
          const scoreDelta = Math.abs(right.priorityScore - left.priorityScore);
          if (scoreDelta <= 4) {
            return Math.random() - 0.5;
          }

          return right.priorityScore - left.priorityScore;
        });

    // console.log(
    //   'Planning candidate list:',
    //   JSON.stringify(
    //     promptCandidates.map((candidate) => ({
    //       id: candidate.id,
    //       name: candidate.name,
    //       address: candidate.address,
    //       category: getCategoryLabel(candidate.categoryId),
    //       primaryType: candidate.primaryTypeDisplayName || candidate.primaryType || '',
    //       rating: candidate.rating,
    //       userRatingCount: candidate.userRatingCount,
    //       priorityScore: Number(candidate.priorityScore?.toFixed?.(2) || candidate.priorityScore || 0),
    //       travelMinutes: candidate.travelMinutes,
    //       minimumVisitMinutes: candidate.minimumVisitMinutes,
    //       recommendedVisitMinutes: candidate.recommendedVisitMinutes,
    //       maximumVisitMinutes: candidate.maximumVisitMinutes,
    //       openNow:
    //         typeof candidate.openNow === 'boolean'
    //           ? candidate.openNow
    //           : 'unknown',
    //       weekdayDescriptions: Array.isArray(candidate.weekdayDescriptions)
    //         ? candidate.weekdayDescriptions
    //         : [],
    //     })),
    //     null,
    //     2,
    //   ),
    // );

    const analysisPrompt = [
      'You are choosing the next stop in a travel itinerary.',
      `Destination city name: ${cityName || city}`,
      `Destination search query: ${city}`,
      `Destination context: ${destinationContext || city}`,
      `Selected interests: ${categories.map(getCategoryLabel).join(', ')}`,
      `Current time: ${formatHour(currentMinute)}`,
      `End of planning window: ${formatHour(endMinute)}`,
      `Remaining minutes: ${remainingMinutes}`,
      itinerary.length
        ? `Itinerary so far: ${JSON.stringify(
            itinerary.map((stop) => ({
              name: stop.name,
              address: stop.address || '',
              startTime: stop.startTime,
              endTime: stop.endTime,
              categoryId: stop.categoryId
            }))
          )}`
        : 'Itinerary so far: []',
      'Choose the single best next place from the candidate JSON.',
      'Only choose places physically located in the requested destination area.',
      'Use the full candidate address to reject places in other cities, regions, or countries even if the place name sounds related.',
      'When multiple candidates are similarly strong, prefer variety over repeatedly picking the exact same famous place.',
      isFirstLeg
        ? 'For the first stop, avoid always defaulting to the same iconic place. If several options are strong, intentionally vary the opener across neighborhoods, vibes, and stop types from run to run.'
        : 'Keep building variety without losing quality.',
      'A great itinerary should feel diverse in category, vibe, and stop type instead of repeating the same pattern.',
      'Ignore how many reviews a place has. Use the star rating itself, review snippets, open-now status, place type, travel time, visit duration fit, route efficiency, and how this stop shapes the rest of the itinerary.',
      'Do not waste too much of the remaining window on one stop unless it is clearly the anchor experience and its quality justifies it.',
      'Avoid weakly reviewed or low-evidence places when stronger options exist.',
      'Return ONLY JSON in this exact shape:',
      '{"selectedId":"<place id>","visitMinutes":75,"reason":"<why this stop now>","nextStep":"<brief transition toward what should come after>"}',
      'Rules:',
      '- visitMinutes must be an integer within the candidate minVisitMinutes/maxVisitMinutes range.',
      '- The chosen stop must still fit inside the remaining minutes once travel is included.',
      '- Use review snippets and editorial summary as evidence, not filler.',
      '- Ignore review count when comparing places.',
      '- If two places are similarly strong, choose the more distinctive or less repetitive option.',
      JSON.stringify(
        promptCandidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          fullLocation: [candidate.name, candidate.address].filter(Boolean).join(' - '),
          address: candidate.address,
          cityArea: getSelectionAreaKey(candidate),
          category: getCategoryLabel(candidate.categoryId),
          primaryType: candidate.primaryTypeDisplayName || candidate.primaryType || '',
          rating: candidate.rating,
          priorityScore: Number(candidate.priorityScore?.toFixed?.(2) || candidate.priorityScore || 0),
          travelMinutes: candidate.travelMinutes,
          minVisitMinutes: candidate.minimumVisitMinutes,
          recommendedVisitMinutes: candidate.recommendedVisitMinutes,
          maxVisitMinutes: candidate.maximumVisitMinutes,
          editorialSummary: candidate.editorialSummary || '',
          reviewSnippets: Array.isArray(candidate.reviewSnippets) ? candidate.reviewSnippets.slice(0, 2) : [],
          openNow:
            typeof candidate.openNow === 'boolean'
              ? candidate.openNow
              : 'unknown'
        }))
      )
    ].join('\n');

    const analysis = await callGemini(aiApiKey, analysisPrompt, {
      generationConfig: {
        temperature: 0.9,
        topP: 0.95,
      },
    });
    const parsed = parseJsonFromModelText(analysis);
    const picked = scoredCandidates.find((candidate) => candidate.id === parsed?.selectedId);

    if (!picked) {
      return {
        ...fallback,
        suggestedVisitMinutes: fallbackMaxVisit,
        aiReason: '',
        nextStep: ''
      };
    }

    const maxVisitMinutes = Math.min(
      picked.maximumVisitMinutes,
      Math.max(picked.minimumVisitMinutes, remainingMinutes - picked.travelMinutes)
    );
    const visitMinutes = clampMinutes(parsed?.visitMinutes, picked.minimumVisitMinutes, maxVisitMinutes);

    return {
      ...picked,
      suggestedVisitMinutes: visitMinutes,
      aiReason: String(parsed?.reason || '').trim(),
      nextStep: String(parsed?.nextStep || '').trim()
    };
  } catch {
    return {
      ...fallback,
      suggestedVisitMinutes: fallbackMaxVisit,
      aiReason: '',
      nextStep: ''
    };
  }
}
 
// ADD computeNextPlanningStop // 
async function computeNextPlanningStop({
  aiApiKey,
  mapsApiKey,
  city,
  cityName,
  destinationContext,
  categories,
  center,
  currentLocation,
  currentMinute,
  endMinute,
  itinerary,
}) {
  const chosenPlaceIds = new Set(itinerary.map((stop) => String(stop.placeId || '')).filter(Boolean));
  const remainingMinutes = endMinute - currentMinute;
  const isFirstLeg = !Array.isArray(itinerary) || itinerary.length === 0;
  const searchCenters = buildPlanningSearchCenters({ center, itinerary });

  if (remainingMinutes <= 0) {
    return { done: true, message: 'No more stops fit in the remaining time.' };
  }

  const groupedResults = await Promise.all(
    categories.flatMap((categoryId) =>
      searchCenters.map((searchCenter, index) =>
        searchCategoryPlaces(city, categoryId, searchCenter, mapsApiKey, categoryConfig, {
          maxResultCount: isFirstLeg ? 4 : index === 0 ? 5 : 4,
          radiusMeters: isFirstLeg ? 18000 : 14000,
        })
      )
    )
  );

  const uniqueById = new Map();
  groupedResults.flat().forEach((place) => {
    if (!chosenPlaceIds.has(place.id) && !uniqueById.has(place.id)) {
      uniqueById.set(place.id, place);
    }
  });

  const routeCandidates = pickCandidatesForTravelEstimates(
    Array.from(uniqueById.values()),
    Math.max(6, categories.length * 3)
  );

  const withTravelResults = [];
  const departureTime = buildDepartureDateTime(currentMinute);
  await Promise.all(
    routeCandidates.map(async (candidate) => {
      try {
        const travelMinutes = await getTravelMinutes(currentLocation, candidate.location, mapsApiKey, {
          departureTime,
          allowApproximateFallback: true,
        });

        if (!Number.isFinite(travelMinutes)) {
          return;
        }

        const minimumTotalCost = travelMinutes + candidate.minimumVisitMinutes;
        if (minimumTotalCost <= remainingMinutes) {
          withTravelResults.push({
            ...candidate,
            baseTravelMinutes: travelMinutes,
            travelMinutes,
            totalCost: travelMinutes + candidate.recommendedVisitMinutes,
            suggestedVisitMinutes: candidate.recommendedVisitMinutes
          });
        }
      } catch {
        return;
      }
    })
  );

  const withTravel = withTravelResults.sort((left, right) => left.travelMinutes - right.travelMinutes);

  if (!withTravel.length) {
    return { done: true, message: 'No more stops fit in the remaining time.' };
  }

  const shortlistedCandidates = pickTopCandidates(withTravel, remainingMinutes, itinerary);
  const enrichedCandidates = await enrichPlanningCandidates(shortlistedCandidates, mapsApiKey);

  const feasibleCandidates = enrichedCandidates.filter(
    (candidate) => candidate.travelMinutes + candidate.minimumVisitMinutes <= remainingMinutes
  );

  const openTodayCandidates = feasibleCandidates.filter((candidate) => isCandidateOpenToday(candidate));

  if (!openTodayCandidates.length) {
    return { done: true, message: 'No more stops fit in the remaining time.' };
  }

  const selected = await chooseNextCandidate({
    aiApiKey,
    city,
    cityName,
    destinationContext,
    categories,
    currentMinute,
    endMinute,
    itinerary,
    candidates: openTodayCandidates
  });

  if (!selected) {
    return { done: true, message: 'No more stops fit in the remaining time.' };
  }

  const fallbackSelected =
    Math.ceil((currentMinute + selected.travelMinutes) / 5) * 5 + selected.minimumVisitMinutes > endMinute
      ? openTodayCandidates.find((candidate) =>
          Math.ceil((currentMinute + candidate.travelMinutes) / 5) * 5 + candidate.minimumVisitMinutes <= endMinute
        ) || null
      : null;

  const finalCandidate = fallbackSelected || selected;
  const arrival = Math.ceil((currentMinute + finalCandidate.travelMinutes) / 5) * 5;
  const maxAvailableVisitMinutes = endMinute - arrival;

  if (maxAvailableVisitMinutes < finalCandidate.minimumVisitMinutes) {
    return { done: true, message: 'No more stops fit in the remaining time.' };
  }

  finalCandidate.suggestedVisitMinutes = clampMinutes(
    finalCandidate.suggestedVisitMinutes,
    finalCandidate.minimumVisitMinutes,
    Math.min(finalCandidate.maximumVisitMinutes, maxAvailableVisitMinutes)
  );

  const departure = Math.ceil((arrival + finalCandidate.suggestedVisitMinutes) / 5) * 5;

  return {
    done: false,
    stop: buildStop(finalCandidate, arrival, departure, mapsApiKey),
    currentMinute: departure,
    currentLocation: finalCandidate.location,
  };
}


// Streaming itinerary builder (step-by-step) — called repeatedly by the client,
// once per stop, each call carrying the itinerary built so far.
// Returns the chosen stop, or done:true when time runs out.
router.post('/next', async (req, res) => {
  const aiApiKey = process.env.GOOGLE_AI_API_KEY;
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  const body = req.body || {};

  const city = String(body.city || '').trim();
  const cityName = String(body.cityName || '').trim();
  const country = String(body.country || '').trim();
  const destinationContext = buildDestinationContext(body.destinationContext, cityName, country) || city;
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

    const currentLocation = resolvePlanningStartLocation({
      currentLocationInput: body.currentLocation,
      itinerary,
      center,
    });

    const nextStep = await computeNextPlanningStop({
      aiApiKey,
      mapsApiKey,
      city,
      cityName,
      destinationContext,
      categories,
      center,
      currentLocation,
      currentMinute,
      endMinute: end,
      itinerary,
    });

    const nextItinerary = nextStep.done ? itinerary : [...itinerary, nextStep.stop];
    let routePolyline = '';
    if (nextItinerary.length > 1) {
      try { routePolyline = await computeRoutePolyline(nextItinerary, mapsApiKey); } catch { routePolyline = ''; }
    }

    return res.json({
      done: nextStep.done,
      stop: nextStep.stop,
      itinerary: nextItinerary,
      routePolyline,
      center,
      currentMinute: nextStep.done ? currentMinute : nextStep.currentMinute,
      currentLocation: nextStep.done ? currentLocation : nextStep.currentLocation,
      message: nextStep.message || ''
    });
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
  const cityName = String(body.cityName || '').trim();
  const country = String(body.country || '').trim();
  const destinationContext = buildDestinationContext(body.destinationContext, cityName, country) || city;

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
    let timelineMinute = start;
    let currentLocation = getRandomCityStartLocation(center);
    const itinerary = [];

    while (timelineMinute < end) {
      const nextStep = await computeNextPlanningStop({
        aiApiKey,
        mapsApiKey,
        city,
        cityName,
        destinationContext,
        categories,
        center,
        currentLocation,
        currentMinute: timelineMinute,
        endMinute: end,
        itinerary,
      });

      if (nextStep.done || !nextStep.stop) {
        break;
      }

      itinerary.push(nextStep.stop);
      timelineMinute = nextStep.currentMinute;
      currentLocation = nextStep.currentLocation;
    }

    if (!itinerary.length) {
      return res.status(200).json({
        itinerary: [],
        reply: 'I could not fit any stops in the selected timeframe. Try increasing your time window.'
      });
    }

    const summaryPrompt = [
      `Create a practical travel plan narrative for ${destinationContext || city}.`,
      `Time window: ${startHour} ${startPeriod} to ${endHour} ${endPeriod}.`,
      `Interests: ${categories.map(getCategoryLabel).join(', ')}.`,
      'Use this itinerary JSON and explain why the sequence is efficient based on travel time, stay length, and place quality.',
      'Keep it concise but useful. Use plain text with numbered stops and a short closing note.',
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
