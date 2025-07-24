// index.js
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3010;

app.use(bodyParser.json());

// Add logging for debugging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Serve static files with better configuration for Render
app.use('/static', express.static(path.join(__dirname, 'static'), {
    maxAge: '1d',
    etag: true
}));

// Also serve static files from root for flexibility
app.use(express.static(path.join(__dirname, 'static')));

// Root route
app.get('/', (req, res) => {
    const htmlPath = path.join(__dirname, 'pages', 'index.html');
    console.log('Serving HTML from:', htmlPath);
    res.sendFile(htmlPath);
});

// Health check endpoint (useful for Render)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Proxy endpoint for Pinecone queries
app.post('/pinecone-query', async (req, res) => {
    try {
        const queryPayload = req.body;
        const pineconeApiUrl = process.env.PINECONE_API_URL;
        const pineconeApiKey = process.env.PINECONE_API_KEY;

        console.log('Pinecone API URL configured:', !!pineconeApiUrl);
        console.log('Pinecone API Key configured:', !!pineconeApiKey);

        if (!pineconeApiUrl || !pineconeApiKey) {
            return res.status(500).json({ error: 'Pinecone API URL or API key not configured.' });
        }

        // Forward the request to Pinecone with credentials
        const response = await axios.post(pineconeApiUrl, queryPayload, {
            headers: {
                'Api-Key': pineconeApiKey,
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 second timeout
        });

        res.json(response.data);
    } catch (error) {
        console.error('Pinecone query error:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        res.status(500).json({ 
            error: error.message || 'Internal Server Error',
            details: error.response?.data || null
        });
    }
});

// Catch-all handler for unmatched routes
app.get('*', (req, res) => {
    console.log('404 - Route not found:', req.url);
    res.status(404).send(`Cannot GET ${req.url}`);
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
    console.log('Environment:', process.env.NODE_ENV || 'development');
    console.log('Static files directory:', path.join(__dirname, 'static'));
    console.log('Pages directory:', path.join(__dirname, 'pages'));
});