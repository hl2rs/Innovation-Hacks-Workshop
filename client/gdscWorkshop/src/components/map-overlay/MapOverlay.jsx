import React, { useEffect, useRef } from 'react';
import './MapOverlay.css';

export default function MapOverlay({ onCitySelect, mapsReady, mapsError }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);

  useEffect(() => {
    if (!mapsReady || !mapRef.current || !window.google || !window.google.maps) return;

    // Initialize Google Map with 3D view
    const mapOptions = {
      center: { lat: 0, lng: 0 },
      zoom: 2,
      minZoom: 2,
      maxZoom: 2,
      mapTypeId: 'satellite',
      tilt: 45,
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
      gestureHandling: 'none',
      draggable: false,
      keyboardShortcuts: false,
      disableDoubleClickZoom: true,
      scrollwheel: false,
      restriction: {
        latLngBounds: {
          north: 85.051129,
          south: -85.051129,
          east: 179.999,
          west: -179.999,
        },
        strictBounds: true,
      },
    };

    // Initialize the map
    const map = new window.google.maps.Map(mapRef.current, mapOptions);
    mapInstanceRef.current = map;

    // Enable 3D buildings
    map.setOptions({ 
      tilt: 45,
      mapTypeId: 'satellite',
      cameraControl: false
    });

    // Add click listener for city selection
    map.addListener('click', (event) => {
      if (onCitySelect) {
        onCitySelect({
          lat: event.latLng.lat(),
          lng: event.latLng.lng()
        });
      }
    });

    return () => {
      // Cleanup if needed
    };
  }, [onCitySelect, mapsReady]);

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
    <div className="map-overlay">
      <div ref={mapRef} className="map-container"></div>
    </div>
  );
}
