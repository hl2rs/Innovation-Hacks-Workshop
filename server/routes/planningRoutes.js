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
  estimatePlaceVisitWindows,
  estimateTrafficAdjustedTravelTimes
} = require('../services/geminiService');
const { toMinutes, formatHour } = require('../utils/time');
const {
  clampMinutes,
  computeCandidatePriorityScore,
  estimateVisitWindow,
  pickTopCandidates,
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
  return baseDate.toISOString();
}

function getCurrentLocationLabel({ city, cityName, itinerary }) {
  if (Array.isArray(itinerary) && itinerary.length) {
    const lastStop = itinerary[itinerary.length - 1];
    return [lastStop?.name, lastStop?.address].filter(Boolean).join(' - ');
  }

  return `${cityName || city} city center`;
}

async function applyTrafficAdjustedTravelTimes({
  aiApiKey,
  candidates,
  city,
  cityName,
  currentMinute,
  destinationContext,
  itinerary,
}) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return [];
  }

  const departureDateTime = new Date(buildDepartureDateTime(currentMinute));

  try {
    const trafficAdjustments = await estimateTrafficAdjustedTravelTimes({
      candidates,
      aiApiKey,
      destinationContext: destinationContext || city,
      weekdayName: getCurrentWeekdayName(departureDateTime),
      departureTimeLabel: formatHour(currentMinute),
      originLabel: getCurrentLocationLabel({ city, cityName, itinerary }),
    });
    const adjustmentMap = new Map(
      trafficAdjustments.map((row) => [row.id, row]).filter(([id]) => id)
    );

    return candidates.map((candidate) => {
      const adjustment = adjustmentMap.get(candidate.id);
      if (!adjustment) {
        return candidate;
      }

      const baselineTravelMinutes = Math.max(1, Number(candidate.travelMinutes || 0));
      const clampedAdjustedTravelMinutes = clampMinutes(
        Number.isFinite(adjustment.adjustedTravelMinutes)
          ? adjustment.adjustedTravelMinutes
          : Math.round(baselineTravelMinutes * Math.max(0.95, Math.min(1.35, Number(adjustment.multiplier) || 1))),
        Math.max(1, Math.floor(baselineTravelMinutes * 0.95)),
        Math.max(2, Math.ceil(baselineTravelMinutes * 1.35)),
      );

      return {
        ...candidate,
        baseTravelMinutes: baselineTravelMinutes,
        travelMinutes: clampedAdjustedTravelMinutes,
        trafficRationale: adjustment.rationale || '',
      };
    });
  } catch {
    return candidates;
  }
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

function isCandidateOpenToday(candidate, referenceDate = new Date()) {
  const todayDescription = getTodayWeekdayDescription(candidate?.weekdayDescriptions, referenceDate);

  if (!todayDescription) {
    return true;
  }

  return !/\bclosed\b/i.test(todayDescription);
}

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

async function enrichPlanningCandidates(candidates, mapsApiKey, aiApiKey, destinationContext) {
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

  let aiVisitWindowById = new Map();
  try {
    const aiWindows = await estimatePlaceVisitWindows(mergedCandidates, aiApiKey, destinationContext);
    aiVisitWindowById = new Map(
      aiWindows.map((window) => [String(window.id || '').trim(), window]).filter(([id]) => id)
    );
  } catch {
    aiVisitWindowById = new Map();
  }

  return mergedCandidates.map((merged) => {
    const fallbackWindow = estimateVisitWindow(merged);
    const visitWindow = normalizeAiVisitWindow(aiVisitWindowById.get(merged.id), fallbackWindow);

    return {
      ...merged,
      ...visitWindow,
      suggestedVisitMinutes: visitWindow.recommendedVisitMinutes,
      totalCost: merged.travelMinutes + visitWindow.recommendedVisitMinutes
    };
  });
}

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

  const fallbackPool = scoredCandidates.slice(0, Math.min(3, scoredCandidates.length));
  const fallback = fallbackPool[Math.floor(Math.random() * fallbackPool.length)] || candidates[0];
  const fallbackMaxVisit = Math.min(
    fallback.maximumVisitMinutes,
    Math.max(fallback.minimumVisitMinutes, remainingMinutes - fallback.travelMinutes)
  );

  try {
    const promptCandidates = [...scoredCandidates].sort((left, right) => {
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
              categoryId: stop.categoryId,
              travelMinutes: stop.travelMinutes,
              visitMinutes: stop.visitMinutes
            }))
          )}`
        : 'Itinerary so far: []',
      'Choose the single best next place from the candidate JSON.',
      'Only choose places physically located in the requested destination area.',
      'Use the full candidate address to reject places in other cities, regions, or countries even if the place name sounds related.',
      'Prioritize high-confidence places with both excellent star ratings and substantial review volume.',
      'When multiple candidates are similarly strong, prefer variety over repeatedly picking the exact same famous place.',
      'A great itinerary should feel diverse in category, vibe, and stop type instead of repeating the same pattern.',
      'A place with a high rating but very few reviews is weaker evidence than a place with a similarly high rating and hundreds or thousands of reviews.',
      'Consider many factors together: rating, number of reviews, review snippet quality, editorial summary, open-now status, place type, travel time, visit duration fit, route efficiency, and how this stop shapes the rest of the itinerary.',
      'Do not waste too much of the remaining window on one stop unless it is clearly the anchor experience and its quality justifies it.',
      'Avoid weakly reviewed or low-evidence places when stronger options exist.',
      'Return ONLY JSON in this exact shape:',
      '{"selectedId":"<place id>","visitMinutes":75,"reason":"<why this stop now>","nextStep":"<brief transition toward what should come after>"}',
      'Rules:',
      '- visitMinutes must be an integer within the candidate minVisitMinutes/maxVisitMinutes range.',
      '- The chosen stop must still fit inside the remaining minutes once travel is included.',
      '- Use review snippets and editorial summary as evidence, not filler.',
      '- If two places are similar, prefer the one with stronger review volume and review quality evidence.',
      '- If two places are similarly strong, choose the more distinctive or less repetitive option.',
      JSON.stringify(
        promptCandidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          fullLocation: [candidate.name, candidate.address].filter(Boolean).join(' - '),
          address: candidate.address,
          category: getCategoryLabel(candidate.categoryId),
          primaryType: candidate.primaryTypeDisplayName || candidate.primaryType || '',
          rating: candidate.rating,
          userRatingCount: candidate.userRatingCount,
          priorityScore: Number(candidate.priorityScore?.toFixed?.(2) || candidate.priorityScore || 0),
          prioritySignals: candidate.prioritySignals || {},
          travelMinutes: candidate.travelMinutes,
          minVisitMinutes: candidate.minimumVisitMinutes,
          recommendedVisitMinutes: candidate.recommendedVisitMinutes,
          maxVisitMinutes: candidate.maximumVisitMinutes,
          durationRationale: candidate.visitDurationRationale,
          editorialSummary: candidate.editorialSummary || '',
          reviewSnippets: candidate.reviewSnippets || [],
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

  if (remainingMinutes <= 0) {
    return { done: true, message: 'No more stops fit in the remaining time.' };
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
  const departureTime = buildDepartureDateTime(currentMinute);
  for (const candidate of uniqueById.values()) {
    const travelMinutes = await getTravelMinutes(currentLocation, candidate.location, mapsApiKey, {
      departureTime,
    });
    const minimumTotalCost = travelMinutes + candidate.minimumVisitMinutes;
    if (minimumTotalCost <= remainingMinutes) {
      withTravel.push({
        ...candidate,
        baseTravelMinutes: travelMinutes,
        travelMinutes,
        totalCost: travelMinutes + candidate.recommendedVisitMinutes,
        suggestedVisitMinutes: candidate.recommendedVisitMinutes
      });
    }
  }

  if (!withTravel.length) {
    return { done: true, message: 'No more stops fit in the remaining time.' };
  }

  const shortlistedCandidates = pickTopCandidates(withTravel, remainingMinutes, itinerary);
  const trafficAdjustedCandidates = await applyTrafficAdjustedTravelTimes({
    aiApiKey,
    candidates: shortlistedCandidates,
    city,
    cityName,
    currentMinute,
    destinationContext,
    itinerary,
  });

  const enrichedCandidates = await enrichPlanningCandidates(
    trafficAdjustedCandidates,
    mapsApiKey,
    aiApiKey,
    destinationContext || city
  );

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
    let currentLocation = center;
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
