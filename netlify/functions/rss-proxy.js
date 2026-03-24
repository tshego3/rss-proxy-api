const RSSParser = require("rss-parser");

// Create a new RSS parser instance
const parser = new RSSParser();

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
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    "Accept": "application/rss+xml, application/xml, application/atom+xml, text/xml;q=0.9, */*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache",
                    "Connection": "keep-alive",
                    "User-Agent": getRandomUserAgent(),
                },
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

exports.handler = async (event, context) => {
    const { url, format = "xml" } = event.queryStringParameters;

    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

    if (format !== "xml" && format !== "json") {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Format must be either "xml" or "json".' }),
        };
    }

    try {
        console.log(`Fetching RSS from: ${url}`);
        const responseData = await fetchWithRetry(url);

        if (!responseData.ok) {
            throw { response: { status: responseData.status, data: responseData.data } };
        }

        let body;
        if (format === "json") {
            const feed = await parser.parseString(responseData.data);
            body = JSON.stringify(feed);
        } else {
            body = responseData.data;
        }

        return {
            statusCode: 200,
            headers: {
                ...headers,
                "Content-Type": format === "json" ? "application/json" : "application/xml",
            },
            body,
        };
    } catch (error) {
        console.warn(`Primary fetch failed for ${url}:`, error.message || error.response?.status);

        // Fallback: Try Codetabs Proxy
        try {
            console.log(`Attempting fallback via Codetabs proxy for: ${url}`);
            const codetabsUrl = `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const fallbackResponse = await fetch(codetabsUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (fallbackResponse.ok) {
                const data = await fallbackResponse.text();
                let body;
                if (format === "json") {
                    const feed = await parser.parseString(data);
                    body = JSON.stringify(feed);
                } else {
                    body = data;
                }

                return {
                    statusCode: 200,
                    headers: {
                        ...headers,
                        "Content-Type": format === "json" ? "application/json" : "application/xml",
                        "X-Proxy-Fallback": "codetabs",
                    },
                    body,
                };
            }
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
                        ? `The upstream server (${new URL(url).hostname}) is protected by Cloudflare and blocked this request (HTTP ${status}).`
                        : `Upstream server returned HTTP ${status}.`,
                    url,
                    statusCode: status,
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
                body: JSON.stringify({ error: "Failed to parse RSS feed or invalid URL.", url }),
            };
        }
    }
};
