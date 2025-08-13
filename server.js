const express = require("express");
const axios = require("axios");
const RSSParser = require("rss-parser");

const app = express();
const port = 3000;

// Create a new RSS parser instance
const parser = new RSSParser();

// Define an endpoint for fetching RSS feeds
app.get("/rss-proxy", async (req, res) => {
  const { url, format = "xml" } = req.query;

  // Check if URL parameter is provided
  if (!url) {
    return res.status(400).json({ error: 'Missing "url" query parameter.' });
  }

  // Validate format parameter
  if (format !== "xml" && format !== "json") {
    return res
      .status(400)
      .json({ error: 'Format must be either "xml" or "json".' });
  }

  try {
    // Fetch the RSS feed data
    const response = await axios.get(url, {
      headers: { Accept: "application/xml" },
    });

    if (format === "json") {
      // Parse the RSS data and send as JSON
      const feed = await parser.parseString(response.data);
      res.json(feed);
    } else {
      // Send the original XML response
      res.type("application/xml");
      res.send(response.data);
    }
  } catch (error) {
    console.error(error);

    // Error handling: check if it's a network error or invalid RSS
    if (error.response) {
      // The server responded with a status code outside the 2xx range
      res.status(error.response.status).json({ error: error.response.data });
    } else if (error.request) {
      // The request was made, but no response was received
      res
        .status(500)
        .json({ error: "Network error, no response from server." });
    } else {
      // General error (invalid RSS, etc.)
      res
        .status(500)
        .json({ error: "Failed to parse RSS feed or invalid URL." });
    }
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
