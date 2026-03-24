
async function fetchWithRetry(url, maxRetries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    "Accept": "application/rss+xml, application/xml, application/atom+xml, text/xml;q=0.9, */*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache",
                    "Connection": "keep-alive",
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

        if (responseData.ok) {
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

        // Fallback: Try Codetabs Proxy with native fetch
        try {
            console.log(`Attempting fallback via Codetabs proxy for: ${url}`);
            const codetabsUrl = `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const fallbackResponse = await fetch(codetabsUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (fallbackResponse.ok) {
                const data = await fallbackResponse.text();
                return {
                    statusCode: 200,
                    headers: {
                        ...headers,
                        "Content-Type": "application/xml",
                        "X-Proxy-Fallback": "codetabs",
                    },
                    body: data,
                };
            }
        } catch (codetabsError) {
            console.error(`Codetabs fallback also failed for ${url}:`, codetabsError.message);
        }

        // Final error reporting
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
