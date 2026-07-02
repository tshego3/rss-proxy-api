// Browser-like headers: Cloudflare scores requests from datacenter IPs (like
// Netlify's AWS ranges) heavily on the User-Agent — Node's fetch sends none by
// default, which reads as a bot and triggers 403s on protected feeds.
const BROWSER_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "application/rss+xml, application/xml, application/atom+xml, text/xml;q=0.9, */*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
};

// Upstream (and fallback proxies) sometimes return HTML challenge/error pages
// with a 200 status — only trust a body that actually looks like a feed.
function looksLikeFeedXml(text) {
    if (typeof text !== "string") return false;
    const head = text.trimStart().slice(0, 500).toLowerCase();
    if (head.startsWith("<!doctype html") || head.startsWith("<html")) return false;
    const lower = text.toLowerCase();
    return lower.includes("<rss") || lower.includes("<feed") || lower.includes("<rdf");
}

async function fetchWithRetry(url, maxRetries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const response = await fetch(url, {
                signal: controller.signal,
                redirect: "follow",
                headers: BROWSER_HEADERS,
            });

            clearTimeout(timeoutId);
            const data = await response.text();
            return { ok: response.ok, status: response.status, data };
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
            }
        }
    }
    throw lastError;
}

const FALLBACK_PROXIES = [
    { name: "codetabs", buildUrl: (u) => `https://api.codetabs.com/v1/proxy/?quest=${u}` },
    { name: "allorigins", buildUrl: (u) => `https://api.allorigins.win/raw?url=${u}` },
];

async function fetchViaFallbackProxies(url) {
    const encoded = encodeURIComponent(url);
    for (const proxy of FALLBACK_PROXIES) {
        try {
            console.log(`Attempting fallback via ${proxy.name} proxy for: ${url}`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(proxy.buildUrl(encoded), { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.text();
                if (looksLikeFeedXml(data)) {
                    return { data, via: proxy.name };
                }
                console.warn(`${proxy.name} returned non-feed content for ${url}`);
            }
        } catch (fallbackError) {
            console.error(`${proxy.name} fallback failed for ${url}:`, fallbackError.message);
        }
    }
    return null;
}

exports.handler = async (event, context) => {
    const { url } = event.queryStringParameters;

    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };

    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 204, headers, body: "" };
    }

    if (!url) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Missing "url" query parameter.' }),
        };
    }

    try {
        console.log(`Fetching XML from: ${url}`);
        const responseData = await fetchWithRetry(url);

        if (responseData.ok && looksLikeFeedXml(responseData.data)) {
            return {
                statusCode: 200,
                headers: { ...headers, "Content-Type": "application/xml" },
                body: responseData.data,
            };
        }

        // Handle failed primary fetch by status
        throw { response: { status: responseData.status, data: responseData.data } };

    } catch (error) {
        console.error(`Primary fetch failed for ${url}:`, error.message || error.response?.status);

        const fallback = await fetchViaFallbackProxies(url);
        if (fallback) {
            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    "Content-Type": "application/xml",
                    "X-Proxy-Fallback": fallback.via,
                },
                body: fallback.data,
            };
        }

        // Final error reporting
        if (error.response) {
            const status = error.response.status;
            const isCloudflare =
                typeof error.response.data === "string" &&
                (error.response.data.includes("cf-chl") ||
                    error.response.data.includes("Just a moment"));

            return {
                statusCode: status === 200 ? 502 : status,
                headers,
                body: JSON.stringify({
                    error: isCloudflare
                        ? `The feed (${new URL(url).hostname}) is protected by Cloudflare and blocked this request (HTTP ${status}).`
                        : status === 200
                            ? `Upstream returned HTTP 200 but the body is not a feed.`
                            : `Failed to download XML. Upstream returned HTTP ${status}.`,
                    url,
                }),
            };
        } else if (error.name === "AbortError") {
            return {
                statusCode: 504,
                headers,
                body: JSON.stringify({ error: `Request to ${new URL(url).hostname} timed out.`, url }),
            };
        } else {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: "Failed to fetch XML or invalid URL.", url }),
            };
        }
    }
};
