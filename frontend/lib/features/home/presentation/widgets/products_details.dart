part of '../pages/home_page.dart';

class _ProductDetailsCacheEntry {
  const _ProductDetailsCacheEntry({
    required this.product,
    required this.cachedAt,
  });

  final _CatalogProduct product;
  final DateTime cachedAt;

  bool get isFresh =>
      DateTime.now().difference(cachedAt) < _ProductDetailsCache._ttl;
}

class _ProductDetailsCache {
  static const _ttl = Duration(seconds: 90);
  static final Map<int, _ProductDetailsCacheEntry> _entries = {};
  static final Map<int, Future<_CatalogProduct>> _inFlight = {};

  static _ProductDetailsCacheEntry? entry(int productId) => _entries[productId];

  static _CatalogProduct? getFresh(int productId) {
    final cached = _entries[productId];
    if (cached == null || !cached.isFresh) return null;
    return cached.product;
  }

  static Future<_CatalogProduct> fetchAndCache(int productId) {
    final inFlight = _inFlight[productId];
    if (inFlight != null) return inFlight;

    final future = _fetchFromNetwork(productId);
    _inFlight[productId] = future;
    return future.whenComplete(() {
      _inFlight.remove(productId);
    });
  }

  static Future<void> prefetch(int productId) async {
    if (getFresh(productId) != null) return;
    try {
      await fetchAndCache(productId);
    } catch (_) {
      // Ignore prefetch failures; regular open path will handle retries.
    }
  }

  static Future<_CatalogProduct> _fetchFromNetwork(int productId) async {
    final response = await ApiClient.instance.get('/api/products/$productId');
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to load details (${response.statusCode})');
    }
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    final productJson = data['product'] as Map<String, dynamic>? ?? const {};
    final product = _CatalogProduct.fromJson(productJson);
    _entries[productId] = _ProductDetailsCacheEntry(
      product: product,
      cachedAt: DateTime.now(),
    );
    return product;
  }
}

class _ProductDetailsPage extends StatefulWidget {
  const _ProductDetailsPage({
    required this.productId,
    required this.initialProduct,
    required this.initialQuantity,
    required this.initialIsFavorite,
    required this.onQuantityChanged,
    required this.onFavoriteToggleRequested,
  });

  final int productId;
  final _CatalogProduct initialProduct;
  final int initialQuantity;
  final bool initialIsFavorite;
  final ValueChanged<int> onQuantityChanged;
  final Future<bool> Function(_CatalogProduct product, bool currentlyFavorite)
      onFavoriteToggleRequested;

  @override
  State<_ProductDetailsPage> createState() => _ProductDetailsPageState();
}

class _ProductDetailsPageState extends State<_ProductDetailsPage> {
  static const String _productShareBaseUrl =
      'https://share.dotdelivery.com.au/p';
  late _CatalogProduct _product;
  late int _quantity;
  late bool _isFavorite;
  bool _isHydratingDetails = false;
  bool _isFavoriteUpdating = false;
  bool _favoriteSyncQueued = false;
  String? _error;
  int _selectedVariantIndex = 0;
  int _hydrateAnimationKey = 0;
  bool _didScheduleInitialHydration = false;
  Animation<double>? _routeAnimation;
  AnimationStatusListener? _routeAnimationStatusListener;

  @override
  void initState() {
    super.initState();
    _product = _ProductDetailsCache.entry(widget.productId)?.product ??
        widget.initialProduct;
    _quantity = widget.initialQuantity;
    _isFavorite = _favoritesStore.isFavoriteProduct(widget.productId) ||
        widget.initialIsFavorite;
    _selectedVariantIndex = _defaultVariantIndex(_product.variants);
    _favoritesStore.addListener(_onFavoritesChanged);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_didScheduleInitialHydration) return;
    _didScheduleInitialHydration = true;
    _scheduleInitialHydration();
  }

  @override
  void dispose() {
    if (_routeAnimation != null && _routeAnimationStatusListener != null) {
      _routeAnimation!.removeStatusListener(_routeAnimationStatusListener!);
    }
    _favoritesStore.removeListener(_onFavoritesChanged);
    super.dispose();
  }

  void _scheduleInitialHydration() {
    final routeAnimation = ModalRoute.of(context)?.animation;
    if (routeAnimation != null &&
        routeAnimation.status != AnimationStatus.completed) {
      late final AnimationStatusListener statusListener;
      statusListener = (status) {
        if (status != AnimationStatus.completed) return;
        routeAnimation.removeStatusListener(statusListener);
        _routeAnimation = null;
        _routeAnimationStatusListener = null;
        if (!mounted) return;
        unawaited(_hydrateDetailsIfNeeded());
      };
      _routeAnimation = routeAnimation;
      _routeAnimationStatusListener = statusListener;
      routeAnimation.addStatusListener(statusListener);
      return;
    }

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      unawaited(_hydrateDetailsIfNeeded());
    });
  }

  void _onFavoritesChanged() {
    if (!mounted) return;
    if (_favoriteSyncQueued) return;
    _favoriteSyncQueued = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _favoriteSyncQueued = false;
      if (!mounted) return;
      final nextFavorite = _favoritesStore.isFavoriteProduct(widget.productId);
      if (_isFavorite == nextFavorite) return;
      setState(() {
        _isFavorite = nextFavorite;
      });
    });
  }

  Future<void> _hydrateDetailsIfNeeded({bool force = false}) async {
    final cached = _ProductDetailsCache.entry(widget.productId);
    final shouldFetch = force || cached == null || !cached.isFresh;
    if (!shouldFetch) return;

    setState(() {
      _isHydratingDetails = true;
      if (force) {
        _error = null;
      }
    });

    try {
      final product =
          await _ProductDetailsCache.fetchAndCache(widget.productId);
      if (!mounted) return;
      setState(() {
        _product = product;
        _selectedVariantIndex = _defaultVariantIndex(_product.variants);
        _error = null;
        _hydrateAnimationKey++;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (!mounted) return;
      setState(() {
        _isHydratingDetails = false;
      });
    }
  }

  int _defaultVariantIndex(List<_ProductVariant> variants) {
    if (variants.isEmpty) return 0;
    for (var i = 0; i < variants.length; i++) {
      if (variants[i].isDefault) return i;
    }
    for (var i = 0; i < variants.length; i++) {
      final variant = variants[i];
      if (variant.mrp > 0 &&
          variant.salePrice > 0 &&
          variant.salePrice < variant.mrp) {
        return i;
      }
    }
    for (var i = 0; i < variants.length; i++) {
      final variant = variants[i];
      if (variant.mrp > 0 || variant.salePrice > 0) return i;
    }
    return 0;
  }

  void _setQuantity(int quantity) {
    final value = quantity < 0 ? 0 : quantity;
    setState(() {
      _quantity = value;
    });
    widget.onQuantityChanged(value);
  }

  Future<void> _toggleFavorite() async {
    if (_isFavoriteUpdating) return;
    setState(() {
      _isFavoriteUpdating = true;
    });
    try {
      final updatedFavorite = await widget.onFavoriteToggleRequested(
        _product,
        _isFavorite,
      );
      if (!mounted) return;
      setState(() {
        _isFavorite = updatedFavorite;
      });
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (!mounted) return;
      setState(() {
        _isFavoriteUpdating = false;
      });
    }
  }

  String _productShareUrl() => '$_productShareBaseUrl/${widget.productId}';

  Future<void> _shareProduct() async {
    final shareUrl = _productShareUrl();
    final message = 'Check out ${_product.name} on BuyZo.\n$shareUrl';
    try {
      final box = context.findRenderObject() as RenderBox?;
      final shareOrigin =
          box == null ? null : (box.localToGlobal(Offset.zero) & box.size);
      await Share.share(
        message,
        subject: _product.name,
        sharePositionOrigin: shareOrigin,
      );
    } on MissingPluginException {
      await Clipboard.setData(ClipboardData(text: shareUrl));
      if (!mounted) return;
      AppSnackBar.show(
        context,
        'Share unavailable. Product link copied.',
      );
    } catch (_) {
      await Clipboard.setData(ClipboardData(text: shareUrl));
      if (!mounted) return;
      AppSnackBar.show(
        context,
        'Could not open share sheet. Product link copied.',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final variant = _product.variants.isNotEmpty
        ? _product.variants[_selectedVariantIndex
            .clamp(0, _product.variants.length - 1)
            .toInt()]
        : null;
    final selectedMrp = variant?.mrp ?? 0;
    final selectedSale = variant?.salePrice ?? 0;
    final pricing = _resolveDisplayPricing(
      mrp: selectedMrp > 0 ? selectedMrp : _product.priceMrp,
      sale: selectedSale > 0 ? selectedSale : _product.priceSale,
    );

    return Scaffold(
      appBar: AppBar(
        title: Text(_product.name),
        actions: [
          IconButton(
            onPressed: _shareProduct,
            icon: const Icon(Icons.share_rounded),
          ),
          IconButton(
            onPressed: _isFavoriteUpdating ? null : _toggleFavorite,
            icon: Icon(
              _isFavorite
                  ? Icons.favorite_rounded
                  : Icons.favorite_border_rounded,
              color: _isFavorite ? Colors.redAccent : null,
            ),
          ),
        ],
      ),
      body: _HydrateFadeIn(
        animationKey: _hydrateAnimationKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 102),
          children: [
            if (_isHydratingDetails) const SizedBox(height: 6),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        _error!,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: colorScheme.error,
                        ),
                      ),
                    ),
                    TextButton(
                      onPressed: () => _hydrateDetailsIfNeeded(force: true),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            SizedBox(
              height: 236,
              child: _ProductImageCarousel(images: _product.images),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: Text(
                    _product.name,
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                _VegTag(isVeg: _product.isVeg),
              ],
            ),
            if (_product.brand.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                _product.brand,
                style: theme.textTheme.bodyLarge?.copyWith(
                  color: colorScheme.onSurface.withOpacity(0.7),
                ),
              ),
            ],
            const SizedBox(height: 8),
            Row(
              children: [
                Text(
                  '\$${pricing.primaryPrice.toStringAsFixed(2)}',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(width: 8),
                if (pricing.hasDiscount)
                  Text(
                    '\$${pricing.mrp.toStringAsFixed(2)}',
                    style: theme.textTheme.titleMedium?.copyWith(
                      decoration: TextDecoration.lineThrough,
                      color: colorScheme.onSurface.withOpacity(0.5),
                    ),
                  ),
                const SizedBox(width: 8),
                if (pricing.hasDiscount)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: colorScheme.primary,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      '${pricing.discountPercent.toStringAsFixed(0)}% OFF',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: colorScheme.onPrimary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
              ],
            ),
            if (_product.description.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                _product.description,
                style: theme.textTheme.bodyMedium?.copyWith(
                  height: 1.45,
                ),
              ),
            ],
            if (_product.variants.isNotEmpty) ...[
              const SizedBox(height: 14),
              Text(
                'Sizes',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: List.generate(_product.variants.length, (index) {
                  final item = _product.variants[index];
                  final isSelected = _selectedVariantIndex == index;
                  return ChoiceChip(
                    label: Text(item.title),
                    selected: isSelected,
                    onSelected: (_) {
                      setState(() {
                        _selectedVariantIndex = index;
                      });
                    },
                  );
                }),
              ),
            ],
            _DetailHighlightsSection(
              highlights: _product.highlights,
              isHydratingDetails: _isHydratingDetails,
            ),
            _DetailNutritionSection(
              nutrition: _product.nutrition,
              isHydratingDetails: _isHydratingDetails,
            ),
            if (_product.similar.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(
                'Similar Products',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                height: 190,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _product.similar.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 10),
                  itemBuilder: (context, index) {
                    final item = _product.similar[index];
                    return SizedBox(
                      width: 150,
                      child: _ProductCard(
                        product: item,
                        quantity: 0,
                        isFavorite: _favoritesStore.isFavoriteProduct(item.id),
                        onTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => _ProductDetailsPage(
                                productId: item.id,
                                initialProduct: item,
                                initialQuantity: 0,
                                initialIsFavorite:
                                    _favoritesStore.isFavoriteProduct(item.id),
                                onQuantityChanged: (_) {},
                                onFavoriteToggleRequested:
                                    widget.onFavoriteToggleRequested,
                              ),
                            ),
                          );
                        },
                        onFavoriteToggle: () {
                          unawaited(
                            widget.onFavoriteToggleRequested(
                              item,
                              _favoritesStore.isFavoriteProduct(item.id),
                            ),
                          );
                        },
                        onQuantityChanged: (_) {},
                      ),
                    );
                  },
                ),
              ),
            ] else if (_isHydratingDetails) ...[
              const SizedBox(height: 16),
              const _DetailSimilarSkeleton(),
            ],
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(12, 0, 12, 10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: colorScheme.surface,
            borderRadius: BorderRadius.circular(16),
            border:
                Border.all(color: colorScheme.outlineVariant.withOpacity(0.5)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.08),
                blurRadius: 16,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Row(
            children: [
              Expanded(
                child: _QuantityControl(
                  quantity: _quantity,
                  onChanged: _setQuantity,
                ),
              ),
              const SizedBox(width: 10),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).pop(),
                icon: const Icon(Icons.arrow_back_rounded),
                label: const Text('Browse'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DetailHighlightsSection extends StatelessWidget {
  const _DetailHighlightsSection({
    required this.highlights,
    required this.isHydratingDetails,
  });

  final List<String> highlights;
  final bool isHydratingDetails;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final hasData = highlights.isNotEmpty;
    final shouldShow = hasData || isHydratingDetails;
    if (!shouldShow) return const SizedBox.shrink();

    return AnimatedSize(
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
      alignment: Alignment.topCenter,
      child: Padding(
        padding: const EdgeInsets.only(top: 14),
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 220),
          switchInCurve: Curves.easeOutCubic,
          switchOutCurve: Curves.easeInCubic,
          transitionBuilder: (child, animation) {
            return FadeTransition(
              opacity: animation,
              child: SizeTransition(
                sizeFactor: animation,
                axisAlignment: -1,
                child: child,
              ),
            );
          },
          child: hasData
              ? Column(
                  key: const ValueKey('highlights_data'),
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Highlights',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    ...highlights.map(
                      (item) => Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(
                              Icons.check_circle_rounded,
                              size: 18,
                              color: colorScheme.primary,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                item,
                                style: theme.textTheme.bodyMedium,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                )
              : const Column(
                  key: ValueKey('highlights_skeleton'),
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _DetailSectionTitleSkeleton(),
                    SizedBox(height: 6),
                    _DetailHighlightsSkeleton(lineCount: 3),
                  ],
                ),
        ),
      ),
    );
  }
}

class _DetailNutritionSection extends StatelessWidget {
  const _DetailNutritionSection({
    required this.nutrition,
    required this.isHydratingDetails,
  });

  final List<_NutritionRow> nutrition;
  final bool isHydratingDetails;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final hasData = nutrition.isNotEmpty;
    final shouldShow = hasData || isHydratingDetails;
    if (!shouldShow) return const SizedBox.shrink();

    return AnimatedSize(
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
      alignment: Alignment.topCenter,
      child: Padding(
        padding: const EdgeInsets.only(top: 14),
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 220),
          switchInCurve: Curves.easeOutCubic,
          switchOutCurve: Curves.easeInCubic,
          transitionBuilder: (child, animation) {
            return FadeTransition(
              opacity: animation,
              child: SizeTransition(
                sizeFactor: animation,
                axisAlignment: -1,
                child: child,
              ),
            );
          },
          child: hasData
              ? Column(
                  key: const ValueKey('nutrition_data'),
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Nutrition',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(
                          color: colorScheme.outlineVariant.withOpacity(0.6),
                        ),
                      ),
                      child: Column(
                        children: List.generate(nutrition.length, (index) {
                          final row = nutrition[index];
                          return ListTile(
                            dense: true,
                            title: Text(row.nutrient),
                            trailing: Text(
                              row.value,
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          );
                        }),
                      ),
                    ),
                  ],
                )
              : const Column(
                  key: ValueKey('nutrition_skeleton'),
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _DetailSectionTitleSkeleton(),
                    SizedBox(height: 6),
                    _DetailNutritionSkeleton(),
                  ],
                ),
        ),
      ),
    );
  }
}

class _DetailSectionTitleSkeleton extends StatelessWidget {
  const _DetailSectionTitleSkeleton();

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final baseColor = isDark ? Colors.grey.shade800 : Colors.grey.shade300;
    final highlightColor = isDark ? Colors.grey.shade700 : Colors.grey.shade100;
    return Shimmer.fromColors(
      baseColor: baseColor,
      highlightColor: highlightColor,
      period: const Duration(milliseconds: 900),
      child: const _SkeletonBone(width: 96, height: 16, radius: 8),
    );
  }
}

class _DetailHighlightsSkeleton extends StatelessWidget {
  const _DetailHighlightsSkeleton({required this.lineCount});

  final int lineCount;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final baseColor = isDark ? Colors.grey.shade800 : Colors.grey.shade300;
    final highlightColor = isDark ? Colors.grey.shade700 : Colors.grey.shade100;

    return Shimmer.fromColors(
      baseColor: baseColor,
      highlightColor: highlightColor,
      period: const Duration(milliseconds: 900),
      child: Column(
        children: List.generate(lineCount, (index) {
          final width = index == lineCount - 1 ? 180.0 : double.infinity;
          return Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _SkeletonBone(width: 18, height: 18, radius: 9),
                const SizedBox(width: 8),
                Expanded(
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: _SkeletonBone(
                      width: width,
                      height: 14,
                      radius: 8,
                    ),
                  ),
                ),
              ],
            ),
          );
        }),
      ),
    );
  }
}

class _DetailNutritionSkeleton extends StatelessWidget {
  const _DetailNutritionSkeleton();

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final baseColor = isDark ? Colors.grey.shade800 : Colors.grey.shade300;
    final highlightColor = isDark ? Colors.grey.shade700 : Colors.grey.shade100;
    final colorScheme = Theme.of(context).colorScheme;
    return Shimmer.fromColors(
      baseColor: baseColor,
      highlightColor: highlightColor,
      period: const Duration(milliseconds: 900),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          color: colorScheme.surfaceContainerHighest.withOpacity(0.18),
        ),
        child: Column(
          children: List.generate(3, (_) {
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: 6),
              child: Row(
                children: [
                  Expanded(
                    child: _SkeletonBone(
                      width: double.infinity,
                      height: 12,
                      radius: 8,
                    ),
                  ),
                  SizedBox(width: 12),
                  _SkeletonBone(
                    width: 56,
                    height: 12,
                    radius: 8,
                  ),
                ],
              ),
            );
          }),
        ),
      ),
    );
  }
}

class _DetailSimilarSkeleton extends StatelessWidget {
  const _DetailSimilarSkeleton();

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final base = colorScheme.surfaceContainerHighest.withOpacity(0.5);
    return SizedBox(
      height: 170,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: 3,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (_, __) => Container(
          width: 140,
          decoration: BoxDecoration(
            color: base,
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
    );
  }
}

class _HydrateFadeIn extends StatelessWidget {
  const _HydrateFadeIn({
    required this.animationKey,
    required this.child,
  });

  final int animationKey;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      key: ValueKey(animationKey),
      tween: Tween(begin: 0.94, end: 1),
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
      child: child,
      builder: (context, value, animatedChild) {
        return Opacity(opacity: value, child: animatedChild);
      },
    );
  }
}

class _ProductImageCarousel extends StatefulWidget {
  const _ProductImageCarousel({required this.images});

  final List<String> images;

  @override
  State<_ProductImageCarousel> createState() => _ProductImageCarouselState();
}

class _ProductImageCarouselState extends State<_ProductImageCarousel> {
  int _current = 0;

  void _openImageViewer(int initialIndex) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => _ProductImageViewerPage(
          images: widget.images,
          initialIndex: initialIndex,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    if (widget.images.isEmpty) {
      return Container(
        decoration: BoxDecoration(
          color: colorScheme.surfaceContainerHighest.withOpacity(0.35),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Center(
          child: Icon(
            Icons.image_outlined,
            size: 56,
            color: colorScheme.onSurface.withOpacity(0.42),
          ),
        ),
      );
    }

    return Column(
      children: [
        Expanded(
          child: PageView.builder(
            itemCount: widget.images.length,
            onPageChanged: (index) {
              setState(() {
                _current = index;
              });
            },
            itemBuilder: (context, index) {
              return GestureDetector(
                onTap: () => _openImageViewer(index),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: Image.network(
                    widget.images[index],
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => Container(
                      color:
                          colorScheme.surfaceContainerHighest.withOpacity(0.35),
                      child: Icon(
                        Icons.broken_image_outlined,
                        size: 56,
                        color: colorScheme.onSurface.withOpacity(0.42),
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(widget.images.length, (index) {
            final selected = index == _current;
            return AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              margin: const EdgeInsets.symmetric(horizontal: 3),
              height: 6,
              width: selected ? 22 : 6,
              decoration: BoxDecoration(
                color: selected
                    ? colorScheme.primary
                    : colorScheme.outlineVariant.withOpacity(0.6),
                borderRadius: BorderRadius.circular(12),
              ),
            );
          }),
        ),
      ],
    );
  }
}

class _ProductImageViewerPage extends StatefulWidget {
  const _ProductImageViewerPage({
    required this.images,
    required this.initialIndex,
  });

  final List<String> images;
  final int initialIndex;

  @override
  State<_ProductImageViewerPage> createState() =>
      _ProductImageViewerPageState();
}

class _ProductImageViewerPageState extends State<_ProductImageViewerPage> {
  late final PageController _pageController;
  late int _currentIndex;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex.clamp(0, widget.images.length - 1);
    _pageController = PageController(initialPage: _currentIndex);
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text('${_currentIndex + 1}/${widget.images.length}'),
      ),
      body: PageView.builder(
        controller: _pageController,
        itemCount: widget.images.length,
        onPageChanged: (value) {
          setState(() {
            _currentIndex = value;
          });
        },
        itemBuilder: (context, index) {
          return InteractiveViewer(
            minScale: 1,
            maxScale: 4,
            child: Center(
              child: Image.network(
                widget.images[index],
                fit: BoxFit.contain,
                errorBuilder: (_, __, ___) => const Icon(
                  Icons.broken_image_outlined,
                  color: Colors.white70,
                  size: 64,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
