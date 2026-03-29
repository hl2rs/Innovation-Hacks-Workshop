const { Router } = require('express');
const { google } = require('googleapis');
const { callGemini } = require('../services/geminiService');

const router = Router();

// Direct Gemini chat — pass-through used when the React client sends a
// free-form message and wants the reply posted as a chat message in the UI.
router.post('/gemini/chat', async (req, res) => {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  const message = req.body?.message;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'A text message is required.' });
  }

  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing GOOGLE_AI_API_KEY in environment variables.' });
  }

  try {
    const reply = await callGemini(apiKey, message);

    if (!reply) {
      return res.status(502).json({ error: 'No response text returned by Gemini API.' });
    }

    return res.json({ reply });
  } catch (error) {
    console.error('Gemini route error:', error.message);
    return res.status(500).json({ error: 'Failed to generate AI response.' });
  }
});

// Google Custom Search proxy — forwards a query to the Custom Search API
// and returns title, link, and snippet for each result.
router.get('/google/search', async (req, res) => {
  const query = req.query.q;
  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;

  if (!query) {
    return res.status(400).json({ error: 'Missing required query param: q' });
  }

  if (!apiKey || !cseId) {
    return res.status(500).json({
      error: 'Server is missing GOOGLE_API_KEY or GOOGLE_CSE_ID in environment variables.'
    });
  }

  try {
    const customSearch = google.customsearch('v1');
    const response = await customSearch.cse.list({ auth: apiKey, cx: cseId, q: String(query) });

    const items = (response.data.items || []).map((item) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet
    }));

    return res.json({ items });
  } catch (error) {
    console.error('Google API error:', error.message);
    return res.status(502).json({ error: 'Failed to fetch results from Google API.' });
  }
});

module.exports = router;
