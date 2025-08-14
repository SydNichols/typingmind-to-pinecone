// FLINT OS Knowledge Base Server - Fixed CommonJS Version
// Version: 1.1.2-commonjs-fix
// Date: August 13, 2025

const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3010;

// Middleware
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-email']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging utility
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        level: level.toUpperCase(),
        message,
        ...(data && { data })
    };
    console.log(JSON.stringify(logEntry));
}

// Helper functions
function formatDate(dateString) {
    if (!dateString) return "Unknown date";
    
    try {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
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
    if (!metadata) return "low";
    
    // Logic to determine importance based on metadata
    if (metadata.decisions_made?.length > 0) return "high";
    if (metadata.action_items?.length > 0) return "medium";
    if (metadata.roadblocks_issues?.length > 0) return "high";
    if (metadata.source_type === "Critical Document") return "critical";
    return "low";
}

// Email domain validation middleware
const validateEmailDomain = (req, res, next) => {
    const email = req.headers['x-user-email'];
    const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN || '@flintbuilders.com';
    
    if (!email || !email.endsWith(allowedDomain)) {
        return res.status(401).json({ 
            error: 'Unauthorized domain',
            message: `Please use an email ending with ${allowedDomain}`
        });
    }
    
    req.userEmail = email;
    next();
};

// OpenAI embedding generation
async function generateEmbedding(text) {
    try {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY environment variable not set');
        }

        const response = await axios.post('https://api.openai.com/v1/embeddings', {
            model: 'text-embedding-3-small',
            input: text.substring(0, 8000)  // Limit input length
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        return response.data.data[0].embedding;
    } catch (error) {
        log('error', 'Embedding generation failed', { 
            error: error.message,
            text_length: text?.length 
        });
        throw new Error('Failed to generate embedding for search');
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    const healthData = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        port: PORT,
        platform: process.platform,
        nodeVersion: process.version,
        pineconeConfig: {
            transcripts: {
                apiKey: {
                    isSet: !!process.env.PINECONE_API_KEY,
                    length: process.env.PINECONE_API_KEY?.length || 0,
                    preview: process.env.PINECONE_API_KEY?.substring(0, 7) + '...' || 'not set'
                },
                indexHost: {
                    isSet: !!process.env.PINECONE_INDEX_HOST,
                    value: process.env.PINECONE_INDEX_HOST || 'not set'
                }
            },
            flintOs: {
                apiKey: {
                    isSet: !!process.env.FLINT_OS_PINECONE_API_KEY,
                    length: process.env.FLINT_OS_PINECONE_API_KEY?.length || 0,
                    preview: process.env.FLINT_OS_PINECONE_API_KEY?.substring(0, 7) + '...' || 'not set'
                },
                indexHost: {
                    isSet: !!process.env.FLINT_OS_PINECONE_INDEX_HOST,
                    value: process.env.FLINT_OS_PINECONE_INDEX_HOST || 'not set'
                },
                usingFallback: !process.env.FLINT_OS_PINECONE_API_KEY && !!process.env.PINECONE_API_KEY
            }
        },
        newEndpoints: {
            '/api/recent': 'GET - Recent knowledge entries',
            '/api/search': 'POST - Search with filters',
            '/api/chat': 'POST - Chat webhook proxy'
        },
        configuration: {
            chat_webhook_configured: !!process.env.MAKE_CHAT_WEBHOOK_URL,
            openai_configured: !!process.env.OPENAI_API_KEY,
            allowed_email_domain: process.env.ALLOWED_EMAIL_DOMAIN || '@flintbuilders.com'
        },
        version: '1.1.2-commonjs-fix'
    };
    
    res.json(healthData);
});

// Function to transform Notion API response to frontend format
function transformNotionToKnowledgeEntries(notionResponse) {
    if (!notionResponse.results || !Array.isArray(notionResponse.results)) {
        return { entries: [] };
    }

    const entries = notionResponse.results.map(page => {
        const props = page.properties;
        
        // Extract text content from rich_text fields
        const extractRichText = (richTextArray) => {
            if (!richTextArray || !Array.isArray(richTextArray)) return "";
            return richTextArray.map(item => item.plain_text || "").join("").trim();
        };

        // Extract title from title field
        const extractTitle = (titleArray) => {
            if (!titleArray || !Array.isArray(titleArray)) return "Untitled";
            return titleArray.map(item => item.plain_text || "").join("").trim() || "Untitled";
        };

        // Extract select field value
        const extractSelect = (selectField) => {
            return selectField?.select?.name || null;
        };

        // Extract multi-select values
        const extractMultiSelect = (multiSelectField) => {
            if (!multiSelectField?.multi_select || !Array.isArray(multiSelectField.multi_select)) return [];
            return multiSelectField.multi_select.map(item => item.name);
        };

        // Extract date
        const extractDate = (dateField) => {
            return dateField?.date?.start || null;
        };

        // Build the transformed entry
        return {
            id: page.id,
            title: extractTitle(props.Title?.title),
            description: extractRichText(props["What Was Discussed"]?.rich_text)?.substring(0, 300) + "..." || "No description available",
            author: extractRichText(props["People Involved"]?.rich_text)?.split('\n')[0]?.replace(/^- /, '') || "Unknown",
            date: formatDate(extractDate(props["Date Received"])),
            tags: extractMultiSelect(props.Tags),
            sourceType: extractSelect(props["Source Type"]) || "Document",
            importance: (extractSelect(props.Importance) || "medium").toLowerCase(),
            summary: extractRichText(props["What Was Discussed"]?.rich_text),
            actionItems: extractRichText(props["Action Items/Next Steps"]?.rich_text)?.split('\n').filter(item => item.trim()),
            decisions: extractRichText(props["Decision Made"]?.rich_text)?.split('\n').filter(item => item.trim()),
            roadblocks: extractRichText(props["Roadblocks/Issues Raised"]?.rich_text)?.split('\n').filter(item => item.trim()),
            openQuestions: extractRichText(props["Open Questions"]?.rich_text)?.split('\n').filter(item => item.trim()),
            references: extractRichText(props.References?.rich_text)?.split('\n').filter(item => item.trim()),
            milestones: extractRichText(props["Milestones and Status Updates"]?.rich_text)?.split('\n').filter(item => item.trim()),
            type: extractSelect(props.Type),
            phase: extractSelect(props.Phase),
            freshnessScore: props["Freshness Score"]?.formula?.number || 0,
            url: page.url,
            lastEdited: page.last_edited_time,
            createdTime: page.created_time
        };
    });

    return { entries };
}

// Updated /api/recent-notion endpoint - simplified for most recent entries
app.get('/api/recent-notion', validateEmailDomain, async (req, res) => {
    log('info', 'Recent Notion knowledge request started');
    
    try {
        const { limit = 20 } = req.query;
        
        const notionToken = 'ntn_v76360814545OsVy0XnVxzXFBJ82Lye9J8R9q8q1rel85F';
        const databaseId = '22d1c725-5b2e-80d1-a2c3-f7b6586e26a4';
        
        if (!notionToken || !databaseId) {
            return res.status(500).json({
                error: 'Notion configuration missing',
                missing: {
                    token: !notionToken,
                    databaseId: !databaseId
                }
            });
        }

        const notionPayload = {
            sorts: [
                {
                    property: "Date Received",
                    direction: "descending"
                }
            ],
            page_size: parseInt(limit)
        };

        const response = await axios.post(
            `https://api.notion.com/v1/databases/${databaseId}/query`, 
            notionPayload, 
            {
                headers: {
                    'Authorization': `Bearer ${notionToken}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                },
                timeout: 30000
            }
        );

        // Transform the Notion response to frontend format
        const transformedData = transformNotionToKnowledgeEntries(response.data);

        log('info', 'Recent Notion knowledge query completed', {
            total_results: transformedData.entries.length,
            user_email: req.userEmail
        });

        res.json(transformedData);

    } catch (error) {
        log('error', 'Recent Notion knowledge query failed', error.message);
        res.status(500).json({
            error: 'Failed to fetch recent Notion knowledge',
            message: error.message,
            status: error.response?.status
        });
    }
});

// Alternative: Search Notion endpoint with filters
app.post('/api/search-notion', validateEmailDomain, async (req, res) => {
    log('info', 'Notion search request started', req.body);
    
    try {
        const { query, filters = {} } = req.body;
        
        const notionToken = process.env.NOTION_API_TOKEN;
        const databaseId = process.env.NOTION_DATABASE_ID;
        
        if (!notionToken || !databaseId) {
            return res.status(500).json({
                error: 'Notion configuration missing'
            });
        }

        // Build Notion filter from UI filters
        let notionFilter = undefined;
        
        if (query || Object.keys(filters).length > 0) {
            const filterConditions = [];
            
            // Text search across multiple fields
            if (query) {
                filterConditions.push({
                    or: [
                        {
                            property: "Title",
                            title: {
                                contains: query
                            }
                        },
                        {
                            property: "What Was Discussed",
                            rich_text: {
                                contains: query
                            }
                        },
                        {
                            property: "Decision Made",
                            rich_text: {
                                contains: query
                            }
                        }
                    ]
                });
            }
            
            // Source type filter
            if (filters.source_type?.length) {
                filterConditions.push({
                    property: "Source Type",
                    select: {
                        equals: filters.source_type[0] // Notion select only supports single value
                    }
                });
            }
            
            // Tags filter
            if (filters.tags?.length) {
                filterConditions.push({
                    property: "Tags",
                    multi_select: {
                        contains: filters.tags[0] // Can be expanded for multiple tag logic
                    }
                });
            }
            
            // Date range filter
            if (filters.date_range) {
                filterConditions.push({
                    property: "Date Received",
                    date: {
                        on_or_after: filters.date_range.from,
                        on_or_before: filters.date_range.to
                    }
                });
            }
            
            // Importance filter
            if (filters.importance?.length) {
                filterConditions.push({
                    property: "Importance",
                    select: {
                        equals: filters.importance[0]
                    }
                });
            }
            
            // Combine filters with AND logic
            if (filterConditions.length === 1) {
                notionFilter = filterConditions[0];
            } else if (filterConditions.length > 1) {
                notionFilter = {
                    and: filterConditions
                };
            }
        }

        const notionPayload = {
            sorts: [
                {
                    property: "Freshness Score",
                    direction: "descending"
                },
                {
                    property: "Date Received",
                    direction: "descending"
                }
            ],
            page_size: 50,
            ...(notionFilter && { filter: notionFilter })
        };

        const response = await axios.post(
            `https://api.notion.com/v1/databases/${databaseId}/query`, 
            notionPayload, 
            {
                headers: {
                    'Authorization': `Bearer ${notionToken}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                },
                timeout: 30000
            }
        );

        // Transform the Notion response
        const transformedData = transformNotionToKnowledgeEntries(response.data);

        log('info', 'Notion search completed', {
            query: query,
            total_results: transformedData.entries.length,
            filters_applied: Object.keys(filters),
            user_email: req.userEmail
        });

        res.json({ results: transformedData.entries });

    } catch (error) {
        log('error', 'Notion search failed', error.message);
        res.status(500).json({
            error: 'Notion search failed',
            message: error.message
        });
    }
});

module.exports = { transformNotionToKnowledgeEntries };
// Test namespaces endpoint (for debugging)
app.get('/test-namespaces', async (req, res) => {
    try {
        // Test FLINT OS Pinecone connection
        const flintOsKey = process.env.FLINT_OS_PINECONE_API_KEY;
        const flintOsHost = process.env.FLINT_OS_PINECONE_INDEX_HOST;
        
        if (!flintOsKey || !flintOsHost) {
            return res.status(500).json({
                error: 'FLINT OS Pinecone configuration missing',
                missing: {
                    apiKey: !flintOsKey,
                    indexHost: !flintOsHost
                }
            });
        }

        // Test with a simple query to check data availability
        const testEmbedding = await generateEmbedding("test query");
        
        const testPayload = {
            vector: testEmbedding,
            topK: 5,
            namespace: "__default__",
            includeMetadata: true
        };

        const response = await axios.post(`https://${flintOsHost}/query`, testPayload, {
            headers: {
                'Api-Key': flintOsKey,
                'Content-Type': 'application/json',
                'X-Pinecone-API-Version': '2025-04'
            },
            timeout: 30000
        });

        res.json({
            status: 'success',
            matches_count: response.data.matches?.length || 0,
            sample_match: response.data.matches?.[0] || null,
            namespace: response.data.namespace || '__default__',
            usage: response.data.usage || null
        });

    } catch (error) {
        log('error', 'Namespace test failed', error.message);
        res.status(500).json({
            error: 'Failed to test Pinecone connection',
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
    }
});

// Recent Knowledge Endpoint
app.get('/api/recent', validateEmailDomain, async (req, res) => {
    log('info', 'Recent knowledge request started');
    
    try {
        const { limit = 20, days = 30 } = req.query;
        
        // Generate embedding for a generic "recent updates" query
        const queryEmbedding = await generateEmbedding("recent updates knowledge information documents meeting notes");
        
        // Build date filter
        const dateFilter = {
            date_ended: { 
                $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            }
        };

        const requestPayload = {
            vector: queryEmbedding,
            topK: parseInt(limit),
            namespace: "__default__",
            includeMetadata: true,
            filter: dateFilter
        };

        // Use FLINT OS Pinecone configuration
        const flintOsKey = process.env.FLINT_OS_PINECONE_API_KEY;
        const flintOsHost = process.env.FLINT_OS_PINECONE_INDEX_HOST;
        
        if (!flintOsKey || !flintOsHost) {
            throw new Error('FLINT OS Pinecone configuration not found');
        }

        const pineconeApiUrl = `https://${flintOsHost}/query`;
        
        const response = await axios.post(pineconeApiUrl, requestPayload, {
            headers: {
                'Api-Key': flintOsKey,
                'Content-Type': 'application/json',
                'X-Pinecone-API-Version': '2025-04'
            },
            timeout: 30000
        });

        // Parse response with proper error handling
        const matches = response.data.matches || [];
        
        const entries = matches.map(match => ({
            id: match.id,
            title: match.metadata?.title || match.metadata?.label || "Untitled",
            description: match.metadata?.chunk_text?.substring(0, 300) + "..." || "No description",
            author: match.metadata?.people_involved?.[0] || "Unknown",
            date: formatDate(match.metadata?.date_ended),
            tags: match.metadata?.tags || [],
            sourceType: match.metadata?.source_type || "Document",
            importance: deriveImportance(match.metadata || {}),
            summary: match.metadata?.discussion,
            actionItems: match.metadata?.action_items,
            decisions: match.metadata?.decisions_made,
            score: match.score
        }));

        log('info', 'Recent knowledge query completed', {
            total_results: entries.length,
            user_email: req.userEmail,
            days_filter: days
        });

        res.json({ entries });
        
    } catch (error) {
        log('error', 'Recent knowledge query failed', error.message);
        
        // Enhanced error handling
        if (error.response?.status === 422) {
            return res.status(422).json({ 
                error: 'Invalid request format',
                message: 'Pinecone API request validation failed',
                details: error.response.data
            });
        }
        
        res.status(500).json({ 
            error: 'Failed to fetch recent knowledge',
            message: error.message 
        });
    }
});

// Search Endpoint
app.post('/api/search', validateEmailDomain, async (req, res) => {
    log('info', 'Knowledge search request started', req.body);
    
    try {
        const { query, filters = {} } = req.body;
        
        if (!query) {
            return res.status(400).json({
                error: 'Query parameter is required'
            });
        }
        
        // Generate embedding for the search query
        const queryEmbedding = await generateEmbedding(query);
        
        // Build Pinecone filter from UI filters
        const pineconeFilter = {};
        
        if (filters.source_type?.length) {
            pineconeFilter.source_type = { $in: filters.source_type };
        }
        
        if (filters.tags?.length) {
            pineconeFilter.tags = { $in: filters.tags };
        }
        
        if (filters.date_range) {
            pineconeFilter.date_ended = {
                $gte: filters.date_range.from,
                $lte: filters.date_range.to
            };
        }
        
        if (filters.people_involved?.length) {
            pineconeFilter.people_involved = { $in: filters.people_involved };
        }

        const requestPayload = {
            vector: queryEmbedding,
            topK: 50,
            namespace: "__default__",
            includeMetadata: true,
            filter: Object.keys(pineconeFilter).length > 0 ? pineconeFilter : undefined
        };

        // Use FLINT OS Pinecone configuration
        const flintOsKey = process.env.FLINT_OS_PINECONE_API_KEY;
        const flintOsHost = process.env.FLINT_OS_PINECONE_INDEX_HOST;
        
        if (!flintOsKey || !flintOsHost) {
            throw new Error('FLINT OS Pinecone configuration not found');
        }

        const pineconeApiUrl = `https://${flintOsHost}/query`;
        
        const response = await axios.post(pineconeApiUrl, requestPayload, {
            headers: {
                'Api-Key': flintOsKey,
                'Content-Type': 'application/json',
                'X-Pinecone-API-Version': '2025-04'
            },
            timeout: 30000
        });

        // Parse response with validation
        const matches = response.data.matches || [];
        
        const results = matches.map(match => ({
            id: match.id,
            title: match.metadata?.title || match.metadata?.label || "Untitled",
            description: match.metadata?.chunk_text?.substring(0, 300) + "..." || "No description",
            author: match.metadata?.people_involved?.[0] || "Unknown",
            date: formatDate(match.metadata?.date_ended),
            tags: match.metadata?.tags || [],
            sourceType: match.metadata?.source_type || "Document",
            importance: deriveImportance(match.metadata || {}),
            summary: match.metadata?.discussion,
            score: match.score
        }));

        log('info', 'Search query completed', {
            query: query,
            total_results: results.length,
            filters_applied: Object.keys(pineconeFilter),
            user_email: req.userEmail
        });

        res.json({ results });
        
    } catch (error) {
        log('error', 'Search query failed', error.message);
        
        if (error.response?.status === 422) {
            return res.status(422).json({ 
                error: 'Invalid search request',
                message: 'Pinecone API validation failed',
                details: error.response.data
            });
        }
        
        res.status(500).json({ 
            error: 'Search failed',
            message: error.message 
        });
    }
});

// Chat Webhook Proxy
app.post('/api/chat', validateEmailDomain, async (req, res) => {
    log('info', 'Chat request started', req.body);
    
    try {
        const { message, conversation_history } = req.body;
        
        if (!message) {
            return res.status(400).json({
                error: 'Message parameter is required'
            });
        }
        
        // Forward to your Make.com webhook
        const makeWebhookUrl = process.env.MAKE_CHAT_WEBHOOK_URL;
        
        if (!makeWebhookUrl) {
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

        log('info', 'Chat response received', {
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
        log('error', 'Chat request failed', error.message);
        
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

// Legacy transcript search endpoint (for backwards compatibility)
app.post('/search', async (req, res) => {
    log('info', 'Legacy transcript search request started', req.body);
    
    try {
        const { query } = req.body;

        if (!query) {
            return res.status(400).json({
                error: 'Query parameter is required'
            });
        }

        // Generate embedding
        const embedding = await generateEmbedding(query);
        
        const requestPayload = {
            vector: embedding,
            topK: 10,
            namespace: "__default__",
            includeMetadata: true
        };

        // Use legacy transcript Pinecone configuration
        const response = await axios.post(`https://${process.env.PINECONE_INDEX_HOST}/query`, requestPayload, {
            headers: {
                'Api-Key': process.env.PINECONE_API_KEY,
                'Content-Type': 'application/json',
                'X-Pinecone-API-Version': '2025-04'
            },
            timeout: 30000
        });

        const matches = response.data.matches || [];
        const formattedResults = matches.map(match => ({
            id: match.id,
            text: match.metadata?.text || 'No content available',
            score: match.score,
            metadata: match.metadata || {}
        }));

        log('info', 'Legacy transcript search completed', {
            query,
            results_count: formattedResults.length
        });

        res.json({
            results: formattedResults,
            query,
            total: formattedResults.length
        });

    } catch (error) {
        log('error', 'Legacy transcript search failed', error.message);
        res.status(500).json({
            error: 'Search failed',
            message: error.message
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    log('error', 'Unhandled error', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method
    });
    
    res.status(500).json({
        error: 'Internal server error',
        message: 'An unexpected error occurred'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        availableEndpoints: [
            'GET /health',
            'GET /test-namespaces',
            'GET /api/recent',
            'POST /api/search',
            'POST /api/chat',
            'POST /search (legacy)',
            'GET /recent-notion'
        ]
    });
});

// Start server
app.listen(PORT, () => {
    log('info', `FLINT OS Knowledge Base Server started on port ${PORT}`, {
        version: '1.1.2-commonjs-fix',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
    });
});

module.exports = app;