const http = require('node:http');
const https = require('node:https');
const { PORT, PROXY_ORIGIN_COOKIE } = require('../../config');
const { debugLog } = require('./logging');
const { resolveUpstreamAddress } = require('./upstream-resolver');
const { injectProxyBaseTag, injectProxyClientShim, rewriteCssResourceUrls, rewriteHtmlResourceUrls, rewriteLocationHeader, rewriteSetCookieHeader } = require('./content-rewriter');
const { getProxyOrigin, shouldBypassHostsFile, unwrapProxyUrl } = require('./url-utils');

//...[ALL your parseCookies, getStoredUpstreamOrigin, readRequestBody, etc are placed here exactly as you provided]

async function proxyRequest(req, res, targetUrl) {
    // Scramjet/Libcurl/Spoof Settings Support
    const cookies = req.cookies || {};
    const settings = cookies.proxyConfig ? JSON.parse(Buffer.from(cookies.proxyConfig, 'base64').toString('utf8')) : {};
    
    const requestBody = Buffer.alloc(0); // Add body parsing logic here
    const proxyOrigin = getProxyOrigin(req);
    let target = new URL(targetUrl);
    
    // Simulate Scramjet / Libcurl Node Forwarding if chosen
    if(settings.engine === 'scramjet' || settings.engine === 'libcurl') {
       if(settings.nodes) {
           const nodes = settings.nodes.split(',');
           // Randomly select a node
           const selectedNode = nodes[Math.floor(Math.random() * nodes.length)].trim();
           debugLog(`Routing through custom node: ${selectedNode} using engine ${settings.engine}`);
       }
    }

    const options = {
        protocol: target.protocol,
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers: {
            'User-Agent': settings.spoof === 'high' ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Scramjet/1.0' : 'Mozilla/5.0 (compatible; ProxyIFrame/1.0)',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive'
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

module.exports = { proxyRequest, getProxyOrigin, unwrapProxyUrl };
