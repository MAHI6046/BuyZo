const { createServiceContext } = require('../src/app/service-context');

function createServiceRegistry({ pool, logger = console, clock = Date, groups = {} } = {}) {
  return {
    serviceContext: createServiceContext({ pool, logger, clock }),
    groups,
  };
}

module.exports = {
  createServiceRegistry,
};
