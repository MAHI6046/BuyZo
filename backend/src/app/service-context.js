function createServiceContext({ pool, logger = console, clock = Date } = {}) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new Error('createServiceContext requires a db pool with connect()');
  }

  const db = {
    pool,
    query: (...args) => pool.query(...args),
    connect: () => pool.connect(),
    async withClient(handler) {
      const client = await pool.connect();
      try {
        return await handler(client);
      } finally {
        client.release();
      }
    },
  };

  return {
    db,
    clock: {
      now: () => new clock(),
    },
    logger,
  };
}

module.exports = {
  createServiceContext,
};
