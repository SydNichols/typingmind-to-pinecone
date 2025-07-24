// index.js - Environment Variables Debug Version
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');

// Debug environment variables BEFORE loading dotenv
console.log('=== ENVIRONMENT VARIABLES DEBUG ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);

// List all environment variables that start with PINECONE
const pineconeVars = Object.keys(process.env).filter(key => key.startsWith('PINECONE'));
console.log('Found PINECONE environment variables:', pineconeVars);

pineconeVars.forEach(key => {
    const value = process.env[key];
    console.log(`${key}: ${value ? `[SET - length: ${value.length}]` : '[NOT SET]'}`);
});

// Also check for common variations
const commonVars = [
    'PINECONE_API_KEY',
    'PINECONE_INDEX_HOST',
    'PINECONE_API_URL',
    'PINECONE_ENVIRONMENT',
    'PINECONE_INDEX_NAME'
];

console.log('\n=== CHECKING COMMON PINECONE VARIABLES ===');
commonVars.forEach(key => {
    const value = process.env[key];
    console.log(`${key}: ${value ? `[SET - ${value.substring(0, 10)}...]` : '[NOT SET]'}`);
});

// Show all environment variables (be careful with this in production)
console.log('\n=== ALL ENVIRONMENT VARIABLES ===');
const allEnvKeys = Object.keys(process.env).sort();
allEnvKeys.forEach(key => {
    const value = process.env[key];
    // Don't log sensitive values in full, just show they exist
    if (key.toLowerCase().includes('key') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('token')) {
        console.log(`${key}: [SENSITIVE - length: ${value ? value.length : 0}]`);
    } else {
        console.log(`${key}: ${value || '[NOT SET]'}`);
    }
});

console.log('=== END ENVIRONMENT DEBUG ===\n');

// NOW load dotenv (for local development)
require('dotenv').config();

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

// Environment debug endpoint
app.get('/env-debug', (req, res) => {
    const envInfo = {
        timestamp: new Date().toISOString(),
        nodeEnv: process.env.NODE_ENV,
        port: process.env.PORT,
        platform: process.platform,
        nodeVersion: process.version,
        pineconeVars: {},
        allEnvKeys: Object.keys(process.env).sort()
    };

    // Check all PINECONE variables
    Object.keys(process.env).forEach(key => {
        if (key.startsWith('PINECONE')) {
            const value = process.env[key];
            envInfo.pineconeVars[key] = value ? {
                isSet: true,
                length: value.length,
                preview: value.substring(0, 10) + '...'
            } : {
                isSet: false
            };
        }
    });

    log('info', 'Environment debug requested', envInfo);
    res.json(envInfo);
});

// Health check with environment details
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
                length: pineconeApiKey ? pineconeApiKey.length : 0,
                preview: pineconeApiKey ? pineconeApiKey.substring(0, 8) + '...' : null
            },
            indexHost: {
                isSet: !!pineconeIndexHost,
                length: pineconeIndexHost ? pineconeIndexHost.length : 0,
                value: pineconeIndexHost || null
            }
        }
    };
    
    log('info', 'Health check', healthData);
    res.json(healthData);
});

// Pinecone query endpoint with enhanced environment checking
app.post('/pinecone-query', async (req, res) => {
    log('info', 'Pinecone query started');
    
    // Check environment variables with multiple possible names
    const possibleApiKeyNames = [
        'PINECONE_API_KEY',
        'PINECONE_KEY', 
        'PINECONEAPI_KEY',
        'PINECONE_ACCESS_KEY'
    ];
    
    const possibleHostNames = [
        'PINECONE_INDEX_HOST',
        'PINECONE_HOST',
        'PINECONE_INDEX_URL',
        'PINECONE_API_URL',
        'PINECONE_ENDPOINT'
    ];
    
    let pineconeApiKey = null;
    let pineconeIndexHost = null;
    
    // Try to find the API key
    for (const keyName of possibleApiKeyNames) {
        if (process.env[keyName]) {
            pineconeApiKey = process.env[keyName];
            log('info', `Found API key in: ${keyName}`);
            break;
        }
    }
    
    // Try to find the host
    for (const hostName of possibleHostNames) {
        if (process.env[hostName]) {
            pineconeIndexHost = process.env[hostName];
            // Remove https:// if present
            if (pineconeIndexHost.startsWith('https://')) {
                pineconeIndexHost = pineconeIndexHost.replace('https://', '');
            }
            log('info', `Found index host in: ${hostName} = ${pineconeIndexHost}`);
            break;
        }
    }
    
    log('info', 'Environment variable check results', {
        apiKeyFound: !!pineconeApiKey,
        apiKeyLength: pineconeApiKey ? pineconeApiKey.length : 0,
        hostFound: !!pineconeIndexHost,
        hostValue: pineconeIndexHost,
        checkedApiKeyNames: possibleApiKeyNames,
        checkedHostNames: possibleHostNames
    });
    
    if (!pineconeApiKey || !pineconeIndexHost) {
        log('error', 'Missing Pinecone configuration', {
            hasApiKey: !!pineconeApiKey,
            hasHost: !!pineconeIndexHost,
            availableEnvVars: Object.keys(process.env).filter(k => k.includes('PINECONE'))
        });
        
        return res.status(500).json({
            error: 'Pinecone configuration missing',
            details: {
                apiKey: {
                    found: !!pineconeApiKey,
                    checkedNames: possibleApiKeyNames
                },
                indexHost: {
                    found: !!pineconeIndexHost,
                    value: pineconeIndexHost,
                    checkedNames: possibleHostNames
                },
                availablePineconeVars: Object.keys(process.env).filter(k => k.includes('PINECONE')),
                help: 'Set PINECONE_API_KEY and PINECONE_INDEX_HOST in Render environment variables'
            }
        });
    }
    
    // Rest of your Pinecone logic here...
    const { query, search_type = "text", namespace = "__default__", top_k = 10 } = req.body;
    
    if (!query) {
        return res.status(400).json({ error: 'Query parameter is required' });
    }
    
    try {
        const pineconeApiUrl = `https://${pineconeIndexHost}/records/namespaces/${encodeURIComponent(namespace)}/search`;
        
        let requestPayload = { top_k: Math.min(top_k, 10000) };
        
        if (search_type === "text") {
            requestPayload.query = {
                inputs: { text: query },
                top_k: requestPayload.top_k
            };
        } else {
            return res.status(400).json({ error: 'Only text search supported in this debug version' });
        }
        
        log('info', 'Making Pinecone request', {
            url: pineconeApiUrl,
            hasApiKey: !!pineconeApiKey
        });
        
        const response = await axios.post(pineconeApiUrl, requestPayload, {
            headers: {
                'Api-Key': pineconeApiKey,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        log('info', 'Pinecone response received', {
            status: response.status,
            resultCount: response.data?.result?.hits?.length || 0
        });
        
        res.json(response.data);
        
    } catch (error) {
        log('error', 'Pinecone request failed', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
        
        res.status(500).json({
            error: 'Pinecone request failed',
            details: error.response?.data || error.message
        });
    }
});

// 404 handler
app.use((req, res) => {
    log('warn', '404 - Route not found', { url: req.url });
    res.status(404).send(`Cannot ${req.method} ${req.url}`);
});

app.listen(port, '0.0.0.0', () => {
    log('info', 'Server started', {
        port: port,
        environment: process.env.NODE_ENV || 'development',
        pineconeConfigured: {
            apiKey: !!process.env.PINECONE_API_KEY,
            indexHost: !!process.env.PINECONE_INDEX_HOST
        }
    });
    
    console.log('\n🚀 Server is running!');
    console.log('🔍 Check environment variables at: /env-debug');
    console.log('❤️  Health check at: /health');
    console.log('🔍 Available endpoints:');
    console.log('   GET  /');
    console.log('   GET  /health');
    console.log('   GET  /env-debug');
    console.log('   POST /pinecone-query');
});