const { toHttpErrorPayload } = require('../src/errors');

function createErrorMiddleware({ nodeEnv }) {
  return (error, _req, res, _next) => {
    console.error('Backend error:', error);
    const mapped = toHttpErrorPayload(error, {
      exposeInternal: nodeEnv === 'development',
    });
    res.status(mapped.status).json(mapped.body);
  };
}

module.exports = {
  createErrorMiddleware,
};
