import React, { useLayoutEffect, useRef, useState } from 'react';
import './ChatMessage.css';

export default function ChatMessage({ text, children, animatedWidth = true, className = '' }) {
  const measureRef = useRef(null);
  const [bubbleWidth, setBubbleWidth] = useState(null);
  const hasRichContent = Boolean(children);
  const shouldAnimateWidth = animatedWidth && !hasRichContent;

  useLayoutEffect(() => {
    if (!shouldAnimateWidth) {
      setBubbleWidth(null);
      return;
    }

    if (!measureRef.current) return;

    // Add horizontal padding value so the bubble tracks text width smoothly.
    const measuredWidth = Math.ceil(measureRef.current.offsetWidth + 28);
    setBubbleWidth(measuredWidth);
  }, [text, shouldAnimateWidth]);

  return (
    <div
      className={`chat-message ${shouldAnimateWidth ? '' : 'chat-message--wrap'} ${className}`.trim()}
      style={bubbleWidth ? { width: `${bubbleWidth}px` } : undefined}
    >
      {hasRichContent ? children : text}
      {shouldAnimateWidth && (
        <span ref={measureRef} className="chat-message-measure" aria-hidden="true">
          {text}
        </span>
      )}
    </div>
  );
}
