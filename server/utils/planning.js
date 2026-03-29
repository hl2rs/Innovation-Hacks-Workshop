// Extracts a JSON value from Gemini's raw text response.
// Tries direct parse first, then strips markdown fences, then finds the first
// { } or [ ] block. Throws if no valid JSON can be found.
function parseJsonFromModelText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) {
    throw new Error('Model returned empty text.');
  }

  try {
    return JSON.parse(text);
  } catch (directError) {
    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      return JSON.parse(fencedMatch[1]);
    }

    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(text.slice(objectStart, objectEnd + 1));
    }

    const arrayStart = text.indexOf('[');
    const arrayEnd = text.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
    }

    throw directError;
  }
}

// Collapses multiple spaces and trims a city name string.
function normalizeCityName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Coerces a rank value to a positive integer, using fallbackRank if invalid.
function normalizeRank(value, fallbackRank) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallbackRank;
  }
  return Math.round(parsed);
}

// Narrows a candidate list to the top 4 by composite score before sending to
// Gemini for the final pick. Higher rating/review count raises the score;
// long travel times and time-budget overruns lower it.
function pickTopCandidates(candidates, remainingMinutes) {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score:
        candidate.rating * 18 +
        Math.min(candidate.userRatingCount / 150, 8) -
        candidate.travelMinutes * 0.25 -
        Math.max(candidate.travelMinutes + candidate.suggestedVisitMinutes - remainingMinutes, 0)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

module.exports = { parseJsonFromModelText, normalizeCityName, normalizeRank, pickTopCandidates };
