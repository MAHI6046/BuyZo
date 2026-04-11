const { createUserService } = require('../../src/domains/users/user-service');

function registerUserRoutes(app, deps) {
  const {
    serviceContext,
    auth,
    identity,
    wallet,
    utils,
  } = deps;

  const requiredWalletMethods = [
    'getDeliveryCreditBalance',
    'getOrderCreditBalance',
    'getAvailableOrderCreditBalance',
    'publishUserRealtimeWalletSnapshot',
  ];
  for (const methodName of requiredWalletMethods) {
    if (typeof wallet?.[methodName] !== 'function') {
      throw new Error(`registerUserRoutes requires wallet.${methodName}()`);
    }
  }

  const userService = createUserService({
    ...serviceContext,
    identity: {
      resolveUserRole: identity.resolveUserRole,
      ensurePricingSchema: identity.ensurePricingSchema,
      ensureUserRow: identity.ensureUserRow,
    },
    wallet: {
      getDeliveryCreditBalance: wallet.getDeliveryCreditBalance,
      getOrderCreditBalance: wallet.getOrderCreditBalance,
      getAvailableOrderCreditBalance: wallet.getAvailableOrderCreditBalance,
      publishUserRealtimeWalletSnapshot: wallet.publishUserRealtimeWalletSnapshot,
    },
    utils: {
      normalizePhoneNumber: utils.normalizePhoneNumber,
      normalizeReferralCode: utils.normalizeReferralCode,
    },
  });

  app.get('/api/users/me', auth.requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await userService.getMe(req.auth?.uid || '');
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/users', auth.requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await userService.upsertUser({
        firebaseUid: req.auth?.uid || '',
        token: req.auth?.token,
        body: req.body || {},
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/users/referral', auth.requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await userService.getReferral(req.auth?.uid || '');
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/users/referral/claim', auth.requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await userService.claimReferral(req.auth?.uid || '', req.body || {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/api/users/:firebaseUid', auth.requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await userService.deleteOwnUser({
        authUid: req.auth?.uid || '',
        targetFirebaseUid: req.params.firebaseUid,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });
}

module.exports = {
  registerUserRoutes,
};
