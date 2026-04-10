part of '../pages/home_page.dart';

class _ProductGridSkeleton extends StatelessWidget {
  const _ProductGridSkeleton({required this.itemCount});

  final int itemCount;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final baseColor = isDark ? Colors.grey.shade800 : Colors.grey.shade300;
    final highlightColor = isDark ? Colors.grey.shade700 : Colors.grey.shade100;

    return Shimmer.fromColors(
      baseColor: baseColor,
      highlightColor: highlightColor,
      period: const Duration(milliseconds: 900),
      child: GridView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: itemCount,
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          mainAxisSpacing: 6,
          crossAxisSpacing: 6,
          childAspectRatio: 0.75,
        ),
        itemBuilder: (_, __) => const _ProductCardSkeleton(),
      ),
    );
  }
}

class _ProductCardSkeleton extends StatelessWidget {
  const _ProductCardSkeleton();

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final bone = colorScheme.surfaceContainerHighest.withOpacity(0.9);

    return Container(
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: colorScheme.outlineVariant.withOpacity(0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius:
                  const BorderRadius.vertical(top: Radius.circular(12)),
              child: Stack(
                children: [
                  Positioned.fill(
                    child: Container(color: bone),
                  ),
                  const Positioned(
                    top: 8,
                    left: 8,
                    child: _SkeletonBone(
                      width: 12,
                      height: 12,
                      radius: 2,
                    ),
                  ),
                  const Positioned(
                    top: 8,
                    right: 8,
                    child: _SkeletonBone(
                      width: 26,
                      height: 26,
                      radius: 13,
                    ),
                  ),
                  const Positioned(
                    bottom: 8,
                    left: 8,
                    child: _SkeletonBone(
                      width: 56,
                      height: 18,
                      radius: 8,
                    ),
                  ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(7, 6, 7, 5),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _SkeletonBone(width: 110, height: 12, radius: 6),
                const SizedBox(height: 4),
                const _SkeletonBone(width: 92, height: 10, radius: 6),
                const SizedBox(height: 3),
                const _SkeletonBone(width: 120, height: 10, radius: 6),
                const SizedBox(height: 6),
                Row(
                  children: const [
                    _SkeletonBone(width: 52, height: 12, radius: 6),
                    SizedBox(width: 6),
                    _SkeletonBone(width: 36, height: 10, radius: 6),
                  ],
                ),
                const SizedBox(height: 6),
                const _SkeletonBone(
                    width: double.infinity, height: 34, radius: 10),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SkeletonBone extends StatelessWidget {
  const _SkeletonBone({
    required this.width,
    required this.height,
    required this.radius,
  });

  final double width;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}

class _ProductCard extends StatelessWidget {
  const _ProductCard({
    required this.product,
    required this.quantity,
    required this.isFavorite,
    required this.onTap,
    required this.onFavoriteToggle,
    required this.onQuantityChanged,
  });

  final _CatalogProduct product;
  final int quantity;
  final bool isFavorite;
  final VoidCallback onTap;
  final VoidCallback onFavoriteToggle;
  final ValueChanged<int> onQuantityChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final imageUrl = product.displayImage;
    final pricing = _resolveDisplayPricing(
      mrp: product.priceMrp,
      sale: product.priceSale,
    );
    final outOfStock = product.stockQty <= 0;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Ink(
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
            Expanded(
              child: Stack(
                children: [
                  ClipRRect(
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(12),
                    ),
                    child: Container(
                      color:
                          colorScheme.surfaceContainerHighest.withOpacity(0.4),
                      width: double.infinity,
                      child: imageUrl.isEmpty
                          ? Icon(
                              Icons.image_outlined,
                              size: 42,
                              color: colorScheme.onSurface.withOpacity(0.4),
                            )
                          : Image.network(
                              imageUrl,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => Icon(
                                Icons.broken_image_outlined,
                                size: 42,
                                color: colorScheme.onSurface.withOpacity(0.4),
                              ),
                            ),
                    ),
                  ),
                  Positioned(
                    top: 8,
                    left: 8,
                    child: _VegTag(isVeg: product.isVeg),
                  ),
                  Positioned(
                    top: 8,
                    right: 8,
                    child: Material(
                      color: colorScheme.surface.withOpacity(0.92),
                      borderRadius: BorderRadius.circular(20),
                      child: InkWell(
                        onTap: onFavoriteToggle,
                        borderRadius: BorderRadius.circular(20),
                        child: Padding(
                          padding: const EdgeInsets.all(6),
                          child: Icon(
                            isFavorite
                                ? Icons.favorite_rounded
                                : Icons.favorite_border_rounded,
                            size: 18,
                            color: isFavorite
                                ? Colors.redAccent
                                : colorScheme.onSurface.withOpacity(0.7),
                          ),
                        ),
                      ),
                    ),
                  ),
                  if (pricing.hasDiscount)
                    Positioned(
                      bottom: 8,
                      left: 8,
                      child: Container(
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
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(7, 6, 7, 5),
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
                  const SizedBox(height: 2),
                  Text(
                    product.shortDescription.isEmpty
                        ? product.category
                        : product.shortDescription,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: colorScheme.onSurface.withOpacity(0.66),
                    ),
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      Text(
                        '\$${pricing.primaryPrice.toStringAsFixed(2)}',
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(width: 6),
                      if (pricing.hasDiscount)
                        Text(
                          '\$${pricing.mrp.toStringAsFixed(2)}',
                          style: theme.textTheme.labelMedium?.copyWith(
                            color: colorScheme.onSurface.withOpacity(0.5),
                            decoration: TextDecoration.lineThrough,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  if (outOfStock)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      decoration: BoxDecoration(
                        color: colorScheme.surfaceContainerHighest
                            .withOpacity(0.6),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        'Out of stock',
                        style: theme.textTheme.labelLarge,
                      ),
                    )
                  else
                    GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () {},
                      child: _QuantityControl(
                        quantity: quantity,
                        onChanged: onQuantityChanged,
                      ),
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

class _QuantityControl extends StatelessWidget {
  const _QuantityControl({
    required this.quantity,
    required this.onChanged,
  });

  final int quantity;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return SizedBox(
      height: 34,
      width: double.infinity,
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 160),
        switchInCurve: Curves.easeOut,
        switchOutCurve: Curves.easeIn,
        child: quantity <= 0
            ? OutlinedButton.icon(
                key: const ValueKey('add'),
                onPressed: () => onChanged(1),
                icon: const Icon(Icons.add_rounded, size: 16),
                label: const Text('Add'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: colorScheme.primary,
                  side: BorderSide(color: colorScheme.primary.withOpacity(0.7)),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                  padding: EdgeInsets.zero,
                  minimumSize: const Size.fromHeight(34),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
              )
            : Container(
                key: const ValueKey('stepper'),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: colorScheme.primary.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Stack(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          flex: 4,
                          child: InkWell(
                            onTap: () => onChanged(quantity - 1),
                            borderRadius: BorderRadius.circular(8),
                            child: const Align(
                              alignment: Alignment.centerLeft,
                              child: Padding(
                                padding: EdgeInsets.symmetric(horizontal: 4),
                                child: Icon(Icons.remove_rounded, size: 17),
                              ),
                            ),
                          ),
                        ),
                        const Expanded(flex: 2, child: SizedBox()),
                        Expanded(
                          flex: 4,
                          child: InkWell(
                            onTap: () => onChanged(quantity + 1),
                            borderRadius: BorderRadius.circular(8),
                            child: const Align(
                              alignment: Alignment.centerRight,
                              child: Padding(
                                padding: EdgeInsets.symmetric(horizontal: 4),
                                child: Icon(Icons.add_rounded, size: 17),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    Positioned.fill(
                      child: IgnorePointer(
                        child: Center(
                          child: Text(
                            '$quantity',
                            textAlign: TextAlign.center,
                            style: theme.textTheme.titleSmall?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}

class _VegTag extends StatelessWidget {
  const _VegTag({required this.isVeg});

  final bool? isVeg;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final color = isVeg == null
        ? colorScheme.onSurface.withOpacity(0.7)
        : (isVeg! ? Colors.green : Colors.redAccent);

    return Container(
      width: 12,
      height: 12,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: colorScheme.surface.withOpacity(0.92),
        borderRadius: BorderRadius.circular(2),
        border: Border.all(color: color.withOpacity(0.7), width: 1),
      ),
      child: Container(
        width: 4,
        height: 4,
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
        ),
      ),
    );
  }
}
