# Client Setup

This folder contains the React + Vite frontend for the travel planner.

The client is responsible for:

- the chat interface
- Google Maps rendering
- city exploration and map zoom behavior
- itinerary display
- stop details modals

## Requirements

- Node.js 20+
- npm
- a Google Maps Platform API key
- the backend server running locally or deployed somewhere reachable

## Install

From inside this folder:

```powershell
npm install
```

## Environment Variables

Create a file named `.env.local` inside this folder.

Example:

```env
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
VITE_API_BASE_URL=http://localhost:5000
```

## Required Variables

- `VITE_GOOGLE_MAPS_API_KEY`: required for loading the Google map in the frontend
- `VITE_API_BASE_URL`: backend base URL used by the app

For local development, `VITE_API_BASE_URL` should usually be:

```env
VITE_API_BASE_URL=http://localhost:5000
```

## Run In Development

```powershell
npm run dev
```

Default local URL:

```text
http://localhost:5173
```

## Build For Demo / Production

```powershell
npm run build
```

The build output is created in:

```text
dist
```

## Preview The Production Build

```powershell
npm run preview
```

## Main Scripts

```json
{
	"dev": "vite",
	"build": "vite build",
	"preview": "vite preview"
}
```

## Setup Checklist

1. Open a terminal in `client/gdscWorkshop`
2. Run `npm install`
3. Create `client/gdscWorkshop/.env.local`
4. Add `VITE_GOOGLE_MAPS_API_KEY`
5. Set `VITE_API_BASE_URL` to your backend URL
6. Run `npm run dev`
7. Open `http://localhost:5173`

## Common Problems

### The map does not load

Check:

- `VITE_GOOGLE_MAPS_API_KEY` exists in `.env.local`
- your Google Maps key allows localhost
- the Maps JavaScript API is enabled

### Frontend loads but planning fails

Check:

- the backend server is running
- `VITE_API_BASE_URL` points to the correct backend
- the backend has valid API keys configured

### CORS or network errors

Check both sides:

- frontend `VITE_API_BASE_URL`
- backend `CLIENT_ORIGIN`

For local development they should usually be:

```env
# client/gdscWorkshop/.env.local
VITE_API_BASE_URL=http://localhost:5000

# server/.env
CLIENT_ORIGIN=http://localhost:5173
```

## Folder Purpose

Key files in this folder:

- `src/App.jsx`: top-level frontend state and app shell
- `src/components/chat-container/ChatContainer.jsx`: chat and planning flow
- `src/components/map-overlay/MapOverlay.jsx`: Google Maps display and camera logic
- `src/components/travel-stop-recommendation/`: itinerary UI
