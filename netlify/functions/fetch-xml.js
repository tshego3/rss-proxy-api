const axios = require("axios");

// Rotate User-Agent strings to reduce bot detection
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function fetchWithRetry(url, maxRetries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios.get(url, {
                timeout: 15000,
                maxRedirects: 5,
                headers: {
                    "Accept": "application/rss+xml, application/xml, application/atom+xml, text/xml;q=0.9, */*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache",
                    "Connection": "keep-alive",
                    "Sec-Fetch-Dest": "document",
                    "Sec-Fetch-Mode": "navigate",
                    "Sec-Fetch-Site": "none",
                    "Sec-Fetch-User": "?1",
                    "Upgrade-Insecure-Requests": "1",
                    "User-Agent": getRandomUserAgent(),
                },
            });
            return response;
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                // Wait before retrying (exponential backoff)
                await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
            }
        }
    }
    throw lastError;
}

exports.handler = async (event, context) => {
    const { url } = event.queryStringParameters;

    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle preflight OPTIONS request
    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 204,
            headers,
            body: "",
        };
    }

    // Check if URL parameter is provided
    if (!url) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Missing "url" query parameter.' }),
        };
    }

    try {
        console.log(`Fetching XML from: ${url}`);

        const response = await fetchWithRetry(url);

        // Return the raw XML content
        return {
            statusCode: 200,
            headers: {
                ...headers,
                "Content-Type": "application/xml",
            },
            body: response.data,
        };
    } catch (error) {
        console.error(`Primary fetch failed for ${url}:`, error.message);

        // Fallback: Try Codetabs Proxy
        try {
            console.log(`Attempting fallback via Codetabs proxy for: ${url}`);
            const codetabsUrl = `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`;
            const response = await axios.get(codetabsUrl, { timeout: 10000 });
            
            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    "Content-Type": "application/xml",
                    "X-Proxy-Fallback": "codetabs",
                },
                body: response.data,
            };
        } catch (codetabsError) {
            console.error(`Codetabs fallback also failed for ${url}:`, codetabsError.message);
        }

        if (error.response) {
            const status = error.response.status;
            const isCloudflare =
                typeof error.response.data === "string" &&
                (error.response.data.includes("cf-chl") ||
                    error.response.data.includes("Just a moment"));

            return {
                statusCode: status,
                headers,
                body: JSON.stringify({
                    error: isCloudflare
                        ? `The feed (${new URL(url).hostname}) is protected by Cloudflare and blocked this request (HTTP ${status}).`
                        : `Failed to download XML. Upstream returned HTTP ${status}.`,
                    url,
                }),
            };
        } else if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
            return {
                statusCode: 504,
                headers,
                body: JSON.stringify({
                    error: `Request to ${new URL(url).hostname} timed out.`,
                    url,
                }),
            };
        } else if (error.request) {
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({
                    error: `Network error: no response from ${new URL(url).hostname}.`,
                    url,
                }),
            };
        } else {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: "Failed to fetch XML or invalid URL.",
                    url,
                }),
            };
        }
    }
};
