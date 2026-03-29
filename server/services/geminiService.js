const { parseJsonFromModelText } = require('../utils/planning');
const { extractTextValue, toDisplayText } = require('../utils/placeFormatting');

const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Core wrapper for all Gemini generateContent calls. Used by:
//   - summarizePlaceExperience  → AI Overview for the place detail panel
//   - getPopularCitiesForCountry → city rank list when a country is entered
//   - planning/next & planning/build → selecting the best itinerary stop
//   - POST /api/gemini/chat → direct user chat messages from the UI
async function callGemini(apiKey, prompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      })
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

// Reads up to 5 user reviews + the editorial summary for a place and asks
// Gemini to produce a short AI Overview paragraph and a "What to do" list.
// Called inside getPlaceDetails after fetching from the Places API.
async function summarizePlaceExperience(place, aiApiKey) {
  const reviewSnippets = Array.isArray(place?.reviews)
    ? place.reviews
        .map((review) => extractTextValue(review?.originalText || review?.text))
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const editorialSummary = extractTextValue(place?.editorialSummary);

  if (!aiApiKey || (!reviewSnippets.length && !editorialSummary)) {
    return { aiOverview: editorialSummary, whatToDo: [] };
  }

  const prompt = [
    'You are writing an AI Overview for a travel stop.',
    'Return ONLY JSON in this shape: {"aiOverview":"short paragraph","whatToDo":["item 1","item 2","item 3"]}.',
    `Place name: ${extractTextValue(place?.displayName) || 'Unknown place'}`,
    `Primary type: ${toDisplayText(place?.primaryTypeDisplayName?.text || place?.primaryType || '')}`,
    `Editorial summary: ${editorialSummary || 'None'}`,
    'Use the editorial summary and review snippets to explain what the place is like, what visitors actually do there, and what kind of time commitment it feels like.',
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

module.exports = { callGemini, summarizePlaceExperience };
