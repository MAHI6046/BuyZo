part of 'home_page.dart';

class _ProductsView extends StatefulWidget {
  const _ProductsView({
    required this.selectedAddress,
    required this.isActive,
    required this.onOpenLocationPicker,
    required this.searchFocusRequestId,
    this.categoryScrollRequestId,
    required this.store,
    required this.cartQuantities,
    required this.onCartChanged,
  });

  final String selectedAddress;
  final bool isActive;
  final VoidCallback onOpenLocationPicker;
  final int searchFocusRequestId;
  final int? categoryScrollRequestId;
  final _ProductsCatalogStore store;
  final Map<int, int> cartQuantities;
  final void Function(_CatalogProduct product, int quantity) onCartChanged;

  @override
  State<_ProductsView> createState() => _ProductsViewState();
}

class _ProductsCatalogStore extends ChangeNotifier {
  static const _pageSize = 24;
  static const _freshTtl = Duration(seconds: 90);

  bool isLoading = false;
  bool isLoadingMore = false;
  bool isBackgroundRefreshing = false;
  bool hasMore = true;
  String? nextCursor;
  int? nextOffset;
  String pageMode = 'offset';
  String? error;
  String searchQuery = '';
  String? category;
  String? storeId;
  bool categoriesLoading = false;
  List<String> categories = const ['All'];
  bool _categoriesFetchedOnce = false;
  DateTime? _lastFetchedAt;
  List<_CatalogProduct> products = const [];
  final Set<String> _productIds = <String>{};
  bool _isFetching = false;
  bool _isRefreshing = false;
  bool _isPaginating = false;
  bool _pendingResetFetch = false;
  bool _pendingResetShowLoader = false;
  bool _pendingResetBackground = false;

  bool get _isExpired {
    if (_lastFetchedAt == null) return true;
    return DateTime.now().difference(_lastFetchedAt!) >= _freshTtl;
  }

  Future<void> ensureFresh({bool includeCategories = true}) async {
    if (includeCategories) {
      unawaited(ensureCategoriesLoaded());
    }
    if (products.isEmpty) {
      await _fetch(reset: true, showLoader: true);
      return;
    }
    if (_isExpired) {
      await _fetch(reset: true, background: true);
    }
  }

  Future<void> warmStartLoad() async {
    await Future.wait<void>([
      ensureCategoriesLoaded(),
      _fetch(
        reset: true,
        showLoader: products.isEmpty,
        background: products.isNotEmpty,
      ),
    ]);
  }

  Future<void> refresh() async {
    await Future.wait<void>([
      ensureCategoriesLoaded(force: true),
      _fetch(reset: true, showLoader: products.isEmpty),
    ]);
  }

  Future<void> updateSearch(String query) async {
    final trimmed = query.trim().toLowerCase();
    final normalized = trimmed.length >= 2 ? trimmed : '';
    if (normalized == searchQuery) return;
    searchQuery = normalized;
    await _fetch(reset: true, showLoader: true);
  }

  Future<void> updateCategory(String? newCategory) async {
    final normalized = (newCategory ?? '').trim();
    final nextValue = normalized.isEmpty ? null : normalized;
    if (nextValue == category) {
      notifyListeners();
      return;
    }
    category = nextValue;
    await _fetch(reset: true, showLoader: true);
  }

  Future<void> ensureCategoriesLoaded({bool force = false}) async {
    if (force) {
      _categoriesFetchedOnce = false;
    }
    if (categoriesLoading || _categoriesFetchedOnce) return;
    categoriesLoading = true;
    notifyListeners();
    try {
      final query = <String, String>{};
      if ((storeId ?? '').isNotEmpty) {
        query['store_id'] = storeId!;
      }
      final response = await ApiClient.instance.get(
        '/api/categories',
        queryParameters: query,
      );
      if (response.statusCode >= 200 && response.statusCode < 300) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        final rows = (data['categories'] as List<dynamic>? ?? [])
            .whereType<Map<String, dynamic>>();
        final names = rows
            .map((row) => row['name']?.toString().trim() ?? '')
            .where((name) => name.isNotEmpty)
            .toList(growable: false);
        categories = ['All', ...names];
        _categoriesFetchedOnce = true;
      }
    } catch (_) {
      // Keep default "All" when categories request fails.
    } finally {
      categoriesLoading = false;
      notifyListeners();
    }
  }

  void invalidateCategories() {
    _categoriesFetchedOnce = false;
  }

  Future<void> loadMore() async {
    if (_isFetching || _isRefreshing || _isPaginating || !hasMore) return;
    await _fetch(reset: false);
  }

  Future<void> _fetch({
    required bool reset,
    bool showLoader = false,
    bool background = false,
  }) async {
    if (_isFetching) {
      if (reset) {
        _pendingResetFetch = true;
        _pendingResetShowLoader = _pendingResetShowLoader || showLoader;
        _pendingResetBackground = _pendingResetBackground || background;
      }
      return;
    }
    if (!reset && (_isRefreshing || _isPaginating || !hasMore)) return;
    if (reset && _isPaginating) return;

    _isFetching = true;

    if (reset) {
      _isRefreshing = true;
      if (showLoader) {
        isLoading = true;
      }
      if (background) {
        isBackgroundRefreshing = true;
      } else {
        error = null;
      }
      hasMore = true;
      nextCursor = null;
      nextOffset = null;
      pageMode = 'offset';
      notifyListeners();
    } else {
      _isPaginating = true;
      isLoadingMore = true;
      notifyListeners();
    }

    try {
      final queryParams = <String, String>{
        'limit': '$_pageSize',
      };
      if (!reset && nextCursor != null && nextCursor!.isNotEmpty) {
        queryParams['cursor'] = nextCursor!;
      } else if (!reset && pageMode == 'offset' && nextOffset != null) {
        queryParams['offset'] = '$nextOffset';
      }
      if (searchQuery.isNotEmpty) {
        queryParams['q'] = searchQuery;
      }
      if ((category ?? '').isNotEmpty) {
        queryParams['category'] = category!;
      }
      if ((storeId ?? '').isNotEmpty) {
        queryParams['store'] = storeId!;
      }

      final response = await ApiClient.instance.get(
        '/api/products',
        queryParameters: queryParams,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('Failed to load products (${response.statusCode})');
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final items = (data['products'] as List<dynamic>? ?? [])
          .whereType<Map<String, dynamic>>()
          .map(_CatalogProduct.fromJson)
          .toList(growable: false);
      final normalizedCategory = (category ?? '').trim().toLowerCase();
      final filteredItems = normalizedCategory.isEmpty
          ? items
          : items
              .where(
                (item) =>
                    item.category.trim().toLowerCase() == normalizedCategory,
              )
              .toList(growable: false);
      final pageInfo = data['pageInfo'] as Map<String, dynamic>?;
      pageMode = pageInfo?['mode']?.toString() ?? 'offset';
      hasMore = pageInfo?['hasMore'] == true;
      nextCursor = pageInfo?['nextCursor']?.toString();
      nextOffset = _asInt(pageInfo?['nextOffset']);
      if (reset) {
        final deduped = <_CatalogProduct>[];
        final seenIds = <String>{};
        for (final item in filteredItems) {
          final id = item.id.toString();
          if (seenIds.add(id)) {
            deduped.add(item);
          }
        }
        products = deduped;
        _productIds
          ..clear()
          ..addAll(deduped.map((item) => item.id.toString()));
      } else {
        final uniqueItems = <_CatalogProduct>[];
        for (final item in filteredItems) {
          final id = item.id.toString();
          if (_productIds.add(id)) {
            uniqueItems.add(item);
          }
        }
        products = [...products, ...uniqueItems];
      }
      error = null;
      _lastFetchedAt = DateTime.now();
    } catch (e) {
      if (reset && products.isEmpty) {
        error = e.toString().replaceFirst('Exception: ', '');
      }
    } finally {
      _isFetching = false;
      _isRefreshing = false;
      _isPaginating = false;
      isLoading = false;
      isLoadingMore = false;
      isBackgroundRefreshing = false;
      notifyListeners();

      if (_pendingResetFetch) {
        final queuedShowLoader = _pendingResetShowLoader;
        final queuedBackground = _pendingResetBackground;
        _pendingResetFetch = false;
        _pendingResetShowLoader = false;
        _pendingResetBackground = false;
        unawaited(
          _fetch(
            reset: true,
            showLoader: queuedShowLoader,
            background: queuedBackground,
          ),
        );
      }
    }
  }
}

class _FavoriteItem {
  const _FavoriteItem({
    required this.favoriteId,
    required this.createdAt,
    required this.product,
  });

  final int favoriteId;
  final String createdAt;
  final _CatalogProduct product;

  factory _FavoriteItem.fromJson(Map<String, dynamic> json) {
    return _FavoriteItem(
      favoriteId: _asInt(json['favorite_id']),
      createdAt: json['created_at']?.toString() ?? '',
      product: _CatalogProduct.fromJson(
        json['product'] as Map<String, dynamic>? ?? const {},
      ),
    );
  }
}

class _FavoriteBook {
  const _FavoriteBook({
    required this.id,
    required this.label,
    required this.items,
    required this.sortOrder,
    required this.createdAt,
  });

  final int id;
  final String label;
  final List<_FavoriteItem> items;
  final int sortOrder;
  final String createdAt;

  factory _FavoriteBook.fromJson(Map<String, dynamic> json) {
    final items = (json['items'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(_FavoriteItem.fromJson)
        .where((entry) => entry.product.id > 0)
        .toList(growable: false);
    return _FavoriteBook(
      id: _asInt(json['id']),
      label: json['label']?.toString().trim().isNotEmpty == true
          ? json['label']!.toString().trim()
          : 'Favorites',
      items: items,
      sortOrder: _asInt(json['sort_order']),
      createdAt: json['created_at']?.toString() ?? '',
    );
  }
}

class _FavoritesStore extends ChangeNotifier {
  static const Duration _ttl = Duration(seconds: 20);

  DateTime? _lastFetchedAt;
  Future<void>? _inFlight;
  bool _isLoading = false;
  String? _error;
  List<_FavoriteBook> _books = const [];
  Set<int> _favoriteProductIds = const {};

  bool get isLoading => _isLoading;
  String? get error => _error;
  List<_FavoriteBook> get books => _books;
  Set<int> get favoriteProductIds => _favoriteProductIds;

  bool isFavoriteProduct(int productId) =>
      _favoriteProductIds.contains(productId);

  Future<void> ensureLoaded({bool force = false}) async {
    final now = DateTime.now();
    final isFresh = !force &&
        _lastFetchedAt != null &&
        now.difference(_lastFetchedAt!) < _ttl;
    if (isFresh) return;
    if (_inFlight != null) return _inFlight!;

    _isLoading = true;
    notifyListeners();
    final request = _fetchFromApi();
    _inFlight = request;
    try {
      await request;
      _lastFetchedAt = DateTime.now();
      _error = null;
    } catch (error) {
      _error = error.toString().replaceFirst('Exception: ', '');
      rethrow;
    } finally {
      _inFlight = null;
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> refresh() => ensureLoaded(force: true);

  Future<_FavoriteBook> createBook(String label) async {
    final trimmed = label.trim();
    if (trimmed.isEmpty) {
      throw Exception('Book label is required');
    }
    final response = await ApiClient.instance.post(
      '/api/favorites/books',
      authenticated: true,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'label': trimmed}),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        _apiMessage(
          response.body,
          'Failed to create favorites book (${response.statusCode})',
        ),
      );
    }
    await refresh();
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    final book = _FavoriteBook.fromJson(
      data['book'] as Map<String, dynamic>? ?? const {},
    );
    return book;
  }

  Future<void> deleteBook(int bookId) async {
    final response = await ApiClient.instance.delete(
      '/api/favorites/books/$bookId',
      authenticated: true,
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        _apiMessage(
          response.body,
          'Failed to delete favorites book (${response.statusCode})',
        ),
      );
    }
    await refresh();
  }

  Future<void> addProductToBook({
    required int productId,
    required int bookId,
  }) async {
    final response = await ApiClient.instance.post(
      '/api/favorites/items',
      authenticated: true,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'product_id': productId,
        'book_id': bookId,
      }),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        _apiMessage(
          response.body,
          'Failed to add product to favorites (${response.statusCode})',
        ),
      );
    }
    await refresh();
  }

  Future<void> removeProductFromAllBooks(int productId) async {
    final response = await ApiClient.instance.delete(
      '/api/favorites/products/$productId',
      authenticated: true,
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        _apiMessage(
          response.body,
          'Failed to remove product from favorites (${response.statusCode})',
        ),
      );
    }
    await refresh();
  }

  Future<void> removeFavoriteItem(int favoriteId) async {
    final response = await ApiClient.instance.delete(
      '/api/favorites/items/$favoriteId',
      authenticated: true,
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        _apiMessage(
          response.body,
          'Failed to remove favorites item (${response.statusCode})',
        ),
      );
    }
    await refresh();
  }

  Future<void> _fetchFromApi() async {
    final response = await ApiClient.instance.get(
      '/api/favorites/books',
      authenticated: true,
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        _apiMessage(
          response.body,
          'Failed to load favorites (${response.statusCode})',
        ),
      );
    }
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    final parsedBooks = (data['books'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(_FavoriteBook.fromJson)
        .toList(growable: false);
    final ids = (data['favorite_product_ids'] as List<dynamic>? ?? const [])
        .map(_asInt)
        .where((id) => id > 0)
        .toSet();

    _books = parsedBooks;
    _favoriteProductIds = ids;
    _error = null;
  }

  static String _apiMessage(String body, String fallback) {
    try {
      final data = jsonDecode(body);
      if (data is Map<String, dynamic>) {
        final message = data['message']?.toString().trim() ?? '';
        if (message.isNotEmpty) return message;
      }
    } catch (_) {
      // Ignore json decode issues and use fallback message.
    }
    return fallback;
  }
}

final _favoritesStore = _FavoritesStore();

class _ProductsViewState extends State<_ProductsView>
    with AutomaticKeepAliveClientMixin {
  static const Duration _deferredWarmupDelay = Duration(milliseconds: 450);
  static const Duration _openTapPrefetchBudget = Duration(milliseconds: 120);
  final _searchFocusNode = FocusNode();
  final _searchController = TextEditingController();
  final _scrollController = ScrollController();
  final _categoriesScrollController = ScrollController();
  final GlobalKey _categoriesViewportKey = GlobalKey();
  final GlobalKey _productsGridKey = GlobalKey();
  final Set<String> _prefetchedHeroImages = <String>{};
  final Map<String, GlobalKey> _categoryChipKeys = <String, GlobalKey>{};
  bool _favoritesRebuildQueued = false;

  Timer? _searchDebounce;
  Timer? _visibleDetailsPrefetchDebounce;
  Timer? _deferredWarmupTimer;
  String? _lastTrackedCategory;
  bool _didRunDeferredWarmup = false;

  @override
  void initState() {
    super.initState();
    _searchController.text = widget.store.searchQuery;
    _scrollController.addListener(_onScroll);
    widget.store.addListener(_onStoreUpdated);
    _favoritesStore.addListener(_onFavoritesUpdated);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (widget.isActive) {
        unawaited(widget.store.ensureCategoriesLoaded());
        if (widget.store.products.isEmpty && !widget.store.isLoading) {
          unawaited(widget.store.ensureFresh(includeCategories: false));
        } else if (!widget.store.isLoading &&
            !widget.store.isBackgroundRefreshing) {
          unawaited(widget.store.ensureFresh(includeCategories: false));
        }
        _scheduleDeferredWarmup();
      }
      _lastTrackedCategory = widget.store.category;
      _scrollSelectedCategoryChipIntoView();
    });
  }

  @override
  void didUpdateWidget(covariant _ProductsView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.store != widget.store) {
      oldWidget.store.removeListener(_onStoreUpdated);
      widget.store.addListener(_onStoreUpdated);
    }
    if (!oldWidget.isActive && widget.isActive) {
      _scheduleActivationRefresh();
    }
    if (oldWidget.searchFocusRequestId != widget.searchFocusRequestId) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _searchFocusNode.requestFocus();
      });
    }
    final oldRequestId = oldWidget.categoryScrollRequestId ?? 0;
    final newRequestId = widget.categoryScrollRequestId ?? 0;
    if (oldRequestId != newRequestId) {
      _scrollSelectedCategoryChipIntoView();
    }
  }

  void _scheduleActivationRefresh() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !widget.isActive) return;
      unawaited(widget.store.ensureCategoriesLoaded());
      if (!widget.store.isLoading && !widget.store.isBackgroundRefreshing) {
        unawaited(widget.store.ensureFresh(includeCategories: false));
      }
      _scheduleDeferredWarmup(immediate: true);
    });
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final position = _scrollController.position;
    if (!widget.store.isLoading &&
        !widget.store.isLoadingMore &&
        widget.store.hasMore &&
        position.pixels >= position.maxScrollExtent - 560) {
      widget.store.loadMore();
    }
    if (widget.isActive && !_didRunDeferredWarmup) {
      _scheduleDeferredWarmup(immediate: true);
    }
    _scheduleVisibleDetailsPrefetch();
  }

  void _scheduleDeferredWarmup({bool immediate = false}) {
    if (_didRunDeferredWarmup || !widget.isActive) return;
    _deferredWarmupTimer?.cancel();
    if (immediate) {
      _runDeferredWarmup();
      return;
    }
    _deferredWarmupTimer = Timer(_deferredWarmupDelay, _runDeferredWarmup);
  }

  void _runDeferredWarmup() {
    if (!mounted || _didRunDeferredWarmup || !widget.isActive) return;
    _didRunDeferredWarmup = true;
    unawaited(_warmFavorites());
    _scheduleVisibleDetailsPrefetch();
  }

  void _scheduleVisibleDetailsPrefetch() {
    if (!widget.isActive || !_didRunDeferredWarmup) return;
    _visibleDetailsPrefetchDebounce?.cancel();
    _visibleDetailsPrefetchDebounce = Timer(
      const Duration(milliseconds: 180),
      _prefetchVisibleProductDetails,
    );
  }

  void _prefetchVisibleProductDetails() {
    if (!widget.isActive || !_didRunDeferredWarmup) return;
    if (!mounted || widget.store.products.isEmpty) return;
    final gridContext = _productsGridKey.currentContext;
    if (gridContext == null) {
      final fallbackCount = math.min(4, widget.store.products.length);
      for (var i = 0; i < fallbackCount; i++) {
        final product = widget.store.products[i];
        unawaited(_ProductDetailsCache.prefetch(product.id));
        _prefetchHeroImage(product.displayImage);
      }
      return;
    }

    final renderObject = gridContext.findRenderObject();
    if (renderObject is! RenderBox) return;

    const crossAxisCount = 2;
    const spacing = 6.0;
    const childAspectRatio = 0.75;
    final gridWidth = renderObject.size.width;
    if (gridWidth <= 0) return;
    final itemWidth =
        (gridWidth - ((crossAxisCount - 1) * spacing)) / crossAxisCount;
    if (itemWidth <= 0) return;
    final itemHeight = itemWidth / childAspectRatio;
    final rowExtent = itemHeight + spacing;
    if (rowExtent <= 0 || !rowExtent.isFinite) return;

    final gridTopOnScreen = renderObject.localToGlobal(Offset.zero).dy;
    if (!gridTopOnScreen.isFinite) return;
    final rawVisibleTop = -gridTopOnScreen;
    if (!rawVisibleTop.isFinite) return;
    final visibleTopInGrid = rawVisibleTop < 0 ? 0.0 : rawVisibleTop;
    if (!visibleTopInGrid.isFinite) return;
    final rowPosition = visibleTopInGrid / rowExtent;
    if (!rowPosition.isFinite) return;
    final firstVisibleRow = rowPosition.floor();
    final firstVisibleIndex = (firstVisibleRow * crossAxisCount)
        .clamp(0, widget.store.products.length - 1)
        .toInt();

    final endExclusive =
        math.min(firstVisibleIndex + 5, widget.store.products.length);
    for (var i = firstVisibleIndex; i < endExclusive; i++) {
      final product = widget.store.products[i];
      unawaited(_ProductDetailsCache.prefetch(product.id));
      _prefetchHeroImage(product.displayImage);
    }
  }

  void _prefetchHeroImage(String imageUrl) {
    final normalized = imageUrl.trim();
    if (normalized.isEmpty || _prefetchedHeroImages.contains(normalized)) {
      return;
    }
    _prefetchedHeroImages.add(normalized);
    unawaited(
      precacheImage(NetworkImage(normalized), context).catchError((_) {
        _prefetchedHeroImages.remove(normalized);
      }),
    );
  }

  void _trackCategoryTap(String categoryName) {
    debugPrint(
      'analytics_event=products_category_tap category=$categoryName '
      'query="${_searchController.text.trim()}"',
    );
  }

  void _maybePrefetchByIndex(int index) {
    // No-op: keep loadMore trigger exclusively in scroll listener to avoid
    // fetch requests being initiated during grid rebuilds.
  }

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 320), () {
      widget.store.updateSearch(value);
    });
  }

  void _onStoreUpdated() {
    if (widget.isActive &&
        !_didRunDeferredWarmup &&
        widget.store.products.isNotEmpty) {
      _scheduleDeferredWarmup(immediate: true);
    }
    final currentCategory = widget.store.category;
    final categoryChanged = currentCategory != _lastTrackedCategory;
    _lastTrackedCategory = currentCategory;
    final selectedName = currentCategory ?? 'All';
    final hasSelectedChip = widget.store.categories.contains(selectedName);
    if (categoryChanged || hasSelectedChip || widget.store.categoriesLoading) {
      _scrollSelectedCategoryChipIntoView();
    }
  }

  void _scrollSelectedCategoryChipIntoView({int attempt = 0}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_categoriesScrollController.hasClients) return;
      final selectedName = widget.store.category ?? 'All';
      final chipKey = _categoryChipKeys[selectedName];
      final chipContext = chipKey?.currentContext;
      final viewportContext = _categoriesViewportKey.currentContext;
      if (viewportContext == null) {
        if (attempt < 18) {
          Future<void>.delayed(
            const Duration(milliseconds: 110),
            () => _scrollSelectedCategoryChipIntoView(attempt: attempt + 1),
          );
        }
        return;
      }
      final viewportBox = viewportContext.findRenderObject() as RenderBox?;
      if (viewportBox == null) return;

      final position = _categoriesScrollController.position;
      if (position.maxScrollExtent <= 0 && attempt < 18) {
        Future<void>.delayed(
          const Duration(milliseconds: 110),
          () => _scrollSelectedCategoryChipIntoView(attempt: attempt + 1),
        );
        return;
      }
      double target;
      final chipBox = chipContext?.findRenderObject() as RenderBox?;
      if (chipBox != null) {
        final chipGlobalLeft = chipBox.localToGlobal(Offset.zero).dx;
        final viewportGlobalLeft = viewportBox.localToGlobal(Offset.zero).dx;
        final chipCenterInViewport =
            (chipGlobalLeft - viewportGlobalLeft) + (chipBox.size.width / 2);
        final viewportCenter = viewportBox.size.width / 2;
        final delta = chipCenterInViewport - viewportCenter;
        target = position.pixels + delta;
      } else {
        final categories = widget.store.categories;
        final selectedIndex = categories.indexOf(selectedName);
        if (selectedIndex < 0) return;
        const separator = 8.0;
        double beforeWidth = 0;
        for (var i = 0; i < selectedIndex; i++) {
          beforeWidth +=
              _estimatedChipWidth(categories[i], context) + separator;
        }
        final selectedWidth =
            _estimatedChipWidth(categories[selectedIndex], context);
        target = beforeWidth - ((viewportBox.size.width - selectedWidth) / 2);
      }
      target = target.clamp(position.minScrollExtent, position.maxScrollExtent);
      if ((target - position.pixels).abs() < 1) return;
      _categoriesScrollController.animateTo(
        target,
        duration: const Duration(milliseconds: 260),
        curve: Curves.easeOutCubic,
      );
    });
  }

  double _estimatedChipWidth(String label, BuildContext context) {
    final style = DefaultTextStyle.of(context).style.copyWith(
          fontWeight: FontWeight.w500,
        );
    final painter = TextPainter(
      text: TextSpan(text: label, style: style),
      textDirection: TextDirection.ltr,
      maxLines: 1,
    )..layout();
    const horizontalPadding = 24.0;
    return painter.width + horizontalPadding;
  }

  void _setQuantity(_CatalogProduct product, int quantity) {
    widget.onCartChanged(product, quantity);
  }

  void _onFavoritesUpdated() {
    if (!mounted) return;
    if (_favoritesRebuildQueued) return;
    _favoritesRebuildQueued = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _favoritesRebuildQueued = false;
      if (!mounted) return;
      setState(() {});
    });
  }

  Future<void> _toggleFavoriteForProduct(_CatalogProduct product) async {
    final currentlyFavorite = _favoritesStore.isFavoriteProduct(product.id);
    try {
      if (currentlyFavorite) {
        await _favoritesStore.removeProductFromAllBooks(product.id);
        return;
      }

      await _favoritesStore.ensureLoaded();
      final books = _favoritesStore.books;
      if (books.isEmpty) {
        final createdBook = await _showCreateFavoritesBookDialog(
          title: 'Create favorites book',
          hintText: 'e.g. Lunch, Dinner',
          submitLabel: 'Create',
        );
        if (createdBook == null) return;
        await _favoritesStore.addProductToBook(
          productId: product.id,
          bookId: createdBook.id,
        );
        if (!mounted) return;
        AppSnackBar.show(
          context,
          '"${product.name}" added to "${createdBook.label}".',
        );
        return;
      }

      if (books.length == 1) {
        await _favoritesStore.addProductToBook(
          productId: product.id,
          bookId: books.first.id,
        );
        if (!mounted) return;
        AppSnackBar.show(
          context,
          '"${product.name}" added to "${books.first.label}".',
        );
        return;
      }

      final selectedBook = await _showFavoriteBookPicker(books, product.name);
      if (selectedBook == null) return;
      await _favoritesStore.addProductToBook(
        productId: product.id,
        bookId: selectedBook.id,
      );
      if (!mounted) return;
      AppSnackBar.show(
        context,
        '"${product.name}" added to "${selectedBook.label}".',
      );
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', ''),
      );
    }
  }

  Future<void> _warmFavorites() async {
    try {
      await _favoritesStore.ensureLoaded();
    } catch (_) {
      // Keep products usable even if favorites sync fails.
    }
  }

  Future<bool> _toggleFavoriteAndReturnState(
    _CatalogProduct product,
    bool currentlyFavorite,
  ) async {
    await _toggleFavoriteForProduct(product);
    return _favoritesStore.isFavoriteProduct(product.id);
  }

  Future<_FavoriteBook?> _showCreateFavoritesBookDialog({
    required String title,
    required String hintText,
    required String submitLabel,
  }) async {
    String draft = '';
    final label = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          maxLength: 40,
          autofocus: true,
          textInputAction: TextInputAction.done,
          decoration: InputDecoration(
            hintText: hintText,
          ),
          onChanged: (value) => draft = value,
          onSubmitted: (value) => Navigator.of(context).pop(value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(draft),
            child: Text(submitLabel),
          ),
        ],
      ),
    );
    final trimmed = (label ?? '').trim();
    if (trimmed.isEmpty) return null;
    return _favoritesStore.createBook(trimmed);
  }

  Future<_FavoriteBook?> _showFavoriteBookPicker(
    List<_FavoriteBook> books,
    String productName,
  ) {
    return showModalBottomSheet<_FavoriteBook>(
      context: context,
      showDragHandle: true,
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Save "$productName" to',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
                const SizedBox(height: 8),
                ...books.map(
                  (book) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(book.label),
                    subtitle: Text(
                      '${book.items.length} item${book.items.length == 1 ? '' : 's'}',
                    ),
                    onTap: () => Navigator.of(context).pop(book),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  void dispose() {
    widget.store.removeListener(_onStoreUpdated);
    _favoritesStore.removeListener(_onFavoritesUpdated);
    _searchDebounce?.cancel();
    _visibleDetailsPrefetchDebounce?.cancel();
    _deferredWarmupTimer?.cancel();
    _searchController.dispose();
    _searchFocusNode.dispose();
    _scrollController.dispose();
    _categoriesScrollController.dispose();
    super.dispose();
  }

  Future<void> _openProductDetails(_CatalogProduct product) async {
    _prefetchHeroImage(product.displayImage);
    if (product.images.isNotEmpty) {
      _prefetchHeroImage(product.images.first);
    }
    if (_ProductDetailsCache.getFresh(product.id) == null) {
      await Future.any<void>([
        _ProductDetailsCache.prefetch(product.id),
        Future<void>.delayed(_openTapPrefetchBudget),
      ]);
      if (!mounted) return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _ProductDetailsPage(
          productId: product.id,
          initialProduct: product,
          initialQuantity: widget.cartQuantities[product.id] ?? 0,
          initialIsFavorite: _favoritesStore.isFavoriteProduct(product.id),
          onQuantityChanged: (value) => _setQuantity(product, value),
          onFavoriteToggleRequested: (currentProduct, currentlyFavorite) =>
              _toggleFavoriteAndReturnState(currentProduct, currentlyFavorite),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    const compactPadding = 12.0;
    const productsGridOffsetY = -64.0;

    return RefreshIndicator(
      onRefresh: widget.store.refresh,
      child: AnimatedBuilder(
        animation: widget.store,
        builder: (context, _) => CustomScrollView(
          controller: _scrollController,
          slivers: [
            SliverAppBar(
              expandedHeight: 0,
              floating: false,
              pinned: true,
              elevation: 0,
              backgroundColor: colorScheme.surface,
              titleSpacing: compactPadding,
              title: _HeaderLocationTrigger(
                address: widget.selectedAddress,
                onTap: widget.onOpenLocationPicker,
              ),
            ),
            SliverPersistentHeader(
              pinned: true,
              delegate: _ProductsFiltersHeaderDelegate(
                searchController: _searchController,
                searchFocusNode: _searchFocusNode,
                onSearchChanged: _onSearchChanged,
                store: widget.store,
                onCategoryTap: _trackCategoryTap,
                categoriesScrollController: _categoriesScrollController,
                categoriesViewportKey: _categoriesViewportKey,
                categoryChipKeys: _categoryChipKeys,
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  compactPadding,
                  6,
                  compactPadding,
                  compactPadding,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (widget.store.isLoading)
                      Transform.translate(
                        offset: const Offset(0, productsGridOffsetY),
                        child: _ProductGridSkeleton(itemCount: 6),
                      )
                    else if (widget.store.error != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 24),
                        child: Center(
                          child: Column(
                            children: [
                              Text(
                                widget.store.error!,
                                textAlign: TextAlign.center,
                                style: theme.textTheme.bodyMedium,
                              ),
                              const SizedBox(height: 10),
                              FilledButton(
                                onPressed: widget.store.refresh,
                                child: const Text('Retry'),
                              ),
                            ],
                          ),
                        ),
                      )
                    else if (widget.store.products.isEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 30),
                        child: Center(
                          child: Column(
                            children: [
                              Icon(
                                Icons.inventory_2_outlined,
                                size: 34,
                                color: colorScheme.onSurface.withOpacity(0.55),
                              ),
                              const SizedBox(height: 10),
                              Text(
                                widget.store.category == null
                                    ? 'No products found'
                                    : 'No products in ${widget.store.category}',
                                style: theme.textTheme.titleMedium,
                              ),
                              const SizedBox(height: 4),
                              Text(
                                widget.store.category == null
                                    ? 'Try changing your search terms.'
                                    : 'Try a different category or pull to refresh.',
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color:
                                      colorScheme.onSurface.withOpacity(0.68),
                                ),
                              ),
                            ],
                          ),
                        ),
                      )
                    else
                      Transform.translate(
                        offset: const Offset(0, productsGridOffsetY),
                        child: Column(
                          children: [
                            GridView.builder(
                              key: _productsGridKey,
                              shrinkWrap: true,
                              physics: const NeverScrollableScrollPhysics(),
                              itemCount: widget.store.products.length,
                              gridDelegate:
                                  const SliverGridDelegateWithFixedCrossAxisCount(
                                crossAxisCount: 2,
                                mainAxisSpacing: 6,
                                crossAxisSpacing: 6,
                                childAspectRatio: 0.75,
                              ),
                              itemBuilder: (context, index) {
                                final product = widget.store.products[index];
                                final qty =
                                    widget.cartQuantities[product.id] ?? 0;
                                final isFavorite = _favoritesStore
                                    .isFavoriteProduct(product.id);
                                return _ProductCard(
                                  product: product,
                                  quantity: qty,
                                  isFavorite: isFavorite,
                                  onTap: () => _openProductDetails(product),
                                  onFavoriteToggle: () => unawaited(
                                      _toggleFavoriteForProduct(product)),
                                  onQuantityChanged: (value) =>
                                      _setQuantity(product, value),
                                );
                              },
                            ),
                            if (widget.store.isLoadingMore)
                              const Padding(
                                padding: EdgeInsets.symmetric(vertical: 8),
                                child: SizedBox(
                                  height: 26,
                                  child: Center(
                                    child: SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    const SizedBox(height: 74),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  bool get wantKeepAlive => true;
}

class _ProductsFiltersHeaderDelegate extends SliverPersistentHeaderDelegate {
  _ProductsFiltersHeaderDelegate({
    required this.searchController,
    required this.searchFocusNode,
    required this.onSearchChanged,
    required this.store,
    required this.onCategoryTap,
    required this.categoriesScrollController,
    required this.categoriesViewportKey,
    required this.categoryChipKeys,
  });

  final TextEditingController searchController;
  final FocusNode searchFocusNode;
  final ValueChanged<String> onSearchChanged;
  final _ProductsCatalogStore store;
  final ValueChanged<String> onCategoryTap;
  final ScrollController categoriesScrollController;
  final GlobalKey categoriesViewportKey;
  final Map<String, GlobalKey> categoryChipKeys;

  @override
  double get minExtent => 108;

  @override
  double get maxExtent => 108;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      color: Colors.transparent,
      child: Stack(
        fit: StackFit.expand,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  height: 46,
                  child: _ProductsSearchBar(
                    controller: searchController,
                    focusNode: searchFocusNode,
                    onChanged: onSearchChanged,
                  ),
                ),
                const SizedBox(height: 6),
                SizedBox(
                  key: categoriesViewportKey,
                  height: 34,
                  child: ListView.separated(
                    controller: categoriesScrollController,
                    scrollDirection: Axis.horizontal,
                    itemCount: store.categories.length +
                        (store.categoriesLoading ? 1 : 0),
                    separatorBuilder: (_, __) => const SizedBox(width: 8),
                    itemBuilder: (context, index) {
                      if (index >= store.categories.length) {
                        return const SizedBox(
                          width: 20,
                          height: 20,
                          child: Center(
                            child: SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                          ),
                        );
                      }

                      final name = store.categories[index];
                      final selected =
                          (name == 'All' && store.category == null) ||
                              store.category == name;
                      final key = categoryChipKeys[name] ??=
                          GlobalKey(debugLabel: name);
                      return KeyedSubtree(
                        key: key,
                        child: _FrostedCategoryChip(
                          label: name,
                          selected: selected,
                          onSelected: () {
                            onCategoryTap(name);
                            store.updateCategory(
                              name == 'All' ? null : name,
                            );
                          },
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
          if (store.isBackgroundRefreshing && store.products.isNotEmpty)
            const Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: LinearProgressIndicator(minHeight: 2),
            ),
        ],
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _ProductsFiltersHeaderDelegate oldDelegate) {
    return true;
  }
}

class _ProductsSearchBar extends StatelessWidget {
  const _ProductsSearchBar({
    required this.controller,
    required this.focusNode,
    required this.onChanged,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final caretColor = isDark ? Colors.white : colorScheme.onSurface;

    return AnimatedBuilder(
      animation: Listenable.merge([focusNode, controller]),
      builder: (context, _) {
        final hasText = controller.text.trim().isNotEmpty;
        final isFocused = focusNode.hasFocus;
        return Material(
          color: Colors.transparent,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
              child: Container(
                height: 46,
                padding: const EdgeInsets.symmetric(horizontal: 10),
                decoration: BoxDecoration(
                  color: colorScheme.surfaceContainerHighest.withOpacity(0.6),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: isFocused
                        ? colorScheme.primary.withOpacity(0.75)
                        : colorScheme.outlineVariant.withOpacity(0.75),
                    width: isFocused ? 1.2 : 1,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.search_rounded,
                      size: 20,
                      color: colorScheme.onSurface.withOpacity(0.8),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: controller,
                        focusNode: focusNode,
                        showCursor: true,
                        cursorColor: caretColor,
                        cursorWidth: 2,
                        cursorHeight: 20,
                        style: TextStyle(
                          color: colorScheme.onSurface,
                          fontSize: 14,
                        ),
                        decoration: InputDecoration(
                          isCollapsed: true,
                          filled: false,
                          fillColor: Colors.transparent,
                          border: InputBorder.none,
                          enabledBorder: InputBorder.none,
                          focusedBorder: InputBorder.none,
                          disabledBorder: InputBorder.none,
                          errorBorder: InputBorder.none,
                          focusedErrorBorder: InputBorder.none,
                          contentPadding: EdgeInsets.zero,
                          hintText: 'Search products...',
                          hintStyle: TextStyle(
                            color: colorScheme.onSurface.withOpacity(0.58),
                            fontSize: 14,
                          ),
                        ),
                        textInputAction: TextInputAction.search,
                        onChanged: onChanged,
                        onTap: () {
                          if (!focusNode.hasFocus) {
                            focusNode.requestFocus();
                          }
                        },
                      ),
                    ),
                    if (hasText)
                      IconButton(
                        tooltip: 'Clear search',
                        padding: EdgeInsets.zero,
                        visualDensity: VisualDensity.compact,
                        icon: Icon(
                          Icons.close_rounded,
                          size: 20,
                          color: colorScheme.onSurface.withOpacity(0.75),
                        ),
                        onPressed: () {
                          controller.clear();
                          onChanged('');
                          focusNode.requestFocus();
                        },
                      )
                    else
                      Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: Icon(
                          Icons.tune_rounded,
                          size: 20,
                          color: colorScheme.onSurface.withOpacity(0.65),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _FrostedCategoryChip extends StatelessWidget {
  const _FrostedCategoryChip({
    required this.label,
    required this.selected,
    required this.onSelected,
  });

  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return ClipRRect(
      borderRadius: BorderRadius.circular(20),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(20),
            onTap: onSelected,
            child: Container(
              height: 34,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: colorScheme.surfaceContainerHighest.withOpacity(0.6),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: selected
                      ? colorScheme.primary.withOpacity(0.75)
                      : colorScheme.outlineVariant.withOpacity(0.75),
                  width: selected ? 1.2 : 1,
                ),
              ),
              child: Text(
                label,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: selected
                      ? colorScheme.primary
                      : colorScheme.onSurface.withOpacity(0.85),
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CartItem {
  const _CartItem({
    required this.product,
    required this.quantity,
  });

  final _CatalogProduct product;
  final int quantity;
}

class _CartWithFavoritesTabs extends StatefulWidget {
  const _CartWithFavoritesTabs({
    required this.items,
    required this.selectedAddress,
    required this.onOpenLocationPicker,
    required this.onQuantityChanged,
    required this.onBrowseProducts,
    required this.onCheckout,
    required this.isCheckingOut,
    required this.onClearCart,
    required this.cartQuantities,
    required this.onCartChanged,
  });

  final List<_CartItem> items;
  final String selectedAddress;
  final VoidCallback onOpenLocationPicker;
  final void Function(int productId, int quantity) onQuantityChanged;
  final VoidCallback onBrowseProducts;
  final Future<void> Function() onCheckout;
  final bool isCheckingOut;
  final VoidCallback onClearCart;
  final Map<int, int> cartQuantities;
  final void Function(_CatalogProduct product, int quantity) onCartChanged;

  @override
  State<_CartWithFavoritesTabs> createState() => _CartWithFavoritesTabsState();
}

class _CartWithFavoritesTabsState extends State<_CartWithFavoritesTabs> {
  bool _favoritesRebuildQueued = false;

  @override
  void initState() {
    super.initState();
    _favoritesStore.addListener(_onFavoritesChanged);
    unawaited(_warmFavorites());
  }

  @override
  void dispose() {
    _favoritesStore.removeListener(_onFavoritesChanged);
    super.dispose();
  }

  void _onFavoritesChanged() {
    if (!mounted) return;
    if (_favoritesRebuildQueued) return;
    _favoritesRebuildQueued = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _favoritesRebuildQueued = false;
      if (!mounted) return;
      setState(() {});
    });
  }

  Future<void> _warmFavorites() async {
    try {
      await _favoritesStore.ensureLoaded();
    } catch (_) {
      // Keep cart usable even if favorites sync fails.
    }
  }

  Future<void> _createFavoritesBookFromCart() async {
    String draft = '';
    try {
      final label = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Create favorites book'),
          content: TextField(
            maxLength: 40,
            autofocus: true,
            textInputAction: TextInputAction.done,
            decoration: const InputDecoration(
              hintText: 'e.g. Lunch, Dinner',
            ),
            onChanged: (value) => draft = value,
            onSubmitted: (value) => Navigator.of(context).pop(value),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(draft),
              child: const Text('Create'),
            ),
          ],
        ),
      );
      final trimmed = (label ?? '').trim();
      if (trimmed.isEmpty) return;
      await _favoritesStore.createBook(trimmed);
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', ''),
      );
    }
  }

  Future<void> _removeFavoriteItem(_FavoriteItem item) async {
    try {
      await _favoritesStore.removeFavoriteItem(item.favoriteId);
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', ''),
      );
    }
  }

  Future<void> _deleteFavoritesBook(_FavoriteBook book) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete book?'),
        content: Text(
          'Delete "${book.label}" and remove ${book.items.length} favorite item${book.items.length == 1 ? '' : 's'}?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await _favoritesStore.deleteBook(book.id);
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', ''),
      );
    }
  }

  Future<void> _addBookToCart(_FavoriteBook book) async {
    if (book.items.isEmpty) return;

    final increments = <int, int>{};
    final productsById = <int, _CatalogProduct>{};
    for (final item in book.items) {
      final product = item.product;
      if (product.id <= 0) continue;
      increments[product.id] = (increments[product.id] ?? 0) + 1;
      productsById[product.id] = product;
    }
    if (increments.isEmpty) return;

    var addedUnits = 0;
    increments.forEach((productId, incrementBy) {
      final product = productsById[productId];
      if (product == null) return;
      final currentQty = widget.cartQuantities[productId] ?? 0;
      widget.onCartChanged(product, currentQty + incrementBy);
      addedUnits += incrementBy;
    });

    if (!mounted || addedUnits <= 0) return;
    AppSnackBar.show(
      context,
      'Added $addedUnits item${addedUnits == 1 ? '' : 's'} from "${book.label}" to cart.',
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: DefaultTabController(
        length: 2,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 2),
              child: Align(
                alignment: Alignment.centerLeft,
                child: _HeaderLocationTrigger(
                  address: widget.selectedAddress,
                  onTap: widget.onOpenLocationPicker,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
              child: const _SegmentedTabBar(
                compact: true,
                tabs: [
                  _SegmentedTabBarItem(
                    label: 'Cart',
                    icon: Icons.shopping_bag_outlined,
                    height: 38,
                  ),
                  _SegmentedTabBarItem(
                    label: 'Favorites',
                    icon: Icons.favorite_border_rounded,
                    height: 38,
                  ),
                ],
              ),
            ),
            Expanded(
              child: TabBarView(
                children: [
                  _CartView(
                    items: widget.items,
                    onQuantityChanged: widget.onQuantityChanged,
                    onBrowseProducts: widget.onBrowseProducts,
                    onCheckout: widget.onCheckout,
                    isCheckingOut: widget.isCheckingOut,
                    onClearCart: widget.onClearCart,
                  ),
                  _FavoritesBooksView(
                    books: _favoritesStore.books,
                    isLoading: _favoritesStore.isLoading,
                    error: _favoritesStore.error,
                    onCreateBook: _createFavoritesBookFromCart,
                    onDeleteBook: _deleteFavoritesBook,
                    onRemoveItem: _removeFavoriteItem,
                    onAddBookToCart: _addBookToCart,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SegmentedTabBarItem extends StatelessWidget {
  const _SegmentedTabBarItem({
    required this.label,
    required this.icon,
    this.height = 46,
  });

  final String label;
  final IconData icon;
  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 20),
          const SizedBox(width: 8),
          Text(
            label,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

class _SegmentedTabBar extends StatelessWidget {
  const _SegmentedTabBar({
    required this.tabs,
    this.compact = false,
  });

  final List<Widget> tabs;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final isDark = theme.brightness == Brightness.dark;
    final glassBackground = Color.alphaBlend(
      (isDark ? Colors.white : Colors.black).withOpacity(isDark ? 0.11 : 0.08),
      colorScheme.surface,
    );
    final activeSegmentBackground = Color.alphaBlend(
      (isDark ? Colors.white : Colors.black).withOpacity(isDark ? 0.18 : 0.04),
      colorScheme.surface,
    );
    return Container(
      decoration: BoxDecoration(
        color: glassBackground,
        borderRadius: BorderRadius.circular(30),
        border: Border.all(
          color: colorScheme.outlineVariant.withOpacity(isDark ? 0.45 : 0.32),
        ),
      ),
      padding: EdgeInsets.all(compact ? 4 : 6),
      child: TabBar(
        dividerColor: Colors.transparent,
        indicatorSize: TabBarIndicatorSize.tab,
        labelColor: colorScheme.onSurface,
        unselectedLabelColor: colorScheme.onSurface.withOpacity(0.7),
        labelPadding:
            compact ? const EdgeInsets.symmetric(horizontal: 4) : null,
        splashBorderRadius: BorderRadius.circular(24),
        indicator: BoxDecoration(
          color: activeSegmentBackground,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
            color: colorScheme.outlineVariant.withOpacity(isDark ? 0.58 : 0.38),
          ),
        ),
        tabs: tabs,
      ),
    );
  }
}

class _CartView extends StatelessWidget {
  const _CartView({
    required this.items,
    required this.onQuantityChanged,
    required this.onBrowseProducts,
    required this.onCheckout,
    required this.isCheckingOut,
    required this.onClearCart,
  });

  final List<_CartItem> items;
  final void Function(int productId, int quantity) onQuantityChanged;
  final VoidCallback onBrowseProducts;
  final Future<void> Function() onCheckout;
  final bool isCheckingOut;
  final VoidCallback onClearCart;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    final itemCount = items.fold<int>(0, (sum, item) => sum + item.quantity);

    if (items.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.shopping_bag_outlined,
                size: 46,
                color: colorScheme.onSurface.withOpacity(0.55),
              ),
              const SizedBox(height: 10),
              Text(
                'Your cart is empty',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Add products to continue',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: colorScheme.onSurface.withOpacity(0.66),
                ),
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: onBrowseProducts,
                child: const Text('Browse Products'),
              ),
            ],
          ),
        ),
      );
    }

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
          child: Row(
            children: [
              Text(
                'My Cart',
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const Spacer(),
              Text(
                '$itemCount item${itemCount == 1 ? '' : 's'}',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: colorScheme.onSurface.withOpacity(0.7),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            itemCount: items.length + 2,
            itemBuilder: (context, index) {
              if (index == items.length) {
                return Padding(
                  padding: const EdgeInsets.only(top: 10, bottom: 4),
                  child: Align(
                    alignment: Alignment.centerRight,
                    child: OutlinedButton.icon(
                      onPressed: onClearCart,
                      icon: const Icon(Icons.delete_sweep_rounded, size: 14),
                      label: const Text('Clear cart'),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        minimumSize: const Size(0, 32),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                    ),
                  ),
                );
              }
              if (index == items.length + 1) {
                return Padding(
                  padding: const EdgeInsets.only(top: 8, bottom: 6),
                  child: SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: isCheckingOut
                          ? null
                          : () {
                              onCheckout();
                            },
                      child: isCheckingOut
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Text('Checkout'),
                    ),
                  ),
                );
              }

              final cartItem = items[index];
              final product = cartItem.product;
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: colorScheme.outlineVariant.withOpacity(0.45),
                    ),
                    color: colorScheme.surface,
                  ),
                  child: Row(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: Container(
                          width: 62,
                          height: 62,
                          color: colorScheme.surfaceContainerHighest
                              .withOpacity(0.35),
                          child: product.displayImage.isEmpty
                              ? Icon(
                                  Icons.image_outlined,
                                  color: colorScheme.onSurface.withOpacity(0.4),
                                )
                              : Image.network(
                                  product.displayImage,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) => Icon(
                                    Icons.broken_image_outlined,
                                    color:
                                        colorScheme.onSurface.withOpacity(0.4),
                                  ),
                                ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              product.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              '\$${product.priceSale.toStringAsFixed(2)} each',
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: colorScheme.onSurface.withOpacity(0.66),
                              ),
                            ),
                            const SizedBox(height: 8),
                            SizedBox(
                              width: 150,
                              child: _QuantityControl(
                                quantity: cartItem.quantity,
                                onChanged: (value) =>
                                    onQuantityChanged(product.id, value),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        '\$${(product.priceSale * cartItem.quantity).toStringAsFixed(2)}',
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _CheckoutReviewPage extends StatefulWidget {
  const _CheckoutReviewPage({
    required this.items,
    required this.addressId,
    required this.onPlaceOrder,
  });

  final List<_CartItem> items;
  final int addressId;
  final Future<bool> Function(String? promoCode) onPlaceOrder;

  @override
  State<_CheckoutReviewPage> createState() => _CheckoutReviewPageState();
}

class _CheckoutReviewPageState extends State<_CheckoutReviewPage> {
  final TextEditingController _promoController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  bool _isLoadingPricing = true;
  bool _isApplyingPromo = false;
  bool _isPlacingOrder = false;
  bool _didAutoScrollToBottom = false;
  String? _appliedPromoCode;
  String? _promoError;
  double _itemTotal = 0;
  double _deliveryFee = 0;
  double _platformFee = 0;
  double _discountAmount = 0;
  double _orderCreditUsedAmount = 0;
  double _totalAmount = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _scrollToBottomIfNeeded();
    });
    unawaited(_fetchPricing());
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _promoController.dispose();
    super.dispose();
  }

  void _scrollToBottomIfNeeded() {
    if (!mounted || _didAutoScrollToBottom) return;
    if (!_scrollController.hasClients) return;
    final target = _scrollController.position.maxScrollExtent;
    _scrollController.jumpTo(target);
    _didAutoScrollToBottom = true;
  }

  List<Map<String, dynamic>> _itemsPayload() => widget.items
      .map(
        (item) => {
          'product_id': item.product.id,
          'quantity': item.quantity,
        },
      )
      .toList(growable: false);

  double _toDouble(dynamic value) {
    if (value is num) return value.toDouble();
    return double.tryParse(value?.toString() ?? '') ?? 0;
  }

  Future<void> _fetchPricing({String? promoCode}) async {
    setState(() {
      _isLoadingPricing = true;
      _promoError = null;
    });
    try {
      final response = await ApiClient.instance.post(
        '/api/pricing/preview',
        authenticated: true,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'items': _itemsPayload(),
          'address_id': widget.addressId,
          if (promoCode != null && promoCode.trim().isNotEmpty)
            'promo_code': promoCode.trim(),
        }),
      );
      final json = jsonDecode(response.body) as Map<String, dynamic>? ?? {};
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          json['message']?.toString() ??
              'Unable to load pricing (HTTP ${response.statusCode})',
        );
      }
      final breakdown = json['breakdown'] as Map<String, dynamic>? ?? const {};
      if (!mounted) return;
      setState(() {
        _itemTotal = _toDouble(breakdown['item_total']);
        _deliveryFee = _toDouble(breakdown['delivery_fee']);
        _platformFee = _toDouble(breakdown['platform_fee']);
        _discountAmount = _toDouble(breakdown['discount_amount']);
        _orderCreditUsedAmount =
            _toDouble(breakdown['order_credit_used_amount']);
        _totalAmount = _toDouble(breakdown['total_amount']);
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _promoError = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingPricing = false;
        });
        WidgetsBinding.instance.addPostFrameCallback((_) {
          _scrollToBottomIfNeeded();
        });
      }
    }
  }

  Future<void> _applyPromo() async {
    if (_isApplyingPromo) return;
    final code = _promoController.text.trim().toUpperCase();
    if (code.isEmpty) {
      AppSnackBar.show(context, 'Enter a promo code');
      return;
    }
    setState(() {
      _isApplyingPromo = true;
      _promoError = null;
    });
    try {
      final response = await ApiClient.instance.post(
        '/api/promos/apply',
        authenticated: true,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'code': code,
          'items': _itemsPayload(),
          'address_id': widget.addressId,
        }),
      );
      final json = jsonDecode(response.body) as Map<String, dynamic>? ?? {};
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          json['message']?.toString() ??
              'Unable to apply promo (HTTP ${response.statusCode})',
        );
      }
      final promo = json['promo'] as Map<String, dynamic>? ?? const {};
      final breakdown = json['breakdown'] as Map<String, dynamic>? ?? const {};
      if (!mounted) return;
      setState(() {
        _appliedPromoCode = (promo['code']?.toString() ?? code).trim();
        _discountAmount = _toDouble(breakdown['discount_amount']);
        _itemTotal = _toDouble(breakdown['item_total']);
        _deliveryFee = _toDouble(breakdown['delivery_fee']);
        _platformFee = _toDouble(breakdown['platform_fee']);
        _totalAmount = _toDouble(breakdown['total_amount']);
        _orderCreditUsedAmount =
            _toDouble(breakdown['order_credit_used_amount']);
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _appliedPromoCode = null;
        _discountAmount = 0;
        _orderCreditUsedAmount = 0;
        _promoError = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) {
        setState(() {
          _isApplyingPromo = false;
        });
      }
    }
  }

  Future<void> _placeOrder() async {
    if (_isPlacingOrder) return;
    final draft = _promoController.text.trim().toUpperCase();
    if (draft.isNotEmpty &&
        (_appliedPromoCode == null ||
            _appliedPromoCode!.toUpperCase() != draft)) {
      AppSnackBar.show(context, 'Apply promo code before placing order.');
      return;
    }

    setState(() {
      _isPlacingOrder = true;
    });
    try {
      final success = await widget.onPlaceOrder(_appliedPromoCode);
      if (success && mounted) {
        Navigator.of(context).pop();
      }
    } finally {
      if (mounted) {
        setState(() {
          _isPlacingOrder = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Checkout'),
      ),
      body: ListView(
        controller: _scrollController,
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 100),
        children: [
          ...widget.items.map(
            (cartItem) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: colorScheme.outlineVariant.withOpacity(0.45),
                  ),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${cartItem.product.name} x${cartItem.quantity}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '\$${(cartItem.product.priceSale * cartItem.quantity).toStringAsFixed(2)}',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 6),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: colorScheme.outlineVariant.withOpacity(0.45),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Promo Code',
                  style: theme.textTheme.labelLarge?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: SizedBox(
                        height: 42,
                        child: TextField(
                          controller: _promoController,
                          textCapitalization: TextCapitalization.characters,
                          decoration: const InputDecoration(
                            isDense: true,
                            contentPadding: EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 10,
                            ),
                            hintText: 'Enter promo code',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      onPressed: _isApplyingPromo ? null : _applyPromo,
                      child: _isApplyingPromo
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Text('Apply'),
                    ),
                  ],
                ),
                if (_promoError != null && _promoError!.trim().isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      _promoError!,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: colorScheme.error,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                if (_appliedPromoCode != null && _discountAmount > 0)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'Applied: $_appliedPromoCode • -\$${_discountAmount.toStringAsFixed(2)}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: colorScheme.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                const SizedBox(height: 8),
                if (_isLoadingPricing)
                  const Padding(
                    padding: EdgeInsets.only(top: 6),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else ...[
                  _AmountRow(label: 'Items', value: _itemTotal),
                  const SizedBox(height: 4),
                  _AmountRow(label: 'Delivery fee', value: _deliveryFee),
                  const SizedBox(height: 4),
                  _AmountRow(label: 'Platform fee', value: _platformFee),
                  if (_discountAmount > 0) ...[
                    const SizedBox(height: 4),
                    _AmountRow(
                      label: 'Promo discount',
                      value: -_discountAmount,
                      valueColor: colorScheme.primary,
                    ),
                  ],
                  if (_orderCreditUsedAmount > 0) ...[
                    const SizedBox(height: 4),
                    _AmountRow(
                      label: 'Credits used',
                      value: -_orderCreditUsedAmount,
                      valueColor: colorScheme.primary,
                    ),
                  ],
                  const Divider(height: 14),
                  _AmountRow(
                    label: 'Total payable',
                    value: _totalAmount,
                    emphasize: true,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(12, 6, 12, 10),
        child: SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed:
                (_isPlacingOrder || _isLoadingPricing) ? null : _placeOrder,
            child: _isPlacingOrder
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text('Place Order'),
          ),
        ),
      ),
    );
  }
}

class _AmountRow extends StatelessWidget {
  const _AmountRow({
    required this.label,
    required this.value,
    this.emphasize = false,
    this.valueColor,
  });

  final String label;
  final double value;
  final bool emphasize;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final style = emphasize
        ? theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w800)
        : theme.textTheme.bodySmall?.copyWith(
            color: colorScheme.onSurface.withOpacity(0.8),
            fontWeight: FontWeight.w600,
          );
    final resolvedValueColor = valueColor ??
        (emphasize
            ? colorScheme.onSurface
            : colorScheme.onSurface.withOpacity(0.85));

    return Row(
      children: [
        Expanded(
          child: Text(label, style: style),
        ),
        Text(
          '${value < 0 ? '-' : ''}\$${value.abs().toStringAsFixed(2)}',
          style: style?.copyWith(color: resolvedValueColor),
        ),
      ],
    );
  }
}

class _OrdersTab extends StatefulWidget {
  const _OrdersTab({
    required this.selectedAddress,
    required this.onOpenLocationPicker,
    required this.isVisible,
  });

  final String selectedAddress;
  final VoidCallback onOpenLocationPicker;
  final bool isVisible;

  @override
  State<_OrdersTab> createState() => _OrdersTabState();
}

class _OrdersTabState extends State<_OrdersTab> with WidgetsBindingObserver {
  static const Duration _ordersFetchCooldown = Duration(seconds: 20);
  static const Duration _realtimeBackfillMinInterval = Duration(seconds: 45);
  static const Duration _manualRefreshCooldown = Duration(seconds: 60);
  static DateTime? _lastOrdersFetchedAt;
  static _OrdersFetchSnapshot? _ordersCache;
  static Future<_OrdersFetchSnapshot>? _inFlightOrdersRequest;

  bool _isLoading = true;
  String? _error;
  List<_OrderSummary> _activeOrders = const [];
  List<_OrderSummary> _previousOrders = const [];
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _ordersRealtimeSub;
  DateTime? _lastRealtimeBackfillAt;
  Timer? _realtimeBackfillTimer;
  Timer? _periodicVisibleSyncTimer;
  bool _isAppResumed = true;
  DateTime? _lastManualRefreshAt;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (_ordersCache != null) {
      _applyOrdersSnapshot(_ordersCache!);
    }
    _syncRealtimeSubscription();
    _syncPeriodicVisibleRefresh();
    if (widget.isVisible) {
      unawaited(_fetchOrders());
    } else {
      _isLoading = _ordersCache == null;
    }
  }

  @override
  void didUpdateWidget(covariant _OrdersTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.isVisible != widget.isVisible) {
      _syncRealtimeSubscription();
      _syncPeriodicVisibleRefresh();
      if (widget.isVisible) {
        unawaited(_fetchOrders());
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final wasResumed = _isAppResumed;
    _isAppResumed = state == AppLifecycleState.resumed;
    if (wasResumed == _isAppResumed) return;
    _syncRealtimeSubscription();
    _syncPeriodicVisibleRefresh();
    if (_isAppResumed && widget.isVisible) {
      unawaited(_fetchOrders(forceRefresh: true));
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _ordersRealtimeSub?.cancel();
    _realtimeBackfillTimer?.cancel();
    _periodicVisibleSyncTimer?.cancel();
    super.dispose();
  }

  bool get _shouldSyncRealtime => widget.isVisible && _isAppResumed;

  void _syncRealtimeSubscription() {
    if (!_shouldSyncRealtime) {
      _ordersRealtimeSub?.cancel();
      _ordersRealtimeSub = null;
      return;
    }

    if (_ordersRealtimeSub != null) return;
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    if (uid.isEmpty) return;

    _ordersRealtimeSub = FirebaseFirestore.instance
        .collection('users')
        .doc(uid)
        .collection('orders')
        .orderBy('updated_at', descending: true)
        .limit(50)
        .snapshots()
        .listen(
      (snapshot) {
        if (!mounted || snapshot.docChanges.isEmpty) return;
        _applyRealtimeChanges(snapshot.docChanges);
      },
      onError: (error) {
        if (kDebugMode) {
          debugPrint('Orders realtime listener error: $error');
        }
      },
    );
  }

  void _syncPeriodicVisibleRefresh() {
    _periodicVisibleSyncTimer?.cancel();
    _periodicVisibleSyncTimer = null;
  }

  bool _isPreviousStatus(String status) {
    const previousStatuses = {'delivered', 'cancelled', 'failed'};
    return previousStatuses.contains(status.trim().toLowerCase());
  }

  int _extractRealtimeOrderId(DocumentChange<Map<String, dynamic>> change) {
    final data = change.doc.data() ?? const <String, dynamic>{};
    final orderId = _asInt(data['order_id']);
    if (orderId > 0) return orderId;
    return _asInt(change.doc.id);
  }

  _OrderSummary _patchOrderFromRealtime(
    _OrderSummary source,
    Map<String, dynamic> data,
  ) {
    final status = (data['status']?.toString() ?? source.status).trim();
    final paymentStatus =
        (data['payment_status']?.toString() ?? source.paymentStatus).trim();
    const currency = AppConstants.platformCurrency;
    final itemTotal = data.containsKey('item_total')
        ? _asDouble(data['item_total'])
        : source.itemTotal;
    final subtotal = data.containsKey('subtotal')
        ? _asDouble(data['subtotal'])
        : source.subtotal;
    final deliveryFee = data.containsKey('delivery_fee')
        ? _asDouble(data['delivery_fee'])
        : source.deliveryFee;
    final discountAmount = data.containsKey('discount_amount')
        ? _asDouble(data['discount_amount'])
        : source.discountAmount;
    final platformFee = data.containsKey('platform_fee')
        ? _asDouble(data['platform_fee'])
        : source.platformFee;
    final totalAmount = data.containsKey('total_amount')
        ? _asDouble(data['total_amount'])
        : source.totalAmount;
    final missingItemsCreditEarned =
        data.containsKey('missing_items_credit_earned')
            ? _asDouble(data['missing_items_credit_earned'])
            : source.missingItemsCreditEarned;
    final deliveryPin = data.containsKey('delivery_pin')
        ? (data['delivery_pin']?.toString() ?? '').trim()
        : source.deliveryPin;

    return source.copyWith(
      status: status,
      paymentStatus: paymentStatus,
      currency: currency,
      itemTotal: itemTotal,
      subtotal: subtotal,
      deliveryFee: deliveryFee,
      discountAmount: discountAmount,
      platformFee: platformFee,
      missingItemsCreditEarned: missingItemsCreditEarned,
      totalAmount: totalAmount,
      deliveryPin: deliveryPin,
    );
  }

  void _scheduleRealtimeBackfillSync() {
    if (!_shouldSyncRealtime) return;
    final now = DateTime.now();
    final lastBackfill = _lastRealtimeBackfillAt;
    if (lastBackfill != null &&
        now.difference(lastBackfill) < _realtimeBackfillMinInterval) {
      return;
    }
    _realtimeBackfillTimer?.cancel();
    _realtimeBackfillTimer = Timer(const Duration(seconds: 2), () {
      if (!mounted || !_shouldSyncRealtime) return;
      _lastRealtimeBackfillAt = DateTime.now();
      unawaited(_fetchOrders(forceRefresh: true));
    });
  }

  void _applyRealtimeChanges(
    List<DocumentChange<Map<String, dynamic>>> changes,
  ) {
    var nextActive = List<_OrderSummary>.from(_activeOrders);
    var nextPrevious = List<_OrderSummary>.from(_previousOrders);
    var hasLocalChanges = false;
    var requiresBackfillSync = false;

    for (final change in changes) {
      final orderId = _extractRealtimeOrderId(change);
      if (orderId <= 0) {
        requiresBackfillSync = true;
        continue;
      }

      final activeIndex = nextActive.indexWhere((order) => order.id == orderId);
      final previousIndex =
          nextPrevious.indexWhere((order) => order.id == orderId);

      if (change.type == DocumentChangeType.removed) {
        if (activeIndex >= 0) {
          nextActive.removeAt(activeIndex);
          hasLocalChanges = true;
        }
        if (previousIndex >= 0) {
          nextPrevious.removeAt(previousIndex);
          hasLocalChanges = true;
        }
        continue;
      }

      final data = change.doc.data();
      if (data == null) {
        requiresBackfillSync = true;
        continue;
      }

      final source = activeIndex >= 0
          ? nextActive[activeIndex]
          : previousIndex >= 0
              ? nextPrevious[previousIndex]
              : null;
      if (source == null) {
        requiresBackfillSync = true;
        continue;
      }

      final patched = _patchOrderFromRealtime(source, data);
      final normalizedRealtimeStatus = patched.status.trim().toLowerCase();
      if (const {
        'picked',
        'packed',
        'out_for_delivery',
        'delivered',
        'cancelled'
      }.contains(normalizedRealtimeStatus)) {
        // Pull full order payload so item-level picked/not-found state stays accurate.
        requiresBackfillSync = true;
      }
      final moveToPrevious = _isPreviousStatus(patched.status);

      if (moveToPrevious) {
        if (activeIndex >= 0) {
          nextActive.removeAt(activeIndex);
          hasLocalChanges = true;
        }
        if (previousIndex >= 0) {
          nextPrevious[previousIndex] = patched;
          hasLocalChanges = true;
        } else {
          nextPrevious.insert(0, patched);
          hasLocalChanges = true;
        }
      } else {
        if (previousIndex >= 0) {
          nextPrevious.removeAt(previousIndex);
          hasLocalChanges = true;
        }
        if (activeIndex >= 0) {
          nextActive[activeIndex] = patched;
          hasLocalChanges = true;
        } else {
          nextActive.insert(0, patched);
          hasLocalChanges = true;
        }
      }
    }

    if (hasLocalChanges && mounted) {
      setState(() {
        _activeOrders = List<_OrderSummary>.unmodifiable(nextActive);
        _previousOrders = List<_OrderSummary>.unmodifiable(nextPrevious);
        _isLoading = false;
        _error = null;
      });
      _ordersCache = _OrdersFetchSnapshot(
        active: _activeOrders,
        previous: _previousOrders,
      );
    }

    if (requiresBackfillSync) {
      _scheduleRealtimeBackfillSync();
    }
  }

  Future<List<_OrderSummary>> _fetchByType({required String type}) async {
    final response = await ApiClient.instance.get(
      '/api/orders',
      authenticated: true,
      queryParameters: {
        'type': type,
        'limit': '30',
      },
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to load $type orders (${response.statusCode})');
    }
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    final rawOrders = (data['orders'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .toList(growable: false);
    return rawOrders.map(_OrderSummary.fromJson).toList(growable: false);
  }

  Future<_OrdersFetchSnapshot> _fetchOrdersSnapshotFromApi() async {
    final results = await Future.wait<List<_OrderSummary>>([
      _fetchByType(type: 'active'),
      _fetchByType(type: 'previous'),
    ]);
    return _OrdersFetchSnapshot(
      active: results[0],
      previous: results[1],
    );
  }

  void _applyOrdersSnapshot(_OrdersFetchSnapshot snapshot) {
    _activeOrders = snapshot.active;
    _previousOrders = snapshot.previous;
    _isLoading = false;
    _error = null;
  }

  Future<void> _fetchOrders({bool forceRefresh = false}) async {
    if (!widget.isVisible && !forceRefresh) {
      return;
    }
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _activeOrders = const [];
        _previousOrders = const [];
        _error = 'Please login to view your orders.';
      });
      return;
    }

    final now = DateTime.now();
    final cache = _ordersCache;
    final hasFreshCache = !forceRefresh &&
        cache != null &&
        _lastOrdersFetchedAt != null &&
        now.difference(_lastOrdersFetchedAt!) < _ordersFetchCooldown;

    if (hasFreshCache) {
      if (!mounted) return;
      setState(() {
        _applyOrdersSnapshot(cache);
      });
      return;
    }

    setState(() {
      _error = null;
      if (forceRefresh || cache == null) {
        _isLoading = true;
      }
    });

    Future<_OrdersFetchSnapshot>? request = _inFlightOrdersRequest;
    if (request == null) {
      request = _fetchOrdersSnapshotFromApi();
      _inFlightOrdersRequest = request;
    }

    try {
      final snapshot = await request;
      _ordersCache = snapshot;
      _lastOrdersFetchedAt = DateTime.now();
      if (!mounted) return;
      setState(() {
        _applyOrdersSnapshot(snapshot);
      });
    } catch (error) {
      if (!mounted) return;
      if (cache != null) {
        setState(() {
          _applyOrdersSnapshot(cache);
        });
        return;
      }
      setState(() {
        _isLoading = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (identical(_inFlightOrdersRequest, request)) {
        _inFlightOrdersRequest = null;
      }
    }
  }

  Future<void> _handleManualRefresh() async {
    final now = DateTime.now();
    final last = _lastManualRefreshAt;
    if (last != null) {
      final elapsed = now.difference(last);
      if (elapsed < _manualRefreshCooldown) {
        final remaining =
            (_manualRefreshCooldown - elapsed).inSeconds.clamp(1, 999);
        if (mounted) {
          AppSnackBar.show(
            context,
            'Please wait ${remaining}s before refreshing again.',
          );
        }
        return;
      }
    }

    _lastManualRefreshAt = now;
    await _fetchOrders(forceRefresh: true);
  }

  void _openOrderDetails(_OrderSummary order) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _OrderDetailsPage(order: order),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return SafeArea(
      child: DefaultTabController(
        length: 2,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 2),
              child: Align(
                alignment: Alignment.centerLeft,
                child: _HeaderLocationTrigger(
                  address: widget.selectedAddress,
                  onTap: widget.onOpenLocationPicker,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
              child: Row(
                children: [
                  Text(
                    'My Orders',
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    onPressed: _isLoading ? null : _handleManualRefresh,
                    icon: const Icon(Icons.refresh_rounded),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: const _SegmentedTabBar(
                compact: true,
                tabs: [
                  _SegmentedTabBarItem(
                    label: 'Active',
                    icon: Icons.schedule_rounded,
                    height: 38,
                  ),
                  _SegmentedTabBarItem(
                    label: 'Previous',
                    icon: Icons.history_rounded,
                    height: 38,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: _isLoading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            child: Text(
                              _error!,
                              textAlign: TextAlign.center,
                            ),
                          ),
                        )
                      : TabBarView(
                          children: [
                            _OrdersListView(
                              orders: _activeOrders,
                              onTapOrder: _openOrderDetails,
                              onRefresh: _handleManualRefresh,
                            ),
                            _OrdersListView(
                              orders: _previousOrders,
                              onTapOrder: _openOrderDetails,
                              onRefresh: _handleManualRefresh,
                            ),
                          ],
                        ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OrdersFetchSnapshot {
  const _OrdersFetchSnapshot({
    required this.active,
    required this.previous,
  });

  final List<_OrderSummary> active;
  final List<_OrderSummary> previous;
}

class _OrdersListView extends StatelessWidget {
  const _OrdersListView({
    required this.orders,
    required this.onTapOrder,
    required this.onRefresh,
  });

  final List<_OrderSummary> orders;
  final ValueChanged<_OrderSummary> onTapOrder;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    if (orders.isEmpty) {
      return RefreshIndicator(
        onRefresh: onRefresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(12, 48, 12, 12),
          children: [
            Center(
              child: Text(
                'No orders found',
                style: theme.textTheme.titleMedium?.copyWith(
                  color: colorScheme.onSurface.withOpacity(0.7),
                ),
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        itemCount: orders.length,
        itemBuilder: (context, index) {
          final order = orders[index];
          return Container(
            margin: const EdgeInsets.only(bottom: 8),
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => onTapOrder(order),
                child: Ink(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: colorScheme.surface,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: colorScheme.outlineVariant.withOpacity(0.45),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            'Order #${order.id}',
                            style: theme.textTheme.titleSmall?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const Spacer(),
                          Text(
                            order.status.toUpperCase(),
                            style: theme.textTheme.labelMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                              color: colorScheme.primary,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        '${order.itemsCount} item${order.itemsCount == 1 ? '' : 's'} • \$${order.totalAmount.toStringAsFixed(2)}',
                        style: theme.textTheme.bodyMedium,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        order.createdAtLabel,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: colorScheme.onSurface.withOpacity(0.7),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _FavoritesBooksView extends StatefulWidget {
  const _FavoritesBooksView({
    required this.books,
    required this.isLoading,
    required this.error,
    required this.onCreateBook,
    required this.onDeleteBook,
    required this.onRemoveItem,
    required this.onAddBookToCart,
  });

  final List<_FavoriteBook> books;
  final bool isLoading;
  final String? error;
  final Future<void> Function() onCreateBook;
  final Future<void> Function(_FavoriteBook book) onDeleteBook;
  final Future<void> Function(_FavoriteItem item) onRemoveItem;
  final Future<void> Function(_FavoriteBook book) onAddBookToCart;

  @override
  State<_FavoritesBooksView> createState() => _FavoritesBooksViewState();
}

class _FavoritesBooksViewState extends State<_FavoritesBooksView> {
  final Set<int> _expandedBookIds = <int>{};

  @override
  void didUpdateWidget(covariant _FavoritesBooksView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.books != widget.books) {
      final validIds = widget.books.map((book) => book.id).toSet();
      _expandedBookIds.removeWhere((id) => !validIds.contains(id));
    }
  }

  void _toggleBook(int bookId) {
    setState(() {
      if (_expandedBookIds.contains(bookId)) {
        _expandedBookIds.remove(bookId);
      } else {
        _expandedBookIds.add(bookId);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    if (widget.isLoading && widget.books.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (widget.error != null && widget.books.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Text(
            widget.error!,
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton.icon(
            onPressed: widget.onCreateBook,
            icon: const Icon(Icons.add_rounded),
            label: const Text('Create Book'),
          ),
        ),
        const SizedBox(height: 8),
        if (widget.books.isEmpty)
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: colorScheme.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: colorScheme.outlineVariant.withOpacity(0.45),
              ),
            ),
            child: Text(
              'No favorites yet. Tap hearts on products to add them here.',
              style: theme.textTheme.bodyMedium,
            ),
          )
        else
          ...widget.books.map(
            (book) {
              final isExpanded = _expandedBookIds.contains(book.id);
              return Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: colorScheme.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: colorScheme.outlineVariant.withOpacity(0.45),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    InkWell(
                      borderRadius: BorderRadius.circular(8),
                      onTap: () => _toggleBook(book.id),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 2),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                book.label,
                                style: theme.textTheme.titleSmall?.copyWith(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                            Text(
                              '${book.items.length} item${book.items.length == 1 ? '' : 's'}',
                              style: theme.textTheme.labelMedium?.copyWith(
                                color: colorScheme.onSurface.withOpacity(0.65),
                              ),
                            ),
                            Icon(
                              isExpanded
                                  ? Icons.keyboard_arrow_up_rounded
                                  : Icons.keyboard_arrow_down_rounded,
                            ),
                            IconButton(
                              tooltip: 'Delete book',
                              onPressed: () => widget.onDeleteBook(book),
                              icon: const Icon(Icons.delete_outline_rounded),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: book.items.isEmpty
                            ? null
                            : () => widget.onAddBookToCart(book),
                        icon: const Icon(Icons.shopping_cart_checkout_rounded),
                        label: const Text('Add to cart'),
                      ),
                    ),
                    AnimatedSize(
                      duration: const Duration(milliseconds: 180),
                      curve: Curves.easeOutCubic,
                      alignment: Alignment.topCenter,
                      child: !isExpanded
                          ? const SizedBox.shrink()
                          : Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: book.items.isEmpty
                                  ? Text(
                                      'No items in this book yet.',
                                      style:
                                          theme.textTheme.bodySmall?.copyWith(
                                        color: colorScheme.onSurface
                                            .withOpacity(0.65),
                                      ),
                                    )
                                  : Column(
                                      children: book.items
                                          .map(
                                            (item) => Padding(
                                              padding:
                                                  const EdgeInsets.only(top: 8),
                                              child: Row(
                                                children: [
                                                  ClipRRect(
                                                    borderRadius:
                                                        BorderRadius.circular(
                                                            8),
                                                    child: SizedBox(
                                                      width: 44,
                                                      height: 44,
                                                      child: item
                                                              .product
                                                              .displayImage
                                                              .isNotEmpty
                                                          ? Image.network(
                                                              item.product
                                                                  .displayImage,
                                                              fit: BoxFit.cover,
                                                              errorBuilder: (_,
                                                                      __,
                                                                      ___) =>
                                                                  Icon(
                                                                Icons
                                                                    .image_not_supported_outlined,
                                                                color: colorScheme
                                                                    .onSurface
                                                                    .withOpacity(
                                                                        0.45),
                                                              ),
                                                            )
                                                          : Icon(
                                                              Icons
                                                                  .image_outlined,
                                                              color: colorScheme
                                                                  .onSurface
                                                                  .withOpacity(
                                                                      0.45),
                                                            ),
                                                    ),
                                                  ),
                                                  const SizedBox(width: 10),
                                                  Expanded(
                                                    child: Column(
                                                      crossAxisAlignment:
                                                          CrossAxisAlignment
                                                              .start,
                                                      children: [
                                                        Text(
                                                          item.product.name,
                                                          maxLines: 1,
                                                          overflow: TextOverflow
                                                              .ellipsis,
                                                          style: theme.textTheme
                                                              .bodyMedium
                                                              ?.copyWith(
                                                            fontWeight:
                                                                FontWeight.w700,
                                                          ),
                                                        ),
                                                        Text(
                                                          '\$${item.product.priceSale.toStringAsFixed(2)}',
                                                          style: theme.textTheme
                                                              .bodySmall
                                                              ?.copyWith(
                                                            color: colorScheme
                                                                .onSurface
                                                                .withOpacity(
                                                                    0.65),
                                                          ),
                                                        ),
                                                      ],
                                                    ),
                                                  ),
                                                  IconButton(
                                                    tooltip: 'Remove item',
                                                    onPressed: () => widget
                                                        .onRemoveItem(item),
                                                    icon: const Icon(Icons
                                                        .remove_circle_outline_rounded),
                                                  ),
                                                ],
                                              ),
                                            ),
                                          )
                                          .toList(),
                                    ),
                            ),
                    ),
                  ],
                ),
              );
            },
          ),
      ],
    );
  }
}

class _OrderItemSummary {
  const _OrderItemSummary({
    required this.id,
    required this.productId,
    required this.productName,
    required this.unitPrice,
    required this.quantity,
    required this.lineTotal,
    required this.pickedByDriver,
  });

  final int id;
  final int productId;
  final String productName;
  final double unitPrice;
  final int quantity;
  final double lineTotal;
  final bool? pickedByDriver;

  factory _OrderItemSummary.fromJson(Map<String, dynamic> json) {
    return _OrderItemSummary(
      id: _asInt(json['id']),
      productId: _asInt(json['product_id']),
      productName: json['product_name']?.toString() ?? 'Product',
      unitPrice: _asDouble(json['unit_price']),
      quantity: _asInt(json['quantity']),
      lineTotal: _asDouble(json['line_total']),
      pickedByDriver: () {
        final value = json['picked_by_driver'];
        if (value is bool) return value;
        return null;
      }(),
    );
  }
}

class _OrderSummary {
  const _OrderSummary({
    required this.id,
    required this.status,
    required this.paymentStatus,
    required this.currency,
    required this.itemTotal,
    required this.subtotal,
    required this.deliveryFee,
    required this.discountAmount,
    required this.platformFee,
    required this.missingItemsCreditEarned,
    required this.totalAmount,
    required this.promoCode,
    required this.deliveryPin,
    required this.itemsCount,
    required this.items,
    required this.createdAtLabel,
  });

  final int id;
  final String status;
  final String paymentStatus;
  final String currency;
  final double itemTotal;
  final double subtotal;
  final double deliveryFee;
  final double discountAmount;
  final double platformFee;
  final double missingItemsCreditEarned;
  final double totalAmount;
  final String promoCode;
  final String deliveryPin;
  final int itemsCount;
  final List<_OrderItemSummary> items;
  final String createdAtLabel;

  _OrderSummary copyWith({
    String? status,
    String? paymentStatus,
    String? currency,
    double? itemTotal,
    double? subtotal,
    double? deliveryFee,
    double? discountAmount,
    double? platformFee,
    double? missingItemsCreditEarned,
    double? totalAmount,
    String? deliveryPin,
  }) {
    return _OrderSummary(
      id: id,
      status: status ?? this.status,
      paymentStatus: paymentStatus ?? this.paymentStatus,
      currency: currency ?? this.currency,
      itemTotal: itemTotal ?? this.itemTotal,
      subtotal: subtotal ?? this.subtotal,
      deliveryFee: deliveryFee ?? this.deliveryFee,
      discountAmount: discountAmount ?? this.discountAmount,
      platformFee: platformFee ?? this.platformFee,
      missingItemsCreditEarned:
          missingItemsCreditEarned ?? this.missingItemsCreditEarned,
      totalAmount: totalAmount ?? this.totalAmount,
      promoCode: promoCode,
      deliveryPin: deliveryPin ?? this.deliveryPin,
      itemsCount: itemsCount,
      items: items,
      createdAtLabel: createdAtLabel,
    );
  }

  factory _OrderSummary.fromJson(Map<String, dynamic> json) {
    final id = _asInt(json['id']);
    final status = json['status']?.toString() ?? 'pending';
    final paymentStatus = json['payment_status']?.toString() ?? 'pending';
    const currency = AppConstants.platformCurrency;
    final itemTotalRaw = _asDouble(json['item_total']);
    final subtotal = _asDouble(json['subtotal']);
    final itemTotal = itemTotalRaw > 0 ? itemTotalRaw : subtotal;
    final deliveryFee = _asDouble(json['delivery_fee']);
    final discountAmount = _asDouble(json['discount_amount']);
    final platformFee = _asDouble(json['platform_fee']);
    final missingItemsCreditEarned =
        _asDouble(json['missing_items_credit_earned']);
    final totalAmountRaw = _asDouble(json['total_amount']);
    final totalAmount = totalAmountRaw > 0
        ? totalAmountRaw
        : itemTotal + deliveryFee + platformFee - discountAmount;
    final promoCode = (json['promo_code']?.toString() ?? '').trim();
    final deliveryPin = (json['delivery_pin']?.toString() ?? '').trim();
    final items = (json['items'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(_OrderItemSummary.fromJson)
        .toList(growable: false);
    final createdAtRaw = json['created_at']?.toString();
    DateTime? createdAt;
    if (createdAtRaw != null) {
      createdAt = DateTime.tryParse(createdAtRaw)?.toLocal();
    }
    final createdAtLabel = createdAt == null
        ? 'Just now'
        : '${createdAt.day.toString().padLeft(2, '0')}/${createdAt.month.toString().padLeft(2, '0')}/${createdAt.year} ${createdAt.hour.toString().padLeft(2, '0')}:${createdAt.minute.toString().padLeft(2, '0')}';

    return _OrderSummary(
      id: id,
      status: status,
      paymentStatus: paymentStatus,
      currency: currency,
      itemTotal: itemTotal,
      subtotal: subtotal,
      deliveryFee: deliveryFee,
      discountAmount: discountAmount,
      platformFee: platformFee,
      missingItemsCreditEarned: missingItemsCreditEarned,
      totalAmount: totalAmount,
      promoCode: promoCode,
      deliveryPin: deliveryPin,
      itemsCount: items.length,
      items: items,
      createdAtLabel: createdAtLabel,
    );
  }
}
