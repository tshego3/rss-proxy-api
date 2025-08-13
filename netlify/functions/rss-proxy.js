const axios = require("axios");
const RSSParser = require("rss-parser");

// Create a new RSS parser instance
const parser = new RSSParser();

exports.handler = async (event, context) => {
  const { url, format = "xml" } = event.queryStringParameters;

  // Check if URL parameter is provided
  if (!url) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing "url" query parameter.' }),
    };
  }

  // Validate format parameter
  if (format !== "xml" && format !== "json") {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Format must be either "xml" or "json".' }),
    };
  }

  try {
    // Fetch the RSS feed data
    const response = await axios.get(url, {
      headers: { Accept: "application/xml" },
    });

    if (format === "json") {
      // Parse the RSS data and send as JSON
      const feed = await parser.parseString(response.data);
      return {
        statusCode: 200,
        body: JSON.stringify(feed),
      };
    } else {
      // Send the original XML response
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/xml" },
        body: response.data,
      };
    }
  } catch (error) {
    console.error(error);

    // Error handling: check if it's a network error or invalid RSS
    if (error.response) {
      // The server responded with a status code outside the 2xx range
      return {
        statusCode: error.response.status,
        body: JSON.stringify({ error: error.response.data }),
      };
    } else if (error.request) {
      // The request was made, but no response was received
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Network error, no response from server.",
        }),
      };
    } else {
      // General error (invalid RSS, etc.)
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Failed to parse RSS feed or invalid URL.",
        }),
      };
    }
  }
};
