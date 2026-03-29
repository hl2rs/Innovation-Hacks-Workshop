const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const planningRoutes = require('./routes/planningRoutes');
const aiRoutes = require('./routes/aiRoutes');

const app = express();
const port = Number(process.env.PORT) || 5000;
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

app.use(cors({ origin: clientOrigin }));
app.use(express.json());

// Health check � used to verify the server is running.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'google-api-backend' });
});

app.use('/api/planning', planningRoutes);
app.use('/api', aiRoutes);

// Global error handler � catches any unhandled errors thrown by route handlers.
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
