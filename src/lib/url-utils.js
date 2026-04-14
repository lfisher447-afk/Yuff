const { BYPASS_ALL_UPSTREAM_HOSTS, DIRECT_RESOURCE_HOSTS, UPSTREAM_HOST_OVERRIDES } = require('../../config');
const RECAPTCHA_HOSTS =['www.google.com', 'www.recaptcha.net', 'www.gstatic.com'];
const NUMBERED_DIRECT_HOST_SUFFIXES = [];
const DIRECT_PATH_RULES = [{ hosts:['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'], pathPrefixes: ['/embed/', '/s/_/ytembeds/'] }];
const DIRECT_HOST_SUFFIXES = ['googlevideo.com', 'ytimg.com'];

function isLocalDevelopmentHost(hostname) {
    const norm = String(hostname || '').toLowerCase();
    return norm === 'localhost' || norm === '127.0.0.1' || norm === '::1' || norm.endsWith('.localhost');
}

function shouldBypassHostsFile(hostname) {
    if (BYPASS_ALL_UPSTREAM_HOSTS) return true;
    return UPSTREAM_HOST_OVERRIDES.has(hostname.toLowerCase());
}

function getProxyOrigin(req) {
    const forwardedProtoHeader = req.get('x-forwarded-proto');
    const protocol = forwardedProtoHeader ? forwardedProtoHeader.split(',')[0].trim() : req.protocol;
    return `${protocol}://${req.get('host')}`;
}

function toProxyUrl(absoluteUrl, proxyOrigin = '') {
    const proxyPath = `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
    return proxyOrigin ? `${proxyOrigin}${proxyPath}` : proxyPath;
}

function unwrapProxyUrl(absoluteUrl, proxyOrigin = '') {
    let currentUrl = absoluteUrl;
    for (let depth = 0; depth < 5; depth += 1) {
        try {
            const parsedUrl = new URL(currentUrl, proxyOrigin || undefined);
            const isLocalProxyPath = parsedUrl.pathname === '/proxy';
            const isMatchingOrigin = !proxyOrigin || parsedUrl.origin === proxyOrigin;
            if (!isLocalProxyPath || !isMatchingOrigin) return parsedUrl.href;
            const nestedUrl = parsedUrl.searchParams.get('url');
            if (!nestedUrl) return parsedUrl.href;
            currentUrl = nestedUrl;
        } catch { return currentUrl; }
    }
    return currentUrl;
}

function shouldBypassProxyForAbsoluteUrl(absoluteUrl) {
    try {
        const url = new URL(absoluteUrl);
        const hostname = url.hostname.toLowerCase();
        const pathname = url.pathname;
        if (isLocalDevelopmentHost(hostname)) return true;
        if (RECAPTCHA_HOSTS.includes(hostname) && pathname.startsWith('/recaptcha/')) return true;
        if (NUMBERED_DIRECT_HOST_SUFFIXES.some(s => new RegExp(`^c\\d+\\.${s.replace('.', '\\.')}$`, 'i').test(hostname))) return true;
        if (DIRECT_PATH_RULES.some(r => r.hosts.includes(hostname) && r.pathPrefixes.some(p => pathname.startsWith(p)))) return true;
        if (DIRECT_HOST_SUFFIXES.some(s => hostname === s || hostname.endsWith(`.${s}`))) return true;
        return DIRECT_RESOURCE_HOSTS.some(d => hostname === d || hostname.endsWith(`.${d}`));
    } catch { return false; }
}

function isAlreadyProxyUrl(absoluteUrl, proxyOrigin = '') {
    try {
        const url = new URL(absoluteUrl, proxyOrigin || undefined);
        if (url.pathname !== '/proxy') return false;
        if (!proxyOrigin) return true;
        return url.origin === proxyOrigin;
    } catch { return false; }
}

function shouldLeaveUrlAlone(path) {
    return !path || path.startsWith('data:') || path.startsWith('javascript:') || path.startsWith('mailto:') || path.startsWith('tel:') || path.startsWith('#');
}

function rewriteUrlValue(path, baseUrl, proxyOrigin = '') {
    if (shouldLeaveUrlAlone(path)) return path;
    try {
        const absolute = new URL(path, baseUrl).href;
        if (isAlreadyProxyUrl(absolute, proxyOrigin)) return absolute;
        if (shouldBypassProxyForAbsoluteUrl(absolute)) return absolute;
        return toProxyUrl(absolute, proxyOrigin);
    } catch { return path; }
}

function rewriteSrcsetValue(value, baseUrl, proxyOrigin = '') {
    return value.split(',').map(c => {
        const trimmed = c.trim();
        if (!trimmed) return c;
        const parts = trimmed.split(/\s+/);
        return[rewriteUrlValue(parts[0], baseUrl, proxyOrigin), ...parts.slice(1)].join(' ');
    }).join(', ');
}

function rewriteLocationHeader(value, baseUrl, proxyOrigin = '') {
    if (!value) return value;
    try { return toProxyUrl(new URL(value, baseUrl).href, proxyOrigin); } 
    catch { return value; }
}

module.exports = { DIRECT_RESOURCE_HOSTS, DIRECT_HOST_SUFFIXES, DIRECT_PATH_RULES, NUMBERED_DIRECT_HOST_SUFFIXES, RECAPTCHA_HOSTS, isLocalDevelopmentHost, shouldBypassHostsFile, getProxyOrigin, toProxyUrl, unwrapProxyUrl, isAlreadyProxyUrl, shouldBypassProxyForAbsoluteUrl, shouldLeaveUrlAlone, rewriteUrlValue, rewriteSrcsetValue, rewriteLocationHeader };
