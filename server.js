const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const cheerio = require('cheerio');
const { PORT } = require('./config');
const { proxyRequest, getProxyOrigin, unwrapProxyUrl } = require('./src/lib/proxy-http');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(cookieParser());

// Anti-detection headers applied globally
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' *;");
    next();
});

// Your Proxy Endpoint
app.all('/proxy', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Invalid or missing URL parameter');
    try {
        await proxyRequest(req, res, targetUrl);
    } catch (error) {
        res.status(500).send(`<h2>Proxy Error</h2><p>${error.message}</p>`);
    }
});

// The Iframe Extractor Backend Endpoint (Called by app.js)
app.post('/extract', async (req, res) => {
    const { url } = req.body;
    try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const iframes =[];
        
        $('iframe').each((i, el) => {
            if ($(el).attr('src')) {
                iframes.push({ src: $(el).attr('src'), label: `Extracted Iframe ${i+1}` });
            }
        });

        const links =[];
        $('a').each((i, el) => {
            if ($(el).attr('href')) links.push({ url: $(el).attr('href'), title: $(el).text() });
        });

        if (iframes.length === 0) {
            return res.json({ error: 'no_iframes', message: 'No iframes found on page.', help: 'Try these links instead:', links: links.slice(0,10) });
        }
        res.json({ title: $('title').text() || 'Extracted Page', iframes, links });
    } catch (err) {
        res.json({ error: `Extraction failed: ${err.message}` });
    }
});

// Any AI API Passthrough
app.post('/api/ai', async (req, res) => {
    const { endpoint, apiKey, model, messages } = req.body;
    try {
        const aiReq = await axios.post(endpoint, { model, messages }, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });
        res.json(aiReq.data);
    } catch (err) {
        res.status(500).json({ error: err.response ? err.response.data : err.message });
    }
});

app.listen(PORT, () => console.log(`🚀 Railway Server running on http://localhost:${PORT}`));
