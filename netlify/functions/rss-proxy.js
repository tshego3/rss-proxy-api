const axios = require("axios");
const RSSParser = require("rss-parser");

const parser = new RSSParser();

exports.handler = async (event, context) => {
  const { url } = event.queryStringParameters;

  if (!url) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing "url" query parameter.' }),
    };
  }

  try {
    const response = await axios.get(url, {
      headers: { Accept: "application/xml" },
    });

    const feed = await parser.parseString(response.data);

    return {
      statusCode: 200,
      body: JSON.stringify(feed),
    };
  } catch (error) {
    console.error(error);

    if (error.response) {
      return {
        statusCode: error.response.status,
        body: JSON.stringify({ error: error.response.data }),
      };
    } else if (error.request) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Network error, no response from server.",
        }),
      };
    } else {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Failed to parse RSS feed or invalid URL.",
        }),
      };
    }
  }
};
