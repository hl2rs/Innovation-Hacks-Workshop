import React, { useEffect } from 'react';
import './CityRecommendation.css';

export default function CityRecommendation({
  country,
  cities,
  inMessage = false,
  onContentReady,
  onCityHoverChange,
  onCitySelect,
}) {
  if (!Array.isArray(cities) || !cities.length) {
    return null;
  }

  useEffect(() => {
    if (!onContentReady) return undefined;

    const timerA = window.setTimeout(onContentReady, 0);
    const timerB = window.setTimeout(onContentReady, 160);

    return () => {
      window.clearTimeout(timerA);
      window.clearTimeout(timerB);
    };
  }, [cities, onContentReady]);

  return (
    <div className={`city-recommendation ${inMessage ? 'city-recommendation--message' : ''}`.trim()}>
      <h3 className="city-recommendation-title">
        Popular Cities in {country}
      </h3>
      <div className="city-recommendation-list">
        {cities.map((city) => {
          const fallbackImage = `https://picsum.photos/seed/reco-${encodeURIComponent(city.name)}/320/200`;
          const cityKey = `${city.name}-${city.popularityRank}`;
          const handleCityClick = () => {
            const lat = Number(city?.location?.lat);
            const lng = Number(city?.location?.lng);
            if (!onCitySelect || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

            onCitySelect({
              lat,
              lng,
              name: city.name,
              formattedAddress: city.formattedAddress || city.name,
            });
          };

          return (
            <button
              key={cityKey}
              type="button"
              className="city-recommendation-card"
              onClick={handleCityClick}
              onMouseEnter={() => onCityHoverChange?.(cityKey)}
              onMouseLeave={() => onCityHoverChange?.('')}
              onFocus={() => onCityHoverChange?.(cityKey)}
              onBlur={() => onCityHoverChange?.('')}
            >
              <div className="city-recommendation-photo-frame">
                <img
                  src={city.photoUrl || fallbackImage}
                  alt={city.name}
                  className="city-recommendation-photo"
                  onLoad={onContentReady}
                />
              </div>
              <div className="city-recommendation-meta">
                <span className="city-recommendation-rank">#{city.popularityRank}</span>
                <p className="city-recommendation-name">{city.name}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
