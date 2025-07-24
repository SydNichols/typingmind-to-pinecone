// index.js
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3010;

app.use(bodyParser.json());

// Proxy endpoint for Pinecone queries
app.post('/pinecone-query', async (req, res) => {
    try {
        const queryPayload = req.body;
        const pineconeApiUrl = process.env.PINECONE_API_URL;
        const pineconeApiKey = process.env.PINECONE_API_KEY;

        if (!pineconeApiUrl || !pineconeApiKey) {
            return res.status(500).json({ error: 'Pinecone API URL or API key not configured.' });
        }

        // Forward the request to Pinecone with credentials
        const response = await axios.post(pineconeApiUrl, queryPayload, {
            headers: {
                'Api-Key': pineconeApiKey,
                'Content-Type': 'application/json'
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

app.listen(port, () => {
    console.log(`Pinecone proxy server listening at http://localhost:${port}`);
});
