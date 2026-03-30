import React, { useEffect, useRef, useState } from 'react';
import './ChatContainer.css';
import appLogo from '../../assets/logo.png';
import ChatMessage from '../chat-message/ChatMessage';
import UserResponse from '../user-response/UserResponse';
import CityRecommendation from '../city-recommendation/CityRecommendation';
import TravelStopRecommendation from '../travel-stop-recommendation/TravelStopRecommendation';

function PlanningFindingMessage() {
  return (
    <span className="planning-finding-message" aria-live="polite" role="status">
      <span>Finding</span>
      <span className="planning-finding-message-dots" aria-hidden="true">
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </span>
  );
}

const activityCategories = [
  '🍜 Food & Dining',
  '🌄 Nature & Outdoors',
  '🏛️ History & Landmarks',
  '🎭 Culture & Arts',
  '🎢 Entertainment & Attractions',
  '🛍️ Shopping',
  '🧗 Adventure & Activities',
  '🌙 Nightlife',
];

const timeOptions = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const meridiemOptions = ['AM', 'PM'];

export default function ChatContainer({
  onFindCities,
  onCitySelected,
  onDetailsOpenChange,
  onPlanningStateChange,
  onItineraryChange,
  onRoutePolylineChange,
  onRecommendationHoverChange,
  onPlanningInputChange,
  recommendedCities,
  selectedCountry,
  selectedCity,
  findingCities,
  findCitiesError,
}) {
  const [message, setMessage] = useState('Hello Travler!');
  const [showUserResponse, setShowUserResponse] = useState(false);
  const [showRecommendationMessage, setShowRecommendationMessage] = useState(false);
  const [showActivityPrompt, setShowActivityPrompt] = useState(false);
  const [showActivityCategories, setShowActivityCategories] = useState(false);
  const [selectedActivityCategories, setSelectedActivityCategories] = useState([]);
  const [showTimePrompt, setShowTimePrompt] = useState(false);
  const [showTimeSelector, setShowTimeSelector] = useState(false);
  const [hasConfirmedCategories, setHasConfirmedCategories] = useState(false);
  const [hasConfirmedTimeRange, setHasConfirmedTimeRange] = useState(false);
  const [planningLoading, setPlanningLoading] = useState(false);
  const [planningError, setPlanningError] = useState('');
  const [plannedItinerary, setPlannedItinerary] = useState([]);
  const [planningReply, setPlanningReply] = useState('');
  const [timeRange, setTimeRange] = useState({
    fromHour: '9',
    fromMeridiem: 'AM',
    toHour: '6',
    toMeridiem: 'PM',
  });
  const chatBodyRef = useRef(null);
  const bottomAnchorRef = useRef(null);
  const selectedCityKey = selectedCity
    ? `${selectedCity.name || 'city'}-${selectedCity.lat}-${selectedCity.lng}`
    : '';
  const timeRangeLabel = `Planning from ${timeRange.fromHour} ${timeRange.fromMeridiem} to ${timeRange.toHour} ${timeRange.toMeridiem}`;
  const hasPlanningContent =
    planningLoading ||
    Boolean(planningError) ||
    plannedItinerary.length > 0 ||
    Boolean(planningReply);
  const planningStatusText = planningLoading
    ? plannedItinerary.length
      ? `Added ${plannedItinerary.length} stop${plannedItinerary.length === 1 ? '' : 's'}. Finding the next one...`
      : `Finding...`
    : planningError
      ? 'I ran into a problem building the plan.'
      : plannedItinerary.length > 0 || planningReply
        ? 'Here is a route that fits your time window.'
        : 'I could not fit strong recommendations into that time window.';

  const scrollChatToBottom = () => {
    if (!bottomAnchorRef.current) return;

    bottomAnchorRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  };

  useEffect(() => {
    const messageTimer = setTimeout(() => {
      setMessage('What country and city are you visiting?');
    }, 1000);

    const userResponseTimer = setTimeout(() => {
      setShowUserResponse(true);
    }, 2000);

    return () => {
      clearTimeout(messageTimer);
      clearTimeout(userResponseTimer);
    };
  }, []);

  useEffect(() => {
    let recommendationTimer;

    if (recommendedCities.length > 0) {
      setShowRecommendationMessage(false);
      recommendationTimer = window.setTimeout(() => {
        setShowRecommendationMessage(true);
      }, 450);
    } else {
      setShowRecommendationMessage(false);
    }

    return () => {
      window.clearTimeout(recommendationTimer);
    };
  }, [recommendedCities, selectedCountry]);

  useEffect(() => {
    if (!selectedCityKey) {
      setShowActivityPrompt(false);
      setShowActivityCategories(false);
      setSelectedActivityCategories([]);
      setShowTimePrompt(false);
      setShowTimeSelector(false);
      setHasConfirmedCategories(false);
      setHasConfirmedTimeRange(false);
      setPlanningLoading(false);
      setPlanningError('');
      setPlannedItinerary([]);
      setPlanningReply('');
      onRoutePolylineChange?.('');
      return undefined;
    }

    setShowActivityPrompt(true);
    setShowActivityCategories(false);
    setSelectedActivityCategories([]);
    setShowTimePrompt(false);
    setShowTimeSelector(false);
    setHasConfirmedCategories(false);
    setHasConfirmedTimeRange(false);
    setPlanningLoading(false);
    setPlanningError('');
    setPlannedItinerary([]);
    setPlanningReply('');
    onRoutePolylineChange?.('');
    setTimeRange({
      fromHour: '9',
      fromMeridiem: 'AM',
      toHour: '6',
      toMeridiem: 'PM',
    });

    const categoriesTimer = window.setTimeout(() => {
      setShowActivityCategories(true);
    }, 1000);

    return () => {
      window.clearTimeout(categoriesTimer);
    };
  }, [selectedCityKey]);

  useEffect(() => {
    if (!hasConfirmedCategories || !selectedActivityCategories.length) {
      setShowTimePrompt(false);
      setShowTimeSelector(false);
      return undefined;
    }

    setShowTimePrompt(true);
    setShowTimeSelector(false);

    const timeSelectorTimer = window.setTimeout(() => {
      setShowTimeSelector(true);
    }, 1000);

    return () => {
      window.clearTimeout(timeSelectorTimer);
    };
  }, [hasConfirmedCategories, selectedActivityCategories]);

  useEffect(() => {
    if (!selectedCity || !hasConfirmedTimeRange || !selectedActivityCategories.length) {
      setPlanningLoading(false);
      setPlanningError('');
      setPlannedItinerary([]);
      setPlanningReply('');
      onRoutePolylineChange?.('');
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPlanningLoading(true);
      setPlanningError('');
      setPlannedItinerary([]);
      setPlanningReply('');
      onRoutePolylineChange?.('');

      try {
        const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
        let currentItinerary = [];
        let currentMinute;
        let currentLocation = null;
        let center = null;
        let done = false;
        let finalMessage = '';
        const planningCity = selectedCity.formattedAddress || selectedCity.name;

        while (!done && !controller.signal.aborted) {
          const response = await fetch(`${apiBase}/api/planning/next`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
              city: planningCity,
              cityName: selectedCity.name,
              destinationContext: planningCity,
              country: selectedCountry,
              categories: selectedActivityCategories,
              startHour: timeRange.fromHour,
              startPeriod: timeRange.fromMeridiem,
              endHour: timeRange.toHour,
              endPeriod: timeRange.toMeridiem,
              itinerary: currentItinerary,
              currentMinute,
              currentLocation,
              center,
            }),
          });

          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data.error || 'Failed to build travel plan.');
          }

          center = data?.center || center;
          currentLocation = data?.currentLocation || currentLocation;
          currentMinute = Number.isFinite(Number(data?.currentMinute))
            ? Number(data.currentMinute)
            : currentMinute;

          const nextItinerary = Array.isArray(data?.itinerary) ? data.itinerary : currentItinerary;
          const appendedStop = nextItinerary.length > currentItinerary.length;
          currentItinerary = nextItinerary;
          setPlannedItinerary(currentItinerary);
          onRoutePolylineChange?.(typeof data?.routePolyline === 'string' ? data.routePolyline : '');

          if (data?.done || !appendedStop) {
            done = true;
            const completionMessage = String(data?.message || '').trim();
            finalMessage = (
              completionMessage
                ? completionMessage
                : currentItinerary.length
                  ? `Built ${currentItinerary.length} stop${currentItinerary.length === 1 ? '' : 's'} in your time window.`
                  : 'I could not fit any stops in that time window.'
            ).trim();
            break;
          }

          await new Promise((resolve) => {
            const pauseTimer = window.setTimeout(resolve, 320);
            controller.signal.addEventListener(
              'abort',
              () => {
                window.clearTimeout(pauseTimer);
                resolve();
              },
              { once: true }
            );
          });
        }

        if (!controller.signal.aborted) {
          setPlanningReply(finalMessage);
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          return;
        }

        setPlanningError(error.message || 'Failed to build travel plan.');
      } finally {
        if (!controller.signal.aborted) {
          setPlanningLoading(false);
        }
      }
    }, 450);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [hasConfirmedTimeRange, onRoutePolylineChange, selectedActivityCategories, selectedCity, timeRange]);

  useEffect(() => {
    if (typeof onItineraryChange === 'function') {
      onItineraryChange(plannedItinerary);
    }
  }, [onItineraryChange, plannedItinerary]);

  useEffect(() => {
    if (typeof onPlanningStateChange === 'function') {
      onPlanningStateChange(planningLoading);
    }
  }, [onPlanningStateChange, planningLoading]);

  useEffect(() => {
    const timerA = window.setTimeout(scrollChatToBottom, 0);
    const timerB = window.setTimeout(scrollChatToBottom, 180);
    const timerC = window.setTimeout(scrollChatToBottom, 420);

    return () => {
      window.clearTimeout(timerA);
      window.clearTimeout(timerB);
      window.clearTimeout(timerC);
    };
  }, [
    message,
    recommendedCities.length,
    hasConfirmedCategories,
    hasConfirmedTimeRange,
    selectedActivityCategories.length,
    selectedCityKey,
    showActivityCategories,
    showActivityPrompt,
    showRecommendationMessage,
    showTimePrompt,
    showTimeSelector,
    showUserResponse,
    plannedItinerary.length,
    planningError,
    planningLoading,
    planningReply,
  ]);

  const toggleActivityCategory = (category) => {
    setHasConfirmedCategories(false);
    setHasConfirmedTimeRange(false);

    setSelectedActivityCategories((currentCategories) => {
      if (currentCategories.includes(category)) {
        return currentCategories.filter((value) => value !== category);
      }

      return [...currentCategories, category];
    });
  };

  const updateTimeRange = (field, value) => {
    setHasConfirmedTimeRange(false);

    setTimeRange((currentRange) => ({
      ...currentRange,
      [field]: value,
    }));
  };

  const handleContinueCategories = () => {
    if (!selectedActivityCategories.length) {
      return;
    }

    setHasConfirmedCategories(true);
  };

  const handleContinueTimeRange = () => {
    setPlanningLoading(true);
    setPlanningError('');
    setPlannedItinerary([]);
    setPlanningReply('');
    setHasConfirmedTimeRange(true);
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <img className="chat-header-logo" src={appLogo} alt="App logo" />
        <h1 className="chat-header-title">TRAVLER</h1>
        {/* <p className="chat-header-subtitle">"Your AI travel companion"</p> */}
      </header>

      <div ref={chatBodyRef} className="chat-body">
        <ChatMessage text={message} />
        {showUserResponse && (
          <UserResponse
            onFindCities={onFindCities}
            onCitySelected={onCitySelected}
            onPlanningInputChange={onPlanningInputChange}
            findingCities={findingCities}
            findCitiesError={findCitiesError}
          />
        )}
        {showRecommendationMessage && recommendedCities.length > 0 && (
          <ChatMessage animatedWidth={false} className="chat-message-rich">
            <CityRecommendation
              country={selectedCountry}
              cities={recommendedCities}
              inMessage
              onContentReady={scrollChatToBottom}
              onCityHoverChange={onRecommendationHoverChange}
              onCitySelect={onCitySelected}
            />
          </ChatMessage>
        )}
        {showActivityPrompt && selectedCity && (
          <ChatMessage
            text={`What would you like to do in ${selectedCity.name || 'this city'}?`}
          />
        )}
        {showActivityCategories && (
          <div className="activity-category-message">
            <p className="activity-category-message-title">I want ideas for:</p>
            <div className="activity-category-list">
              {activityCategories.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={`activity-category-chip ${selectedActivityCategories.includes(category) ? 'activity-category-chip--selected' : ''}`.trim()}
                  aria-pressed={selectedActivityCategories.includes(category)}
                  onClick={() => toggleActivityCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="activity-step-continue"
              onClick={handleContinueCategories}
              disabled={!selectedActivityCategories.length}
            >
              Continue
            </button>
          </div>
        )}
        {showTimePrompt && selectedActivityCategories.length > 0 && (
          <ChatMessage text="What time period should I plan for?" />
        )}
        {showTimeSelector && selectedActivityCategories.length > 0 && (
          <div className="activity-time-message">
            <p className="activity-time-message-title">Choose a time range</p>
            <div className="activity-time-range-row">
              <div className="activity-time-group">
                <p className="activity-time-group-label">From</p>
                <div className="activity-time-group-controls">
                  <select
                    className="activity-time-select"
                    value={timeRange.fromHour}
                    onChange={(event) => updateTimeRange('fromHour', event.target.value)}
                  >
                    {timeOptions.map((option) => (
                      <option key={`from-${option}`} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <select
                    className="activity-time-select activity-time-select--meridiem"
                    value={timeRange.fromMeridiem}
                    onChange={(event) => updateTimeRange('fromMeridiem', event.target.value)}
                  >
                    {meridiemOptions.map((option) => (
                      <option key={`from-${option}`} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="activity-time-group">
                <p className="activity-time-group-label">To</p>
                <div className="activity-time-group-controls">
                  <select
                    className="activity-time-select"
                    value={timeRange.toHour}
                    onChange={(event) => updateTimeRange('toHour', event.target.value)}
                  >
                    {timeOptions.map((option) => (
                      <option key={`to-${option}`} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <select
                    className="activity-time-select activity-time-select--meridiem"
                    value={timeRange.toMeridiem}
                    onChange={(event) => updateTimeRange('toMeridiem', event.target.value)}
                  >
                    {meridiemOptions.map((option) => (
                      <option key={`to-${option}`} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="activity-step-continue"
              onClick={handleContinueTimeRange}
            >
              Continue
            </button>
            {hasConfirmedTimeRange && (
              <p className="activity-time-confirmation">
              </p>
            )}
          </div>
        )}
        {hasConfirmedTimeRange && selectedCity && planningLoading && (
          <ChatMessage animatedWidth={false}>
            <PlanningFindingMessage />
          </ChatMessage>
        )}
        {hasConfirmedTimeRange && selectedCity && !planningLoading && hasPlanningContent && (
          <ChatMessage text={planningStatusText} />
        )}
        {hasConfirmedTimeRange && selectedCity && (Boolean(planningError) || plannedItinerary.length > 0 || Boolean(planningReply)) && (
          <ChatMessage animatedWidth={false} className="chat-message-rich chat-message-rich--itinerary">
            <TravelStopRecommendation
              city={selectedCity.name || 'Your city'}
              error={planningError}
              itinerary={plannedItinerary}
              onDetailsOpenChange={onDetailsOpenChange}
              reply={planningReply}
              timeRangeLabel={timeRangeLabel}
            />
          </ChatMessage>
        )}
        <div ref={bottomAnchorRef} aria-hidden="true" />
      </div>
    </div>
  );
}
