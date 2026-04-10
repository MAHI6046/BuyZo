const { createFavoritesService } = require('../../src/domains/users/favorites-service');

function registerFavoriteRoutes(app, deps) {
  const {
    serviceContext,
    requireFirebaseAuth,
    parseInteger,
    normalizeFavoriteBookLabel,
  } = deps;

  const favoritesService = createFavoritesService({
    db: serviceContext.db,
    parseInteger,
    normalizeFavoriteBookLabel,
  });

  app.get('/api/favorites/books', requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await favoritesService.listBooks(req.auth?.uid || '');
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/favorites/books', requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await favoritesService.addBook(req.auth?.uid || '', req.body?.label);
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/api/favorites/books/:bookId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await favoritesService.deleteBook(req.auth?.uid || '', req.params.bookId);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/favorites/items', requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await favoritesService.addItem(
        req.auth?.uid || '',
        req.body?.book_id,
        req.body?.product_id,
      );
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/api/favorites/products/:productId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await favoritesService.removeByProduct(req.auth?.uid || '', req.params.productId);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/api/favorites/items/:favoriteId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await favoritesService.removeItem(req.auth?.uid || '', req.params.favoriteId);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });
}

module.exports = {
  registerFavoriteRoutes,
};
