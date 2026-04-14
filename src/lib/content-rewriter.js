const { DIRECT_RESOURCE_HOSTS } = require('../../config');
const { rewriteLocationHeader, rewriteSrcsetValue, rewriteUrlValue } = require('./url-utils');

function rewriteHtmlResourceUrls(html, baseUrl, proxyOrigin = '') {
    const resourceAttributesByTag = {
        a: ['href'], area: ['href'], audio: ['src'], form: ['action'],
        iframe: ['src', 'srcdoc'], img: ['src', 'srcset'], input: ['src'],
        link: ['href'], script: ['src'], source: ['src', 'srcset'], track: ['src'], video: ['src', 'poster']
    };

    const preservedBlocks =[];
    const protectedHtml = html.replace(/<(script|style|textarea|noscript)\b[\s\S]*?<\/\1>/gi, (block) => {
        const token = `__PROXIT_PRESERVED_BLOCK_${preservedBlocks.length}__`;
        preservedBlocks.push(block);
        return token;
    });

    const rewrittenHtml = protectedHtml.replace(/<[^>]+>/g, (tag) => {
        if (/^<\//.test(tag)) return tag;
        const tagNameMatch = tag.match(/^<\s*([a-z0-9-]+)/i);
        const tagName = tagNameMatch ? tagNameMatch[1].toLowerCase() : '';
        const resourceAttributes = resourceAttributesByTag[tagName] ||[];
        let rewrittenTag = tag;

        for (const attribute of resourceAttributes) {
            rewrittenTag = rewrittenTag.replace(new RegExp(`\\b(${attribute})=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'gi'), (match, attr, doubleQuotedPath, singleQuotedPath, unquotedPath) => {
                const path = doubleQuotedPath ?? singleQuotedPath ?? unquotedPath ?? '';
                const rewrittenValue = attr.toLowerCase() === 'srcset' ? rewriteSrcsetValue(path, baseUrl, proxyOrigin) : rewriteUrlValue(path, baseUrl, proxyOrigin);
                return `${attr}="${rewrittenValue}"`;
            });
        }

        rewrittenTag = rewrittenTag.replace(/\starget=["']_blank["']/gi, ' target="_self"');
        rewrittenTag = rewrittenTag.replace(/\sintegrity=["'][^"']*["']/gi, '');
        rewrittenTag = rewrittenTag.replace(/\scrossorigin=["'][^"']*["']/gi, '');
        return rewrittenTag;
    });

    const restoredHtml = rewrittenHtml.replace(/__PROXIT_PRESERVED_BLOCK_(\d+)__/g, (match, index) => preservedBlocks[Number(index)] || match);

    return restoredHtml.replace(/<script\b[^>]*>/gi, (tag) => {
        return tag.replace(/\b(src)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i, (match, attr, doubleQuotedPath, singleQuotedPath, unquotedPath) => {
            const path = doubleQuotedPath ?? singleQuotedPath ?? unquotedPath ?? '';
            return `${attr}="${rewriteUrlValue(path, baseUrl, proxyOrigin)}"`;
        });
    });
}

function injectProxyBaseTag(html, baseUrl) {
    const baseTag = `<base data-proxit-base href="${baseUrl.href}">`;
    if (/<base\b[^>]*data-proxit-base/i.test(html)) return html.replace(/<base\b[^>]*data-proxit-base[^>]*>/i, baseTag);
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
    if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}</head>`);
    return `${baseTag}${html}`;
}

function injectProxyClientShim(html, proxyOrigin) {
    const shim = `
<script>
(() => {
    if (window.__proxitShimInstalled) return;
    window.__proxitShimInstalled = true;

    const proxyOrigin = ${JSON.stringify(proxyOrigin)};
    const directResourceHosts = ${JSON.stringify(DIRECT_RESOURCE_HOSTS)};
    
    if (typeof window.ready !== 'function') {
        window.ready = function(callback) {
            if (typeof callback !== 'function') return;
            if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => callback.call(document), { once: true }); return; }
            callback.call(document);
        };
    }

    const upstreamBase = (() => { const baseElement = document.querySelector('base[data-proxit-base]'); return baseElement ? baseElement.href : document.baseURI; })();
    
    const notifyParentNavigation = (url) => {
        if (!window.parent || window.parent === window) return;
        try { window.parent.postMessage({ type: 'proxit:navigating', url: String(url || '') }, proxyOrigin || '*'); } catch {}
    };

    const shouldBypass = (value) => {
        if (!value) return true;
        return (value.startsWith('data:') || value.startsWith('javascript:') || value.startsWith('mailto:') || value.startsWith('tel:') || value.startsWith('#'));
    };

    const toAbsoluteUrl = (value) => { try { return new URL(value, upstreamBase).href; } catch { return value; } };

    const shouldBypassProxyForAbsoluteUrl = (absoluteUrl) => {
        try {
            const url = new URL(absoluteUrl);
            const hostname = url.hostname.toLowerCase();
            return directResourceHosts.some((directHost) => hostname === directHost || hostname.endsWith('.' + directHost));
        } catch { return false; }
    };

    const toProxyUrl = (value) => {
        if (shouldBypass(value)) return value;
        const absoluteUrl = toAbsoluteUrl(value);
        if (shouldBypassProxyForAbsoluteUrl(absoluteUrl)) return absoluteUrl;
        return proxyOrigin + '/proxy?url=' + encodeURIComponent(absoluteUrl);
    };

    const shouldProxyRequest = (value) => {
        if (!value || shouldBypass(value)) return false;
        const absoluteUrl = toAbsoluteUrl(value);
        if (shouldBypassProxyForAbsoluteUrl(absoluteUrl)) return false;
        if (!/^https?:/i.test(absoluteUrl)) return false;
        if (absoluteUrl.startsWith(proxyOrigin + '/')) return false;
        return true;
    };

    window.open = function(url) {
        if (url) {
            const destinationUrl = toProxyUrl(url);
            notifyParentNavigation(destinationUrl);
            window.location.href = destinationUrl;
        }
        return window;
    };

    document.addEventListener('click', (event) => {
        const link = event.target.closest && event.target.closest('a[href]');
        if (!link) return;
        const href = link.getAttribute('href');
        if (!href || shouldBypass(href)) return;
        notifyParentNavigation(link.href || toProxyUrl(href));
    }, true);

    const originalFetch = window.fetch && window.fetch.bind(window);
    if (originalFetch) {
        window.fetch = function(input, init) {
            if (typeof input === 'string') return originalFetch(shouldProxyRequest(input) ? toProxyUrl(input) : input, init);
            if (input instanceof Request) {
                const requestUrl = input.url;
                if (!shouldProxyRequest(requestUrl)) return originalFetch(input, init);
                return originalFetch(new Request(toProxyUrl(requestUrl), input), init);
            }
            return originalFetch(input, init);
        };
    }

    const OriginalXHR = window.XMLHttpRequest;
    if (OriginalXHR) {
        const originalOpen = OriginalXHR.prototype.open;
        OriginalXHR.prototype.open = function(method, url, ...rest) {
            const proxiedUrl = shouldProxyRequest(url) ? toProxyUrl(url) : url;
            return originalOpen.call(this, method, proxiedUrl, ...rest);
        };
    }
})();
</script>`;

    if (/<base\b[^>]*data-proxit-base[^>]*>/i.test(html)) return html.replace(/(<base\b[^>]*data-proxit-base[^>]*>)/i, `$1${shim}`);
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${shim}`);
    if (/<body[^>]*>/i.test(html)) return html.replace(/<body([^>]*)>/i, `<body$1>${shim}`);
    return `${shim}${html}`;
}

function rewriteCssResourceUrls(css, baseUrl, proxyOrigin = '') {
    const rewrittenUrls = css.replace(/url\((['"]?)([^)'"]+)\1\)/gi, (match, quote, path) => `url(${quote}${rewriteUrlValue(path.trim(), baseUrl, proxyOrigin)}${quote})`);
    return rewrittenUrls.replace(/@import\s+(?:url\()?(['"])([^'"]+)\1\)?/gi, (match, quote, path) => match.replace(path, rewriteUrlValue(path.trim(), baseUrl, proxyOrigin)));
}

function rewriteSetCookieHeader(value) {
    const cookies = Array.isArray(value) ? value : [value];
    return cookies.map((cookie) => {
        const parts = cookie.split(';').map((part) => part.trim()).filter(Boolean);
        if (parts.length === 0) return cookie;
        const [nameValue, ...attributes] = parts;
        const rewrittenAttributes =[];
        for (const attribute of attributes) {
            const lowerAttribute = attribute.toLowerCase();
            if (lowerAttribute.startsWith('domain=') || lowerAttribute === 'secure') continue;
            if (lowerAttribute === 'samesite=none') { rewrittenAttributes.push('SameSite=Lax'); continue; }
            rewrittenAttributes.push(attribute);
        }
        if (!rewrittenAttributes.some((attribute) => attribute.toLowerCase().startsWith('path='))) rewrittenAttributes.push('Path=/');
        return [nameValue, ...rewrittenAttributes].join('; ');
    });
}

module.exports = { rewriteHtmlResourceUrls, injectProxyBaseTag, injectProxyClientShim, rewriteCssResourceUrls, rewriteSetCookieHeader, rewriteLocationHeader };
