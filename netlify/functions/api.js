const serverless = require("serverless-http");

const { app } = require("../../src/server");

const handler = serverless(app);

exports.handler = async (event, context) => handler(event, context);
