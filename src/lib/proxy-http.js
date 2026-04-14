const http = require('node:http');
const https = require('node:https');

// Safely load node-libcurl
let Curl;
try {
    Curl = require('node-libcurl').Curl;
} catch (e) {
    console.warn("WARNING: node-libcurl could not be loaded. Falling back to standard proxy engine.");
}

const { getProxyOrigin } = require('./url-utils');
const { injectProxyBaseTag, injectProxyClientShim, rewriteCssResourceUrls, rewriteHtmlResourceUrls, rewriteSetCookieHeader } = require('./content-rewriter');

async function proxyRequest(req, res, targetUrl) {
    const cookies = req.cookies || {};
    const settings = cookies.proxyConfig ? JSON.parse(Buffer.from(cookies.proxyConfig, 'base64').toString('utf8')) : { engine: 'standard' };
    
    const target = new URL(targetUrl);
    const proxyOrigin = getProxyOrigin(req);

    // ENGINE: LIBCURL (Only if loaded successfully)
    if (settings.engine === 'libcurl' && Curl) {
        const curl = new Curl();
        curl.setOpt('URL', target.href);
        curl.setOpt('FOLLOWLOCATION', true);
        curl.setOpt('SSL_VERIFYPEER', false);
        curl.setOpt('USERAGENT', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        curl.on('end', function (statusCode, data, headers) {
            let body = data;
            const contentType = headers[0]['content-type'] || 'text/html';
            
            if (contentType.includes('text/html')) {
                let html = body.toString('utf8');
                html = injectProxyBaseTag(html, target);
                html = rewriteHtmlResourceUrls(html, target, proxyOrigin);
                html = injectProxyClientShim(html, proxyOrigin);
                body = Buffer.from(html, 'utf8');
            }
            res.status(statusCode).setHeader('Content-Type', contentType).send(body);
            this.close();
        });
        curl.on('error', (err) => { curl.close(); res.status(500).send(err.message); });
        curl.perform();
        return;
    }

    // ENGINE: STANDARD FALLBACK
    const transport = target.protocol === 'https:' ? https : http;
    const options = {
        hostname: target.hostname,
        path: target.pathname + target.search,
        method: req.method,
        headers: { 'User-Agent': 'Mozilla/5.0' }
    };

    const proxyReq = transport.request(options, (upstreamResponse) => {
        let chunks = [];
        upstreamResponse.on('data', chunk => chunks.push(chunk));
        upstreamResponse.on('end', () => {
            let body = Buffer.concat(chunks);
            let contentType = upstreamResponse.headers['content-type'] || 'text/html';

            if (contentType.includes('text/html')) {
                let html = body.toString('utf8');
                html = injectProxyBaseTag(html, target);
                html = rewriteHtmlResourceUrls(html, target, proxyOrigin);
                html = injectProxyClientShim(html, proxyOrigin);
                body = Buffer.from(html, 'utf8');
            }
            res.status(upstreamResponse.statusCode).setHeader('Content-Type', contentType).send(body);
        });
    });
    proxyReq.end();
}

module.exports = { proxyRequest };
