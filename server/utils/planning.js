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

function clampMinutes(value, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return minimum;
  }
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function clampNumber(value, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return minimum;
  }
  return Math.max(minimum, Math.min(maximum, parsed));
}

function normalizeTextKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCandidateTypeKey(candidate) {
  return normalizeTextKey(
    candidate?.primaryTypeDisplayName || candidate?.primaryType || candidate?.categoryId || ''
  );
}

function getCandidateAreaKey(candidate) {
  const address = String(candidate?.address || '').trim();
  if (!address) {
    return '';
  }

  const parts = address
    .split(',')
    .map((part) => normalizeTextKey(part))
    .filter(Boolean);

  if (!parts.length) {
    return '';
  }

  return parts.slice(0, 2).join(' | ');
}

function countItineraryMatches(itinerary, predicate) {
  return itinerary.reduce((count, stop) => (predicate(stop) ? count + 1 : count), 0);
}

function shuffleArray(values) {
  const copy = [...values];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = temp;
  }

  return copy;
}

function computeReviewSnippetSignal(candidate) {
  const snippets = Array.isArray(candidate?.reviewSnippets) ? candidate.reviewSnippets : [];
  if (!snippets.length) {
    return 0;
  }

  const positivePattern = /(excellent|amazing|incredible|beautiful|stunning|favorite|fantastic|worth it|must[- ]see|memorable|delicious|outstanding|great atmosphere|highly recommend)/i;
  const negativePattern = /(overrated|crowded|skip|avoid|disappointing|poor|rude|dirty|expensive for|not worth|tourist trap|long wait|bad service)/i;

  return snippets.reduce((score, review) => {
    const text = String(review?.text || '').trim();
    const rating = Number(review?.rating || 0);
    let nextScore = score;

    if (rating >= 4.5) nextScore += 1.6;
    else if (rating >= 4) nextScore += 0.9;
    else if (rating > 0 && rating <= 2.5) nextScore -= 1.3;

    if (positivePattern.test(text)) nextScore += 1.2;
    if (negativePattern.test(text)) nextScore -= 1.6;

    return nextScore;
  }, 0);
}

function computeCandidatePriorityScore(candidate, remainingMinutes, itinerary = []) {
  const isFirstLeg = !Array.isArray(itinerary) || itinerary.length === 0;
  const rating = clampNumber(candidate?.rating, 0, 5);
  const travelMinutes = Math.max(0, Number(candidate?.travelMinutes || 0));
  const recommendedVisitMinutes = Math.max(30, Number(candidate?.recommendedVisitMinutes || candidate?.suggestedVisitMinutes || 75));
  const minimumVisitMinutes = Math.max(30, Number(candidate?.minimumVisitMinutes || 30));
  const totalMinutes = travelMinutes + recommendedVisitMinutes;
  const remaining = Math.max(1, Number(remainingMinutes || 1));
  const reviewSnippetSignal = computeReviewSnippetSignal(candidate);
  const ratingScore = Math.pow(rating / 5, 1.8) * 44;
  const weakRatingPenalty =
    rating < 3.8
      ? 18
      : rating < 4.1
        ? 10
        : rating < 4.3
          ? 4
          : 0;
  const travelEfficiencyScore = isFirstLeg
    ? Math.max(-6, 6 - travelMinutes * 0.12)
    : Math.max(-16, 16 - travelMinutes * 0.42);
  const fitRatio = totalMinutes / remaining;
  const fitScore =
    fitRatio <= 0.22
      ? 4
      : fitRatio <= 0.58
        ? 10
        : fitRatio <= 0.78
          ? 6
          : fitRatio <= 1
            ? 1
            : -18;
  const minimumFitPenalty =
    travelMinutes + minimumVisitMinutes > remaining
      ? 25
      : 0;
  const openNowScore =
    candidate?.openNow === true
      ? 3
      : candidate?.openNow === false
        ? -12
        : 0;
  const editorialScore = candidate?.editorialSummary ? 2.5 : 0;
  const candidateCategoryKey = normalizeTextKey(candidate?.categoryId);
  const candidateTypeKey = getCandidateTypeKey(candidate);
  const candidateAreaKey = getCandidateAreaKey(candidate);
  const repeatedCategoryCount = countItineraryMatches(
    itinerary,
    (stop) => normalizeTextKey(stop?.categoryId) === candidateCategoryKey,
  );
  const repeatedTypeCount = candidateTypeKey
    ? countItineraryMatches(itinerary, (stop) => getCandidateTypeKey(stop) === candidateTypeKey)
    : 0;
  const repeatedAreaCount = candidateAreaKey
    ? countItineraryMatches(itinerary, (stop) => getCandidateAreaKey(stop) === candidateAreaKey)
    : 0;
  const repeatedCategoryPenalty = repeatedCategoryCount * 6;
  const repeatedTypePenalty = repeatedTypeCount * 4.5;
  const repeatedAreaPenalty = repeatedAreaCount * 5;
  const varietyBoost = repeatedCategoryCount === 0 ? 3.5 : repeatedCategoryCount === 1 ? 0.5 : 0;

  const score =
    ratingScore +
    reviewSnippetSignal +
    travelEfficiencyScore +
    fitScore +
    openNowScore +
    varietyBoost +
    editorialScore -
    weakRatingPenalty -
    minimumFitPenalty -
    repeatedCategoryPenalty -
    repeatedTypePenalty -
    repeatedAreaPenalty;

  return {
    score,
    signals: {
      ratingScore: Number(ratingScore.toFixed(2)),
      reviewSnippetSignal: Number(reviewSnippetSignal.toFixed(2)),
      travelEfficiencyScore: Number(travelEfficiencyScore.toFixed(2)),
      fitScore,
      openNowScore,
      varietyBoost,
      editorialScore,
      weakRatingPenalty,
      repeatedCategoryPenalty,
      repeatedTypePenalty: Number(repeatedTypePenalty.toFixed(2)),
      repeatedAreaPenalty,
    },
  };
}

function estimateVisitWindow(candidate) {
  const baseVisitMinutes = Math.max(30, Number(candidate?.suggestedVisitMinutes || 75));
  const haystack = [
    candidate?.name,
    candidate?.primaryType,
    candidate?.primaryTypeDisplayName,
    candidate?.categoryId,
  ]
    .join(' ')
    .toLowerCase();

  let minimumVisitMinutes = Math.max(30, baseVisitMinutes - 20);
  let recommendedVisitMinutes = baseVisitMinutes;
  let maximumVisitMinutes = Math.max(recommendedVisitMinutes + 20, baseVisitMinutes + 35);
  let rationale = 'Balanced stop length based on the selected category.';

  if (/(restaurant|cafe|coffee|brunch|diner|bistro|bakery|food|tea|dessert)/.test(haystack)) {
    minimumVisitMinutes = 40;
    recommendedVisitMinutes = 65;
    maximumVisitMinutes = 95;
    rationale = 'Dining stops usually work best with enough time to order, eat, and pause.';
  } else if (/(bar|pub|club|nightlife|cocktail|speakeasy|live music|jazz)/.test(haystack)) {
    minimumVisitMinutes = 60;
    recommendedVisitMinutes = 95;
    maximumVisitMinutes = 140;
    rationale = 'Nightlife stops usually need a longer dwell time to be worthwhile.';
  } else if (/(museum|gallery|exhibit|arts?|culture|science center)/.test(haystack)) {
    minimumVisitMinutes = 75;
    recommendedVisitMinutes = 105;
    maximumVisitMinutes = 150;
    rationale = 'Museums and galleries usually need longer browsing time.';
  } else if (/(park|garden|beach|trail|hike|viewpoint|overlook|outdoor|nature)/.test(haystack)) {
    minimumVisitMinutes = 50;
    recommendedVisitMinutes = 85;
    maximumVisitMinutes = 125;
    rationale = 'Outdoor stops need buffer for walking, views, and unstructured time.';
  } else if (/(market|mall|shopping|bazaar|outlet)/.test(haystack)) {
    minimumVisitMinutes = 45;
    recommendedVisitMinutes = 80;
    maximumVisitMinutes = 120;
    rationale = 'Shopping areas need enough time to browse without rushing.';
  } else if (/(zoo|aquarium|theme park|amusement|studio tour|water park|safari)/.test(haystack)) {
    minimumVisitMinutes = 120;
    recommendedVisitMinutes = 150;
    maximumVisitMinutes = 210;
    rationale = 'Large attractions usually require the longest visit windows.';
  } else if (/(temple|church|cathedral|shrine|monument|memorial|tower|palace|castle|historic|landmark)/.test(haystack)) {
    minimumVisitMinutes = 35;
    recommendedVisitMinutes = 60;
    maximumVisitMinutes = 95;
    rationale = 'Landmarks are often shorter but still need time for arrival, photos, and context.';
  } else if (/(escape|adventure|climb|rafting|kayak|surf|kart|zipline|activity)/.test(haystack)) {
    minimumVisitMinutes = 90;
    recommendedVisitMinutes = 120;
    maximumVisitMinutes = 165;
    rationale = 'Hands-on activities usually take longer once prep and queue time are included.';
  }

  recommendedVisitMinutes = clampMinutes(recommendedVisitMinutes, minimumVisitMinutes, maximumVisitMinutes);

  return {
    minimumVisitMinutes,
    recommendedVisitMinutes,
    maximumVisitMinutes,
    visitDurationRationale: rationale,
  };
}

function computeSearchCandidateScore(candidate) {
  const rating = clampNumber(candidate?.rating, 0, 5);
  const ratingScore = Math.pow(rating / 5, 1.7) * 36;
  const weakRatingPenalty =
    rating < 3.8
      ? 16
      : rating < 4.1
        ? 8
        : rating < 4.3
          ? 3
          : 0;

  return ratingScore - weakRatingPenalty;
}

function pickCandidatesForTravelEstimates(candidates, limit = 10) {
  const scoredCandidates = shuffleArray(candidates)
    .map((candidate) => ({
      ...candidate,
      searchScore: computeSearchCandidateScore(candidate),
    }))
    .sort((a, b) => b.searchScore - a.searchScore);

  if (!scoredCandidates.length) {
    return [];
  }

  const selected = [];
  const categoryCounts = new Map();
  const typeCounts = new Map();
  const areaCounts = new Map();
  const targetCount = Math.min(limit, scoredCandidates.length);
  const workingPool = [...scoredCandidates];

  while (workingPool.length && selected.length < targetCount) {
    workingPool.sort((left, right) => {
      const leftCategoryKey = normalizeTextKey(left.categoryId);
      const rightCategoryKey = normalizeTextKey(right.categoryId);
      const leftTypeKey = getCandidateTypeKey(left);
      const rightTypeKey = getCandidateTypeKey(right);
      const leftAreaKey = getCandidateAreaKey(left);
      const rightAreaKey = getCandidateAreaKey(right);
      const leftDiversityPenalty =
        (categoryCounts.get(leftCategoryKey) || 0) * 3.5 +
        (typeCounts.get(leftTypeKey) || 0) * 2.5 +
        (areaCounts.get(leftAreaKey) || 0) * 3;
      const rightDiversityPenalty =
        (categoryCounts.get(rightCategoryKey) || 0) * 3.5 +
        (typeCounts.get(rightTypeKey) || 0) * 2.5 +
        (areaCounts.get(rightAreaKey) || 0) * 3;
      const leftSelectionScore = left.searchScore - leftDiversityPenalty + (Math.random() - 0.5) * 6;
      const rightSelectionScore = right.searchScore - rightDiversityPenalty + (Math.random() - 0.5) * 6;
      return rightSelectionScore - leftSelectionScore;
    });

    const nextCandidate = workingPool.shift();
    if (!nextCandidate) {
      break;
    }

    const categoryKey = normalizeTextKey(nextCandidate.categoryId);
    const typeKey = getCandidateTypeKey(nextCandidate);
    const areaKey = getCandidateAreaKey(nextCandidate);
    const categoryCount = categoryCounts.get(categoryKey) || 0;
    const typeCount = typeCounts.get(typeKey) || 0;
    const areaCount = areaCounts.get(areaKey) || 0;

    if (categoryCount >= 3 || typeCount >= 2) {
      continue;
    }

    if (areaKey && areaCount >= 2 && Math.random() < 0.75) {
      continue;
    }

    selected.push(nextCandidate);
    categoryCounts.set(categoryKey, categoryCount + 1);
    typeCounts.set(typeKey, typeCount + 1);
    if (areaKey) {
      areaCounts.set(areaKey, areaCount + 1);
    }
  }

  if (selected.length < targetCount) {
    scoredCandidates.forEach((candidate) => {
      if (selected.length >= targetCount || selected.some((selectedCandidate) => selectedCandidate.id === candidate.id)) {
        return;
      }

      selected.push(candidate);
    });
  }

  return selected.map(({ searchScore, ...candidate }) => candidate);
}

// ADD pickTopCandidates // 

module.exports = {
  clampMinutes,
  computeCandidatePriorityScore,
  estimateVisitWindow,
  parseJsonFromModelText,
  normalizeCityName,
  normalizeRank,
  pickCandidatesForTravelEstimates,
  pickTopCandidates,
};
