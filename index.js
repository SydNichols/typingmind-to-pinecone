// index.js - Production-Ready Pinecone API Implementation
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');

// Only load dotenv in development
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

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
    
    // Also output to stderr for better visibility on cloud platforms
    if (level === 'error') {
        console.error(logEntry, data ? JSON.stringify(data, null, 2) : '');
    }
}

// Environment variable debugging on startup
log('info', 'Starting server initialization');
log('info', 'Environment check', {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    PINECONE_API_KEY: process.env.PINECONE_API_KEY ? `[SET - ${process.env.PINECONE_API_KEY.length} chars]` : '[NOT SET]',
    PINECONE_INDEX_HOST: process.env.PINECONE_INDEX_HOST ? `[SET - ${process.env.PINECONE_INDEX_HOST}]` : '[NOT SET]'
});

// Request logging middleware
app.use((req, res, next) => {
    log('info', `${req.method} ${req.url}`);
    next();
});

// CORS middleware for TypingMind plugin
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
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
    log('info', 'Serving HTML from:', htmlPath);
    res.sendFile(htmlPath);
});

// Health check endpoint
app.get('/health', (req, res) => {
    const pineconeApiKey = process.env.PINECONE_API_KEY;
    const pineconeIndexHost = process.env.PINECONE_INDEX_HOST;
    
    const healthData = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        port: port,
        platform: process.platform,
        nodeVersion: process.version,
        pineconeConfig: {
            apiKey: {
                isSet: !!pineconeApiKey,
                length: pineconeApiKey ? pineconeApiKey.length : 0,
                preview: pineconeApiKey ? pineconeApiKey.substring(0, 8) + '...' : null
            },
            indexHost: {
                isSet: !!pineconeIndexHost,
                value: pineconeIndexHost || null
            }
        },
        allEnvKeys: Object.keys(process.env).sort()
    };
    
    log('info', 'Health check requested', healthData);
    res.json(healthData);
});

// Environment variables debug endpoint (helpful for production debugging)
app.get('/env-check', (req, res) => {
    const envInfo = {
        timestamp: new Date().toISOString(),
        nodeEnv: process.env.NODE_ENV,
        platform: process.platform,
        nodeVersion: process.version,
        environmentVariables: {
            total: Object.keys(process.env).length,
            pineconeVars: {}
        }
    };

    // Check all environment variables that contain 'PINECONE'
    Object.keys(process.env).forEach(key => {
        if (key.toUpperCase().includes('PINECONE')) {
            const value = process.env[key];
            envInfo.environmentVariables.pineconeVars[key] = {
                isSet: !!value,
                length: value ? value.length : 0,
                preview: value ? value.substring(0, 10) + '...' : null
            };
        }
    });

    // Also check common variations
    const commonKeys = ['API_KEY', 'INDEX_HOST', 'HOST', 'KEY'];
    envInfo.environmentVariables.allKeys = Object.keys(process.env)
        .filter(key => commonKeys.some(common => key.includes(common)))
        .sort();

    log('info', 'Environment check requested', envInfo);
    res.json(envInfo);
});

// Enhanced Pinecone query endpoint with robust environment variable handling
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

        // Enhanced request logging
        log('info', 'Request parameters parsed', {
            query: query,
            namespace: namespace,
            top_k: top_k,
            fields: fields,
            filters: filters,
            search_type: search_type
        });

        // Multiple ways to get environment variables (in case of different naming)
        let pineconeApiKey = process.env.PINECONE_API_KEY || 
                           process.env.PINECONE_KEY || 
                           process.env.API_KEY;
        
        let pineconeIndexHost = process.env.PINECONE_INDEX_HOST || 
                              process.env.PINECONE_HOST || 
                              process.env.INDEX_HOST;

        // Clean up the host if it has https://
        if (pineconeIndexHost && pineconeIndexHost.startsWith('https://')) {
            pineconeIndexHost = pineconeIndexHost.replace('https://', '');
        }

        log('info', 'Environment variables check', {
            apiKeyFound: !!pineconeApiKey,
            apiKeyLength: pineconeApiKey ? pineconeApiKey.length : 0,
            apiKeySource: pineconeApiKey ? (
                process.env.PINECONE_API_KEY ? 'PINECONE_API_KEY' :
                process.env.PINECONE_KEY ? 'PINECONE_KEY' :
                process.env.API_KEY ? 'API_KEY' : 'unknown'
            ) : 'none',
            hostFound: !!pineconeIndexHost,
            hostValue: pineconeIndexHost,
            hostSource: pineconeIndexHost ? (
                process.env.PINECONE_INDEX_HOST ? 'PINECONE_INDEX_HOST' :
                process.env.PINECONE_HOST ? 'PINECONE_HOST' :
                process.env.INDEX_HOST ? 'INDEX_HOST' : 'unknown'
            ) : 'none'
        });

        if (!pineconeApiKey || !pineconeIndexHost) {
            log('error', 'Missing Pinecone configuration', {
                apiKeyFound: !!pineconeApiKey,
                hostFound: !!pineconeIndexHost,
                availableEnvVars: Object.keys(process.env).filter(k => 
                    k.toUpperCase().includes('PINECONE') || 
                    k.toUpperCase().includes('API') || 
                    k.toUpperCase().includes('HOST')
                )
            });
            
            return res.status(500).json({ 
                error: 'Pinecone configuration missing. Please set PINECONE_API_KEY and PINECONE_INDEX_HOST environment variables.',
                details: {
                    hasApiKey: !!pineconeApiKey,
                    hasIndexHost: !!pineconeIndexHost,
                    checkedVariables: [
                        'PINECONE_API_KEY',
                        'PINECONE_KEY', 
                        'API_KEY',
                        'PINECONE_INDEX_HOST',
                        'PINECONE_HOST',
                        'INDEX_HOST'
                    ],
                    availableEnvVars: Object.keys(process.env).filter(k => 
                        k.toUpperCase().includes('PINECONE') || 
                        k.toUpperCase().includes('API') || 
                        k.toUpperCase().includes('HOST')
                    ),
                    help: 'Make sure to set environment variables in your Render dashboard'
                }
            });
        }

        if (!query) {
            return res.status(400).json({ 
                error: 'Query parameter is required'
            });
        }

        // Build the Pinecone API URL - this is where namespace is used!
        const pineconeApiUrl = `https://${pineconeIndexHost}/records/namespaces/${encodeURIComponent(namespace)}/search`;
        
        log('info', 'Built Pinecone API URL', {
            url: pineconeApiUrl,
            namespace_used: namespace
        });

        // Build request payload according to Pinecone API 2025-01 specification
        let requestPayload = {};

        // Configure query based on search type
        switch (search_type) {
            case "text":
                if (typeof query !== 'string') {
                    return res.status(400).json({ 
                        error: 'For text search, query must be a string',
                        example: { query: "find documents about machine learning" }
                    });
                }
                requestPayload.query = {
                    inputs: { text: query },
                    top_k: Math.min(top_k, 10000)
                };
                break;

            case "vector":
                if (!Array.isArray(query) || query.some(v => typeof v !== 'number')) {
                    return res.status(400).json({ 
                        error: 'For vector search, query must be an array of numbers',
                        example: { query: [0.1, 0.2, 0.3, 0.4] }
                    });
                }
                requestPayload.query = {
                    vector: { values: query },
                    top_k: Math.min(top_k, 10000)
                };
                break;

            case "id":
                if (typeof query !== 'string') {
                    return res.status(400).json({ 
                        error: 'For ID search, query must be a record ID string',
                        example: { query: "record_123" }
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

        // Add fields at root level (per official API docs)
        if (fields && fields.length > 0) {
            requestPayload.fields = fields;
        }

        // Add filters at root level (per official API docs)
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
                'Accept': 'application/json', 
                'X-Pinecone-API-Version': 'unstable'
            },
            timeout: 30000
        });

        log('info', 'Pinecone response received', {
            status: response.status,
            resultCount: response.data?.result?.hits?.length || 0,
            namespace_searched: namespace
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
                timestamp: new Date().toISOString(),
                pinecone_url_used: pineconeApiUrl
            }
        };

        log('info', 'Pinecone search completed successfully', {
            total_results: enhancedResults.metadata.total_results,
            namespace_searched: namespace
        });
        
        res.json(enhancedResults);

    } catch (error) {
        log('error', 'Pinecone query error', {
            message: error.message,
            stack: error.stack,
            response: error.response ? {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data,
                headers: error.response.headers
            } : null,
            config: error.config ? {
                url: error.config.url,
                method: error.config.method,
                headers: error.config.headers
            } : null
        });
        
        if (error.response) {
            return res.status(error.response.status).json({
                error: 'Pinecone API error',
                details: error.response.data,
                status: error.response.status,
                statusText: error.response.statusText,
                pinecone_url: error.config?.url || 'unknown'
            });
        }
        
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            return res.status(503).json({
                error: 'Unable to connect to Pinecone API',
                details: 'Please check your PINECONE_INDEX_HOST configuration',
                code: error.code,
                host_attempted: error.config?.url || 'unknown'
            });
        }

        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({
                error: 'Pinecone API timeout',
                details: 'Request took longer than 30 seconds',
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

// Test endpoint for debugging namespace issues
app.get('/test-namespaces', async (req, res) => {
    const pineconeApiKey = process.env.PINECONE_API_KEY;
    const pineconeIndexHost = process.env.PINECONE_INDEX_HOST;
    
    if (!pineconeApiKey || !pineconeIndexHost) {
        return res.status(500).json({
            error: 'Pinecone not configured'
        });
    }

    const testResults = {};
    const namespaces = ['__default__', 'key_learnings', 'challenges', 'initiatives'];
    
    for (const namespace of namespaces) {
        try {
            const pineconeApiUrl = `https://${pineconeIndexHost}/records/namespaces/${encodeURIComponent(namespace)}/search`;
            const testPayload = {
                query: {
                    inputs: { text: "test" },
                    top_k: 1
                }
            };
            
            const response = await axios.post(pineconeApiUrl, testPayload, {
                headers: {
                    'Api-Key': pineconeApiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json', 
                    'X-Pinecone-API-Version': 'unstable'
                },
                timeout: 10000
            });
            
            testResults[namespace] = {
                status: 'success',
                result_count: response.data?.result?.hits?.length || 0,
                url: pineconeApiUrl
            };
        } catch (error) {
            testResults[namespace] = {
                status: 'error',
                error: error.message,
                response_status: error.response?.status,
                response_data: error.response?.data,
                url: `https://${pineconeIndexHost}/records/namespaces/${encodeURIComponent(namespace)}/search`
            };
        }
    }
    
    res.json({
        timestamp: new Date().toISOString(),
        namespace_tests: testResults
    });
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
                },
                note: "Filters are automatically placed inside the query object"
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
        environment_setup: {
            required_variables: [
                "PINECONE_API_KEY - Your Pinecone API key",
                "PINECONE_INDEX_HOST - Your index host (without https://)"
            ],
            render_setup: [
                "1. Go to Render Dashboard → Your Service → Environment",
                "2. Add PINECONE_API_KEY with your API key",
                "3. Add PINECONE_INDEX_HOST with your index host",
                "4. Redeploy the service"
            ]
        }
    });
});

// 404 handler
app.use((req, res) => {
    log('warn', '404 - Route not found', { url: req.url });
    res.status(404).json({
        error: 'Route not found',
        available_endpoints: [
            'GET /',
            'GET /health',
            'GET /env-check',
            'GET /test-namespaces',
            'GET /pinecone-examples', 
            'POST /pinecone-query'
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
        platform: process.platform,
        nodeVersion: process.version,
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
    console.log('   GET  /env-check       - Environment variables check');
    console.log('   GET  /test-namespaces - Test all namespaces');
    console.log('   GET  /pinecone-examples - Usage examples');
    console.log('   POST /pinecone-query  - Semantic search');
    
    // Log environment status on startup
    setTimeout(() => {
        log('info', 'Startup complete - Environment status', {
            PINECONE_API_KEY: process.env.PINECONE_API_KEY ? 'SET' : 'NOT SET',
            PINECONE_INDEX_HOST: process.env.PINECONE_INDEX_HOST ? 'SET' : 'NOT SET'
        });
    }, 1000);
});