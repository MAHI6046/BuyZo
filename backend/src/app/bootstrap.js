const express = require('express');
const cors = require('cors');

function parseAllowedOrigins(rawValue) {
  return String(rawValue || '')
    .split(/[,\n;]/)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function createAppWithCors({ nodeEnv, configuredOriginsRaw }) {
  const app = express();
  const configuredCorsOrigins = parseAllowedOrigins(configuredOriginsRaw);
  const defaultCorsOrigins =
    nodeEnv === 'production'
      ? [
          'https://anydot-admin-portal.vercel.app',
          'https://share.dotdelivery.com.au',
          'https://dotdelivery.com.au',
          'https://www.dotdelivery.com.au',
        ]
      : [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://localhost:5173',
          'http://localhost:8080',
        ];
  const allowedCorsOrigins =
    configuredCorsOrigins.length > 0 ? configuredCorsOrigins : defaultCorsOrigins;
  const allowedCorsOriginsSet = new Set(allowedCorsOrigins);

  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        return callback(null, allowedCorsOriginsSet.has(origin));
      },
    }),
  );

  return app;
}

module.exports = {
  parseAllowedOrigins,
  createAppWithCors,
};
