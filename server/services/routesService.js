const { parseDurationToMinutes } = require('../utils/time');

// Returns the driving time in minutes between two lat/lng points.
// Called for every candidate stop during planning to filter out places that
// would bust the remaining time budget before Gemini picks the best one.
async function getTravelMinutes(origin, destination, mapsApiKey, options = {}) {
  const requestBody = {
    origin: {
      location: { latLng: { latitude: origin.lat, longitude: origin.lng } }
    },
    destination: {
      location: { latLng: { latitude: destination.lat, longitude: destination.lng } }
    },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE'
  };

  if (options?.departureTime) {
    requestBody.departureTime = options.departureTime;
  }

  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsApiKey,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Routes API failed: ${err}`);
  }

  const data = await response.json();
  const durationText = data?.routes?.[0]?.duration;
  return parseDurationToMinutes(durationText);
}

// Computes a single encoded polyline covering all itinerary stops in order.
// Sent to the client so Background.jsx can draw the route on the Google Map
// once planning is complete.
async function computeRoutePolyline(stops, mapsApiKey) {
  if (!Array.isArray(stops) || stops.length < 2) {
    return '';
  }

  const toLatLng = (location) => ({
    latitude: Number(location.lat),
    longitude: Number(location.lng)
  });

  const origin = stops[0];
  const destination = stops[stops.length - 1];
  const intermediates = stops.slice(1, -1).map((stop) => ({
    location: { latLng: toLatLng(stop.location) }
  }));

  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsApiKey,
      'X-Goog-FieldMask': 'routes.polyline.encodedPolyline'
    },
    body: JSON.stringify({
      origin: { location: { latLng: toLatLng(origin.location) } },
      destination: { location: { latLng: toLatLng(destination.location) } },
      intermediates,
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE'
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Routes polyline build failed: ${err}`);
  }

  const data = await response.json();
  return data?.routes?.[0]?.polyline?.encodedPolyline || '';
}

module.exports = { getTravelMinutes, computeRoutePolyline };
