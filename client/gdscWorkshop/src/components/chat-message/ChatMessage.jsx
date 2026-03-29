import React from 'react';
import './ChatMessage.css';

export default function ChatMessage({ text }) {
  return (
    <div className="chat-message">
      {text}
    </div>
  );
}
