import React from 'react';
import './ChatContainer.css';
import appLogo from '../../assets/logo.png';
import ChatMessage from '../chat-message/ChatMessage';

export default function ChatContainer() {
  return (
    <div className="chat-container">
      <header className="chat-header">
        <img className="chat-header-logo" src={appLogo} alt="App logo" />
        <h1 className="chat-header-title">TRAVELLLER </h1>
        <p className="chat-header-subtitle">"Your AI travel companion"</p>
      </header>

      <div className="chat-body">
        <ChatMessage text="Hello Travelller!" />
      </div>
    </div>
  );
}
