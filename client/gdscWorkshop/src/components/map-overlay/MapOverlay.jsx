import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./MapOverlay.css";
import { createMapCityCardElement } from "../map-city-card/MapCityCard";
import { TravelStopRecommendationMapOverlay } from "../travel-stop-recommendation/TravelStopRecommendation";

export default function MapOverlay({
  onCitySelect,
  hoveredRecommendedCityKey,
  mapsReady,
  mapsError,
  planningInProgress,
  plannedItinerary,
  routePolyline,
  selectedCityFocusToken,
  selectedCountry,
  selectedCountryCode,
  selectedCity,
  recommendedCities,
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const geocoderRef = useRef(null);
  const hoveredRecommendedCityKeyRef = useRef('');
  const cityOverlaysRef = useRef([]);
  const itineraryOverlaysRef = useRef([]);
  const itineraryRevealTimersRef = useRef([]);
  const cameraSequenceTimersRef = useRef([]);
  const cameraSequenceTokenRef = useRef(0);
  const cityDotsRef = useRef([]);
  const cityCardElementsRef = useRef(new Map());
  const zoomTimerRef = useRef(null);
  const cameraFlightFrameRef = useRef(null);
  const manualCameraFlightRef = useRef(false);
  const lastFocusedCityRequestRef = useRef('');
  const cityFocusRequestTokenRef = useRef(0);
  const routeGlowPolylineRef = useRef(null);
  const routePolylineRef = useRef(null);
  const routeAnimationFrameRef = useRef(null);
  const visibleRoutePointCountRef = useRef(0);
  const renderedRoutePolylineRef = useRef('');
  const hasRecommendations = Array.isArray(recommendedCities) && recommendedCities.length > 0;
  const hasPlannedItinerary = Array.isArray(plannedItinerary) && plannedItinerary.length > 0;
  const allowMapExploration = hasPlannedItinerary && !planningInProgress;
  const isWorldOverview = !selectedCity && !hasRecommendations;

  const getItineraryStopKey = (stop, index) => `${stop.placeId || stop.name || 'stop'}-${index}`;

  const clearItineraryOverlays = () => {
    itineraryOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    itineraryOverlaysRef.current = [];
  };

  const clearItineraryRevealTimers = () => {
    itineraryRevealTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    itineraryRevealTimersRef.current = [];
  };

  const clearRouteAnimation = () => {
    if (routeAnimationFrameRef.current) {
      window.cancelAnimationFrame(routeAnimationFrameRef.current);
      routeAnimationFrameRef.current = null;
    }
  };

  const clearRoutePolylines = () => {
    clearRouteAnimation();
    routeGlowPolylineRef.current?.setMap(null);
    routePolylineRef.current?.setMap(null);
    routeGlowPolylineRef.current = null;
    routePolylineRef.current = null;
    visibleRoutePointCountRef.current = 0;
    renderedRoutePolylineRef.current = '';
  };

  const clearCameraAnimation = () => {
    if (zoomTimerRef.current) {
      window.clearTimeout(zoomTimerRef.current);
      zoomTimerRef.current = null;
    }

    if (cameraFlightFrameRef.current) {
      window.cancelAnimationFrame(cameraFlightFrameRef.current);
      cameraFlightFrameRef.current = null;
    }

    manualCameraFlightRef.current = false;
  };

  const clearCameraSequence = () => {
    cameraSequenceTokenRef.current += 1;
    clearCameraAnimation();
    cameraSequenceTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    cameraSequenceTimersRef.current = [];
  };

  const queueCameraStep = (callback, delay) => {
    const timerId = window.setTimeout(() => {
      cameraSequenceTimersRef.current = cameraSequenceTimersRef.current.filter(
        (activeTimerId) => activeTimerId !== timerId,
      );
      callback();
    }, delay);

    cameraSequenceTimersRef.current.push(timerId);
    return timerId;
  };

  const lockMapTo2D = (map) => {
    if (!map) return;

    if (Number(map.getTilt?.() || 0) !== 0) {
      map.setTilt(0);
    }

    if (Number(map.getHeading?.() || 0) !== 0) {
      map.setHeading(0);
    }
  };

  const syncMapViewport = (map, callback, delay = 72) => {
    if (!map || !window.google?.maps?.event) {
      if (typeof callback === "function") {
        callback();
      }
      return;
    }

    const center = map.getCenter();
    const zoom = map.getZoom();
    window.google.maps.event.trigger(map, "resize");

    if (center) {
      map.setCenter(center);
    }

    if (Number.isFinite(Number(zoom))) {
      map.setZoom(Number(zoom));
    }

    lockMapTo2D(map);

    if (typeof callback === "function") {
      queueCameraStep(callback, delay);
    }
  };

  const refreshMapResolution = (map, centerOverride) => {
    if (!map || !window.google?.maps?.event) {
      return;
    }

    const currentCenter = centerOverride || getMapCenterLiteral(map, { lat: 28, lng: 1 });
    const currentZoom = Number(map.getZoom() || 0);
    window.google.maps.event.trigger(map, "resize");
    map.setCenter(currentCenter);

    if (Number.isFinite(currentZoom)) {
      map.setZoom(currentZoom);
    }

    lockMapTo2D(map);
  };

  const animateZoomTo = (map, targetZoom, stepDelay = 72, onComplete, options = {}) => {
    clearCameraAnimation();

    const {
      centerOn = null,
      refreshResolution = false,
    } = options;

    const step = () => {
      const currentZoom = Number(map.getZoom() || 0);

      if (currentZoom === targetZoom) {
        zoomTimerRef.current = null;
        if (typeof onComplete === "function") {
          onComplete();
        }
        return;
      }

      const nextZoom =
        currentZoom < targetZoom
          ? Math.min(currentZoom + 1, targetZoom)
          : Math.max(currentZoom - 1, targetZoom);

      if (centerOn) {
        map.setCenter(centerOn);
      }

      map.setZoom(nextZoom);

      if (refreshResolution) {
        refreshMapResolution(map, centerOn || undefined);
      }

      zoomTimerRef.current = window.setTimeout(step, stepDelay);
    };

    step();
  };

  const lerp = (start, end, progress) => start + (end - start) * progress;

  const decodeRoutePolyline = (encoded) => {
    const path = [];
    let index = 0;
    let latitude = 0;
    let longitude = 0;

    while (index < encoded.length) {
      let shift = 0;
      let result = 0;
      let byte;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
      latitude += deltaLat;

      shift = 0;
      result = 0;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
      longitude += deltaLng;

      path.push({
        lat: latitude / 1e5,
        lng: longitude / 1e5,
      });
    }

    return path;
  };

  const easeInOutCubic = (progress) => {
    if (progress < 0.5) {
      return 4 * progress * progress * progress;
    }

    return 1 - Math.pow(-2 * progress + 2, 3) / 2;
  };

  const getMapCenterLiteral = (map, fallback) => {
    const center = map?.getCenter?.();
    const lat = Number(center?.lat?.() ?? fallback?.lat ?? 0);
    const lng = Number(center?.lng?.() ?? fallback?.lng ?? 0);

    return { lat, lng };
  };

  const getHeadingDelta = (startHeading, endHeading) => {
    const normalizedStart = Number.isFinite(Number(startHeading)) ? Number(startHeading) : 0;
    const normalizedEnd = Number.isFinite(Number(endHeading)) ? Number(endHeading) : 0;
    return ((normalizedEnd - normalizedStart + 540) % 360) - 180;
  };

  const moveCamera = (map, cameraOptions) => {
    const normalizedCameraOptions = {
      ...cameraOptions,
      tilt: 0,
      heading: 0,
    };

    if (typeof map.moveCamera === "function") {
      map.moveCamera(normalizedCameraOptions);
      return;
    }

    if (normalizedCameraOptions.center) {
      map.setCenter(normalizedCameraOptions.center);
    }

    if (Number.isFinite(Number(normalizedCameraOptions.zoom))) {
      map.setZoom(Number(normalizedCameraOptions.zoom));
    }

    lockMapTo2D(map);
  };

  const ensureRoutePolylines = (map) => {
    if (!routeGlowPolylineRef.current) {
      routeGlowPolylineRef.current = new window.google.maps.Polyline({
        map,
        path: [],
        geodesic: true,
        clickable: false,
        strokeColor: '#ffd7ad',
        strokeOpacity: 0.32,
        strokeWeight: 10,
        zIndex: 2200,
      });
    }

    if (!routePolylineRef.current) {
      routePolylineRef.current = new window.google.maps.Polyline({
        map,
        path: [],
        geodesic: true,
        clickable: false,
        strokeColor: '#ff8a1f',
        strokeOpacity: 0.96,
        strokeWeight: 5,
        zIndex: 2300,
      });
    }
  };

  const setRenderedRoutePath = (path) => {
    routeGlowPolylineRef.current?.setPath(path);
    routePolylineRef.current?.setPath(path);
  };

  const animateRenderedRoute = (map, encodedPolyline) => {
    if (!window.google?.maps || !encodedPolyline) {
      clearRoutePolylines();
      return;
    }

    if (renderedRoutePolylineRef.current === encodedPolyline) {
      return;
    }

    const decodedPath = decodeRoutePolyline(encodedPolyline);
    if (decodedPath.length < 2) {
      clearRoutePolylines();
      return;
    }

    ensureRoutePolylines(map);
    clearRouteAnimation();

    const previousVisibleCount = Math.min(
      visibleRoutePointCountRef.current,
      decodedPath.length,
    );
    const startCount = previousVisibleCount > 1 ? previousVisibleCount : Math.min(2, decodedPath.length);
    const endCount = decodedPath.length;

    if (endCount <= startCount) {
      setRenderedRoutePath(decodedPath);
      visibleRoutePointCountRef.current = endCount;
      renderedRoutePolylineRef.current = encodedPolyline;
      return;
    }

    const duration = Math.min(4200, Math.max(1500, (endCount - startCount) * 30));
    const startedAt = performance.now();

    const step = (now) => {
      const rawProgress = Math.min((now - startedAt) / duration, 1);
      const easedProgress = easeInOutCubic(rawProgress);
      const nextCount = Math.max(
        Math.min(2, decodedPath.length),
        Math.floor(lerp(startCount, endCount, easedProgress)),
      );

      setRenderedRoutePath(decodedPath.slice(0, nextCount));

      if (rawProgress < 1) {
        routeAnimationFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      routeAnimationFrameRef.current = null;
      setRenderedRoutePath(decodedPath);
      visibleRoutePointCountRef.current = endCount;
      renderedRoutePolylineRef.current = encodedPolyline;
    };

    routeAnimationFrameRef.current = window.requestAnimationFrame(step);
  };

  const animateCameraFlight = (map, destination, options = {}) => {
    const {
      duration = 2200,
      onComplete,
    } = options;

    clearCameraAnimation();
    manualCameraFlightRef.current = true;

    const fallbackCenter = destination.center || { lat: 28, lng: 1 };
    const startCenter = getMapCenterLiteral(map, fallbackCenter);
    const endCenter = {
      lat: Number(destination.center?.lat ?? startCenter.lat),
      lng: Number(destination.center?.lng ?? startCenter.lng),
    };
    const startZoom = Number(map.getZoom() ?? 4);
    const endZoom = Number(destination.zoom ?? startZoom);
    const startTilt = Number(map.getTilt() ?? 0);
    const endTilt = Number(destination.tilt ?? startTilt);
    const startHeading = Number(map.getHeading() ?? 0);
    const headingDelta = getHeadingDelta(startHeading, destination.heading ?? startHeading);
    const startedAt = performance.now();

    const step = (now) => {
      const rawProgress = Math.min((now - startedAt) / duration, 1);
      const easedProgress = easeInOutCubic(rawProgress);

      moveCamera(map, {
        center: {
          lat: lerp(startCenter.lat, endCenter.lat, easedProgress),
          lng: lerp(startCenter.lng, endCenter.lng, easedProgress),
        },
        zoom: lerp(startZoom, endZoom, easedProgress),
        tilt: lerp(startTilt, endTilt, easedProgress),
        heading: startHeading + headingDelta * easedProgress,
      });

      applyCameraForZoom(map, lerp(startZoom, endZoom, easedProgress), { preserveOrientation: true });

      if (rawProgress < 1) {
        cameraFlightFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      manualCameraFlightRef.current = false;
      cameraFlightFrameRef.current = null;
      moveCamera(map, {
        center: endCenter,
        zoom: endZoom,
        tilt: endTilt,
        heading: startHeading + headingDelta,
      });
      applyCameraForZoom(map, endZoom, { preserveOrientation: true });

      if (typeof onComplete === "function") {
        onComplete();
      }
    };

    cameraFlightFrameRef.current = window.requestAnimationFrame(step);
  };

  const getRecommendedCitiesTargetZoom = (bounds, fitZoom) => {
    if (!bounds) {
      return Math.max(4, Math.min(8, fitZoom || 4));
    }

    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    const latSpan = Math.abs(northEast.lat() - southWest.lat());
    const lngSpan = Math.abs(northEast.lng() - southWest.lng());
    const maxSpan = Math.max(latSpan, lngSpan);

    let minimumZoom = 5;
    if (maxSpan <= 0.8) {
      minimumZoom = 10;
    } else if (maxSpan <= 1.6) {
      minimumZoom = 9;
    } else if (maxSpan <= 3.5) {
      minimumZoom = 8;
    } else if (maxSpan <= 7) {
      minimumZoom = 7;
    } else if (maxSpan <= 12) {
      minimumZoom = 6;
    }

    return Math.max(minimumZoom, Math.min(10, (fitZoom || 4) + 1));
  };

  const getBoundsMaxSpan = (bounds) => {
    if (!bounds) {
      return null;
    }

    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    const latSpan = Math.abs(northEast.lat() - southWest.lat());
    const lngSpan = Math.abs(northEast.lng() - southWest.lng());

    return Math.max(latSpan, lngSpan);
  };

  const getCityFocusTargetZoom = (cityBounds, fallbackZoom) => {
    const citySpan = getBoundsMaxSpan(cityBounds);

    if (!Number.isFinite(citySpan)) {
      return Math.max(10.4, Math.min(14.8, fallbackZoom || 12.4));
    }

    if (citySpan <= 0.03) return 15.4;
    if (citySpan <= 0.08) return 14.6;
    if (citySpan <= 0.16) return 13.9;
    if (citySpan <= 0.35) return 13.1;
    if (citySpan <= 0.7) return 12.3;
    if (citySpan <= 1.3) return 11.6;
    if (citySpan <= 2.2) return 10.9;
    if (citySpan <= 3.8) return 10.2;
    return 9.6;
  };

  const getCityFocusGeometry = (city) => {
    if (!city || !geocoderRef.current || !window.google?.maps) {
      return Promise.resolve(null);
    }

    const queries = [city.formattedAddress, city.name]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index);

    if (!queries.length) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const runLookup = (queryIndex) => {
        if (queryIndex >= queries.length) {
          resolve(null);
          return;
        }

        const request = {
          address: queries[queryIndex],
        };

        if (selectedCountryCode) {
          request.componentRestrictions = {
            country: String(selectedCountryCode).toLowerCase(),
          };
        }

        geocoderRef.current.geocode(request, (results, status) => {
          if (status !== "OK" || !Array.isArray(results) || !results.length) {
            runLookup(queryIndex + 1);
            return;
          }

          const geometry = results[0]?.geometry;
          const sourceBounds = geometry?.bounds || geometry?.viewport || null;
          const location = geometry?.location;

          resolve({
            center: {
              lat: Number(location?.lat?.() ?? city.lat),
              lng: Number(location?.lng?.() ?? city.lng),
            },
            bounds: sourceBounds
              ? new window.google.maps.LatLngBounds(
                  sourceBounds.getSouthWest(),
                  sourceBounds.getNorthEast(),
                )
              : null,
          });
        });
      };

      runLookup(0);
    });
  };

  const getCountryTargetZoom = (countryBounds, cityBounds, fitZoom) => {
    const countrySpan = getBoundsMaxSpan(countryBounds);
    const citySpan = getBoundsMaxSpan(cityBounds);

    if (!Number.isFinite(countrySpan)) {
      return Math.max(4.8, Math.min(8.2, (fitZoom || 4) + 1.2));
    }

    let minimumZoom = 4.4;
    if (countrySpan <= 3) {
      minimumZoom = 7.2;
    } else if (countrySpan <= 6) {
      minimumZoom = 6.6;
    } else if (countrySpan <= 10) {
      minimumZoom = 6;
    } else if (countrySpan <= 18) {
      minimumZoom = 5.5;
    } else if (countrySpan <= 28) {
      minimumZoom = 5.1;
    } else if (countrySpan <= 42) {
      minimumZoom = 4.7;
    }

    let zoomBoost = 1.1;
    if (Number.isFinite(citySpan) && citySpan > 0) {
      const clusteringRatio = countrySpan / citySpan;
      if (clusteringRatio >= 12) {
        zoomBoost = 1.8;
      } else if (clusteringRatio >= 7) {
        zoomBoost = 1.5;
      } else if (clusteringRatio >= 4) {
        zoomBoost = 1.3;
      }
    }

    return Math.max(minimumZoom, Math.min(8.4, (fitZoom || 4) + zoomBoost));
  };

  const applyCameraForZoom = (map, zoomOverride, options = {}) => {
    if (!map) return;
    const zoom = Number(zoomOverride ?? map.getZoom() ?? 0);

    cityDotsRef.current.forEach((dot) => {
      dot.setRadius(getCityDotRadiusForZoom(zoom));
      dot.setOptions({
        strokeWeight: zoom >= 12 ? 0.9 : zoom >= 10 ? 1.1 : zoom >= 7 ? 1.5 : 2,
      });
    });

    lockMapTo2D(map);
  };

  const getCityDotRadiusForZoom = (zoomLevel) => {
    const zoom = Number.isFinite(Number(zoomLevel)) ? Number(zoomLevel) : 4;
    const clampedZoom = Math.max(2, Math.min(14, zoom));
    const scaledRadius = 32000 / 2 ** ((clampedZoom - 2) * 0.65);

    return Math.max(260, Math.round(scaledRadius));
  };

  const getRecommendedCityKey = (city) => `${city.name}-${city.popularityRank}`;

  const getStopPosition = (stop) => ({
    lat: Number(stop?.location?.lat),
    lng: Number(stop?.location?.lng),
  });

  const getMidpoint = (start, end) => ({
    lat: (Number(start?.lat || 0) + Number(end?.lat || 0)) / 2,
    lng: (Number(start?.lng || 0) + Number(end?.lng || 0)) / 2,
  });

  const frameAllPlannedStops = (map, stops, sequenceToken, { animate = true } = {}) => {
    if (!Array.isArray(stops) || !stops.length || !window.google?.maps) return;

    const bounds = new window.google.maps.LatLngBounds();
    stops.forEach((stop) => {
      bounds.extend(getStopPosition(stop));
    });

    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    const overviewCenter = {
      lat: (northEast.lat() + southWest.lat()) / 2,
      lng: (northEast.lng() + southWest.lng()) / 2,
    };

    const applyFit = () => {
      if (sequenceToken !== cameraSequenceTokenRef.current) return;

      lockMapTo2D(map);
      map.fitBounds(bounds, {
        top: 84,
        right: 92,
        bottom: 124,
        left: 92,
      });

      window.google.maps.event.addListenerOnce(map, "idle", () => {
        if (sequenceToken !== cameraSequenceTokenRef.current) return;
        applyCameraForZoom(map, Number(map.getZoom() || 12));
      });
    };

    if (!animate || stops.length === 1) {
      applyFit();
      return;
    }

    const currentZoom = Number(map.getZoom() || 14);
    const overviewZoom = Math.max(10.6, currentZoom - 1.4);

    animateCameraFlight(
      map,
      {
        center: overviewCenter,
        zoom: overviewZoom,
      },
      {
        duration: 1450,
        onComplete: () => {
          if (sequenceToken !== cameraSequenceTokenRef.current) return;
          queueCameraStep(applyFit, 220);
        },
      },
    );
  };

  const frameWorldOverview = (map) => {
    if (!map || !window.google?.maps) return;

    clearCameraSequence();
    map.setMapTypeId("hybrid");
    lockMapTo2D(map);
    map.setCenter({ lat: 28, lng: 1 });
    map.setZoom(2.7);
    applyCameraForZoom(map, 2.7);
  };

  const frameRecommendedCities = (map, cities) => {
    if (!Array.isArray(cities) || !cities.length || !window.google?.maps) return;

    clearCameraSequence();
    map.setMapTypeId("hybrid");

    if (cities.length === 1) {
      const city = cities[0];
      const location = {
        lat: Number(city.location.lat),
        lng: Number(city.location.lng),
      };

      map.setCenter(location);
      map.setZoom(7);
      applyCameraForZoom(map, 7);
      animateZoomTo(map, 8, 64);
      return;
    }

    const bounds = new window.google.maps.LatLngBounds();
    cities.forEach((city) => {
      bounds.extend({
        lat: Number(city.location.lat),
        lng: Number(city.location.lng),
      });
    });

    map.fitBounds(bounds, {
      top: 84,
      right: 84,
      bottom: 110,
      left: 110,
    });

    window.google.maps.event.addListenerOnce(map, "idle", () => {
      const fitZoom = Number(map.getZoom() || 5);
      const targetZoom = getRecommendedCitiesTargetZoom(bounds, fitZoom);
      if (fitZoom < targetZoom) {
        animateZoomTo(map, targetZoom, 70);
      } else {
        applyCameraForZoom(map, fitZoom);
      }
    });
  };

  const getCountryBounds = (countryName, countryCode) => {
    if (!countryName || !geocoderRef.current || !window.google?.maps) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const request = {
        address: countryName,
      };

      if (countryCode) {
        request.componentRestrictions = { country: String(countryCode).toLowerCase() };
      }

      geocoderRef.current.geocode(request, (results, status) => {
        if (status !== "OK" || !Array.isArray(results) || !results.length) {
          resolve(null);
          return;
        }

        const geometry = results[0]?.geometry;
        const sourceBounds = geometry?.bounds || geometry?.viewport || null;
        if (!sourceBounds) {
          resolve(null);
          return;
        }

        resolve(
          new window.google.maps.LatLngBounds(
            sourceBounds.getSouthWest(),
            sourceBounds.getNorthEast(),
          ),
        );
      });
    });
  };

  const frameCountryWithCities = async (map, cities, countryName, countryCode) => {
    if (!Array.isArray(cities) || !cities.length || !window.google?.maps) return;

    if (cities.length === 1) {
      frameRecommendedCities(map, cities);
      return;
    }

    const cityBounds = new window.google.maps.LatLngBounds();

    cities.forEach((city) => {
      cityBounds.extend({
        lat: Number(city.location.lat),
        lng: Number(city.location.lng),
      });
    });

    const northEast = cityBounds.getNorthEast();
    const southWest = cityBounds.getSouthWest();
    const latSpan = Math.abs(northEast.lat() - southWest.lat());
    const lngSpan = Math.abs(northEast.lng() - southWest.lng());
    const latPadding = Math.max(0.9, latSpan * 0.45);
    const lngPadding = Math.max(1.2, lngSpan * 0.45);
    const paddedBounds = new window.google.maps.LatLngBounds(
      {
        lat: southWest.lat() - latPadding,
        lng: southWest.lng() - lngPadding,
      },
      {
        lat: northEast.lat() + latPadding,
        lng: northEast.lng() + lngPadding,
      },
    );

    clearCameraSequence();
    map.setMapTypeId("hybrid");
    map.fitBounds(paddedBounds, {
      top: 84,
      right: 84,
      bottom: 110,
      left: 110,
    });

    window.google.maps.event.addListenerOnce(map, "idle", () => {
      const fitZoom = Number(map.getZoom() || 4.8);
      const cityTargetZoom = getRecommendedCitiesTargetZoom(cityBounds, fitZoom);
      const targetZoom = Math.max(4.8, Math.min(7.6, cityTargetZoom - 0.8));

      if (fitZoom < targetZoom) {
        animateZoomTo(map, targetZoom, 82, () => applyCameraForZoom(map, targetZoom), {
          refreshResolution: true,
        });
        return;
      }

      applyCameraForZoom(map, fitZoom);
    });
  };

  const framePlannedItinerary = (map, stops) => {
    if (!Array.isArray(stops) || !stops.length || !window.google?.maps) return;

    clearCameraSequence();
    const sequenceToken = cameraSequenceTokenRef.current;
    map.setMapTypeId("hybrid");

    if (stops.length === 1) {
      const position = getStopPosition(stops[0]);
      animateCameraFlight(
        map,
        {
          center: position,
          zoom: 17.8,
        },
        {
          duration: 1550,
        },
      );
      return;
    }

    if (!planningInProgress) {
      frameAllPlannedStops(map, stops, sequenceToken);
      return;
    }

    const newestStop = stops[stops.length - 1];
    const newestPosition = getStopPosition(newestStop);
    const priorPosition = getStopPosition(stops[stops.length - 2]);
    const overviewPosition = getMidpoint(priorPosition, newestPosition);
    const currentZoom = Number(map.getZoom() || 12);
    const overviewZoom = Math.max(12.2, Math.min(15.4, currentZoom - 1.35));

    animateCameraFlight(
      map,
      {
        center: overviewPosition,
        zoom: overviewZoom,
      },
      {
        duration: 1380,
        onComplete: () => {
          if (sequenceToken !== cameraSequenceTokenRef.current) return;

          queueCameraStep(() => {
            if (sequenceToken !== cameraSequenceTokenRef.current) return;

            animateCameraFlight(
              map,
              {
                center: newestPosition,
                zoom: 17.4,
              },
              {
                duration: 1680,
              },
            );
          }, 260);
        },
      },
    );
  };

  const focusCity = async (map, city) => {
    const lat = Number(city?.lat);
    const lng = Number(city?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    clearCameraSequence();
    map.setMapTypeId("hybrid");

    const requestToken = cityFocusRequestTokenRef.current + 1;
    cityFocusRequestTokenRef.current = requestToken;
    const resolvedGeometry = await getCityFocusGeometry(city);

    if (requestToken !== cityFocusRequestTokenRef.current) {
      return;
    }

    const targetPosition = resolvedGeometry?.center || { lat, lng };
    const targetZoom = getCityFocusTargetZoom(
      resolvedGeometry?.bounds || null,
      Number(map.getZoom() || 12),
    );
    const startingZoom = Number(map.getZoom() || 6);

    map.panTo(targetPosition);
    lockMapTo2D(map);

    queueCameraStep(() => {
      const currentZoom = Number(map.getZoom() || startingZoom);

      if (currentZoom >= targetZoom) {
        map.setCenter(targetPosition);
        map.setZoom(targetZoom);
        lockMapTo2D(map);
        return;
      }

      animateZoomTo(map, targetZoom, 150, () => {
        map.setCenter(targetPosition);
        lockMapTo2D(map);
      }, {
        centerOn: targetPosition,
        refreshResolution: true,
      });
    }, 220);
  };

  useEffect(() => {
    if (!mapsReady || !mapRef.current || !window.google?.maps) {
      return undefined;
    }

    const mapOptions = {
      center: { lat: 28, lng: 1 },
      zoom: 2.7,
      minZoom: 2,
      maxZoom: 18,
      mapTypeId: "hybrid",
      tilt: 0,
      heading: 0,
      disableDefaultUI: true,
      mapTypeControl: false,
      fullscreenControl: false,
      zoomControl: false,
      streetViewControl: false,
      rotateControl: false,
      cameraControl: false,
      scaleControl: false,
      panControl: false,
      gestureHandling: "greedy",
      draggable: false,
      keyboardShortcuts: false,
      disableDoubleClickZoom: false,
      scrollwheel: false,
      clickableIcons: false,
      styles: [
        {
          featureType: "administrative.country",
          elementType: "geometry.stroke",
          stylers: [
            { visibility: "on" },
            { color: "#5a5a5a" },
            { weight: 1.3 },
          ],
        },
        {
          featureType: "administrative.country",
          elementType: "labels.text.fill",
          stylers: [{ visibility: "on" }, { color: "#1f1f1f" }],
        },
        {
          featureType: "administrative.country",
          elementType: "labels.text.stroke",
          stylers: [{ visibility: "on" }, { color: "#ffffff" }, { weight: 3 }],
        },
        {
          featureType: "poi",
          elementType: "labels",
          stylers: [{ visibility: "off" }],
        },
      ],
    };

    // Initialize the map
    const map = new window.google.maps.Map(mapRef.current, mapOptions);
    mapInstanceRef.current = map;
    geocoderRef.current = new window.google.maps.Geocoder();

    map.setOptions({
      tilt: 0,
      heading: 0,
      mapTypeId: "hybrid",
      mapTypeControl: false,
      fullscreenControl: false,
      zoomControl: false,
      rotateControl: false,
      cameraControl: false,
      gestureHandling: "greedy",
      draggable: false,
      keyboardShortcuts: false,
      scrollwheel: false,
      clickableIcons: false,
    });

    const idleListener = map.addListener("idle", () => applyCameraForZoom(map));
    const zoomListener = map.addListener("zoom_changed", () => applyCameraForZoom(map));
    const tiltListener = map.addListener("tilt_changed", () => lockMapTo2D(map));
    const headingListener = map.addListener("heading_changed", () => lockMapTo2D(map));

    return () => {
      clearCameraSequence();
      clearItineraryRevealTimers();
      clearRoutePolylines();
      cityOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
      cityOverlaysRef.current = [];
      clearItineraryOverlays();
      cityDotsRef.current = [];
      cityCardElementsRef.current.clear();
      geocoderRef.current = null;
      window.google.maps.event.removeListener(idleListener);
      window.google.maps.event.removeListener(zoomListener);
      window.google.maps.event.removeListener(tiltListener);
      window.google.maps.event.removeListener(headingListener);
      window.google.maps.event.clearInstanceListeners(map);
      mapInstanceRef.current = null;
    };
  }, [mapsReady]);

  useEffect(() => {
    if (!mapsReady || !mapInstanceRef.current) return;

    const map = mapInstanceRef.current;
    map.setOptions({
      disableDefaultUI: !allowMapExploration,
      zoomControl: allowMapExploration,
      rotateControl: false,
      cameraControl: false,
      gestureHandling: allowMapExploration ? "greedy" : "greedy",
      draggable: allowMapExploration,
      keyboardShortcuts: allowMapExploration,
      scrollwheel: allowMapExploration,
      clickableIcons: allowMapExploration,
    });
    lockMapTo2D(map);
  }, [allowMapExploration, mapsReady]);

  useEffect(() => {
    if (!mapsReady || !mapInstanceRef.current) return;

    cityOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    cityOverlaysRef.current = [];
    cityDotsRef.current = [];
    cityCardElementsRef.current.clear();

    if (!hasRecommendations) return;

    const map = mapInstanceRef.current;
    const validCities = recommendedCities.filter(
      (city) =>
        Number.isFinite(Number(city?.location?.lat)) &&
        Number.isFinite(Number(city?.location?.lng)),
    );

    if (!validCities.length) return;

    clearCameraAnimation();
    const currentZoom = Number(map.getZoom() ?? 4);

    const getCityOverlayZIndex = (city) => {
      const rank = Number(city?.popularityRank);
      const normalizedRank = Number.isFinite(rank) ? rank : 999;
      return 1000 - normalizedRank;
    };

    const syncCardHighlightState = (element, city) => {
      if (!element) return;

      const baseZIndex = String(getCityOverlayZIndex(city));
      const isHighlighted = hoveredRecommendedCityKeyRef.current === getRecommendedCityKey(city);
      element.dataset.baseZIndex = baseZIndex;
      element.classList.toggle('map-city-card--highlighted', isHighlighted);
      element.style.zIndex = String(isHighlighted ? 5000 : baseZIndex);
    };

    function CityCardOverlay(position, city) {
      this.position = position;
      this.city = city;
      this.div = null;
    }

    CityCardOverlay.prototype = new window.google.maps.OverlayView();

    const selectRecommendedCity = (city) => {
      if (!onCitySelect) return;

      onCitySelect({
        lat: Number(city.location.lat),
        lng: Number(city.location.lng),
        name: city.name,
        formattedAddress: city.formattedAddress || city.name,
      });
    };

    CityCardOverlay.prototype.onAdd = function onAdd() {
      this.div = createMapCityCardElement(this.city, () => selectRecommendedCity(this.city));
      cityCardElementsRef.current.set(getRecommendedCityKey(this.city), this.div);
      syncCardHighlightState(this.div, this.city);
      const panes = this.getPanes();
      panes.floatPane.appendChild(this.div);
    };

    CityCardOverlay.prototype.draw = function draw() {
      if (!this.div) return;

      const projection = this.getProjection();
      const point = projection.fromLatLngToDivPixel(this.position);

      if (!point) return;
      this.div.style.left = `${point.x}px`;
      this.div.style.top = `${point.y}px`;
      syncCardHighlightState(this.div, this.city);
    };

    CityCardOverlay.prototype.onRemove = function onRemove() {
      if (this.div && this.div.parentNode) {
        this.div.parentNode.removeChild(this.div);
      }
      cityCardElementsRef.current.delete(getRecommendedCityKey(this.city));
      this.div = null;
    };

    const overlays = validCities.map((city) => {
      const position = {
        lat: Number(city.location.lat),
        lng: Number(city.location.lng),
      };

      let dot = null;
      let card = null;

      if (!selectedCity) {
        dot = new window.google.maps.Circle({
          map,
          center: position,
          radius: getCityDotRadiusForZoom(currentZoom),
          strokeColor: "#ffffff",
          strokeOpacity: 0.95,
          strokeWeight: currentZoom >= 12 ? 0.9 : currentZoom >= 10 ? 1.1 : currentZoom >= 7 ? 1.5 : 2,
          fillColor: "#ff7a00",
          fillOpacity: 0.95,
          zIndex: getCityOverlayZIndex(city),
        });
        dot.addListener("click", () => selectRecommendedCity(city));

        card = new CityCardOverlay(
          new window.google.maps.LatLng(position.lat, position.lng),
          city,
        );
        card.setMap(map);
      }

      return [dot, card];
    });

    cityOverlaysRef.current = overlays.flat().filter(Boolean);
    cityDotsRef.current = overlays.map(([dot]) => dot).filter(Boolean);
    if (!selectedCity) {
      void frameCountryWithCities(map, validCities, selectedCountry, selectedCountryCode);
    }
  }, [
    hasRecommendations,
    mapsReady,
    onCitySelect,
    recommendedCities,
    selectedCity,
    selectedCountry,
    selectedCountryCode,
  ]);

  useEffect(() => {
    if (!mapsReady || !mapInstanceRef.current || !window.google?.maps) return;

    if (!hasPlannedItinerary || !routePolyline) {
      clearRoutePolylines();
      return;
    }

    animateRenderedRoute(mapInstanceRef.current, routePolyline);
  }, [hasPlannedItinerary, mapsReady, routePolyline]);

  useEffect(() => {
    if (!mapsReady || !mapInstanceRef.current || !window.google?.maps) return;

    clearItineraryRevealTimers();

    if (!hasPlannedItinerary) {
      clearItineraryOverlays();
      clearRoutePolylines();
      return;
    }

    const map = mapInstanceRef.current;
    const validStops = plannedItinerary.filter(
      (stop) =>
        Number.isFinite(Number(stop?.location?.lat)) && Number.isFinite(Number(stop?.location?.lng))
    );

    if (!validStops.length) {
      clearItineraryOverlays();
      return;
    }

    const hasStablePrefix = itineraryOverlaysRef.current.every(
      (overlay, index) => overlay.stopKey === getItineraryStopKey(validStops[index], index)
    );

    if (!hasStablePrefix || validStops.length < itineraryOverlaysRef.current.length) {
      clearItineraryOverlays();
    }

    function TravelStopOverlay(position, stop, index) {
      this.position = position;
      this.stop = stop;
      this.index = index;
      this.stopKey = getItineraryStopKey(stop, index);
      this.container = null;
      this.root = null;
    }

    TravelStopOverlay.prototype = new window.google.maps.OverlayView();

    TravelStopOverlay.prototype.onAdd = function onAdd() {
      this.container = document.createElement('div');
      this.container.className = 'travel-stop-map-overlay';
      this.root = createRoot(this.container);
      this.root.render(
        <TravelStopRecommendationMapOverlay stop={this.stop} index={this.index} />
      );

      const panes = this.getPanes();
      panes.floatPane.appendChild(this.container);
    };

    TravelStopOverlay.prototype.draw = function draw() {
      if (!this.container) return;

      const projection = this.getProjection();
      const point = projection.fromLatLngToDivPixel(this.position);

      if (!point) return;

      this.container.style.left = `${point.x}px`;
      this.container.style.top = `${point.y}px`;
      this.container.style.zIndex = String(4000 + this.index);
    };

    TravelStopOverlay.prototype.onRemove = function onRemove() {
      if (this.root) {
        this.root.unmount();
      }

      if (this.container && this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
      }

      this.container = null;
      this.root = null;
    };

    const renderedCount = itineraryOverlaysRef.current.length;
    const overlays = validStops.slice(renderedCount).map((stop, offset) => {
      const index = renderedCount + offset;
      return new TravelStopOverlay(
        new window.google.maps.LatLng(Number(stop.location.lat), Number(stop.location.lng)),
        stop,
        index
      );
    });

    overlays.forEach((overlay, index) => {
      const timerId = window.setTimeout(() => {
        overlay.setMap(map);
        itineraryOverlaysRef.current.push(overlay);
        framePlannedItinerary(map, validStops.slice(0, renderedCount + index + 1));
      }, index * 320);

      itineraryRevealTimersRef.current.push(timerId);
    });

    if (!overlays.length) {
      framePlannedItinerary(map, validStops);
    }

    return () => {
      clearItineraryRevealTimers();
    };
  }, [hasPlannedItinerary, mapsReady, plannedItinerary, planningInProgress, selectedCity]);

  useEffect(() => {
    hoveredRecommendedCityKeyRef.current = hoveredRecommendedCityKey || '';

    cityCardElementsRef.current.forEach((element, cityKey) => {
      const isHighlighted = hoveredRecommendedCityKeyRef.current === cityKey;
      element.classList.toggle('map-city-card--highlighted', isHighlighted);
      element.style.zIndex = String(isHighlighted ? 5000 : element.dataset.baseZIndex || 1000);
    });
  }, [hoveredRecommendedCityKey]);

  useEffect(() => {
    if (!mapsReady || !mapInstanceRef.current || !window.google?.maps?.event) return;

    const map = mapInstanceRef.current;
    const syncOverviewLayout = () => {
      window.google.maps.event.trigger(map, "resize");
      if (isWorldOverview) {
        frameWorldOverview(map);
      }
    };

    const timerA = window.setTimeout(syncOverviewLayout, 0);
    const timerB = window.setTimeout(syncOverviewLayout, 180);
    const timerC = window.setTimeout(syncOverviewLayout, 420);

    return () => {
      window.clearTimeout(timerA);
      window.clearTimeout(timerB);
      window.clearTimeout(timerC);
    };
  }, [isWorldOverview, mapsReady]);

  useEffect(() => {
    if (!selectedCity) {
      lastFocusedCityRequestRef.current = '';
      return;
    }

    if (!mapsReady || !mapInstanceRef.current || hasPlannedItinerary) return;

    const cityKey = `${selectedCity.name || 'city'}-${selectedCity.lat}-${selectedCity.lng}`;
    const focusRequestKey = `${cityKey}-${selectedCityFocusToken}`;
    if (lastFocusedCityRequestRef.current === focusRequestKey) return;

    lastFocusedCityRequestRef.current = focusRequestKey;

    const map = mapInstanceRef.current;
    syncMapViewport(map, () => focusCity(map, selectedCity));
  }, [hasPlannedItinerary, mapsReady, selectedCity, selectedCityFocusToken]);

  if (mapsError) {
    return (
      <div className="map-overlay map-overlay-status">
        <p>{mapsError}</p>
      </div>
    );
  }

  if (!mapsReady) {
    return (
      <div className="map-overlay map-overlay-status">
        <p>Loading map...</p>
      </div>
    );
  }

  return (
    <div className={`map-overlay ${isWorldOverview ? "map-overlay--world" : ""}`.trim()}>
      <div ref={mapRef} className="map-container"></div>
    </div>
  );
}
