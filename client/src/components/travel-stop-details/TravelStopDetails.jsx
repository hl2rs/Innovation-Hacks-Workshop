import React, { useEffect } from 'react';
import './TravelStopDetails.css';

function formatBooleanLabel(value, yesLabel, noLabel = 'Not available') {
  if (value === true) {
    return yesLabel;
  }

  if (value === false) {
    return noLabel;
  }

  return 'Unknown';
}

function renderStars(rating) {
  const normalizedRating = Math.max(0, Math.min(5, Number(rating || 0)));
  const rounded = Math.round(normalizedRating);
  return `${'★'.repeat(rounded)}${'☆'.repeat(Math.max(0, 5 - rounded))}`;
}

export default function TravelStopDetails({
  open,
  closing = false,
  stop,
  details,
  loading,
  error,
  onClose,
}) {
  useEffect(() => {
    if (!stop) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, stop]);

  if (!stop) {
    return null;
  }

  const modalClassName = `travel-stop-details-modal ${closing ? 'travel-stop-details-modal--closing' : open ? 'travel-stop-details-modal--open' : ''}`.trim();

  const photoGallery = Array.isArray(details?.photos) && details.photos.length
    ? details.photos
    : stop.photoUrl
      ? [stop.photoUrl]
      : [];
  const reviews = Array.isArray(details?.reviews) ? details.reviews : [];
  const highlights = Array.isArray(details?.highlights) ? details.highlights.filter(Boolean) : [];
  const whatToDo = Array.isArray(details?.whatToDo) ? details.whatToDo.filter(Boolean) : [];
  const openingHours = Array.isArray(details?.weekdayDescriptions)
    ? details.weekdayDescriptions.filter(Boolean)
    : [];

  return (
    <div className={modalClassName} role="dialog" aria-modal="true" aria-labelledby="travel-stop-details-title">
      <button className="travel-stop-details-backdrop" type="button" aria-label="Close details" onClick={onClose} disabled={closing} />
      <div className="travel-stop-details-panel">
        <div className="travel-stop-details-header">
          <div className="travel-stop-details-header-copy">
            <p className="travel-stop-details-eyebrow">Stop details</p>
            <h3 id="travel-stop-details-title" className="travel-stop-details-title">{stop.name}</h3>
            <p className="travel-stop-details-subtitle">{details?.address || stop.address || 'Location details unavailable'}</p>
          </div>
          <button className="travel-stop-details-close" type="button" onClick={onClose} disabled={closing}>
            Close
          </button>
        </div>

        {loading ? (
          <div className="travel-stop-details-state">
            <p className="travel-stop-details-state-title">Loading details</p>
            <p className="travel-stop-details-state-copy">Gathering reviews, overview, photos, and opening-hour context for this stop.</p>
          </div>
        ) : error ? (
          <div className="travel-stop-details-state">
            <p className="travel-stop-details-state-title">Could not load details</p>
            <p className="travel-stop-details-state-copy">{error}</p>
          </div>
        ) : (
          <div className="travel-stop-details-content">
            {photoGallery.length > 0 && (
              <div className="travel-stop-details-gallery">
                <img
                  className="travel-stop-details-hero"
                  src={photoGallery[0]}
                  alt={stop.name}
                />
                {photoGallery.length > 1 && (
                  <div className="travel-stop-details-thumbs">
                    {photoGallery.slice(1, 5).map((photoUrl, index) => (
                      <img
                        key={`${photoUrl}-${index}`}
                        className="travel-stop-details-thumb"
                        src={photoUrl}
                        alt={`${stop.name} view ${index + 2}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="travel-stop-details-grid">
              <section className="travel-stop-details-section">
                <p className="travel-stop-details-section-label">Snapshot</p>
                <div className="travel-stop-details-facts">
                  <div className="travel-stop-details-fact">
                    <span className="travel-stop-details-fact-label">Rating</span>
                    <span className="travel-stop-details-fact-value">
                      {details?.rating ? `${Number(details.rating).toFixed(1)} ${renderStars(details.rating)}` : 'No rating yet'}
                    </span>
                  </div>
                  <div className="travel-stop-details-fact">
                    <span className="travel-stop-details-fact-label">Reviews</span>
                    <span className="travel-stop-details-fact-value">
                      {Number(details?.userRatingCount || stop.userRatingCount || 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="travel-stop-details-fact">
                    <span className="travel-stop-details-fact-label">Type</span>
                    <span className="travel-stop-details-fact-value">{details?.primaryType || stop.primaryType || 'General attraction'}</span>
                  </div>
                  <div className="travel-stop-details-fact">
                    <span className="travel-stop-details-fact-label">Open now</span>
                    <span className="travel-stop-details-fact-value">{formatBooleanLabel(details?.openNow, 'Open now', 'Closed now')}</span>
                  </div>
                  <div className="travel-stop-details-fact">
                    <span className="travel-stop-details-fact-label">Planned visit</span>
                    <span className="travel-stop-details-fact-value">{stop.visitMinutes} min</span>
                  </div>
                  <div className="travel-stop-details-fact">
                    <span className="travel-stop-details-fact-label">Travel time</span>
                    <span className="travel-stop-details-fact-value">{stop.travelMinutes} min away</span>
                  </div>
                </div>
              </section>

              <section className="travel-stop-details-section">
                <p className="travel-stop-details-section-label">AI overview</p>
                <p className="travel-stop-details-paragraph">
                  {details?.aiOverview || details?.summary || stop.aiReason || 'No AI overview available for this stop.'}
                </p>
                {stop.visitDurationRationale && (
                  <p className="travel-stop-details-supporting-copy">
                    Recommended stay: {stop.visitDurationRationale}
                  </p>
                )}
                {stop.nextStep && (
                  <p className="travel-stop-details-supporting-copy">
                    Flow note: {stop.nextStep}
                  </p>
                )}
              </section>

              {whatToDo.length > 0 && (
                <section className="travel-stop-details-section">
                  <p className="travel-stop-details-section-label">What to do here</p>
                  <ul className="travel-stop-details-list">
                    {whatToDo.map((item, index) => (
                      <li key={`${item}-${index}`} className="travel-stop-details-list-item">{item}</li>
                    ))}
                  </ul>
                </section>
              )}

              {highlights.length > 0 && (
                <section className="travel-stop-details-section">
                  <p className="travel-stop-details-section-label">Highlights</p>
                  <div className="travel-stop-details-highlights">
                    {highlights.map((highlight, index) => (
                      <span key={`${highlight.label || highlight}-${index}`} className="travel-stop-details-highlight-pill">
                        {typeof highlight === 'string' ? highlight : `${highlight.label}: ${highlight.value}`}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {openingHours.length > 0 && (
                <section className="travel-stop-details-section">
                  <p className="travel-stop-details-section-label">Opening hours</p>
                  <ul className="travel-stop-details-hours">
                    {openingHours.map((entry) => (
                      <li key={entry} className="travel-stop-details-hours-item">{entry}</li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="travel-stop-details-section">
                <p className="travel-stop-details-section-label">Links</p>
                <div className="travel-stop-details-links">
                  {details?.googleMapsUri && (
                    <a className="travel-stop-details-link" href={details.googleMapsUri} target="_blank" rel="noreferrer">Open in Google Maps</a>
                  )}
                  {details?.websiteUri && (
                    <a className="travel-stop-details-link" href={details.websiteUri} target="_blank" rel="noreferrer">Official website</a>
                  )}
                </div>
              </section>

              <section className="travel-stop-details-section travel-stop-details-section--full">
                <p className="travel-stop-details-section-label">Visitor reviews</p>
                {reviews.length > 0 ? (
                  <div className="travel-stop-details-reviews">
                    {reviews.map((review, index) => (
                      <article key={`${review.authorName || 'review'}-${index}`} className="travel-stop-details-review">
                        <div className="travel-stop-details-review-head">
                          <div>
                            <p className="travel-stop-details-review-author">{review.authorName || 'Visitor'}</p>
                            <p className="travel-stop-details-review-meta">
                              {review.rating ? `${Number(review.rating).toFixed(1)} · ` : ''}
                              {review.relativePublishTimeDescription || 'Recent review'}
                            </p>
                          </div>
                        </div>
                        <p className="travel-stop-details-review-text">{review.text || 'No written review.'}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="travel-stop-details-paragraph">No review excerpts are available for this stop.</p>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
