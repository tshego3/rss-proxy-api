const axios = require("axios");
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
      const response = await axios.get(url, {
        timeout: 10000,
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
  const { url, format = "xml" } = event.queryStringParameters;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

  // Validate format parameter
  if (format !== "xml" && format !== "json") {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Format must be either "xml" or "json".' }),
    };
  }

  try {
    // Fetch the RSS feed data with retry logic
    const response = await fetchWithRetry(url);

    let body;
    if (format === "json") {
      // Parse the RSS data and send as JSON
      const feed = await parser.parseString(response.data);
      body = JSON.stringify(feed);
    } else {
      // Send the original XML response
      body = response.data;
    }

    // Set CORS headers to allow cross-origin requests
    return {
      statusCode: 200,
      headers: {
        ...headers,
        "Content-Type":
          format === "json" ? "application/json" : "application/xml",
      },
      body,
    };
  } catch (error) {
    console.error(`RSS Proxy error for URL: ${url}`, error.message);

    // Error handling: check if it's a network error or invalid RSS
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
          error: "Failed to parse RSS feed or invalid URL.",
          url,
        }),
      };
    }
  }
};
