part of '../pages/home_page.dart';

class _HomeBottomNavBar extends StatefulWidget {
  const _HomeBottomNavBar({
    required this.currentIndex,
    required this.cartItemCount,
    required this.cartSubtotal,
    required this.onCheckout,
    required this.isCheckingOut,
    required this.navItems,
    required this.onTabSelected,
  });

  final int currentIndex;
  final int cartItemCount;
  final double cartSubtotal;
  final Future<void> Function() onCheckout;
  final bool isCheckingOut;
  final List<({IconData icon, String label})> navItems;
  final ValueChanged<int> onTabSelected;

  @override
  State<_HomeBottomNavBar> createState() => _HomeBottomNavBarState();
}

class _HomeBottomNavBarState extends State<_HomeBottomNavBar> {
  final GlobalKey _navGestureKey = GlobalKey();
  double? _dragTabProgress;
  bool _isNavHolding = false;
  Offset? _navTouchDownGlobal;
  bool _navDragActivated = false;

  double _dragProgressFromGlobal(Offset globalPosition) {
    final box = _navGestureKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || box.size.width <= 0) {
      return widget.currentIndex.toDouble();
    }
    final local = box.globalToLocal(globalPosition);
    final clampedDx = local.dx.clamp(0.0, box.size.width);
    final tabWidth = box.size.width / widget.navItems.length;
    return (clampedDx / tabWidth)
        .clamp(0.0, (widget.navItems.length - 1).toDouble());
  }

  void _setDragProgress(Offset globalPosition, {required bool holding}) {
    setState(() {
      _dragTabProgress = _dragProgressFromGlobal(globalPosition);
      _isNavHolding = holding;
    });
  }

  void _onNavDragStart(DragStartDetails details) {
    _navTouchDownGlobal ??= details.globalPosition;
  }

  void _onNavDragUpdate(DragUpdateDetails details) {
    final touchDown = _navTouchDownGlobal;
    if (!_navDragActivated && touchDown != null) {
      final deltaX = (details.globalPosition.dx - touchDown.dx).abs();
      if (deltaX < 6) return;
      _navDragActivated = true;
      _setDragProgress(touchDown, holding: true);
      return;
    }
    _setDragProgress(details.globalPosition, holding: true);
  }

  void _onNavDragEnd() {
    if (!_navDragActivated) {
      setState(() {
        _dragTabProgress = null;
        _isNavHolding = false;
      });
      _navTouchDownGlobal = null;
      return;
    }

    final target = (_dragTabProgress ?? widget.currentIndex.toDouble())
        .round()
        .clamp(0, widget.navItems.length - 1);
    setState(() {
      _dragTabProgress = null;
      _isNavHolding = false;
    });
    _navTouchDownGlobal = null;
    _navDragActivated = false;
    widget.onTabSelected(target);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final colorScheme = theme.colorScheme;

    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.cartItemCount > 0)
            widget.currentIndex == 2
                ? Container(
                    width: double.infinity,
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      color: colorScheme.surface,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: colorScheme.outlineVariant.withOpacity(0.5),
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withOpacity(0.08),
                          blurRadius: 12,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                'Subtotal',
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: colorScheme.onSurface.withOpacity(
                                    0.66,
                                  ),
                                ),
                              ),
                              Text(
                                '\$${widget.cartSubtotal.toStringAsFixed(2)}',
                                style: theme.textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ],
                          ),
                        ),
                        FilledButton(
                          onPressed: widget.isCheckingOut
                              ? null
                              : () {
                                  widget.onCheckout();
                                },
                          child: widget.isCheckingOut
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Text('Checkout'),
                        ),
                      ],
                    ),
                  )
                : Container(
                    width: double.infinity,
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      color: colorScheme.primary,
                      borderRadius: BorderRadius.circular(14),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withOpacity(0.18),
                          blurRadius: 14,
                          offset: const Offset(0, 5),
                        ),
                      ],
                    ),
                    child: InkWell(
                      onTap: () => widget.onTabSelected(2),
                      borderRadius: BorderRadius.circular(14),
                      child: Row(
                        children: [
                          Icon(
                            Icons.shopping_bag_rounded,
                            color: colorScheme.onPrimary,
                            size: 20,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              '${widget.cartItemCount} item${widget.cartItemCount == 1 ? '' : 's'} in cart',
                              style: theme.textTheme.titleSmall?.copyWith(
                                color: colorScheme.onPrimary,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          Text(
                            'Checkout',
                            style: theme.textTheme.labelLarge?.copyWith(
                              color: colorScheme.onPrimary,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Icon(
                            Icons.chevron_right_rounded,
                            color: colorScheme.onPrimary,
                          ),
                        ],
                      ),
                    ),
                  ),
          LayoutBuilder(
            builder: (context, constraints) {
              final selectionProgress =
                  _dragTabProgress ?? widget.currentIndex.toDouble();
              const horizontalInset = 8.0;
              final trackWidth = (constraints.maxWidth - (horizontalInset * 2))
                  .clamp(0.0, constraints.maxWidth);
              final tabWidth = trackWidth / widget.navItems.length;
              final holdScale = _isNavHolding ? 1.18 : 1.0;
              final lensWidth =
                  ((tabWidth - 8) * holdScale).clamp(0.0, trackWidth);
              final lensHeight = _isNavHolding ? 60.0 : 50.0;
              final lensTop = 11.5 - ((lensHeight - 44.0) / 2);
              final lensLeft = horizontalInset +
                  (selectionProgress * tabWidth) +
                  ((tabWidth - lensWidth) / 2);

              return Stack(
                clipBehavior: Clip.none,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(36),
                    child: BackdropFilter(
                      filter: ImageFilter.blur(sigmaX: 7, sigmaY: 7),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 8,
                        ),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(36),
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [
                              Colors.white.withOpacity(isDark ? 0.06 : 0.18),
                              colorScheme.surface
                                  .withOpacity(isDark ? 0.24 : 0.34),
                              colorScheme.surface
                                  .withOpacity(isDark ? 0.2 : 0.28),
                            ],
                          ),
                          border: Border.all(
                            color:
                                Colors.white.withOpacity(isDark ? 0.12 : 0.3),
                            width: 0.9,
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black
                                  .withOpacity(isDark ? 0.36 : 0.12),
                              blurRadius: 26,
                              offset: const Offset(0, 10),
                            ),
                          ],
                        ),
                        child: GestureDetector(
                          key: _navGestureKey,
                          behavior: HitTestBehavior.opaque,
                          onHorizontalDragStart: _onNavDragStart,
                          onHorizontalDragUpdate: _onNavDragUpdate,
                          onHorizontalDragEnd: (_) => _onNavDragEnd(),
                          onHorizontalDragCancel: _onNavDragEnd,
                          onTapDown: (_) {
                            _navTouchDownGlobal = _.globalPosition;
                            _navDragActivated = false;
                            if (_isNavHolding) return;
                            setState(() {
                              _isNavHolding = true;
                            });
                          },
                          onTapUp: (_) {
                            if (!_isNavHolding) return;
                            setState(() {
                              _isNavHolding = false;
                            });
                            _navTouchDownGlobal = null;
                            _navDragActivated = false;
                          },
                          onTapCancel: () {
                            if (!_isNavHolding) return;
                            setState(() {
                              _isNavHolding = false;
                            });
                            _navTouchDownGlobal = null;
                            _navDragActivated = false;
                          },
                          child: Row(
                            children:
                                List.generate(widget.navItems.length, (index) {
                              final item = widget.navItems[index];
                              final activation =
                                  (1 - (selectionProgress - index).abs())
                                      .clamp(0.0, 1.0);
                              final isSelected = activation > 0.5;
                              final iconScale = _isNavHolding
                                  ? (1.0 + (activation * 0.42))
                                  : (1.0 + (activation * 0.05));
                              final iconLift =
                                  _isNavHolding ? (-1.5 * activation) : 0.0;

                              return Expanded(
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(28),
                                  splashFactory: NoSplash.splashFactory,
                                  splashColor: Colors.transparent,
                                  highlightColor: Colors.transparent,
                                  hoverColor: Colors.transparent,
                                  focusColor: Colors.transparent,
                                  overlayColor: const MaterialStatePropertyAll(
                                    Colors.transparent,
                                  ),
                                  onTap: () => widget.onTabSelected(index),
                                  child: Container(
                                    margin: const EdgeInsets.symmetric(
                                      horizontal: 4,
                                      vertical: 1,
                                    ),
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 6,
                                    ),
                                    child: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        SizedBox(
                                          width: 28,
                                          height: 22,
                                          child: Stack(
                                            clipBehavior: Clip.none,
                                            children: [
                                              Align(
                                                alignment: Alignment.center,
                                                child: Transform.translate(
                                                  offset: Offset(0, iconLift),
                                                  child: Transform.scale(
                                                    scale: iconScale,
                                                    child: Icon(
                                                      item.icon,
                                                      size: 22,
                                                      color: Color.lerp(
                                                        colorScheme.onSurface
                                                            .withOpacity(0.7),
                                                        colorScheme.primary,
                                                        activation,
                                                      ),
                                                    ),
                                                  ),
                                                ),
                                              ),
                                              if (index == 2 &&
                                                  widget.cartItemCount > 0)
                                                Positioned(
                                                  top: -3,
                                                  right: -7,
                                                  child: Container(
                                                    padding: const EdgeInsets
                                                        .symmetric(
                                                      horizontal: 5,
                                                      vertical: 2,
                                                    ),
                                                    decoration: BoxDecoration(
                                                      color:
                                                          colorScheme.primary,
                                                      borderRadius:
                                                          BorderRadius.circular(
                                                        10,
                                                      ),
                                                    ),
                                                    child: Text(
                                                      widget.cartItemCount > 99
                                                          ? '99+'
                                                          : widget.cartItemCount
                                                              .toString(),
                                                      style: theme
                                                          .textTheme.labelSmall
                                                          ?.copyWith(
                                                        color: colorScheme
                                                            .onPrimary,
                                                        fontWeight:
                                                            FontWeight.w700,
                                                        fontSize: 9,
                                                      ),
                                                    ),
                                                  ),
                                                ),
                                            ],
                                          ),
                                        ),
                                        const SizedBox(height: 2),
                                        Text(
                                          item.label,
                                          style: theme.textTheme.labelSmall
                                              ?.copyWith(
                                            fontSize: 10,
                                            height: 1.0,
                                            fontWeight: isSelected
                                                ? FontWeight.w700
                                                : FontWeight.w500,
                                            color: Color.lerp(
                                              colorScheme.onSurface
                                                  .withOpacity(0.7),
                                              colorScheme.onSurface
                                                  .withOpacity(0.9),
                                              activation,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              );
                            }),
                          ),
                        ),
                      ),
                    ),
                  ),
                  AnimatedPositioned(
                    duration: const Duration(milliseconds: 140),
                    curve: Curves.easeOutCubic,
                    top: lensTop,
                    left: lensLeft,
                    width: lensWidth,
                    height: lensHeight,
                    child: IgnorePointer(
                      child: Container(
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                            color:
                                Colors.white.withOpacity(isDark ? 0.24 : 0.65),
                            width: 0.9,
                          ),
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [
                              Colors.white.withOpacity(isDark ? 0.08 : 0.16),
                              const Color(0xFFDDF3FF).withOpacity(
                                isDark ? 0.07 : 0.3,
                              ),
                              const Color(0xFFCEE8FF).withOpacity(
                                isDark ? 0.05 : 0.2,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}
