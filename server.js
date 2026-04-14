const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cheerio = require('cheerio');
const { PORT } = require('./config');
const { proxyRequest } = require('./src/lib/proxy-http');

const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' *;");
    next();
});

// Serve Public Files
app.use(express.static(path.join(__dirname, 'public')));

// Serve Client-Side Proxy Libraries & WASM (with correct MIME types)
app.use('/baremux', express.static(path.join(__dirname, 'baremux')));
app.use('/epoxy', express.static(path.join(__dirname, 'epoxy')));
app.use('/scram', express.static(path.join(__dirname, 'scram'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
        }
    }
}));

// Core Server-Side Proxy Endpoint
app.all('/proxy', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Invalid or missing URL parameter');
    try {
        await proxyRequest(req, res, targetUrl);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).send(`<h2>Proxy Error</h2><p>${error.message}</p>`);
    }
});

// Extractor Backend Endpoint (USING NATIVE FETCH)
app.post('/extract', async (req, res) => {
    const { url } = req.body;
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
        }
        const html = await response.text();
        const $ = cheerio.load(html);
        
        const iframes = [];
        $('iframe').each((i, el) => {
            if ($(el).attr('src')) {
                iframes.push({ src: $(el).attr('src'), label: `Extracted Iframe ${i+1}` });
            }
        });

        const links = [];
        $('a').each((i, el) => {
            if ($(el).attr('href')) links.push({ url: $(el).attr('href'), title: $(el).text().trim() });
        });

        if (iframes.length === 0) {
            return res.json({ error: 'no_iframes', message: 'No iframes found on page.', help: 'Try these links instead:', links: links.slice(0,10) });
        }
        res.json({ title: $('title').text() || 'Extracted Page', iframes, links });
    } catch (err) {
        res.json({ error: `Extraction failed: ${err.message}` });
    }
});

// AI Passthrough Endpoint (USING NATIVE FETCH)
app.post('/api/ai', async (req, res) => {
    const { endpoint, apiKey, model, messages } = req.body;
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${apiKey}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ model, messages })
        });

        const data = await response.json();

        if (!response.ok) {
             // Forward the actual error from the AI API
            return res.status(response.status).json(data);
        }

        res.json(data);
    } catch (err) {
        res.status(500).json({ error: { message: `AI Passthrough Error: ${err.message}` } });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Yuff Browser Server running on port ${PORT}`);
});
