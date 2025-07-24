// index.js - Complete Pinecone Semantic Search Implementation
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

// Serve static files
app.use('/static', express.static(path.join(__dirname, 'static'), {
    maxAge: '1d',
    etag: true
}));
app.use(express.static(path.join(__dirname, 'static')));

// Root route
app.get('/', (req, res) => {
    const htmlPath = path.join(__dirname, 'pages', 'index.html');
    console.log('Serving HTML from:', htmlPath);
    res.sendFile(htmlPath);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Enhanced Pinecone semantic search endpoint
app.post('/pinecone-query', async (req, res) => {
    try {
        const {
            query,
            namespace = "__default__",
            top_k = 10,
            fields = [],
            filters = {},
            rerank = null,
            search_type = "text" // "text", "vector", or "id"
        } = req.body;

        // Validate environment variables
        const pineconeIndexHost = process.env.PINECONE_INDEX_HOST;
        const pineconeApiKey = process.env.PINECONE_API_KEY;

        if (!pineconeIndexHost || !pineconeApiKey) {
            return res.status(500).json({ 
                error: 'Pinecone configuration missing. Please set PINECONE_INDEX_HOST and PINECONE_API_KEY environment variables.',
                details: {
                    hasIndexHost: !!pineconeIndexHost,
                    hasApiKey: !!pineconeApiKey
                }
            });
        }

        // Validate required query parameter
        if (!query) {
            return res.status(400).json({ 
                error: 'Query parameter is required',
                expectedFormat: {
                    text_search: { query: "your search text" },
                    vector_search: { query: [0.1, 0.2, 0.3] },
                    id_search: { query: "record_id" }
                }
            });
        }

        // Build the Pinecone API URL
        const pineconeApiUrl = `https://${pineconeIndexHost}/records/namespaces/${encodeURIComponent(namespace)}/search`;

        // Build request payload based on search type
        let requestPayload = {
            top_k: Math.min(top_k, 10000) // Pinecone limit
        };

        // Add fields if specified
        if (fields && fields.length > 0) {
            requestPayload.fields = fields;
        }

        // Add filters if specified
        if (filters && Object.keys(filters).length > 0) {
            requestPayload.filter = filters;
        }

        // Configure query based on search type
        switch (search_type) {
            case "text":
                // Text search with integrated embedding
                if (typeof query !== 'string') {
                    return res.status(400).json({ 
                        error: 'For text search, query must be a string',
                        example: { query: "find documents about machine learning" }
                    });
                }
                requestPayload.query = {
                    inputs: { text: query },
                    top_k: requestPayload.top_k
                };
                break;

            case "vector":
                // Vector search
                if (!Array.isArray(query) || query.some(v => typeof v !== 'number')) {
                    return res.status(400).json({ 
                        error: 'For vector search, query must be an array of numbers',
                        example: { query: [0.1, 0.2, 0.3, 0.4] }
                    });
                }
                requestPayload.query = {
                    vector: { values: query },
                    top_k: requestPayload.top_k
                };
                break;

            case "id":
                // ID-based search
                if (typeof query !== 'string') {
                    return res.status(400).json({ 
                        error: 'For ID search, query must be a record ID string',
                        example: { query: "record_123" }
                    });
                }
                requestPayload.query = {
                    id: query,
                    top_k: requestPayload.top_k
                };
                break;

            default:
                return res.status(400).json({ 
                    error: 'Invalid search_type. Must be "text", "vector", or "id"',
                    received: search_type
                });
        }

        // Add reranking if specified
        if (rerank && rerank.model) {
            requestPayload.rerank = {
                model: rerank.model || "bge-reranker-v2-m3",
                top_n: rerank.top_n || Math.min(top_k, 100),
                rank_fields: rerank.rank_fields || fields
            };

            // Add query for reranking if it's vector or ID search
            if (search_type !== "text" && rerank.query) {
                requestPayload.rerank.query = rerank.query;
            }
        }

        console.log('Pinecone request payload:', JSON.stringify(requestPayload, null, 2));

        // Make the request to Pinecone
        const response = await axios.post(pineconeApiUrl, requestPayload, {
            headers: {
                'Api-Key': pineconeApiKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 30000 // 30 second timeout
        });

        // Process and return the response
        const searchResults = response.data;
        
        // Add some metadata to the response
        const enhancedResults = {
            ...searchResults,
            metadata: {
                search_type,
                namespace,
                top_k,
                total_results: searchResults.result?.hits?.length || 0,
                has_reranking: !!rerank,
                timestamp: new Date().toISOString()
            }
        };

        console.log(`Pinecone search completed: ${enhancedResults.metadata.total_results} results found`);
        
        res.json(enhancedResults);

    } catch (error) {
        console.error('Pinecone query error:', error.message);
        
        if (error.response) {
            console.error('Pinecone API error details:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            });
            
            // Return specific Pinecone API errors
            return res.status(error.response.status).json({
                error: 'Pinecone API error',
                details: error.response.data,
                status: error.response.status,
                statusText: error.response.statusText
            });
        }
        
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            return res.status(503).json({
                error: 'Unable to connect to Pinecone API',
                details: 'Please check your PINECONE_INDEX_HOST configuration',
                code: error.code
            });
        }

        // Generic error response
        res.status(500).json({ 
            error: 'Internal server error during Pinecone query',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Example endpoint to demonstrate usage
app.get('/pinecone-examples', (req, res) => {
    res.json({
        examples: {
            text_search: {
                method: "POST",
                url: "/pinecone-query",
                body: {
                    query: "machine learning algorithms",
                    search_type: "text",
                    namespace: "documents",
                    top_k: 5,
                    fields: ["title", "content", "category"],
                    filters: { category: { "$eq": "technology" } },
                    rerank: {
                        model: "bge-reranker-v2-m3",
                        top_n: 3,
                        rank_fields: ["content"]
                    }
                }
            },
            vector_search: {
                method: "POST",
                url: "/pinecone-query",
                body: {
                    query: [0.1, 0.2, 0.3, 0.4, 0.5],
                    search_type: "vector",
                    namespace: "embeddings",
                    top_k: 10,
                    fields: ["metadata", "text"]
                }
            },
            id_search: {
                method: "POST",
                url: "/pinecone-query",
                body: {
                    query: "record_123",
                    search_type: "id",
                    namespace: "documents",
                    top_k: 5,
                    fields: ["similar_items"]
                }
            }
        },
        environment_variables: {
            required: [
                "PINECONE_INDEX_HOST - Your Pinecone index host (e.g., 'your-index-abc123.svc.us-east1-gcp.pinecone.io')",
                "PINECONE_API_KEY - Your Pinecone API key"
            ],
            optional: [
                "NODE_ENV - Set to 'production' for production deployments"
            ]
        },
        supported_rerank_models: [
            "bge-reranker-v2-m3",
            "bge-reranker-base"
        ]
    });
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
    console.log('Pinecone Index Host:', process.env.PINECONE_INDEX_HOST ? 'Configured' : 'NOT SET');
    console.log('Pinecone API Key:', process.env.PINECONE_API_KEY ? 'Configured' : 'NOT SET');
    console.log('\nEndpoints:');
    console.log('  GET  /              - Main page');
    console.log('  GET  /health        - Health check');
    console.log('  POST /pinecone-query - Semantic search');
    console.log('  GET  /pinecone-examples - Usage examples');
});