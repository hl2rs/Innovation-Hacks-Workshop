import React, { useEffect, useRef, useState } from 'react';
import './App.css';
import MapOverlay from './components/map-overlay/MapOverlay';
import ChatContainer from './components/chat-container/ChatContainer';

export default function App() {
  const desktopMinChatPanelWidth = 340;
  const desktopDefaultChatPanelWidth = 660;
  const desktopHorizontalOffset = 24;

  const chatPanelRef = useRef(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedCountryCode, setSelectedCountryCode] = useState('');
  const [selectedCity, setSelectedCity] = useState(null);
  const [selectedCityFocusToken, setSelectedCityFocusToken] = useState(0);
  const [planningInProgress, setPlanningInProgress] = useState(false);
  const [recommendedCities, setRecommendedCities] = useState([]);
  const [plannedItinerary, setPlannedItinerary] = useState([]);
  const [plannedRoutePolyline, setPlannedRoutePolyline] = useState('');
  const [hoveredRecommendedCityKey, setHoveredRecommendedCityKey] = useState('');
  const [findingCities, setFindingCities] = useState(false);
  const [findCitiesError, setFindCitiesError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(() => window.innerWidth <= 900);
  const [chatPanelWidth, setChatPanelWidth] = useState(() => {
    const maxDesktopWidth = Math.max(
      desktopMinChatPanelWidth,
      window.innerWidth - desktopHorizontalOffset * 2,
    );

    return Math.min(desktopDefaultChatPanelWidth, maxDesktopWidth);
  });
  const [isResizingChatPanel, setIsResizingChatPanel] = useState(false);

  useEffect(() => {
    const handleWindowResize = () => {
      const mobileNow = window.innerWidth <= 900;
      setIsMobileLayout(mobileNow);

      if (!mobileNow) {
        setChatPanelWidth((currentWidth) => {
          const maxWidth = Math.max(desktopMinChatPanelWidth, window.innerWidth - desktopHorizontalOffset * 2);
          return Math.min(Math.max(currentWidth, desktopMinChatPanelWidth), maxWidth);
        });
      }
    };

    window.addEventListener('resize', handleWindowResize);
    return () => {
      window.removeEventListener('resize', handleWindowResize);
    };
  }, []);

  useEffect(() => {
    if (!isResizingChatPanel) {
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      return undefined;
    }

    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };
  }, [isResizingChatPanel]);

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    const mapsScriptUrl = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&libraries=places`;

    if (!apiKey) {
      setMapsError('Missing VITE_GOOGLE_MAPS_API_KEY in .env.local');
      return;
    }

    if (window.google && window.google.maps && window.google.maps.places) {
      setMapsReady(true);
      return;
    }

    const existingScript = document.querySelector('script[data-google-maps="true"]');
    if (existingScript) {
      if (!existingScript.src.includes('libraries=places')) {
        existingScript.remove();
      } else {
        existingScript.addEventListener('load', () => setMapsReady(true));
        existingScript.addEventListener('error', () => {
          setMapsError('Failed to load Google Maps script');
        });
        return;
      }
    }

    const script = document.createElement('script');
    script.src = mapsScriptUrl;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = 'true';
    script.onload = () => setMapsReady(true);
    script.onerror = () => setMapsError('Failed to load Google Maps script');
    document.head.appendChild(script);
  }, []);

  const clearRecommendationState = () => {
    setSelectedCity(null);
    setSelectedCityFocusToken(0);
    setPlanningInProgress(false);
    setRecommendedCities([]);
    setPlannedItinerary([]);
    setPlannedRoutePolyline('');
    setHoveredRecommendedCityKey('');
    setFindCitiesError('');
    setDetailsOpen(false);
  };

  const handleFindCities = async (countryInput) => {
    const countryName = typeof countryInput === 'string' ? countryInput : countryInput?.name || '';
    const countryCode = typeof countryInput === 'string' ? '' : countryInput?.code || '';

    if (!countryName) {
      setFindCitiesError('Select a country first.');
      setSelectedCity(null);
      setRecommendedCities([]);
      return;
    }

    setSelectedCountry(countryName);
    setSelectedCountryCode(countryCode);
    setPlanningInProgress(false);
    setRecommendedCities([]);
    setPlannedItinerary([]);
    setPlannedRoutePolyline('');
    setHoveredRecommendedCityKey('');
    setSelectedCity(null);
    setFindingCities(true);
    setFindCitiesError('');

    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
      const response = await fetch(
        `${apiBase}/api/planning/country-popular-cities?country=${encodeURIComponent(countryName)}`
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error || 'Failed to fetch city recommendations.');
      }

      const data = await response.json();
      setRecommendedCities(Array.isArray(data.cities) ? data.cities : []);
    } catch (error) {
      setSelectedCity(null);
      setPlanningInProgress(false);
      setRecommendedCities([]);
      setPlannedItinerary([]);
      setPlannedRoutePolyline('');
      setHoveredRecommendedCityKey('');
      setFindCitiesError(error.message || 'Failed to fetch city recommendations.');
    } finally {
      setFindingCities(false);
    }
  };

  const handleCitySelected = (city) => {
    if (!city) return;

    const lat = Number(city.lat);
    const lng = Number(city.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    setPlannedItinerary([]);
    setPlannedRoutePolyline('');
    setSelectedCityFocusToken((current) => current + 1);
    setPlanningInProgress(false);
    setDetailsOpen(false);
    setSelectedCity({
      lat,
      lng,
      name: city.name || '',
      formattedAddress: city.formattedAddress || city.name || '',
    });
  };

  const handleResizePointerDown = (event) => {
    if (isMobileLayout || !chatPanelRef.current) {
      return;
    }

    event.preventDefault();
    setIsResizingChatPanel(true);

    const chatPanelLeft = chatPanelRef.current.getBoundingClientRect().left;

    const handlePointerMove = (moveEvent) => {
      const nextWidth = moveEvent.clientX - chatPanelLeft;
      const clampedWidth = Math.max(
        desktopMinChatPanelWidth,
        Math.min(nextWidth, Math.max(desktopMinChatPanelWidth, window.innerWidth - desktopHorizontalOffset * 2)),
      );

      setChatPanelWidth(clampedWidth);
    };

    const stopResizing = () => {
      setIsResizingChatPanel(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);
  };

  return (
    <div className="app">
      <MapOverlay
        onCitySelect={handleCitySelected}
        hoveredRecommendedCityKey={hoveredRecommendedCityKey}
        mapsReady={mapsReady}
        mapsError={mapsError}
        planningInProgress={planningInProgress}
        routePolyline={plannedRoutePolyline}
        selectedCityFocusToken={selectedCityFocusToken}
        selectedCountry={selectedCountry}
        selectedCountryCode={selectedCountryCode}
        selectedCity={selectedCity}
        plannedItinerary={plannedItinerary}
        recommendedCities={recommendedCities}
      />
      <aside
        ref={chatPanelRef}
        className={`chat-panel ${detailsOpen ? 'chat-panel--details-open' : ''} ${isResizingChatPanel ? 'chat-panel--resizing' : ''}`.trim()}
        style={!isMobileLayout ? { width: `${Math.min(chatPanelWidth, Math.max(desktopMinChatPanelWidth, window.innerWidth - desktopHorizontalOffset * 2))}px` } : undefined}
      >
        <ChatContainer
          onFindCities={handleFindCities}
          onCitySelected={handleCitySelected}
          onDetailsOpenChange={setDetailsOpen}
          onPlanningStateChange={setPlanningInProgress}
          onItineraryChange={setPlannedItinerary}
          onRoutePolylineChange={setPlannedRoutePolyline}
          onRecommendationHoverChange={setHoveredRecommendedCityKey}
          onPlanningInputChange={clearRecommendationState}
          recommendedCities={recommendedCities}
          selectedCountry={selectedCountry}
          selectedCity={selectedCity}
          findingCities={findingCities}
          findCitiesError={findCitiesError}
        />
        {!isMobileLayout && (
          <button
            type="button"
            className="chat-panel-resize-handle"
            aria-label="Resize chat panel"
            onPointerDown={handleResizePointerDown}
          />
        )}
      </aside>
    </div>
  );
}
