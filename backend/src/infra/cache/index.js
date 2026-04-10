const { createPlatformRuntimeUtils } = require('../../platform/runtime');

function createCacheRuntime(config) {
  return createPlatformRuntimeUtils(config);
}

module.exports = {
  createCacheRuntime,
};
