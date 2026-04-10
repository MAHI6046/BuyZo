const { createCoreService } = require('../../src/domains/core/core-service');

function registerCoreRoutes(app, deps) {
  const defaultDeepLinkScheme =
    'app-1-599101565212-ios-ece0308900aec56ca3b2d9';
  const coreService = createCoreService({
    ...deps.serviceContext,
    db: deps.serviceContext?.db,
    config: {
      deepLinkScheme:
        String(process.env.APP_DEEP_LINK_SCHEME || defaultDeepLinkScheme).trim() ||
        defaultDeepLinkScheme,
      androidStoreUrl:
        String(process.env.ANDROID_PLAY_STORE_URL || '').trim() ||
        'https://play.google.com/store/apps/details?id=com.anydot.app',
      iosStoreUrl:
        String(process.env.IOS_APP_STORE_URL || '').trim() || 'https://apps.apple.com/',
      defaultFallbackUrl: String(
        process.env.MARKETING_SITE_URL || 'https://dotdelivery.com.au',
      ).trim(),
      adminPortalUrl: process.env.ADMIN_PORTAL_URL,
    },
  });

  app.get('/', async (_req, res, next) => {
    try {
      const result = await coreService.getRootStatus();
      return res.status(result.status).json(result.body);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/admin', async (_req, res, next) => {
    try {
      const result = await coreService.getAdminEntry();
      if (result.type === 'redirect') {
        return res.redirect(result.status, result.location);
      }
      return res.status(result.status).json(result.body);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/p/:productId', async (req, res, next) => {
    try {
      const result = await coreService.getProductSharePage(req.params.productId);
      if (result.type === 'redirect') {
        return res.redirect(result.status, result.location);
      }
      return res.status(result.status).type('html').send(result.html);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/ref', async (req, res, next) => {
    try {
      const result = await coreService.getReferralSharePage(req.query.code);
      return res.status(result.status).type('html').send(result.html);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/health', async (_req, res, next) => {
    try {
      const result = await coreService.getHealth();
      return res.status(result.status).json(result.body);
    } catch (error) {
      return next(error);
    }
  });
}

module.exports = {
  registerCoreRoutes,
};
