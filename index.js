// index.js - Production-Ready Pinecone API Implementation with FLINT OS Knowledge Base
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

// FLINT OS Helper Functions
function formatDate(dateString) {
    if (!dateString) return "Unknown date";

    try {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60)); // FIXED: Added missing space
        const diffDays = Math.floor(diffHours / 24);

        if (diffHours < 1) return "Just now";
        if (diffHours < 24) return `${diffHours} hours ago`;
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;

        return date.toLocaleDateString();
    } catch (e) {
        return dateString;
    }
}

function deriveImportance(metadata) {
    // Logic to determine importance based on your metadata
    if (metadata.decisions_made && metadata.decisions_made.length > 0) return "high";
    if (metadata.action_items && metadata.action_items.length > 0) return "medium";
    if (metadata.roadblocks_issues && metadata.roadblocks_issues.length > 0) return "high";
    if (metadata.tags && metadata.tags.includes("critical")) return "critical";
    if (metadata.tags && metadata.tags.includes("urgent")) return "high";
    return "low";
}

// Email domain validation middleware
const validateEmailDomain = (req, res, next) => {
    const email = req.headers['x-user-email'];
    const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN || '@yourcompany.com';
    
    if (!email || !email.endsWith(allowedDomain)) {
        return res.status(401).json({ 
            error: 'Unauthorized domain',
            message: `Please use an email ending with ${allowedDomain}`,
            received_email: email
        });
    }
    
    req.userEmail = email;
    next();
};

// Environment variable debugging on startup
log('info', 'Starting server initialization');
log('info', 'Environment check', {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    PINECONE_API_KEY: process.env.PINECONE_API_KEY ? `[SET - ${process.env.PINECONE_API_KEY.length} chars]` : '[NOT SET]',
    PINECONE_INDEX_HOST: process.env.PINECONE_INDEX_HOST ? `[SET - ${process.env.PINECONE_INDEX_HOST}]` : '[NOT SET]',
    // FLINT OS specific variables
    FLINT_OS_PINECONE_API_KEY: process.env.FLINT_OS_PINECONE_API_KEY ? `[SET - ${process.env.FLINT_OS_PINECONE_API_KEY.length} chars]` : '[NOT SET]',
    FLINT_OS_PINECONE_INDEX_HOST: process.env.FLINT_OS_PINECONE_INDEX_HOST ? `[SET - ${process.env.FLINT_OS_PINECONE_INDEX_HOST}]` : '[NOT SET]',
    ALLOWED_EMAIL_DOMAIN: process.env.ALLOWED_EMAIL_DOMAIN || '[NOT SET]',
    MAKE_CHAT_WEBHOOK_URL: process.env.MAKE_CHAT_WEBHOOK_URL ? '[SET]' : '[NOT SET]'
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
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-user-email');
    
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

// Enhanced Health check endpoint
app.get('/health', (req, res) => {
    const pineconeApiKey = process.env.PINECONE_API_KEY;
    const pineconeIndexHost = process.env.PINECONE_INDEX_HOST;
    const flintOsApiKey = process.env.FLINT_OS_PINECONE_API_KEY;
    const flintOsIndexHost = process.env.FLINT_OS_PINECONE_INDEX_HOST;
    
    const healthData = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        port: port,
        platform: process.platform,
        nodeVersion: process.version,
        pineconeConfig: {
            transcripts: {
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
            flintOs: {
                apiKey: {
                    isSet: !!flintOsApiKey,
                    length: flintOsApiKey ? flintOsApiKey.length : 0,
                    preview: flintOsApiKey ? flintOsApiKey.substring(0, 8) + '...' : null
                },
                indexHost: {
                    isSet: !!flintOsIndexHost,
                    value: flintOsIndexHost || null
                },
                usingFallback: !flintOsApiKey || !flintOsIndexHost
            }
        },
        // FLINT OS KB additions
        newEndpoints: {
            '/api/recent': 'GET - Recent knowledge entries',
            '/api/search': 'POST - Search with filters',
            '/api/chat': 'POST - Chat webhook proxy'
        },
        configuration: {
            chat_webhook_configured: !!process.env.MAKE_CHAT_WEBHOOK_URL,
            allowed_email_domain: process.env.ALLOWED_EMAIL_DOMAIN || 'not configured'
        },
        version: '1.1.0-week1',
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
    const commonKeys = ['API_KEY', 'INDEX_HOST', 'HOST', 'KEY', 'CHAT', 'EMAIL'];
    envInfo.environmentVariables.allKeys = Object.keys(process.env)
        .filter(key => commonKeys.some(common => key.includes(common)))
        .sort();

    log('info', 'Environment check requested', envInfo);
    res.json(envInfo);
});

// Enhanced Pinecone query endpoint (for transcripts)
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
        flint_os_endpoints: {
            recent_knowledge: {
                method: "GET",
                url: "/api/recent",
                headers: { "x-user-email": "user@yourcompany.com" },
                query_params: { "limit": 20, "days": 30 }
            },
            search_knowledge: {
                method: "POST",
                url: "/api/search",
                headers: { "x-user-email": "user@yourcompany.com" },
                body: {
                    query: "project updates",
                    filters: {
                        source_type: ["meetings", "documents"],
                        tags: ["important"]
                    }
                }
            },
            chat: {
                method: "POST",
                url: "/api/chat",
                headers: { "x-user-email": "user@yourcompany.com" },
                body: {
                    message: "What were the key decisions made last week?",
                    conversation_history: []
                }
            }
        },
        environment_setup: {
            required_variables: [
                "PINECONE_API_KEY - Your Pinecone API key (for transcripts)",
                "PINECONE_INDEX_HOST - Your index host (for transcripts)",
                "FLINT_OS_PINECONE_API_KEY - FLINT OS API key (optional, falls back to main)",
                "FLINT_OS_PINECONE_INDEX_HOST - FLINT OS index host (optional, falls back to main)",
                "ALLOWED_EMAIL_DOMAIN - Email domain for authentication",
                "MAKE_CHAT_WEBHOOK_URL - Make.com webhook for chat"
            ],
            render_setup: [
                "1. Go to Render Dashboard → Your Service → Environment",
                "2. Add all required variables",
                "3. Redeploy the service"
            ]
        }
    });
});

// FLINT OS Recent Knowledge Endpoint
app.get('/api/recent', validateEmailDomain, async (req, res) => {
    log('info', 'Recent knowledge request started');
    
    try {
        const { limit = 20, days = 30 } = req.query;
        
        // Calculate date filter (days ago)
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const dateFilter = cutoffDate.toISOString().split('T')[0]; // YYYY-MM-DD format
        
        // Use FLINT OS specific Pinecone configuration (separate from transcripts)
        let pineconeApiKey = process.env.FLINT_OS_PINECONE_API_KEY || 
                           process.env.PINECONE_API_KEY ||  // fallback to main key
                           process.env.PINECONE_KEY || 
                           process.env.API_KEY;
        
        let pineconeIndexHost = process.env.FLINT_OS_PINECONE_INDEX_HOST || 
                              process.env.PINECONE_INDEX_HOST ||  // fallback to main host
                              process.env.PINECONE_HOST || 
                              process.env.INDEX_HOST;

        // Log which configuration we're using
        log('info', 'FLINT OS Pinecone configuration', {
            using_flint_os_key: !!process.env.FLINT_OS_PINECONE_API_KEY,
            using_flint_os_host: !!process.env.FLINT_OS_PINECONE_INDEX_HOST,
            api_key_source: process.env.FLINT_OS_PINECONE_API_KEY ? 'FLINT_OS_PINECONE_API_KEY' : 'fallback',
            host_source: process.env.FLINT_OS_PINECONE_INDEX_HOST ? 'FLINT_OS_PINECONE_INDEX_HOST' : 'fallback'
        });

        if (pineconeIndexHost && pineconeIndexHost.startsWith('https://')) {
            pineconeIndexHost = pineconeIndexHost.replace('https://', '');
        }

        if (!pineconeApiKey || !pineconeIndexHost) {
            return res.status(500).json({ 
                error: 'Pinecone configuration missing',
                details: 'Please set FLINT_OS_PINECONE_API_KEY and FLINT_OS_PINECONE_INDEX_HOST (or fallback variables)'
            });
        }
        
        // Get recent entries using your existing Pinecone query structure
        const requestPayload = {
            query: {
                inputs: { text: "recent updates knowledge information project meeting" },
                top_k: parseInt(limit)
            },
            fields: ["title", "chunk_text", "date_ended", "people_involved", "tags", "source_type", "discussion", "action_items", "decisions_made", "label"],
            filter: {
                date_ended: { 
                    $gte: dateFilter
                }
            }
        };

        const pineconeApiUrl = `https://${pineconeIndexHost}/records/namespaces/__default__/search`;
        
        log('info', 'Querying Pinecone for recent knowledge', {
            url: pineconeApiUrl,
            limit: limit,
            days: days,
            cutoff_date: dateFilter
        });
        
        const response = await axios.post(pineconeApiUrl, requestPayload, {
            headers: {
                'Api-Key': pineconeApiKey,
                'Content-Type': 'application/json',
                'X-Pinecone-API-Version': 'unstable'
            },
            timeout: 30000
        });

        log('info', 'Pinecone response received', {
            hits_count: response.data.result?.hits?.length || 0
        });

        // Transform Pinecone results to frontend format
        const entries = (response.data.result?.hits || []).map((hit, index) => ({
            id: hit.record.id || `entry-${index}`,
            title: hit.record.metadata.title || hit.record.metadata.label || `Knowledge Entry ${index + 1}`,
            description: hit.record.metadata.chunk_text ? 
                hit.record.metadata.chunk_text.substring(0, 300) + "..." : 
                "No description available",
            author: Array.isArray(hit.record.metadata.people_involved) ? 
                hit.record.metadata.people_involved[0] : 
                hit.record.metadata.people_involved || "Unknown",
            date: formatDate(hit.record.metadata.date_ended),
            tags: Array.isArray(hit.record.metadata.tags) ? hit.record.metadata.tags : [],
            sourceType: hit.record.metadata.source_type || "Document",
            importance: deriveImportance(hit.record.metadata),
            summary: hit.record.metadata.discussion || hit.record.metadata.chunk_text?.substring(0, 500),
            actionItems: hit.record.metadata.action_items,
            decisions: hit.record.metadata.decisions_made,
            score: hit.score
        }));

        log('info', 'Recent knowledge query completed successfully', {
            total_results: entries.length,
            user_email: req.userEmail
        });

        res.json({ entries });
        
    } catch (error) {
        log('error', 'Recent knowledge query failed', {
            error: error.message,
            stack: error.stack,
            user_email: req.userEmail
        });
        
        res.status(500).json({ 
            error: 'Failed to fetch recent knowledge',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// FLINT OS Search Endpoint with Filter Translation
app.post('/api/search', validateEmailDomain, async (req, res) => {
    log('info', 'Knowledge search request started', {
        body: req.body,
        user_email: req.userEmail
    });
    
    try {
        const { query, filters = {} } = req.body;
        
        if (!query) {
            return res.status(400).json({
                error: 'Query parameter is required',
                message: 'Please provide a search query'
            });
        }
        
        // Use FLINT OS specific Pinecone configuration (separate from transcripts)
        let pineconeApiKey = process.env.FLINT_OS_PINECONE_API_KEY || 
                           process.env.PINECONE_API_KEY ||  // fallback to main key
                           process.env.PINECONE_KEY || 
                           process.env.API_KEY;
        
        let pineconeIndexHost = process.env.FLINT_OS_PINECONE_INDEX_HOST || 
                              process.env.PINECONE_INDEX_HOST ||  // fallback to main host
                              process.env.PINECONE_HOST || 
                              process.env.INDEX_HOST;

        // Log which configuration we're using
        log('info', 'FLINT OS Pinecone configuration', {
            using_flint_os_key: !!process.env.FLINT_OS_PINECONE_API_KEY,
            using_flint_os_host: !!process.env.FLINT_OS_PINECONE_INDEX_HOST,
            api_key_source: process.env.FLINT_OS_PINECONE_API_KEY ? 'FLINT_OS_PINECONE_API_KEY' : 'fallback',
            host_source: process.env.FLINT_OS_PINECONE_INDEX_HOST ? 'FLINT_OS_PINECONE_INDEX_HOST' : 'fallback'
        });

        if (pineconeIndexHost && pineconeIndexHost.startsWith('https://')) {
            pineconeIndexHost = pineconeIndexHost.replace('https://', '');
        }

        if (!pineconeApiKey || !pineconeIndexHost) {
            return res.status(500).json({ 
                error: 'Pinecone configuration missing',
                details: 'Please set FLINT_OS_PINECONE_API_KEY and FLINT_OS_PINECONE_INDEX_HOST (or fallback variables)'
            });
        }
        
        // Build Pinecone filter from UI filters
        const pineconeFilter = {};
        
        if (filters.source_type && Array.isArray(filters.source_type) && filters.source_type.length > 0) {
            pineconeFilter.source_type = { $in: filters.source_type };
        }
        
        if (filters.tags && Array.isArray(filters.tags) && filters.tags.length > 0) {
            pineconeFilter.tags = { $in: filters.tags };
        }
        
        if (filters.date_range && filters.date_range.from && filters.date_range.to) {
            pineconeFilter.date_ended = {
                $gte: filters.date_range.from,
                $lte: filters.date_range.to
            };
        }
        
        if (filters.people_involved && Array.isArray(filters.people_involved) && filters.people_involved.length > 0) {
            pineconeFilter.people_involved = { $in: filters.people_involved };
        }

        const requestPayload = {
            query: {
                inputs: { text: query },
                top_k: 50
            },
            fields: ["title", "chunk_text", "date_ended", "people_involved", "tags", "source_type", "discussion", "action_items", "decisions_made", "label"],
            filter: Object.keys(pineconeFilter).length > 0 ? pineconeFilter : undefined
        };

        const pineconeApiUrl = `https://${pineconeIndexHost}/records/namespaces/__default__/search`;
        
        log('info', 'Executing Pinecone search', {
            query: query,
            filters_applied: Object.keys(pineconeFilter),
            payload: requestPayload
        });
        
        const response = await axios.post(pineconeApiUrl, requestPayload, {
            headers: {
                'Api-Key': pineconeApiKey,
                'Content-Type': 'application/json',
                'X-Pinecone-API-Version': 'unstable'
            },
            timeout: 30000
        });

        // Transform results using the same format as /api/recent
        const results = (response.data.result?.hits || []).map((hit, index) => ({
            id: hit.record.id || `search-${index}`,
            title: hit.record.metadata.title || hit.record.metadata.label || `Search Result ${index + 1}`,
            description: hit.record.metadata.chunk_text ? 
                hit.record.metadata.chunk_text.substring(0, 300) + "..." : 
                "No description available",
            author: Array.isArray(hit.record.metadata.people_involved) ? 
                hit.record.metadata.people_involved[0] : 
                hit.record.metadata.people_involved || "Unknown",
            date: formatDate(hit.record.metadata.date_ended),
            tags: Array.isArray(hit.record.metadata.tags) ? hit.record.metadata.tags : [],
            sourceType: hit.record.metadata.source_type || "Document",
            importance: deriveImportance(hit.record.metadata),
            summary: hit.record.metadata.discussion || hit.record.metadata.chunk_text?.substring(0, 500),
            score: hit.score
        }));

        log('info', 'Search query completed successfully', {
            query: query,
            total_results: results.length,
            filters_applied: Object.keys(pineconeFilter),
            user_email: req.userEmail
        });

        res.json({ results });
        
    } catch (error) {
        log('error', 'Search query failed', {
            error: error.message,
            stack: error.stack,
            query: req.body.query,
            user_email: req.userEmail
        });
        
        res.status(500).json({ 
            error: 'Search failed',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// FLINT OS Chat Webhook Proxy
app.post('/api/chat', validateEmailDomain, async (req, res) => {
    log('info', 'Chat request started', {
        message_preview: req.body.message?.substring(0, 100),
        user_email: req.userEmail
    });
    
    try {
        const { message, conversation_history } = req.body;
        
        if (!message) {
            return res.status(400).json({
                error: 'Message parameter is required',
                message: 'Please provide a message to send'
            });
        }
        
        // Forward to your Make.com webhook
        const makeWebhookUrl = process.env.MAKE_CHAT_WEBHOOK_URL;
        
        if (!makeWebhookUrl) {
            log('warn', 'Chat webhook not configured');
            return res.status(500).json({
                error: 'Chat webhook not configured',
                message: 'Please set MAKE_CHAT_WEBHOOK_URL environment variable'
            });
        }

        const response = await axios.post(makeWebhookUrl, {
            message,
            conversation_history: conversation_history || [],
            timestamp: new Date().toISOString(),
            source: "flint_os_dashboard",
            user_email: req.userEmail
        }, {
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        log('info', 'Chat response received successfully', {
            user_email: req.userEmail,
            message_length: message.length,
            response_received: !!response.data
        });

        // Handle different response formats from Make.com
        let chatResponse = '';
        if (typeof response.data === 'string') {
            chatResponse = response.data;
        } else if (response.data.response) {
            chatResponse = response.data.response;
        } else if (response.data.message) {
            chatResponse = response.data.message;
        } else if (response.data.reply) {
            chatResponse = response.data.reply;
        } else {
            chatResponse = JSON.stringify(response.data);
        }

        res.json({
            response: chatResponse,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        log('error', 'Chat request failed', {
            error: error.message,
            user_email: req.userEmail
        });
        
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({ 
                error: 'Chat service timeout',
                message: 'Please try again with a shorter message'
            });
        }
        
        res.status(500).json({ 
            error: 'Chat service unavailable',
            message: 'Please try again later'
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
            'GET /env-check',
            'GET /test-namespaces',
            'GET /pinecone-examples', 
            'POST /pinecone-query',
            'GET /api/recent',        // FLINT OS
            'POST /api/search',       // FLINT OS
            'POST /api/chat'          // FLINT OS
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
            hasTranscriptsApiKey: !!process.env.PINECONE_API_KEY,
            hasTranscriptsIndexHost: !!process.env.PINECONE_INDEX_HOST,
            hasFlintOsApiKey: !!process.env.FLINT_OS_PINECONE_API_KEY,
            hasFlintOsIndexHost: !!process.env.FLINT_OS_PINECONE_INDEX_HOST
        }
    });
    
    console.log('\n🚀 FLINT OS Knowledge Base Server Running!');
    console.log(`📍 URL: http://localhost:${port}`);
    console.log('📚 Endpoints:');
    console.log('   GET  /                - Main page');
    console.log('   GET  /health          - Health check');
    console.log('   GET  /env-check       - Environment variables check');
    console.log('   GET  /test-namespaces - Test all namespaces');
    console.log('   GET  /pinecone-examples - Usage examples');
    console.log('   POST /pinecone-query  - Semantic search (transcripts)');
    console.log('   GET  /api/recent      - Recent FLINT OS knowledge');
    console.log('   POST /api/search      - Search FLINT OS knowledge');
    console.log('   POST /api/chat        - FLINT OS chat assistant');
    
    // Log environment status on startup
    setTimeout(() => {
        log('info', 'Startup complete - Environment status', {
            TRANSCRIPTS_PINECONE_API_KEY: process.env.PINECONE_API_KEY ? 'SET' : 'NOT SET',
            TRANSCRIPTS_PINECONE_INDEX_HOST: process.env.PINECONE_INDEX_HOST ? 'SET' : 'NOT SET',
            FLINT_OS_PINECONE_API_KEY: process.env.FLINT_OS_PINECONE_API_KEY ? 'SET' : 'NOT SET',
            FLINT_OS_PINECONE_INDEX_HOST: process.env.FLINT_OS_PINECONE_INDEX_HOST ? 'SET' : 'NOT SET',
            ALLOWED_EMAIL_DOMAIN: process.env.ALLOWED_EMAIL_DOMAIN ? 'SET' : 'NOT SET',
            MAKE_CHAT_WEBHOOK_URL: process.env.MAKE_CHAT_WEBHOOK_URL ? 'SET' : 'NOT SET'
        });
    }, 1000);
});