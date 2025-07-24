// index.js - Corrected Pinecone API Implementation
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

console.log('=== ENVIRONMENT VARIABLES DEBUG ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);

const app = express();
const port = process.env.PORT || 3010;

app.use(bodyParser.json());

// Enhanced logging function
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    if (data) {
        console.log(logEntry, JSON.stringify(data, null, 2));
    } else {
        console.log(logEntry);
    }
}

// Request logging
app.use((req, res, next) => {
    log('info', `${req.method} ${req.url}`);
    next();
});

// Serve static files
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(express.static(path.join(__dirname, 'static')));

// Root route
app.get('/', (req, res) => {
    const htmlPath = path.join(__dirname, 'pages', 'index.html');
    res.sendFile(htmlPath);
});

// Health check
app.get('/health', (req, res) => {
    const pineconeApiKey = process.env.PINECONE_API_KEY;
    const pineconeIndexHost = process.env.PINECONE_INDEX_HOST;
    
    const healthData = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        port: port,
        pineconeConfig: {
            apiKey: {
                isSet: !!pineconeApiKey,
                length: pineconeApiKey ? pineconeApiKey.length : 0
            },
            indexHost: {
                isSet: !!pineconeIndexHost,
                value: pineconeIndexHost || null
            }
        }
    };
    
    res.json(healthData);
});

// Corrected Pinecone query endpoint
app.post('/pinecone-query', async (req, res) => {
    log('info', 'Pinecone query started', { body: req.body });
    
    try {
        const {
            query,
            namespace = "__default__",
            top_k = 10,
            fields = [],
            filters = {},
            rerank = null,
            search_type = "text"
        } = req.body;

        // Get environment variables
        const pineconeApiKey = process.env.PINECONE_API_KEY;
        const pineconeIndexHost = process.env.PINECONE_INDEX_HOST;

        if (!pineconeApiKey || !pineconeIndexHost) {
            log('error', 'Missing Pinecone configuration');
            return res.status(500).json({ 
                error: 'Pinecone configuration missing. Please set PINECONE_API_KEY and PINECONE_INDEX_HOST environment variables.',
                details: {
                    hasApiKey: !!pineconeApiKey,
                    hasIndexHost: !!pineconeIndexHost
                }
            });
        }

        if (!query) {
            return res.status(400).json({ 
                error: 'Query parameter is required'
            });
        }

        // Build the Pinecone API URL
        const pineconeApiUrl = `https://${pineconeIndexHost}/records/namespaces/${encodeURIComponent(namespace)}/search`;

        // Build request payload according to Pinecone API 2025-01 specification
        let requestPayload = {};

        // Configure query based on search type
        switch (search_type) {
            case "text":
                // Text search with integrated embedding
                if (typeof query !== 'string') {
                    return res.status(400).json({ 
                        error: 'For text search, query must be a string'
                    });
                }
                requestPayload.query = {
                    inputs: { text: query },
                    top_k: Math.min(top_k, 10000)
                };
                break;

            case "vector":
                // Vector search
                if (!Array.isArray(query) || query.some(v => typeof v !== 'number')) {
                    return res.status(400).json({ 
                        error: 'For vector search, query must be an array of numbers'
                    });
                }
                requestPayload.query = {
                    vector: { values: query },
                    top_k: Math.min(top_k, 10000)
                };
                break;

            case "id":
                // ID-based search
                if (typeof query !== 'string') {
                    return res.status(400).json({ 
                        error: 'For ID search, query must be a record ID string'
                    });
                }
                requestPayload.query = {
                    id: query,
                    top_k: Math.min(top_k, 10000)
                };
                break;

            default:
                return res.status(400).json({ 
                    error: 'Invalid search_type. Must be "text", "vector", or "id"',
                    received: search_type
                });
        }

        // Add fields if specified
        if (fields && fields.length > 0) {
            requestPayload.fields = fields;
        }

        // Add filters if specified
        if (filters && Object.keys(filters).length > 0) {
            requestPayload.filter = filters;
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

        log('info', 'Sending request to Pinecone', { 
            url: pineconeApiUrl,
            payload: requestPayload 
        });

        // Make the request to Pinecone
        const response = await axios.post(pineconeApiUrl, requestPayload, {
            headers: {
                'Api-Key': pineconeApiKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 30000
        });

        log('info', 'Pinecone response received', {
            status: response.status,
            resultCount: response.data?.result?.hits?.length || 0
        });

        // Process and return the response
        const searchResults = response.data;
        
        // Add metadata to the response
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

        log('info', 'Pinecone search completed successfully', {
            total_results: enhancedResults.metadata.total_results
        });
        
        res.json(enhancedResults);

    } catch (error) {
        log('error', 'Pinecone query error', {
            message: error.message,
            response: error.response ? {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            } : null
        });
        
        if (error.response) {
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

        res.status(500).json({ 
            error: 'Internal server error during Pinecone query',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Example usage endpoint
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
                    fields: ["title", "content", "category"]
                }
            },
            text_search_with_filters: {
                method: "POST",
                url: "/pinecone-query",
                body: {
                    query: "artificial intelligence",
                    search_type: "text",
                    namespace: "documents",
                    top_k: 10,
                    fields: ["title", "content"],
                    filters: { 
                        category: { "$eq": "technology" },
                        year: { "$gte": 2020 }
                    }
                }
            },
            text_search_with_rerank: {
                method: "POST",
                url: "/pinecone-query",
                body: {
                    query: "deep learning neural networks",
                    search_type: "text",
                    namespace: "documents",
                    top_k: 20,
                    fields: ["title", "content", "abstract"],
                    rerank: {
                        model: "bge-reranker-v2-m3",
                        top_n: 5,
                        rank_fields: ["content", "abstract"]
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
            }
        },
        notes: [
            "Text search requires an index with integrated embedding",
            "Vector search works with any index but requires pre-computed embeddings",
            "Filters use MongoDB-style syntax: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin",
            "Reranking helps improve relevance of initial results"
        ]
    });
});

// Test endpoint for quick testing
app.post('/test-pinecone', async (req, res) => {
    const testQuery = {
        query: "test search query",
        search_type: "text",
        namespace: "__default__",
        top_k: 3
    };
    
    log('info', 'Test Pinecone endpoint called', testQuery);
    
    // Forward to the main pinecone-query endpoint
    try {
        const result = await axios.post(`${req.protocol}://${req.get('host')}/pinecone-query`, testQuery, {
            headers: { 'Content-Type': 'application/json' }
        });
        res.json(result.data);
    } catch (error) {
        res.status(500).json({
            error: 'Test failed',
            details: error.response?.data || error.message
        });
    }
});

// 404 handler
app.use((req, res) => {
    log('warn', '404 - Route not found', { url: req.url });
    res.status(404).json({
        error: 'Route not found',
        available_endpoints: [
            'GET /',
            'GET /health',
            'GET /pinecone-examples', 
            'POST /pinecone-query',
            'POST /test-pinecone'
        ]
    });
});

// Global error handler
app.use((error, req, res, next) => {
    log('error', 'Unhandled server error', error);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(port, '0.0.0.0', () => {
    log('info', 'Server started successfully', {
        port: port,
        environment: process.env.NODE_ENV || 'development',
        pineconeConfigured: {
            hasApiKey: !!process.env.PINECONE_API_KEY,
            hasIndexHost: !!process.env.PINECONE_INDEX_HOST
        }
    });
    
    console.log('\n🚀 Pinecone Semantic Search Server Running!');
    console.log(`📍 URL: http://localhost:${port}`);
    console.log('📚 Endpoints:');
    console.log('   GET  /                - Main page');
    console.log('   GET  /health          - Health check');
    console.log('   GET  /pinecone-examples - Usage examples');
    console.log('   POST /pinecone-query  - Semantic search');
    console.log('   POST /test-pinecone   - Quick test');
});