'use strict';
/* Vercel serverless entry point. vercel.json rewrites every /api/* request here;
   static files in public/ are served by Vercel's CDN. Storage: Upstash Redis
   (UPSTASH_REDIS_REST_URL / _TOKEN or KV_REST_API_URL / _TOKEN), see README. */
const { createApp } = require('../server');

let app;
module.exports = (req, res) => {
  app = app || createApp();
  return app.handle(req, res);
};
