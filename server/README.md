# Server Setup

This folder contains the Express backend for the travel planner.

The server is responsible for:

- itinerary planning
- Gemini chat and recommendation logic
- Google Places lookups
- Google Routes travel-time lookups
- place details and AI summaries

## Requirements

- Node.js 20+
- npm
- a Google Maps Platform API key
- a Google AI API key for Gemini

Optional:

- Google Custom Search API key
- Google Custom Search Engine ID

## Install

From inside this folder:

```powershell
npm install
```

## Environment Variables

Create a file named `.env` inside this folder.

Example:

```env
PORT=5000
CLIENT_ORIGIN=http://localhost:5173
GOOGLE_AI_API_KEY=your_gemini_api_key
GOOGLE_MAPS_API_KEY=your_google_maps_api_key

# Optional
GOOGLE_API_KEY=your_google_custom_search_api_key
GOOGLE_CSE_ID=your_custom_search_engine_id
```

## Required Variables

- `PORT`: backend port, usually `5000`
- `CLIENT_ORIGIN`: frontend origin allowed by CORS
- `GOOGLE_AI_API_KEY`: required for Gemini chat and itinerary generation
- `GOOGLE_MAPS_API_KEY`: required for city lookup, planning, place details, and travel routing

## Optional Variables

- `GOOGLE_API_KEY`: only needed for the Google search proxy route
- `GOOGLE_CSE_ID`: only needed for the Google search proxy route

## Run In Development

```powershell
npm run dev
```

This starts the server with `nodemon`.

Default local URL:

```text
http://localhost:5000
```

## Run In Production Style

```powershell
npm run start
```

## Health Check

Once the server is running, open:

```text
http://localhost:5000/api/health
```

You should get a JSON response showing the server is running.

## Main Scripts

```json
{
  "dev": "nodemon src/index.js",
  "start": "node src/index.js"
}
```

## Setup Checklist

1. Open a terminal in `server`
2. Run `npm install`
3. Create `server/.env`
4. Add the required API keys
5. Run `npm run dev`
6. Confirm `http://localhost:5000/api/health` works

## Common Problems

### Server says environment variables are missing

Check that:

- `.env` exists in the `server` folder
- variable names are spelled exactly right
- the server was restarted after editing `.env`

### Planning or city lookup fails

Usually caused by:

- missing `GOOGLE_AI_API_KEY`
- missing `GOOGLE_MAPS_API_KEY`
- Places API not enabled
- Routes API not enabled

### CORS errors from the frontend

Check that `CLIENT_ORIGIN` matches the frontend URL exactly.

For local development, this is usually:

```env
CLIENT_ORIGIN=http://localhost:5173
```

## Folder Purpose

Key files in this folder:

- `src/index.js`: main backend entry point used by the npm scripts
- `routes/planningRoutes.js`: itinerary planning routes
- `routes/aiRoutes.js`: Gemini and optional Google search routes
- `services/`: integrations with Gemini, Places, Routes, and city ranking
