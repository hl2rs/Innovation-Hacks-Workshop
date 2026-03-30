// Constructs the authenticated Places API (New) media URL for a photo resource
// name. Called when building candidate stops, city suggestion cards, and the
// detailed stop panel photos.
function buildPlacePhotoUrl(photoName, mapsApiKey, maxHeightPx = 420, maxWidthPx = 720) {
  const normalized = String(photoName || '').trim();
  if (!normalized || !mapsApiKey) {
    return '';
  }
  return `https://places.googleapis.com/v1/${normalized}/media?maxHeightPx=${maxHeightPx}&maxWidthPx=${maxWidthPx}&key=${mapsApiKey}`;
}

// Converts snake_case or kebab-case type identifiers into readable text.
// e.g. "tourist_attraction" → "tourist attraction"
function toDisplayText(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Maps the Places API PRICE_LEVEL_* enum to a dollar-sign display string.
function formatPriceLevel(priceLevel) {
  const normalized = String(priceLevel || '').trim();
  const priceMap = {
    PRICE_LEVEL_FREE: 'Free',
    PRICE_LEVEL_INEXPENSIVE: '$',
    PRICE_LEVEL_MODERATE: '$$',
    PRICE_LEVEL_EXPENSIVE: '$$$',
    PRICE_LEVEL_VERY_EXPENSIVE: '$$$$'
  };
  return priceMap[normalized] || '';
}

// Safely extracts a plain string from Places API fields that may be either a
// raw string or an object with a nested .text property (e.g. displayName, editorialSummary).
function extractTextValue(value) {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value?.text === 'string') {
    return value.text.trim();
  }
  return '';
}

// Scans the boolean amenity fields on a Places API place object and returns up
// to 8 human-readable highlight labels (e.g. "Outdoor seating", "Takeout available").
// These appear as chips in TripStopDetailsPanel.
function buildPlaceHighlights(place) {
  const highlights = [];
  const pushHighlight = (condition, label) => {
    if (condition) {
      highlights.push(label);
    }
  };

  pushHighlight(place?.goodForChildren, 'Good for children');
  pushHighlight(place?.outdoorSeating, 'Outdoor seating');
  pushHighlight(place?.liveMusic, 'Live music');
  pushHighlight(place?.menuForChildren, 'Kids menu');
  pushHighlight(place?.reservable, 'Reservations available');
  pushHighlight(place?.takeout, 'Takeout available');
  pushHighlight(place?.delivery, 'Delivery available');
  pushHighlight(place?.dineIn, 'Dine-in available');
  pushHighlight(place?.servesCoffee, 'Coffee served');
  pushHighlight(place?.servesDessert, 'Dessert served');
  pushHighlight(place?.servesBeer, 'Beer served');
  pushHighlight(place?.servesWine, 'Wine served');
  pushHighlight(place?.servesBreakfast, 'Breakfast served');
  pushHighlight(place?.servesLunch, 'Lunch served');
  pushHighlight(place?.servesDinner, 'Dinner served');

  if (place?.paymentOptions?.acceptsCreditCards) {
    highlights.push('Accepts credit cards');
  }
  if (place?.parkingOptions?.freeParkingLot) {
    highlights.push('Free parking lot');
  }
  if (place?.parkingOptions?.paidParkingLot) {
    highlights.push('Paid parking lot');
  }

  return highlights.slice(0, 8);
}

module.exports = { buildPlacePhotoUrl, toDisplayText, formatPriceLevel, extractTextValue, buildPlaceHighlights };
