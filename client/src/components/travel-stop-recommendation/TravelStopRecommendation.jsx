import React, { useEffect, useMemo, useRef, useState } from 'react';
import './TravelStopRecommendation.css';
import TravelStopDetails from '../travel-stop-details/TravelStopDetails';

const detailsAnimationDurationMs = 420;

function getRatingMeta(rating, reviewCount) {
  const safeRating = Number(rating || 0);
  const safeReviewCount = Number(reviewCount || 0);

  if (!safeRating) {
    return {
      emoji: '✨',
      text: 'New recommendation',
      compactText: 'New',
    };
  }

  if (!safeReviewCount) {
    return {
      emoji: '⭐',
      text: `${safeRating.toFixed(1)} rated`,
      compactText: `${safeRating.toFixed(1)}`,
    };
  }

  return {
    emoji: '⭐',
    text: `${safeRating.toFixed(1)} · ${safeReviewCount.toLocaleString()} reviews`,
      compactText: `${safeRating.toFixed(1)} rating`,
  };
}

function formatMinutes(value, suffix) {
  const minutes = Number(value || 0);
  return `${minutes} ${suffix}`;
}

function renderPhoto(stop, variant) {
  if (stop.photoUrl) {
    return (
      <div className="travel-stop-card-photo-wrap">
        <img className="travel-stop-card-photo" src={stop.photoUrl} alt={stop.name} />
      </div>
    );
  }

  return (
    <div className="travel-stop-card-photo-wrap travel-stop-card-photo-wrap--placeholder">
      <span className="travel-stop-card-photo-placeholder">
        {variant === 'map' ? 'Stop' : 'Photo unavailable'}
      </span>
    </div>
  );
}

export function TravelStopRecommendationCard({
  stop,
  index,
  variant = 'chat',
  onViewDetails,
}) {
  const isMapVariant = variant === 'map';
  const cardClassName = `travel-stop-card ${variant === 'map' ? 'travel-stop-card--map' : ''}`.trim();
  const ratingMeta = getRatingMeta(stop.rating, stop.userRatingCount);

  return (
    <article className={cardClassName}>
      {renderPhoto(stop, variant)}
      <div className="travel-stop-card-body">
        <div className="travel-stop-card-topline">
          {!isMapVariant && <span className="travel-stop-card-time">{stop.startTime} to {stop.endTime}</span>}
        </div>
        <h4 className="travel-stop-card-title">{stop.name}</h4>
        {!isMapVariant && (
          <p className="travel-stop-card-meta">
            {stop.categoryLabel || stop.categoryId}
            {stop.primaryType ? ` • ${stop.primaryType}` : ''}
          </p>
        )}
        <div className="travel-stop-card-rating-row">
          <span className="travel-stop-card-rating-emoji" aria-hidden="true">{ratingMeta.emoji}</span>
          <p className="travel-stop-card-rating">{isMapVariant ? ratingMeta.compactText : ratingMeta.text}</p>
        </div>
        <div className="travel-stop-card-stats">
          <span className="travel-stop-card-stat">Spend {formatMinutes(stop.visitMinutes, 'min')}</span>
        </div>
        {!isMapVariant && stop.address && <p className="travel-stop-card-address">{stop.address}</p>}
        {!isMapVariant && (
          <div className="travel-stop-card-stats">
            <span className="travel-stop-card-stat">{formatMinutes(stop.travelMinutes, 'min away')}</span>
          </div>
        )}
        {!isMapVariant && stop.aiReason && <p className="travel-stop-card-reason">{stop.aiReason}</p>}
        {!isMapVariant && stop.visitDurationRationale && (
          <p className="travel-stop-card-duration-note">{stop.visitDurationRationale}</p>
        )}
        {!isMapVariant && stop.nextStep && <p className="travel-stop-card-next-step">Next: {stop.nextStep}</p>}
        {!isMapVariant && (
          <div className="travel-stop-card-actions">
            <button
              type="button"
              className="travel-stop-card-action-button"
              onClick={() => onViewDetails?.(stop)}
              disabled={!stop.placeId}
            >
              View details
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export function TravelStopRecommendationMapOverlay({ stop, index }) {
  return (
    <div className="travel-stop-map-overlay-content">
      <TravelStopRecommendationCard stop={stop} index={index} variant="map" />
      <div className="travel-stop-map-pin" aria-hidden="true">
        <span className="travel-stop-map-pin-number">{index + 1}</span>
      </div>
    </div>
  );
}

export default function TravelStopRecommendation({
  city,
  error,
  itinerary = [],
  onDetailsOpenChange,
  reply = '',
  timeRangeLabel = '',
}) {
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
  const [activeStop, setActiveStop] = useState(null);
  const [detailsCache, setDetailsCache] = useState({});
  const [detailsClosing, setDetailsClosing] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const closeTimerRef = useRef(null);

  const activeStopDetails = useMemo(() => {
    if (!activeStop?.placeId) {
      return null;
    }

    return detailsCache[activeStop.placeId] || null;
  }, [activeStop, detailsCache]);

  const detailsExpanded = Boolean(activeStop) && !detailsClosing;

  useEffect(() => {
    onDetailsOpenChange?.(detailsExpanded);

    return () => {
      onDetailsOpenChange?.(false);
    };
  }, [detailsExpanded, onDetailsOpenChange]);

  useEffect(() => () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!activeStop?.placeId || detailsCache[activeStop.placeId]) {
      return undefined;
    }

    const controller = new AbortController();

    const loadDetails = async () => {
      setDetailsLoading(true);
      setDetailsError('');

      try {
        const response = await fetch(
          `${apiBase}/api/planning/place-details?placeId=${encodeURIComponent(activeStop.placeId)}`,
          { signal: controller.signal },
        );
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load stop details.');
        }

        setDetailsCache((current) => ({
          ...current,
          [activeStop.placeId]: data?.details || null,
        }));
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return;
        }

        setDetailsError(fetchError.message || 'Failed to load stop details.');
      } finally {
        if (!controller.signal.aborted) {
          setDetailsLoading(false);
        }
      }
    };

    void loadDetails();

    return () => {
      controller.abort();
    };
  }, [activeStop, apiBase, detailsCache]);

  const handleViewDetails = (stop) => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    setActiveStop(stop);
    setDetailsClosing(false);
    setDetailsError('');
  };

  const handleCloseDetails = () => {
    setDetailsClosing(true);

    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }

    closeTimerRef.current = window.setTimeout(() => {
      setActiveStop(null);
      setDetailsClosing(false);
      setDetailsLoading(false);
      setDetailsError('');
      closeTimerRef.current = null;
    }, detailsAnimationDurationMs);
  };

  return (
    <>
      <div className="travel-stop-recommendation">
        {error ? (
          <div className="travel-stop-recommendation-state">
            <p className="travel-stop-recommendation-eyebrow">Planning issue</p>
            <p className="travel-stop-recommendation-summary">{error}</p>
          </div>
        ) : (
          <>
            <div className="travel-stop-recommendation-header">
              <p className="travel-stop-recommendation-eyebrow">Suggested plan</p>
              <h3 className="travel-stop-recommendation-title">{city}</h3>
              <p className="travel-stop-recommendation-summary">{timeRangeLabel}</p>
              {reply && <p className="travel-stop-recommendation-narrative">{reply}</p>}
            </div>

            {itinerary.length > 0 ? (
              <div className="travel-stop-recommendation-list">
                {itinerary.map((stop, index) => (
                  <TravelStopRecommendationCard
                    key={`${stop.placeId || stop.name}-${index}`}
                    stop={stop}
                    index={index}
                    onViewDetails={handleViewDetails}
                  />
                ))}
              </div>
            ) : (
              <p className="travel-stop-recommendation-summary">
                No stops fit inside this time range yet. Try a longer window or a different mix of activities.
              </p>
            )}
          </>
        )}
      </div>

      <TravelStopDetails
        open={detailsExpanded}
        closing={detailsClosing}
        stop={activeStop}
        details={activeStopDetails}
        loading={detailsLoading && !activeStopDetails}
        error={detailsError}
        onClose={handleCloseDetails}
      />
    </>
  );
}
