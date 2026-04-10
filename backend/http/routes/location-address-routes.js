const { createAddressService } = require('../../src/domains/users/address-service');

function registerLocationAddressRoutes(app, deps) {
  const {
    serviceContext,
    requireFirebaseAuth,
    ensureUserRow,
    parseNullableNumber,
    ACTIVE_ORDER_STATUSES,
  } = deps;

  const addressService = createAddressService({
    db: serviceContext.db,
    ensureUserRow,
    parseNullableNumber,
    ACTIVE_ORDER_STATUSES,
    mapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
    fetchImpl: fetch,
  });

  app.post('/api/location/autocomplete', async (req, res, next) => {
    try {
      const result = await addressService.autocomplete({
        input: req.body?.input,
        sessionToken: req.body?.sessionToken,
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/location/place-details', async (req, res, next) => {
    try {
      const result = await addressService.placeDetails({ placeId: req.query?.placeId });
      return res.status(result.status).json(result.body);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/location/reverse-geocode', async (req, res, next) => {
    try {
      const result = await addressService.reverseGeocode({
        lat: req.query?.lat,
        lng: req.query?.lng,
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/addresses', requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await addressService.listAddresses(req.auth?.uid || '');
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/addresses/default', requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await addressService.getDefaultAddress(req.auth?.uid || '');
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/addresses', requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await addressService.createAddress(req.auth?.uid || '', req.body || {});
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.patch('/api/addresses/:id/default', requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await addressService.setDefaultAddress(req.auth?.uid || '', req.params.id);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.patch('/api/addresses/:id', requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await addressService.updateAddress(req.auth?.uid || '', req.params.id, req.body || {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/api/addresses/:id', requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await addressService.deleteAddress(req.auth?.uid || '', req.params.id);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });
}

module.exports = {
  registerLocationAddressRoutes,
};
