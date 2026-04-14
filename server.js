// --- CRITICAL POLYFILL FOR NODE 18/20 COMPATIBILITY ---
if (typeof File === 'undefined') {
    const { Blob } = require('node:buffer');
    global.File = class extends Blob {
        constructor(chunks, name, opts) {
            super(chunks, opts);
            this.name = name;
            this.lastModified = opts?.lastModified || Date.now();
        }
    };
}
// -----------------------------------------------------

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cheerio = require('cheerio');
const { PORT } = require('./config');

// Safe load for proxyRequest
let proxyRequest;
try {
    proxyRequest = require('./src/lib/proxy-http').proxyRequest;
} catch (e) {
    console.error("Native Module Error: proxy-http.js failed to load.");
    console.error(e);
}

const app = express();

app.use(express.json());
app.use(cookieParser());

// Railway Health Check
app.get('/health', (req, res) => res.status(200).send('OK'));

app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' *;");
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Serve WASM libraries
app.use('/baremux', express.static(path.join(__dirname, 'baremux')));
app.use('/epoxy', express.static(path.join(__dirname, 'epoxy')));
app.use('/scram', express.static(path.join(__dirname, 'scram'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
    }
}));

app.all('/proxy', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL required');
    if (!proxyRequest) return res.status(500).send("Proxy engine failed to initialize.");
    try {
        await proxyRequest(req, res, targetUrl);
    } catch (error) {
        res.status(500).send(`Proxy Error: ${error.message}`);
    }
});

app.post('/extract', async (req, res) => {
    const { url } = req.body;
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await response.text();
        const $ = cheerio.load(html);
        const iframes = [];
        $('iframe').each((i, el) => {
            if ($(el).attr('src')) iframes.push({ src: $(el).attr('src'), label: `Iframe ${i+1}` });
        });
        res.json({ title: $('title').text(), iframes });
    } catch (err) {
        res.json({ error: err.message });
    }
});

app.post('/api/ai', async (req, res) => {
    const { endpoint, apiKey, model, messages } = req.body;
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages })
        });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Yuff Browser Online: http://0.0.0.0:${PORT}`);
});
