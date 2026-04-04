const { parseJsonFromModelText } = require('../utils/planning');
const { extractTextValue, toDisplayText } = require('../utils/placeFormatting');

const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';


// ADD callGemini //
async function callGemini(apiKey, prompt, options = {}) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }]
  };

  if (options?.generationConfig && typeof options.generationConfig === 'object') {
    body.generationConfig = options.generationConfig;
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini request failed: ${errorBody}`);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part.text)
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function summarizePlaceExperience(place, aiApiKey) {
  const reviewSnippets = Array.isArray(place?.reviews)
    ? place.reviews
        .map((review) => extractTextValue(review?.originalText || review?.text))
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const editorialSummary = extractTextValue(place?.editorialSummary);
  const formattedAddress = String(place?.formattedAddress || '').trim();

  if (!aiApiKey || (!reviewSnippets.length && !editorialSummary)) {
    return { aiOverview: editorialSummary, whatToDo: [] };
  }

  const prompt = [
    'You are writing an AI Overview for a travel stop.',
    'Return ONLY JSON in this shape: {"aiOverview":"short paragraph","whatToDo":["item 1","item 2","item 3"]}.',
    `Place name: ${extractTextValue(place?.displayName) || 'Unknown place'}`,
    `Location: ${formattedAddress || 'Unknown location'}`,
    `Primary type: ${toDisplayText(place?.primaryTypeDisplayName?.text || place?.primaryType || '')}`,
    `Editorial summary: ${editorialSummary || 'None'}`,
    'Use the location context, editorial summary, and review snippets to explain what the place is like, what visitors actually do there, and what kind of time commitment it feels like.',
    'Keep aiOverview under 70 words and whatToDo to at most 4 concise items.',
    JSON.stringify(reviewSnippets)
  ].join('\n');

  try {
    const raw = await callGemini(aiApiKey, prompt);
    const parsed = parseJsonFromModelText(raw);
    return {
      aiOverview: String(parsed?.aiOverview || parsed?.summary || '').trim(),
      whatToDo: Array.isArray(parsed?.whatToDo)
        ? parsed.whatToDo.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
        : []
    };
  } catch {
    return { aiOverview: editorialSummary, whatToDo: [] };
  }
}

async function estimatePlaceVisitWindows(candidates, aiApiKey, destinationContext = '') {
  if (!aiApiKey || !Array.isArray(candidates) || !candidates.length) {
    return [];
  }

  const prompt = [
    'You estimate realistic visit durations for travel itinerary stops.',
    destinationContext ? `Destination context: ${destinationContext}` : 'Destination context: unknown',
    'Use the place name, place type, category, editorial summary, review snippets, and common traveler behavior to infer how long an average visitor would spend there.',
    'Each candidate includes its full address. Use the actual place location, not just the venue name, when understanding what the stop is.',
    'The name matters: infer whether the place is likely a quick cafe, a major museum, a market hall, an observation deck, a temple complex, a scenic overlook, or a long-form attraction.',
    'Account for realistic dwell time including browsing, ordering, photos, short queues, walking the site, and transitions inside the venue when appropriate.',
    'Return ONLY JSON as an array in this exact shape:',
    '[{"id":"<place id>","minimumVisitMinutes":45,"recommendedVisitMinutes":75,"maximumVisitMinutes":105,"rationale":"<short reason>"}]',
    'Rules:',
    '- All minute values must be integers and multiples of 5.',
    '- recommendedVisitMinutes must be between minimumVisitMinutes and maximumVisitMinutes.',
    '- Do not give every place the same duration; tailor it to the actual venue.',
    '- Diners, bakeries, and coffee stops are usually shorter than museums, zoos, major parks, or large attractions.',
    '- Keep rationale short and concrete.',
    JSON.stringify(
      candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        fullLocation: [candidate.name, candidate.address].filter(Boolean).join(' - '),
        address: candidate.address || '',
        category: candidate.categoryLabel || candidate.categoryId || '',
        primaryType: candidate.primaryTypeDisplayName || candidate.primaryType || '',
        rating: candidate.rating,
        userRatingCount: candidate.userRatingCount,
        editorialSummary: candidate.editorialSummary || '',
        reviewSnippets: Array.isArray(candidate.reviewSnippets) ? candidate.reviewSnippets.slice(0, 2) : [],
        weekdayDescriptions: Array.isArray(candidate.weekdayDescriptions)
          ? candidate.weekdayDescriptions.slice(0, 2)
          : []
      }))
    )
  ].join('\n');

  const raw = await callGemini(aiApiKey, prompt);
  const parsed = parseJsonFromModelText(raw);
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.windows)
      ? parsed.windows
      : [];

  return rows.map((row) => ({
    id: String(row?.id || '').trim(),
    minimumVisitMinutes: Number(row?.minimumVisitMinutes),
    recommendedVisitMinutes: Number(row?.recommendedVisitMinutes),
    maximumVisitMinutes: Number(row?.maximumVisitMinutes),
    rationale: String(row?.rationale || '').trim(),
  })).filter((row) => row.id);
}

async function estimateTrafficAdjustedTravelTimes({
  candidates,
  aiApiKey,
  destinationContext = '',
  weekdayName = '',
  departureTimeLabel = '',
  originLabel = '',
}) {
  if (!aiApiKey || !Array.isArray(candidates) || !candidates.length) {
    return [];
  }

  const prompt = [
    'You estimate average traffic-adjusted drive times for travel itinerary legs.',
    destinationContext ? `Destination context: ${destinationContext}` : 'Destination context: unknown',
    weekdayName ? `Weekday: ${weekdayName}` : 'Weekday: unknown',
    departureTimeLabel ? `Departure time: ${departureTimeLabel}` : 'Departure time: unknown',
    originLabel ? `Origin area: ${originLabel}` : 'Origin area: unknown',
    'Each candidate includes a Google driving time baseline plus the stop address and type.',
    'Use typical traffic at that weekday and time of day to make a conservative average adjustment.',
    'Do not invent extreme delays. Use small or moderate adjustments unless the pattern is obviously rush-hour heavy.',
    'Return ONLY JSON as an array in this exact shape:',
    '[{"id":"<place id>","adjustedTravelMinutes":24,"multiplier":1.15,"rationale":"<short reason>"}]',
    'Rules:',
    '- adjustedTravelMinutes must be an integer.',
    '- multiplier must stay between 0.95 and 1.35 unless the baseline is clearly inconsistent with typical rush-hour traffic.',
    '- Keep rationale short and concrete.',
    JSON.stringify(
      candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        address: candidate.address || '',
        primaryType: candidate.primaryTypeDisplayName || candidate.primaryType || '',
        baselineTravelMinutes: candidate.travelMinutes,
      }))
    )
  ].join('\n');

  const raw = await callGemini(aiApiKey, prompt, {
    generationConfig: {
      temperature: 0.35,
      topP: 0.9,
    },
  });
  const parsed = parseJsonFromModelText(raw);
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.legs)
      ? parsed.legs
      : [];

  return rows
    .map((row) => ({
      id: String(row?.id || '').trim(),
      adjustedTravelMinutes: Number(row?.adjustedTravelMinutes),
      multiplier: Number(row?.multiplier),
      rationale: String(row?.rationale || '').trim(),
    }))
    .filter((row) => row.id);
}

module.exports = {
  callGemini,
  summarizePlaceExperience,
  estimatePlaceVisitWindows,
  estimateTrafficAdjustedTravelTimes,
};
