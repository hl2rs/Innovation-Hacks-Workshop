import React, { useEffect, useMemo, useRef, useState } from 'react';
import './UserResponse.css';

export default function UserResponse({
  onFindCities,
  onCitySelected,
  onPlanningInputChange,
  findingCities,
  findCitiesError,
}) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
  const [countries, setCountries] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState('');
  const [countryQuery, setCountryQuery] = useState('');
  const [cityQuery, setCityQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(null);
  const [recommendedCity, setRecommendedCity] = useState(null);
  const [lookupStatus, setLookupStatus] = useState('');
  const [placesBlocked, setPlacesBlocked] = useState(false);
  const [showCountrySuggestions, setShowCountrySuggestions] = useState(false);
  const lastClearedKeyRef = useRef('');

  const normalizeCountryText = (value) => String(value || '').trim().toLowerCase();

  const notifyPlanningInputChange = (countryCodeValue, cityValue) => {
    const nextKey = `${countryCodeValue || ''}::${cityValue || ''}`;

    if (lastClearedKeyRef.current === nextKey) {
      return;
    }

    lastClearedKeyRef.current = nextKey;

    if (onPlanningInputChange) {
      onPlanningInputChange();
    }
  };

  const buildFallbackCityImageUrl = (lat, lng) =>
    `https://picsum.photos/seed/city-${encodeURIComponent(`${lat}-${lng}`)}/240/160`;

  const isFallbackCityLike = (item) => {
    const type = String(item?.type || '').trim().toLowerCase();
    const addressType = String(item?.addresstype || '').trim().toLowerCase();

    return ['city', 'town', 'municipality'].includes(type)
      || ['city', 'town', 'municipality'].includes(addressType);
  };

  const normalizeServerCitySuggestion = (city) => {
    const lat = Number(city?.location?.lat);
    const lng = Number(city?.location?.lng);
    const name = String(city?.name || '').trim();
    const formattedAddress = String(city?.formattedAddress || '').trim();

    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    return {
      placeId: String(city?.id || `${name}-${lat}-${lng}`),
      name,
      description: name,
      formattedAddress: formattedAddress || name,
      photoUrl: city?.photoUrl || '',
      lat,
      lon: lng,
    };
  };

  const fetchServerCitySuggestions = async (query, countryName) => {
    if (!query.trim()) {
      return [];
    }

    const scopedQuery = countryName ? `${query}, ${countryName}` : query;
    const response = await fetch(
      `${apiBase}/api/planning/cities?q=${encodeURIComponent(scopedQuery)}`,
    );

    if (!response.ok) {
      throw new Error('Server city lookup failed.');
    }

    const data = await response.json().catch(() => ({}));
    return (Array.isArray(data?.cities) ? data.cities : [])
      .map(normalizeServerCitySuggestion)
      .filter(Boolean)
      .slice(0, 6);
  };

  const fetchFallbackCitySuggestions = async (query) => {
    if (!query.trim()) {
      return [];
    }

    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '6',
    });

    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
      },
    });

    const data = await response.json();
    return (data || [])
      .filter(isFallbackCityLike)
      .map((item) => ({
        placeId: `osm-${item.place_id}`,
        name: String(item?.name || item?.address?.city || item?.display_name || '').split(',')[0].trim(),
        description: String(item?.name || item?.address?.city || item?.display_name || '').split(',')[0].trim(),
        formattedAddress: String(item?.display_name || '').trim(),
        photoUrl: buildFallbackCityImageUrl(item.lat, item.lon),
        lat: item.lat,
        lon: item.lon,
      }))
      .filter((item) => item.description)
      .slice(0, 6);
  };

  const getPlacesApis = () => {
    if (!window.google || !window.google.maps || !window.google.maps.places) {
      return null;
    }

    const modernAutocomplete = window.google.maps.places.AutocompleteSuggestion;
    if (!modernAutocomplete || typeof modernAutocomplete.fetchAutocompleteSuggestions !== 'function') {
      return null;
    }

    return {
      modernAutocomplete,
      placesService: new window.google.maps.places.PlacesService(document.createElement('div')),
    };
  };

  const normalizeModernPrediction = (suggestion) => {
    const placePrediction = suggestion?.placePrediction || suggestion;
    const placeId = placePrediction?.placeId || placePrediction?.place_id || '';

    const textValue = placePrediction?.text;
    const mainText = placePrediction?.mainText;
    const secondaryText = placePrediction?.secondaryText;

    const description =
      (typeof textValue === 'string' && textValue) ||
      textValue?.text ||
      placePrediction?.description ||
      [mainText?.text, secondaryText?.text].filter(Boolean).join(', ');

    if (!placeId || !description) {
      return null;
    }

    return {
      placeId,
      name:
        (typeof mainText?.text === 'string' && mainText.text.trim()) ||
        String(description).split(',')[0].trim(),
      description,
      formattedAddress: description,
    };
  };

  const fetchCityPredictions = async (apis, query) => {
    if (!query.trim()) {
      return [];
    }

    if (!apis?.modernAutocomplete) {
      return [];
    }

    const request = {
      input: query,
      includedPrimaryTypes: ['(cities)'],
    };

    if (selectedCountry) {
      request.includedRegionCodes = [selectedCountry.toLowerCase()];
    }

    const response = await apis.modernAutocomplete.fetchAutocompleteSuggestions(request);

    return (response?.suggestions || []).map(normalizeModernPrediction).filter(Boolean).slice(0, 6);
  };

  const selectedCountryName = useMemo(() => {
    const match = countries.find((country) => country.code === selectedCountry);
    return match ? match.name : '';
  }, [countries, selectedCountry]);

  const filteredCountries = useMemo(() => {
    const normalizedQuery = normalizeCountryText(countryQuery);
    if (!normalizedQuery) {
      return [];
    }

    return countries
      .filter((country) => {
        const normalizedName = normalizeCountryText(country.name);
        return normalizedName.includes(normalizedQuery)
          || country.code.toLowerCase().includes(normalizedQuery);
      })
      .sort((left, right) => {
        const leftName = normalizeCountryText(left.name);
        const rightName = normalizeCountryText(right.name);
        const leftStarts = leftName.startsWith(normalizedQuery) ? 0 : 1;
        const rightStarts = rightName.startsWith(normalizedQuery) ? 0 : 1;

        if (leftStarts !== rightStarts) {
          return leftStarts - rightStarts;
        }

        const leftExact = leftName === normalizedQuery || left.code.toLowerCase() === normalizedQuery ? 0 : 1;
        const rightExact = rightName === normalizedQuery || right.code.toLowerCase() === normalizedQuery ? 0 : 1;

        if (leftExact !== rightExact) {
          return leftExact - rightExact;
        }

        return left.name.localeCompare(right.name);
      })
      .slice(0, 8);
  }, [countries, countryQuery]);

  const resetCountryScopedSelections = (countryCodeValue = '') => {
    setCityQuery('');
    setSuggestions([]);
    setSelectedSuggestion(null);
    setRecommendedCity(null);
    setLookupStatus('');
    setPlacesBlocked(false);
    notifyPlanningInputChange(countryCodeValue, '');
  };

  const resolveCountryFromInput = () => {
    const normalizedQuery = normalizeCountryText(countryQuery);
    if (!normalizedQuery) {
      return null;
    }

    if (selectedCountry) {
      const selectedMatch = countries.find((country) => country.code === selectedCountry);
      if (selectedMatch && normalizeCountryText(selectedMatch.name) === normalizedQuery) {
        return selectedMatch;
      }
    }

    return countries.find((country) => {
      const normalizedName = normalizeCountryText(country.name);
      return normalizedName === normalizedQuery || country.code.toLowerCase() === normalizedQuery;
    }) || null;
  };

  const handleCountrySuggestionSelect = (country) => {
    setSelectedCountry(country.code);
    setCountryQuery(country.name);
    setShowCountrySuggestions(false);
    resetCountryScopedSelections(country.code);
  };

  const buildStaticMapImageUrl = (lat, lng) => {
    if (!apiKey) return '';

    return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=11&size=240x160&maptype=roadmap&markers=color:red%7C${lat},${lng}&key=${apiKey}`;
  };

  const getPlaceImage = (placesService, placeId) =>
    new Promise((resolve) => {
      placesService.getDetails(
        {
          placeId,
          fields: ['photos', 'geometry'],
        },
        (placeResult, status) => {
          if (status === window.google.maps.places.PlacesServiceStatus.REQUEST_DENIED) {
            setPlacesBlocked(true);
            resolve('');
            return;
          }

          if (
            status === window.google.maps.places.PlacesServiceStatus.OK &&
            placeResult?.photos?.length
          ) {
            resolve(placeResult.photos[0].getUrl({ maxWidth: 120, maxHeight: 90 }));
            return;
          }

          const location = placeResult?.geometry?.location;
          if (status === window.google.maps.places.PlacesServiceStatus.OK && location) {
            const lat = typeof location.lat === 'function' ? location.lat() : location.lat;
            const lng = typeof location.lng === 'function' ? location.lng() : location.lng;
            resolve(buildStaticMapImageUrl(lat, lng));
            return;
          }

          resolve('');
        }
      );
    });

  const getPlaceLocation = (placesService, placeId) =>
    new Promise((resolve) => {
      placesService.getDetails(
        {
          placeId,
          fields: ['geometry'],
        },
        (placeResult, status) => {
          if (status !== window.google.maps.places.PlacesServiceStatus.OK) {
            resolve(null);
            return;
          }

          const location = placeResult?.geometry?.location;
          if (!location) {
            resolve(null);
            return;
          }

          const lat = typeof location.lat === 'function' ? location.lat() : location.lat;
          const lng = typeof location.lng === 'function' ? location.lng() : location.lng;

          if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
            resolve(null);
            return;
          }

          resolve({ lat: Number(lat), lng: Number(lng) });
        }
      );
    });

  useEffect(() => {
    let isMounted = true;

    const loadCountries = async () => {
      try {
        const response = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2');
        const data = await response.json();

        const parsed = data
          .filter((item) => item?.name?.common && item?.cca2)
          .map((item) => ({
            name: item.name.common,
            code: item.cca2,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        if (isMounted) {
          setCountries(parsed);
        }
      } catch (error) {
        if (isMounted) {
          setCountries([]);
        }
      }
    };

    loadCountries();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!cityQuery.trim()) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const serverSuggestions = await fetchServerCitySuggestions(cityQuery, selectedCountryName);
        if (!cancelled && serverSuggestions.length) {
          setSuggestions(serverSuggestions);
          setLookupStatus('');
          return;
        }
      } catch {
        // Fall through to client-side city-only lookups.
      }

      const apis = getPlacesApis();
      if (!apis || placesBlocked) {
        try {
          const fallback = await fetchFallbackCitySuggestions(cityQuery);
          if (!cancelled) {
            setSuggestions(fallback);
            if (fallback.length) {
              setLookupStatus('Using fallback city search (Google Places is blocked).');
            }
          }
        } catch (error) {
          if (!cancelled) {
            setSuggestions([]);
          }
        }

        return;
      }

      let predictions = [];
      try {
        predictions = await fetchCityPredictions(apis, cityQuery);
      } catch (error) {
        if (!cancelled) {
          try {
            const fallback = await fetchFallbackCitySuggestions(cityQuery);
            if (!cancelled) {
              setSuggestions(fallback);
              setLookupStatus('Using fallback city search (Google Places is blocked).');
              setPlacesBlocked(true);
            }
          } catch (fallbackError) {
            setSuggestions([]);
            setLookupStatus('City lookup unavailable right now.');
            setPlacesBlocked(true);
          }
        }
        return;
      }

      if (cancelled) return;

      const { placesService } = apis;

      const enriched = await Promise.all(
        predictions.map(async (prediction) => ({
          placeId: prediction.placeId,
          description: prediction.description,
          photoUrl: await getPlaceImage(placesService, prediction.placeId),
        }))
      );

      if (!cancelled) {
        setSuggestions(enriched);
        setLookupStatus('');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiBase, cityQuery, placesBlocked, selectedCountry, selectedCountryName]);

  const handleCountryInputChange = (event) => {
    const nextCountryQuery = event.target.value;
    const normalizedQuery = normalizeCountryText(nextCountryQuery);
    const exactCountryMatch = countries.find((country) => {
      const normalizedName = normalizeCountryText(country.name);
      return normalizedName === normalizedQuery || country.code.toLowerCase() === normalizedQuery;
    }) || null;

    setCountryQuery(nextCountryQuery);
    setSelectedCountry(exactCountryMatch ? exactCountryMatch.code : '');
    setShowCountrySuggestions(Boolean(normalizedQuery) && !exactCountryMatch);
    resetCountryScopedSelections(exactCountryMatch?.code || '');
  };

  const handleFindCitiesClick = () => {
    const resolvedCountry = resolveCountryFromInput();

    if (!resolvedCountry) {
      setLookupStatus('Choose a country from the suggestions first.');
      return;
    }

    setSelectedCountry(resolvedCountry.code);
    setCountryQuery(resolvedCountry.name);
    setShowCountrySuggestions(false);
    setLookupStatus('');
    if (onFindCities) {
      onFindCities({
        name: resolvedCountry.name,
        code: resolvedCountry.code,
      });
    }
  };

  const handleSuggestionClick = async (suggestion) => {
    setCityQuery(suggestion.description);
    setSuggestions([]);
    setSelectedSuggestion(suggestion);
    setRecommendedCity(null);
    setLookupStatus('');
    notifyPlanningInputChange(selectedCountry, suggestion.description);
  };

  const handleCityInputChange = (event) => {
    const nextCityQuery = event.target.value;

    setCityQuery(nextCityQuery);
    setSelectedSuggestion(null);
    setRecommendedCity(null);
    setLookupStatus('');
    notifyPlanningInputChange(selectedCountry, nextCityQuery);
  };

  const handleContinue = async () => {
    if (!cityQuery.trim()) {
      setLookupStatus('Type a city to continue.');
      setRecommendedCity(null);
      return;
    }

    const apis = getPlacesApis();
    if (!apis || placesBlocked) {
      setLookupStatus('Finding city recommendation...');
      const fallback = suggestions.length
        ? suggestions
        : await fetchFallbackCitySuggestions(cityQuery);

      if (!fallback.length) {
        setLookupStatus('No city result found. Try another city name.');
        setRecommendedCity(null);
        return;
      }

      setRecommendedCity(null);
      setLookupStatus('');
      if (onCitySelected) {
        const fallbackCity = fallback[0];
        const lat = Number(fallbackCity.lat);
        const lng = Number(fallbackCity.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          onCitySelected({
            lat,
            lng,
            name: fallbackCity.name || fallbackCity.description,
            formattedAddress: fallbackCity.formattedAddress || fallbackCity.description,
          });
        }
      }
      return;
    }

    const { placesService } = apis;
    setLookupStatus('Finding city recommendation...');

    let chosen = selectedSuggestion;

    if (!chosen) {
      try {
        const serverSuggestions = await fetchServerCitySuggestions(cityQuery, selectedCountryName);
        if (serverSuggestions.length) {
          chosen = serverSuggestions[0];
        }
      } catch (error) {
        chosen = null;
      }

      if (!chosen) {
        let predictions = [];
        try {
          predictions = await fetchCityPredictions(apis, cityQuery);
        } catch (error) {
          const fallback = await fetchFallbackCitySuggestions(cityQuery);
          if (!fallback.length) {
            setLookupStatus('No city result found. Try another city name.');
            setRecommendedCity(null);
            setPlacesBlocked(true);
            return;
          }

          setRecommendedCity(null);
          setLookupStatus('');
          if (onCitySelected) {
            const fallbackCity = fallback[0];
            const lat = Number(fallbackCity.lat);
            const lng = Number(fallbackCity.lon);
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              onCitySelected({
                lat,
                lng,
                name: fallbackCity.name || fallbackCity.description,
                formattedAddress: fallbackCity.formattedAddress || fallbackCity.description,
              });
            }
          }
          setPlacesBlocked(true);
          return;
        }

        if (!predictions.length) {
          setLookupStatus('No city result found. Try another city name.');
          setRecommendedCity(null);
          return;
        }

        const first = predictions[0];
        chosen = {
          placeId: first.placeId,
          name: first.name,
          description: first.description,
          formattedAddress: first.formattedAddress || first.description,
          photoUrl: await getPlaceImage(placesService, first.placeId),
        };
      }
    } else if (!chosen.photoUrl) {
      chosen = {
        ...chosen,
        photoUrl: await getPlaceImage(placesService, chosen.placeId),
      };
    }

    setRecommendedCity(chosen);
    setLookupStatus('City result found and returned as recommendation.');

    if (onCitySelected) {
      let chosenLocation = null;

      if (Number.isFinite(Number(chosen?.lat)) && Number.isFinite(Number(chosen?.lon))) {
        chosenLocation = { lat: Number(chosen.lat), lng: Number(chosen.lon) };
      } else if (chosen?.placeId) {
        chosenLocation = await getPlaceLocation(placesService, chosen.placeId);
      }

      if (chosenLocation) {
        onCitySelected({
          ...chosenLocation,
          name: chosen.name || String(chosen.description || '').split(',')[0].trim(),
          formattedAddress: chosen.formattedAddress || chosen.description || chosen.name || '',
        });
      }
    }
  };

  return (
    <div className="user-response">
      <div className="user-response-country-block">
        <div className="user-response-row">
          <input
            className="user-response-input"
            type="text"
            placeholder="Type a country"
            value={countryQuery}
            onChange={handleCountryInputChange}
            onFocus={() => setShowCountrySuggestions(Boolean(countryQuery.trim()) && !selectedCountryName)}
            autoComplete="off"
          />
        <button
          className={`user-response-button ${findingCities ? 'user-response-button--loading' : ''}`.trim()}
          type="button"
          onClick={handleFindCitiesClick}
          disabled={Boolean(findingCities)}
        >
          {findingCities ? (
            <span className="user-response-button-loading" aria-live="polite">
              <span>Finding</span>
              <span className="user-response-button-dots" aria-hidden="true">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            </span>
          ) : (
            'Find Cities'
          )}
        </button>
        </div>

        {showCountrySuggestions && filteredCountries.length > 0 && (
          <ul className="user-response-suggestions user-response-suggestions--country">
            {filteredCountries.map((country) => (
              <li key={country.code}>
                <button
                  type="button"
                  className="user-response-suggestion-item user-response-suggestion-item--country"
                  onClick={() => handleCountrySuggestionSelect(country)}
                >
                  <span className="user-response-country-name">{country.name}</span>
                  <span className="user-response-country-code">{country.code}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {findCitiesError && <p className="user-response-status">{findCitiesError}</p>}

      <div className="user-response-city-lookup">
        <input
          className="user-response-input"
          type="text"
          placeholder={selectedCountryName ? `Lookup city in ${selectedCountryName}` : 'Lookup city'}
          value={cityQuery}
          onChange={handleCityInputChange}
        />

        {suggestions.length > 0 && (
          <ul className="user-response-suggestions">
            {suggestions.map((suggestion) => (
              <li key={suggestion.placeId}>
                <button
                  type="button"
                  className="user-response-suggestion-item"
                  onClick={() => handleSuggestionClick(suggestion)}
                >
                  {suggestion.photoUrl ? (
                    <img
                      src={suggestion.photoUrl}
                      alt={suggestion.description}
                      className="user-response-suggestion-photo"
                    />
                  ) : (
                    <span className="user-response-suggestion-photo-placeholder">City</span>
                  )}
                  <span className="user-response-suggestion-label">{suggestion.description}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <button className="user-response-continue" type="button" onClick={handleContinue}>
          Continue
        </button>

        {lookupStatus && <p className="user-response-status">{lookupStatus}</p>}

      </div>
    </div>
  );
}
