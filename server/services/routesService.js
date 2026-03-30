const { parseDurationToMinutes } = require('../utils/time');

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function hasValidLatLng(point) {
  return (
    point &&
    Number.isFinite(Number(point.lat)) &&
    Number.isFinite(Number(point.lng))
  );
}

function estimateApproximateTravelMinutes(origin, destination) {
  if (!hasValidLatLng(origin) || !hasValidLatLng(destination)) {
    return 20;
  }

  const earthRadiusKm = 6371;
  const lat1 = toRadians(origin.lat);
  const lat2 = toRadians(destination.lat);
  const deltaLat = toRadians(Number(destination.lat) - Number(origin.lat));
  const deltaLng = toRadians(Number(destination.lng) - Number(origin.lng));
  const haversineA =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const distanceKm = earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversineA), Math.sqrt(1 - haversineA));

  const estimatedMinutes = distanceKm < 1
    ? 6 + distanceKm * 8
    : 8 + distanceKm * 4.8;

  return Math.max(5, Math.min(120, Math.round(estimatedMinutes)));
}

function isRecoverableRouteError(message) {
  return /timestamp must be set to a future time|could not compute route|no route|no routes|not reachable|route not found|zero results|failed_precondition/i.test(
    String(message || '')
  );
}

async function requestRouteDuration(requestBody, mapsApiKey) {
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
  return parseDurationToMinutes(data?.routes?.[0]?.duration);
}

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

  try {
    return await requestRouteDuration(requestBody, mapsApiKey);
  } catch (error) {
    let latestError = error;
    const errorMessage = String(latestError?.message || '');
    const hasInvalidFutureTimestamp =
      Boolean(options?.departureTime) &&
      /Timestamp must be set to a future time/i.test(errorMessage);

    if (hasInvalidFutureTimestamp) {
      const safeFutureDepartureTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      try {
        return await requestRouteDuration(
          {
            ...requestBody,
            departureTime: safeFutureDepartureTime,
          },
          mapsApiKey,
        );
      } catch (retryError) {
        latestError = retryError;
      }
    }

    if (options?.allowApproximateFallback && isRecoverableRouteError(latestError?.message)) {
      return estimateApproximateTravelMinutes(origin, destination);
    }

    throw latestError;
  }
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
