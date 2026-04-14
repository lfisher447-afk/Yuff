const http = require('node:http');
const https = require('node:https');
const { Curl } = require('node-libcurl');
const { getProxyOrigin } = require('./url-utils');
const { debugLog } = require('./logging');
const { injectProxyBaseTag, injectProxyClientShim, rewriteCssResourceUrls, rewriteHtmlResourceUrls, rewriteSetCookieHeader } = require('./content-rewriter');

async function proxyRequest(req, res, targetUrl) {
    const cookies = req.cookies || {};
    const settings = cookies.proxyConfig ? JSON.parse(Buffer.from(cookies.proxyConfig, 'base64').toString('utf8')) : { engine: 'standard' };
    
    const target = new URL(targetUrl);
    const proxyOrigin = getProxyOrigin(req);

    // Engine: Libcurl (Highest Anti-Detection)
    if (settings.engine === 'libcurl') {
        const curl = new Curl();
        curl.setOpt('URL', target.href);
        curl.setOpt('FOLLOWLOCATION', true);
        curl.setOpt('SSL_VERIFYPEER', false);
        curl.setOpt('USERAGENT', settings.spoof === 'high' ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' : 'Mozilla/5.0');
        
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

        curl.on('error', (err) => {
            curl.close();
            res.status(500).send(`Libcurl Error: ${err.message}`);
        });

        curl.perform();
        return;
    }

    // Engine: Standard Node HTTP
    const options = {
        hostname: target.hostname,
        path: target.pathname + target.search,
        method: req.method,
        headers: {
            'User-Agent': settings.spoof === 'high' ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' : 'Mozilla/5.0'
        }
    };

    const transport = target.protocol === 'https:' ? https : http;
    const proxyReq = transport.request(options, (upstreamResponse) => {
        let chunks =[];
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
            } else if (contentType.includes('text/css')) {
                const css = rewriteCssResourceUrls(body.toString('utf8'), target, proxyOrigin);
                body = Buffer.from(css, 'utf8');
            }

            res.status(upstreamResponse.statusCode);
            res.setHeader('Content-Type', contentType);
            if(upstreamResponse.headers['set-cookie']) {
                res.setHeader('Set-Cookie', rewriteSetCookieHeader(upstreamResponse.headers['set-cookie']));
            }
            res.send(body);
        });
    });

    proxyReq.on('error', err => res.status(500).send(`Proxy Error: ${err.message}`));
    proxyReq.end();
}

module.exports = { proxyRequest };
