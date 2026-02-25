const axios = require("axios");
const RSSParser = require("rss-parser");

// Create a new RSS parser instance
const parser = new RSSParser();

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
    // Fetch the RSS feed data
    const response = await axios.get(url, {
      headers: {
        "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Referer": url,
      },
    });

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
    console.error(error);

    // Error handling: check if it's a network error or invalid RSS
    if (error.response) {
      return {
        statusCode: error.response.status,
        headers,
        body: JSON.stringify({ error: error.response.data }),
      };
    } else if (error.request) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "Network error, no response from server.",
        }),
      };
    } else {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "Failed to parse RSS feed or invalid URL.",
        }),
      };
    }
  }
};
