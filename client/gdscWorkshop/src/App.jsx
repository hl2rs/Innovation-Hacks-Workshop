import React, { useEffect, useState } from 'react';
import './App.css';
import MapOverlay from './components/map-overlay/MapOverlay';
import ChatContainer from './components/chat-container/ChatContainer';

export default function App() {
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState('');

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      setMapsError('Missing VITE_GOOGLE_MAPS_API_KEY in .env.local');
      return;
    }

    if (window.google && window.google.maps) {
      setMapsReady(true);
      return;
    }

    const existingScript = document.querySelector('script[data-google-maps="true"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => setMapsReady(true));
      existingScript.addEventListener('error', () => {
        setMapsError('Failed to load Google Maps script');
      });
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = 'true';
    script.onload = () => setMapsReady(true);
    script.onerror = () => setMapsError('Failed to load Google Maps script');
    document.head.appendChild(script);
  }, []);

  return (
    <div className="app">
      <MapOverlay mapsReady={mapsReady} mapsError={mapsError} />
      <aside className="chat-panel">
        <ChatContainer />
      </aside>
    </div>
  );
}
