const axios = require("axios");

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

        const response = await axios.get(url, {
            timeout: 15000,
            maxRedirects: 5,
            headers: {
                "Accept": "application/rss+xml, application/xml, application/atom+xml, text/xml;q=0.9, */*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
            },
        });

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
        console.error(`Error fetching XML for ${url}:`, error.message);

        const status = error.response?.status || 500;
        return {
            statusCode: status,
            headers,
            body: JSON.stringify({
                error: `Failed to download XML from the source. Upstream returned status ${status}.`,
                message: error.message,
                url,
            }),
        };
    }
};
