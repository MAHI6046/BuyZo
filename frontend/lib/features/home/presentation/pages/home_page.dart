import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_stripe/flutter_stripe.dart' hide Card;
import 'package:geolocator/geolocator.dart';
import 'package:shimmer/shimmer.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:record/record.dart';
import 'package:share_plus/share_plus.dart';

import '../../../../core/constants/app_constants.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/theme_provider.dart';
import '../../../../core/ui/app_snack_bar.dart';
import '../../../../shared/widgets/location_picker_sheet.dart';
import '../../../auth/presentation/pages/login_page.dart';

part 'products_page.dart';
part '../widgets/home_bottom_nav_bar.dart';
part '../widgets/order_details_page.dart';
part '../widgets/dotbot_sheet.dart';
part '../widgets/products_models.dart';
part '../widgets/products_details.dart';
part '../widgets/products_catalog_widgets.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  int _currentIndex = 0;
  String _selectedAddress = 'Set delivery location';
  int? _selectedAddressId;
  bool _isAddressLoading = true;
  bool _needsAddressSetup = false;
  int _productsSearchRequestId = 0;
  int _productsCategoryScrollRequestId = 0;
  final Map<int, _CartItem> _cartItems = {};
  final _productsCatalogStore = _ProductsCatalogStore();
  bool _isCheckingOut = false;
  PageController? _pageController;
  bool _isProgrammaticTabChange = false;
  int? _targetTabIndex;
  StreamSubscription<User?>? _authStateSub;
  List<_DotBotMessage> _dotBotConversation = const [];
  Map<String, dynamic> _dotBotContext = const {};

  int? _asInt(dynamic value) {
    if (value == null) return null;
    if (value is int) return value;
    if (value is num) return value.toInt();
    return int.tryParse(value.toString().trim());
  }

  String _inferProductSizeLabel(_CatalogProduct product) {
    if (product.variants.isNotEmpty) {
      final defaultVariant = product.variants.firstWhere(
        (variant) => variant.isDefault,
        orElse: () => product.variants.first,
      );
      if (defaultVariant.label.trim().isNotEmpty) {
        return defaultVariant.label.trim();
      }
      if (defaultVariant.grams > 0) {
        return '${defaultVariant.grams} g';
      }
      if (defaultVariant.sizeCode.trim().isNotEmpty) {
        return defaultVariant.sizeCode.trim();
      }
    }

    final source = '${product.name} ${product.shortDescription}';
    final match = RegExp(
      r'\b(\d+(?:\.\d+)?)\s?(kg|g|gm|grams?|ml|l|lit(?:er|re)?|oz|lb|pcs?|pack)\b',
      caseSensitive: false,
    ).firstMatch(source);
    if (match == null) return '';

    final amount = match.group(1) ?? '';
    var unit = (match.group(2) ?? '').toLowerCase();
    if (unit == 'gm' || unit == 'grams' || unit == 'gram') unit = 'g';
    if (unit == 'liter' || unit == 'litre') unit = 'L';
    if (unit == 'l') unit = 'L';
    return '$amount $unit'.trim();
  }

  static const List<({IconData icon, String label})> _navItems = [
    (icon: Icons.home_rounded, label: 'Home'),
    (icon: Icons.storefront_rounded, label: 'Products'),
    (icon: Icons.shopping_bag_rounded, label: 'My Cart'),
    (icon: Icons.receipt_long_rounded, label: 'Orders'),
    (icon: Icons.person_rounded, label: 'Profile'),
  ];

  int get _cartItemCount => _cartItems.values.fold<int>(
        0,
        (sum, item) => sum + item.quantity,
      );

  @override
  void initState() {
    super.initState();
    _pageController ??= PageController(initialPage: _currentIndex);
    unawaited(_productsCatalogStore.ensureFresh(includeCategories: false));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      unawaited(_productsCatalogStore.ensureCategoriesLoaded());
    });
    unawaited(_loadDefaultAddress());
    _authStateSub = FirebaseAuth.instance.authStateChanges().listen((user) {
      if (user != null || !mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const LoginPage()),
        (route) => false,
      );
    });
  }

  @override
  void dispose() {
    _authStateSub?.cancel();
    _pageController?.dispose();
    _productsCatalogStore.dispose();
    super.dispose();
  }

  Future<void> _openLocationPicker({bool force = false}) async {
    ResolvedAddress? pickedAddress;
    try {
      if (force) {
        pickedAddress = await Navigator.of(context, rootNavigator: true).push(
          MaterialPageRoute<ResolvedAddress>(
            builder: (_) => Scaffold(
              backgroundColor: Theme.of(context).colorScheme.surface,
              body: SafeArea(
                child: Align(
                  alignment: Alignment.bottomCenter,
                  child: FractionallySizedBox(
                    heightFactor: 0.88,
                    widthFactor: 1,
                    child: const LocationPickerSheet(),
                  ),
                ),
              ),
            ),
          ),
        );
      } else {
        pickedAddress = await showModalBottomSheet<ResolvedAddress>(
          context: context,
          isScrollControlled: true,
          isDismissible: true,
          enableDrag: true,
          useSafeArea: true,
          useRootNavigator: true,
          backgroundColor: Colors.transparent,
          builder: (_) => FractionallySizedBox(
            heightFactor: 0.8,
            child: const LocationPickerSheet(),
          ),
        );
      }
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        'Could not open location picker. Please try again.',
      );
      return;
    }

    if (!mounted ||
        pickedAddress == null ||
        pickedAddress.fullAddress.trim().isEmpty) {
      if (force && mounted) {
        AppSnackBar.show(
          context,
          'Select an address to continue.',
        );
      }
      return;
    }

    await _saveAddress(pickedAddress);
  }

  Future<void> _loadDefaultAddress() async {
    try {
      final response = await ApiClient.instance.get(
        '/api/addresses/default',
        authenticated: true,
      );
      if (!mounted) return;
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        final address = data['address'] as Map<String, dynamic>? ?? const {};
        setState(() {
          _selectedAddressId = _asInt(address['id']);
          _selectedAddress =
              (address['full_address']?.toString().trim().isNotEmpty ?? false)
                  ? address['full_address'].toString().trim()
                  : 'Set delivery location';
          _isAddressLoading = false;
          _needsAddressSetup = _selectedAddressId == null;
        });
        return;
      }
      if (response.statusCode == 404) {
        setState(() {
          _isAddressLoading = false;
          _needsAddressSetup = true;
          _selectedAddressId = null;
          _selectedAddress = 'Set delivery location';
        });
        return;
      }
      setState(() {
        _isAddressLoading = false;
        _needsAddressSetup = true;
      });
    } on SessionExpiredException {
      if (!mounted) return;
      setState(() {
        _isAddressLoading = false;
        _needsAddressSetup = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isAddressLoading = false;
        _needsAddressSetup = true;
      });
    }
  }

  Future<void> _saveAddress(ResolvedAddress pickedAddress) async {
    try {
      final response = pickedAddress.addressId != null
          ? await ApiClient.instance.patch(
              '/api/addresses/${pickedAddress.addressId}/default',
              authenticated: true,
            )
          : await ApiClient.instance.post(
              '/api/addresses',
              authenticated: true,
              headers: {'Content-Type': 'application/json'},
              body: jsonEncode({
                'label': pickedAddress.label ?? 'Home',
                'full_address': pickedAddress.fullAddress.trim(),
                'lat': pickedAddress.lat,
                'lng': pickedAddress.lng,
                'is_default': true,
              }),
            );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('Failed to save address (${response.statusCode})');
      }
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final address = data['address'] as Map<String, dynamic>? ?? const {};
      if (!mounted) return;
      setState(() {
        _selectedAddressId = _asInt(address['id']);
        _selectedAddress = (address['full_address']?.toString() ?? '').trim();
        _needsAddressSetup = false;
      });
    } catch (error) {
      if (!mounted) return;
      final fallbackAddress = pickedAddress.fullAddress.trim();
      if (fallbackAddress.isNotEmpty) {
        setState(() {
          _selectedAddressId = null;
          _selectedAddress = fallbackAddress;
          _needsAddressSetup = false;
        });
      }
      AppSnackBar.show(
        context,
        fallbackAddress.isNotEmpty
            ? 'Address saved locally for now.'
            : error.toString().replaceFirst('Exception: ', ''),
      );
    }
  }

  void _openProductsWithSearchFocus() {
    setState(() {
      _productsSearchRequestId++;
    });
    _switchTab(1);
  }

  void _openProductsForCategory(String categoryName) {
    setState(() {
      _productsCategoryScrollRequestId++;
    });
    unawaited(_productsCatalogStore.updateCategory(categoryName));
    _switchTab(1);
  }

  Future<void> _switchTab(int index) async {
    if (index == _currentIndex) return;
    final controller = _pageController;
    if (controller == null || !controller.hasClients) {
      if (!mounted) return;
      setState(() {
        _currentIndex = index;
      });
      return;
    }

    _isProgrammaticTabChange = true;
    _targetTabIndex = index;

    try {
      controller.jumpToPage(index);
    } catch (_) {
      // Ignore jump errors and still reset tab-switch state below.
    }

    if (!mounted) return;
    setState(() {
      _currentIndex = index;
      _isProgrammaticTabChange = false;
      _targetTabIndex = null;
    });
  }

  void _updateCart(_CatalogProduct product, int quantity) {
    setState(() {
      if (quantity <= 0) {
        _cartItems.remove(product.id);
      } else {
        _cartItems[product.id] =
            _CartItem(product: product, quantity: quantity);
      }
    });
  }

  void _updateCartByProductId(int productId, int quantity) {
    final existing = _cartItems[productId];
    if (existing == null) return;
    _updateCart(existing.product, quantity);
  }

  Future<_CatalogProduct?> _fetchProductById(int productId) async {
    final response = await ApiClient.instance.get('/api/products/$productId');
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return null;
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>? ?? const {};
    final productJson = data['product'];
    if (productJson is! Map<String, dynamic>) return null;
    return _CatalogProduct.fromJson(productJson);
  }

  _CatalogProduct? _findCachedProductById(int productId) {
    final inCart = _cartItems[productId];
    if (inCart != null) return inCart.product;

    for (final product in _productsCatalogStore.products) {
      if (product.id == productId) return product;
    }
    return null;
  }

  Future<void> _applyDotBotActions(List<_DotBotAction> actions) async {
    if (actions.isEmpty) return;

    var totalAddedQty = 0;
    var updatedItemCount = 0;
    for (final action in actions) {
      final type = action.type;
      if (type != 'add_to_cart' &&
          type != 'set_cart_quantity' &&
          type != 'remove_from_cart') {
        continue;
      }

      try {
        _CatalogProduct? product = _findCachedProductById(action.productId);
        if (product == null && action.productPayload != null) {
          product = _CatalogProduct.fromJson(action.productPayload!);
        }
        product ??= await _fetchProductById(action.productId);
        if (product == null) continue;

        final currentQty = _cartItems[product.id]?.quantity ?? 0;
        if (type == 'add_to_cart') {
          if (action.quantity <= 0) continue;
          _updateCart(product, currentQty + action.quantity);
          totalAddedQty += action.quantity;
          continue;
        }
        if (type == 'set_cart_quantity') {
          if (action.quantity < 0) continue;
          _updateCart(product, action.quantity);
          updatedItemCount += 1;
          continue;
        }
        if (action.quantity <= 0) continue;
        final nextQty = math.max(0, currentQty - action.quantity);
        _updateCart(product, nextQty);
        updatedItemCount += 1;
      } catch (_) {
        continue;
      }
    }

    if (!mounted) return;
    if (totalAddedQty <= 0 && updatedItemCount <= 0) return;
    final message = totalAddedQty > 0 && updatedItemCount > 0
        ? 'DOTBOT updated cart and added $totalAddedQty item(s).'
        : totalAddedQty > 0
            ? 'DOTBOT added $totalAddedQty item(s) to your cart.'
            : 'DOTBOT updated $updatedItemCount item(s) in your cart.';
    AppSnackBar.show(context, message);
  }

  Future<void> _setDotBotCartQuantity(int productId, int quantity) async {
    final safeQuantity = quantity < 0 ? 0 : quantity;
    _CatalogProduct? product = _findCachedProductById(productId);
    product ??= await _fetchProductById(productId);
    if (product == null) return;
    _updateCart(product, safeQuantity);
  }

  Future<void> _openDotBot() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return _DotBotSheet(
          conversation: _dotBotConversation,
          context: _dotBotContext,
          cartItems: _cartItems.values
              .map(
                (item) => _DotBotCartItem(
                  productId: item.product.id,
                  name: item.product.name,
                  quantity: item.quantity,
                  unitPrice: item.product.priceSale,
                  sizeLabel: _inferProductSizeLabel(item.product),
                ),
              )
              .toList(growable: false),
          onApplyActions: _applyDotBotActions,
          onSetCartQuantity: _setDotBotCartQuantity,
          onConversationChanged: (conversation) {
            _dotBotConversation = List<_DotBotMessage>.from(conversation);
          },
          onContextChanged: (context) {
            _dotBotContext = Map<String, dynamic>.from(context);
          },
        );
      },
    );
  }

  Future<void> _openCheckoutReview() async {
    if (_cartItems.isEmpty || _isCheckingOut) return;
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      if (!mounted) return;
      AppSnackBar.show(context, 'Please login to continue checkout.');
      return;
    }
    if (_selectedAddressId == null) {
      if (!mounted) return;
      AppSnackBar.show(context, 'Please set delivery location first.');
      await _openLocationPicker(force: true);
      return;
    }

    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _CheckoutReviewPage(
          items: _cartItems.values.toList(growable: false),
          addressId: _selectedAddressId!,
          onPlaceOrder: (promoCode) => _placeOrder(promoCode: promoCode),
        ),
      ),
    );
  }

  Future<bool> _placeOrder({String? promoCode}) async {
    if (_cartItems.isEmpty || _isCheckingOut) return false;
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      if (!mounted) return false;
      AppSnackBar.show(context, 'Please login to continue checkout.');
      return false;
    }

    if (_selectedAddressId == null) {
      if (!mounted) return false;
      AppSnackBar.show(context, 'Please set delivery location first.');
      await _openLocationPicker(force: true);
      return false;
    }

    setState(() {
      _isCheckingOut = true;
    });

    try {
      final payload = {
        'items': _cartItems.values
            .map(
              (item) => {
                'product_id': item.product.id,
                'quantity': item.quantity,
              },
            )
            .toList(growable: false),
        'address_id': _selectedAddressId,
        if (promoCode != null && promoCode.trim().isNotEmpty)
          'promo_code': promoCode.trim(),
      };

      final checkoutRes = await ApiClient.instance.post(
        '/api/create-payment-intent',
        authenticated: true,
        headers: {
          'Content-Type': 'application/json',
        },
        body: jsonEncode(payload),
      );
      final checkoutJson =
          jsonDecode(checkoutRes.body) as Map<String, dynamic>? ?? {};
      if (checkoutRes.statusCode == 409) {
        if (!mounted) return false;
        AppSnackBar.show(context, 'Item out of stock. Please update cart.');
        return false;
      }
      if (checkoutRes.statusCode < 200 || checkoutRes.statusCode >= 300) {
        throw Exception(
          checkoutJson['message']?.toString() ?? 'Checkout failed',
        );
      }

      final orderId = _asInt(checkoutJson['order_id']);
      final paymentRequired = checkoutJson['payment_required'] != false;
      if (!paymentRequired) {
        if (!mounted) return false;
        setState(() {
          _cartItems.clear();
        });
        await _switchTab(3);
        if (!mounted) return false;
        AppSnackBar.show(
          context,
          orderId == null ? 'Order placed.' : 'Order #$orderId placed.',
        );
        return true;
      }
      final clientSecret = checkoutJson['client_secret']?.toString() ?? '';
      final publishableKey = checkoutJson['publishable_key']?.toString() ?? '';
      if (clientSecret.isEmpty || publishableKey.isEmpty) {
        throw Exception('Payment initialization failed');
      }

      Stripe.publishableKey = publishableKey;
      await Stripe.instance.applySettings();
      await Stripe.instance.initPaymentSheet(
        paymentSheetParameters: SetupPaymentSheetParameters(
          paymentIntentClientSecret: clientSecret,
          merchantDisplayName: 'BuyZo',
        ),
      );
      await Stripe.instance.presentPaymentSheet();

      if (!mounted) return false;
      setState(() {
        _cartItems.clear();
      });
      await _switchTab(3);
      if (!mounted) return false;
      AppSnackBar.show(
        context,
        orderId == null
            ? 'Payment successful. Order placed.'
            : 'Payment successful. Order #$orderId placed.',
      );
      return true;
    } on StripeException catch (error) {
      if (!mounted) return false;
      final message = error.error.localizedMessage ?? 'Payment cancelled.';
      AppSnackBar.show(context, message);
      return false;
    } on SessionExpiredException catch (error) {
      if (!mounted) return false;
      AppSnackBar.show(context, error.message);
      return false;
    } catch (error) {
      if (!mounted) return false;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', ''),
      );
      return false;
    } finally {
      if (mounted) {
        setState(() {
          _isCheckingOut = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cartSubtotal = _cartItems.values.fold<double>(
      0,
      (sum, item) => sum + (item.product.priceSale * item.quantity),
    );

    if (_isAddressLoading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    if (_needsAddressSetup) {
      return Scaffold(
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.location_on_rounded, size: 56),
                  const SizedBox(height: 10),
                  Text(
                    'Set delivery location',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Use current location or search manually. You can change it anytime.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () => _openLocationPicker(force: true),
                    child: const Text('Choose Location'),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    final pages = <Widget>[
      _HomeFeedView(
        selectedAddress: _selectedAddress,
        onOpenLocationPicker: _openLocationPicker,
        onOpenProductsSearch: _openProductsWithSearchFocus,
        onOpenProductsCategory: _openProductsForCategory,
        store: _productsCatalogStore,
      ),
      _ProductsView(
        selectedAddress: _selectedAddress,
        isActive: _currentIndex == 1,
        onOpenLocationPicker: _openLocationPicker,
        searchFocusRequestId: _productsSearchRequestId,
        categoryScrollRequestId: _productsCategoryScrollRequestId,
        store: _productsCatalogStore,
        cartQuantities: {
          for (final entry in _cartItems.entries)
            entry.key: entry.value.quantity,
        },
        onCartChanged: _updateCart,
      ),
      _CartWithFavoritesTabs(
        items: _cartItems.values.toList(growable: false),
        selectedAddress: _selectedAddress,
        onOpenLocationPicker: _openLocationPicker,
        onQuantityChanged: _updateCartByProductId,
        onBrowseProducts: () => _switchTab(1),
        onCheckout: _openCheckoutReview,
        isCheckingOut: _isCheckingOut,
        cartQuantities: {
          for (final entry in _cartItems.entries)
            entry.key: entry.value.quantity,
        },
        onCartChanged: _updateCart,
        onClearCart: () {
          setState(() {
            _cartItems.clear();
          });
        },
      ),
      _OrdersTab(
        selectedAddress: _selectedAddress,
        onOpenLocationPicker: _openLocationPicker,
        isVisible: _currentIndex == 3,
      ),
      const _ProfileTab(),
    ];

    return Scaffold(
      extendBody: true,
      body: PageView(
        controller: _pageController ??=
            PageController(initialPage: _currentIndex),
        physics: const BouncingScrollPhysics(),
        onPageChanged: (index) {
          if (_isProgrammaticTabChange && _targetTabIndex != index) {
            return;
          }
          if (_currentIndex != index) {
            setState(() {
              _currentIndex = index;
            });
          }
        },
        children: pages,
      ),
      bottomNavigationBar: _HomeBottomNavBar(
        currentIndex: _currentIndex,
        cartItemCount: _cartItemCount,
        cartSubtotal: cartSubtotal,
        onCheckout: _openCheckoutReview,
        isCheckingOut: _isCheckingOut,
        navItems: _navItems,
        onTabSelected: (index) => _switchTab(index),
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.endFloat,
      floatingActionButton: Padding(
        padding: const EdgeInsets.only(bottom: 76),
        child: FloatingActionButton(
          onPressed: _openDotBot,
          tooltip: 'Open DOTBOT',
          backgroundColor: Theme.of(context).colorScheme.primary,
          foregroundColor: Theme.of(context).colorScheme.onPrimary,
          child: const Icon(Icons.smart_toy_rounded),
        ),
      ),
    );
  }
}

class _HomeFeedView extends StatelessWidget {
  const _HomeFeedView({
    required this.selectedAddress,
    required this.onOpenLocationPicker,
    required this.onOpenProductsSearch,
    required this.onOpenProductsCategory,
    required this.store,
  });

  static const Map<String, String> _categoryImageByName = {
    'Vegetables':
        'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80',
    'Rice & Dals':
        'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=1200&q=80',
    'Dairy':
        'https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=1200&q=80',
    'Snacks':
        'https://images.unsplash.com/photo-1599490659213-e2b9527bd087?auto=format&fit=crop&w=1200&q=80',
    'Instant Food':
        'https://images.unsplash.com/photo-1621939514649-280e2ee25f60?auto=format&fit=crop&w=1200&q=80',
    'Meat & Fish':
        'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?auto=format&fit=crop&w=1200&q=80',
    'Personal Care':
        'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?auto=format&fit=crop&w=1200&q=80',
    'Home Care':
        'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=1200&q=80',
    'Utensils':
        'https://images.unsplash.com/photo-1583778176476-4a8b02bfcf4c?auto=format&fit=crop&w=1200&q=80',
  };

  final String selectedAddress;
  final VoidCallback onOpenLocationPicker;
  final VoidCallback onOpenProductsSearch;
  final ValueChanged<String> onOpenProductsCategory;
  final _ProductsCatalogStore store;

  String _categoryImageUrl(String name) {
    final mapped = _categoryImageByName[name];
    if (mapped != null && mapped.isNotEmpty) return mapped;
    final query = Uri.encodeComponent('$name grocery');
    return 'https://source.unsplash.com/1200x800/?$query';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    const compactPadding = 10.0;
    final bottomContentGap = MediaQuery.of(context).padding.bottom + 110;

    return CustomScrollView(
      slivers: [
        SliverAppBar(
          expandedHeight: 0,
          floating: false,
          pinned: true,
          elevation: 0,
          backgroundColor: colorScheme.surface,
          titleSpacing: compactPadding,
          title: HeaderLocationTrigger(
            address: selectedAddress,
            onTap: onOpenLocationPicker,
          ),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.all(compactPadding),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(22),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        colorScheme.primary,
                        colorScheme.primaryContainer,
                      ],
                    ),
                    borderRadius: BorderRadius.circular(
                      AppConstants.largeBorderRadius,
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Get your groceries delivered with BuyZo',
                        style: theme.textTheme.titleLarge?.copyWith(
                          color: colorScheme.onPrimary,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'All your groceries just a click away',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: colorScheme.onPrimary.withOpacity(0.9),
                        ),
                      ),
                      const SizedBox(height: 16),
                      GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: onOpenProductsSearch,
                        child: Container(
                          height: 46,
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          decoration: BoxDecoration(
                            color: colorScheme.onPrimary,
                            border: Border.all(
                              color: Colors.black.withOpacity(0.55),
                              width: 1.1,
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withOpacity(0.2),
                                blurRadius: 18,
                                offset: const Offset(0, 6),
                              ),
                            ],
                            borderRadius: BorderRadius.circular(
                              AppConstants.defaultBorderRadius,
                            ),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                Icons.search_rounded,
                                color: colorScheme.onSurface,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: _AnimatedSearchHint(
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                    color: colorScheme.onSurface.withOpacity(
                                      0.92,
                                    ),
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                              Icon(
                                Icons.arrow_upward_rounded,
                                color: colorScheme.onSurface.withOpacity(0.72),
                                size: 18,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  'Categories',
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                AnimatedBuilder(
                  animation: store,
                  builder: (context, _) {
                    final categories = store.categories
                        .where(
                            (name) => name.trim().isNotEmpty && name != 'All')
                        .toList(growable: false);
                    return _CategoryGridSection(
                      categories: categories,
                      isLoading: store.categoriesLoading,
                      imageUrlForCategory: _categoryImageUrl,
                      onTap: onOpenProductsCategory,
                    );
                  },
                ),
                const SizedBox(height: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Featured Products',
                      style: theme.textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      height: 236,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        children: [
                          _FeaturedProductCard(
                            title: 'Gulab Jamun',
                            price: '\$12.99',
                            imageUrl: '',
                            onTap: () {},
                          ),
                          const SizedBox(width: 10),
                          _FeaturedProductCard(
                            title: 'Samosas (Pack of 6)',
                            price: '\$8.99',
                            imageUrl: '',
                            onTap: () {},
                          ),
                          const SizedBox(width: 10),
                          _FeaturedProductCard(
                            title: 'Masala Chai',
                            price: '\$4.99',
                            imageUrl: '',
                            onTap: () {},
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                SizedBox(height: bottomContentGap),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _HeaderLocationTrigger extends StatelessWidget {
  const _HeaderLocationTrigger({
    required this.address,
    required this.onTap,
  });

  final String address;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Align(
      alignment: Alignment.centerLeft,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 2),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.location_on_rounded,
                color: colorScheme.primary,
                size: 20,
              ),
              const SizedBox(width: 6),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 170),
                child: Text(
                  address,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Icon(
                Icons.keyboard_arrow_down_rounded,
                color: colorScheme.onSurface.withOpacity(0.75),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LocationPickerSheet extends StatefulWidget {
  const _LocationPickerSheet();

  @override
  State<_LocationPickerSheet> createState() => _LocationPickerSheetState();
}

class _LocationPickerSheetState extends State<_LocationPickerSheet> {
  final _manualController = TextEditingController();
  final _labelController = TextEditingController(text: 'Home');
  final _sessionToken = DateTime.now().millisecondsSinceEpoch.toString();
  final List<_PlaceSuggestion> _suggestions = [];
  final List<_SavedAddress> _savedAddresses = [];
  String _selectedLabel = 'Home';

  Timer? _debounce;
  bool _isSearching = false;
  bool _isFetchingCurrentLocation = false;
  bool _isLoadingSavedAddresses = false;

  @override
  void initState() {
    super.initState();
    unawaited(_loadSavedAddresses());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _manualController.dispose();
    _labelController.dispose();
    super.dispose();
  }

  String get _activeLabel {
    final value = _labelController.text.trim();
    if (value.isEmpty) return 'Home';
    return value.length > 30 ? value.substring(0, 30) : value;
  }

  void _onQueryChanged(String value) {
    _debounce?.cancel();

    _debounce = Timer(const Duration(milliseconds: 320), () {
      _searchPlaces(value.trim());
    });
  }

  Future<void> _loadSavedAddresses() async {
    setState(() {
      _isLoadingSavedAddresses = true;
    });
    try {
      final response = await ApiClient.instance.get(
        '/api/addresses',
        authenticated: true,
      );
      if (!mounted) return;
      if (response.statusCode >= 200 && response.statusCode < 300) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        final rows = (data['addresses'] as List<dynamic>? ?? [])
            .whereType<Map<String, dynamic>>()
            .toList(growable: false);
        setState(() {
          _savedAddresses
            ..clear()
            ..addAll(rows.map(_SavedAddress.fromJson));
        });
      }
    } catch (_) {
      // Keep silent here; manual add/search path still works.
    } finally {
      if (!mounted) return;
      setState(() {
        _isLoadingSavedAddresses = false;
      });
    }
  }

  Future<void> _searchPlaces(String query) async {
    if (query.isEmpty) {
      if (!mounted) return;
      setState(() {
        _suggestions.clear();
        _isSearching = false;
      });
      return;
    }

    setState(() {
      _isSearching = true;
    });

    try {
      final response = await ApiClient.instance.post(
        '/api/location/autocomplete',
        headers: {
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'input': query,
          'sessionToken': _sessionToken,
        }),
      );

      if (!mounted) return;

      if (response.statusCode < 200 || response.statusCode >= 300) {
        setState(() {
          _suggestions.clear();
          _isSearching = false;
        });
        return;
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final items = (data['suggestions'] as List<dynamic>? ?? [])
          .map((item) => item as Map<String, dynamic>)
          .map((item) => item['placePrediction'] as Map<String, dynamic>?)
          .whereType<Map<String, dynamic>>()
          .map((prediction) {
            final placeId = prediction['placeId']?.toString() ?? '';
            final structured =
                prediction['structuredFormat'] as Map<String, dynamic>?;
            final main =
                (structured?['mainText'] as Map<String, dynamic>?)?['text']
                        ?.toString() ??
                    '';
            final secondary =
                (structured?['secondaryText'] as Map<String, dynamic>?)?['text']
                        ?.toString() ??
                    '';
            final fallback =
                (prediction['text'] as Map<String, dynamic>?)?['text']
                        ?.toString() ??
                    '';
            final label = main.isNotEmpty ? main : fallback;
            final fullText =
                secondary.isNotEmpty ? '$label, $secondary' : label;
            return _PlaceSuggestion(placeId: placeId, fullText: fullText);
          })
          .where((s) => s.placeId.isNotEmpty && s.fullText.isNotEmpty)
          .toList();

      setState(() {
        _suggestions
          ..clear()
          ..addAll(items);
        _isSearching = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _suggestions.clear();
        _isSearching = false;
      });
    }
  }

  Future<void> _useSuggestion(_PlaceSuggestion suggestion) async {
    try {
      final response = await ApiClient.instance.get(
        '/api/location/place-details',
        queryParameters: {'placeId': suggestion.placeId},
      );

      if (response.statusCode >= 200 && response.statusCode < 300) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        final formatted = data['formattedAddress']?.toString();
        final location = data['location'] as Map<String, dynamic>?;
        final lat = location?['latitude'] is num
            ? (location?['latitude'] as num).toDouble()
            : double.tryParse('${location?['latitude'] ?? ''}');
        final lng = location?['longitude'] is num
            ? (location?['longitude'] as num).toDouble()
            : double.tryParse('${location?['longitude'] ?? ''}');
        Navigator.of(context).pop(
          _ResolvedAddress(
            fullAddress: (formatted ?? suggestion.fullText).trim(),
            lat: lat,
            lng: lng,
            label: _activeLabel,
          ),
        );
      } else {
        Navigator.of(context).pop(
          _ResolvedAddress(
            fullAddress: suggestion.fullText,
            label: _activeLabel,
          ),
        );
      }
    } catch (_) {
      Navigator.of(context).pop(
        _ResolvedAddress(
          fullAddress: suggestion.fullText,
          label: _activeLabel,
        ),
      );
    }
  }

  Future<void> _pickCurrentLocation() async {
    setState(() {
      _isFetchingCurrentLocation = true;
    });

    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        throw Exception('Please enable location services.');
      }

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }

      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        throw Exception('Location permission is required.');
      }

      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );
      final geocodeResponse = await ApiClient.instance.get(
        '/api/location/reverse-geocode',
        queryParameters: {
          'lat': position.latitude.toString(),
          'lng': position.longitude.toString(),
        },
      );
      if (geocodeResponse.statusCode >= 200 &&
          geocodeResponse.statusCode < 300) {
        final data = jsonDecode(geocodeResponse.body) as Map<String, dynamic>;
        final results = data['results'] as List<dynamic>?;
        final address =
            (results != null && results.isNotEmpty && results.first is Map)
                ? (results.first as Map)['formatted_address']?.toString()
                : null;

        if (!mounted) return;
        Navigator.of(context).pop(
          _ResolvedAddress(
            fullAddress: (address ??
                    '${position.latitude.toStringAsFixed(5)}, ${position.longitude.toStringAsFixed(5)}')
                .trim(),
            lat: position.latitude,
            lng: position.longitude,
            label: _activeLabel,
          ),
        );
      } else {
        if (!mounted) return;
        Navigator.of(context).pop(
          _ResolvedAddress(
            fullAddress:
                '${position.latitude.toStringAsFixed(5)}, ${position.longitude.toStringAsFixed(5)}',
            lat: position.latitude,
            lng: position.longitude,
            label: _activeLabel,
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        e.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isFetchingCurrentLocation = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final keyboardInset = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 10, 16, keyboardInset + 16),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: colorScheme.outlineVariant,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Icon(Icons.place_rounded, color: colorScheme.primary),
                  const SizedBox(width: 8),
                  Text(
                    'Select delivery location',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (final option in const ['Home', 'Work', 'Other'])
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text(option),
                          selected: _selectedLabel == option,
                          onSelected: (_) {
                            setState(() {
                              _selectedLabel = option;
                              _labelController.text = option;
                            });
                          },
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _labelController,
                maxLength: 30,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Address nickname',
                  hintText: 'e.g. Mom Home, Flat 402, Office Gate',
                  counterText: '',
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _manualController,
                onChanged: _onQueryChanged,
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  hintText: 'Enter address manually',
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: _manualController.text.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear_rounded),
                          onPressed: () {
                            _manualController.clear();
                            _searchPlaces('');
                          },
                        )
                      : null,
                ),
              ),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: _manualController.text.trim().isEmpty
                      ? null
                      : () {
                          Navigator.of(context).pop(
                            _ResolvedAddress(
                              fullAddress: _manualController.text.trim(),
                              label: _activeLabel,
                            ),
                          );
                        },
                  icon: const Icon(Icons.check_rounded),
                  label: const Text('Use typed address'),
                ),
              ),
              if (_isSearching)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: LinearProgressIndicator(
                    minHeight: 2,
                    color: colorScheme.primary,
                  ),
                ),
              const SizedBox(height: 8),
              if (_suggestions.isNotEmpty)
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 220),
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: _suggestions.length,
                    separatorBuilder: (_, __) => Divider(
                      height: 1,
                      color: colorScheme.outlineVariant,
                    ),
                    itemBuilder: (context, index) {
                      final suggestion = _suggestions[index];
                      return ListTile(
                        dense: true,
                        leading: Icon(
                          Icons.location_on_outlined,
                          color: colorScheme.primary,
                        ),
                        title: Text(
                          suggestion.fullText,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        onTap: () => _useSuggestion(suggestion),
                      );
                    },
                  ),
                ),
              const SizedBox(height: 10),
              if (_isLoadingSavedAddresses)
                const Padding(
                  padding: EdgeInsets.only(bottom: 8),
                  child: LinearProgressIndicator(minHeight: 2),
                ),
              if (_savedAddresses.isNotEmpty)
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 170),
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: _savedAddresses.length,
                    separatorBuilder: (_, __) => Divider(
                      height: 1,
                      color: colorScheme.outlineVariant,
                    ),
                    itemBuilder: (context, index) {
                      final address = _savedAddresses[index];
                      return ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(
                          _iconForAddressLabel(address.label),
                          color: colorScheme.primary,
                        ),
                        title: Text(
                          address.fullAddress,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        subtitle: Text(address.label),
                        trailing: address.isDefault
                            ? const Icon(Icons.check_circle_rounded, size: 18)
                            : null,
                        onTap: () {
                          Navigator.of(context).pop(
                            _ResolvedAddress(
                              addressId: address.id,
                              fullAddress: address.fullAddress,
                              lat: address.lat,
                              lng: address.lng,
                              label: address.label,
                            ),
                          );
                        },
                      );
                    },
                  ),
                ),
              const SizedBox(height: 8),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(
                  Icons.my_location_rounded,
                  color: colorScheme.primary,
                ),
                title: const Text('Use current location'),
                subtitle: const Text('Fastest way to set your address'),
                trailing: _isFetchingCurrentLocation
                    ? SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.2,
                          color: colorScheme.primary,
                        ),
                      )
                    : const Icon(Icons.chevron_right_rounded),
                onTap: _isFetchingCurrentLocation ? null : _pickCurrentLocation,
              ),
              const SizedBox(height: 10),
            ],
          ),
        ),
      ),
    );
  }
}

class _PlaceSuggestion {
  _PlaceSuggestion({required this.placeId, required this.fullText});

  final String placeId;
  final String fullText;
}

class _ResolvedAddress {
  const _ResolvedAddress({
    this.addressId,
    required this.fullAddress,
    this.lat,
    this.lng,
    this.label,
  });

  final int? addressId;
  final String fullAddress;
  final double? lat;
  final double? lng;
  final String? label;
}

class _SavedAddress {
  const _SavedAddress({
    required this.id,
    required this.label,
    required this.fullAddress,
    required this.isDefault,
    this.lat,
    this.lng,
  });

  factory _SavedAddress.fromJson(Map<String, dynamic> json) {
    int _toInt(dynamic value) {
      if (value == null) return 0;
      if (value is int) return value;
      if (value is num) return value.toInt();
      return int.tryParse(value.toString().trim()) ?? 0;
    }

    double? _toDouble(dynamic value) {
      if (value == null) return null;
      if (value is double) return value;
      if (value is num) return value.toDouble();
      return double.tryParse(value.toString().trim());
    }

    return _SavedAddress(
      id: _toInt(json['id']),
      label: (json['label']?.toString().trim().isNotEmpty ?? false)
          ? json['label'].toString().trim()
          : 'Home',
      fullAddress: (json['full_address']?.toString() ?? '').trim(),
      isDefault: json['is_default'] == true,
      lat: _toDouble(json['lat']),
      lng: _toDouble(json['lng']),
    );
  }

  final int id;
  final String label;
  final String fullAddress;
  final bool isDefault;
  final double? lat;
  final double? lng;
}

class _AnimatedSearchHint extends StatefulWidget {
  const _AnimatedSearchHint({required this.style});

  final TextStyle? style;

  @override
  State<_AnimatedSearchHint> createState() => _AnimatedSearchHintState();
}

enum _SearchHintPhase {
  typing,
  hold,
  erasing,
  gap,
}

class _AnimatedSearchHintState extends State<_AnimatedSearchHint> {
  static const List<String> _keywords = [
    'Chilli Powder',
    'Sweets',
    'Dosa Batter',
    'Coriander Powder',
    'Garam Masala',
    'Vegetables',
    'Dairy',
    'Snacks',
    'Toor Dal',
    'Spices',
    'Ghee',
    'Oil',
  ];

  static const Duration _titleHintTickDuration = Duration(milliseconds: 30);
  static const Duration _holdFullTextDuration = Duration(seconds: 3);
  static const Duration _emptyGapDuration = Duration(milliseconds: 240);
  static const int _fadeStopPercent = 88;

  late final int _holdTickCount;
  late final int _gapTickCount;

  int _currentIndex = 0;
  int _visibleRunes = 0;
  int _holdTicksRemaining = 0;
  int _gapTicksRemaining = 0;
  _SearchHintPhase _phase = _SearchHintPhase.typing;
  Timer? _titleHintTimer;

  @override
  void initState() {
    super.initState();
    if (_keywords.isNotEmpty) {
      _currentIndex = DateTime.now().millisecondsSinceEpoch % _keywords.length;
    }
    _holdTickCount = _holdFullTextDuration.inMilliseconds ~/
        _titleHintTickDuration.inMilliseconds;
    _gapTickCount = _emptyGapDuration.inMilliseconds ~/
        _titleHintTickDuration.inMilliseconds;
    _titleHintTimer = Timer.periodic(_titleHintTickDuration, (_) {
      _tickTitleHint();
    });
  }

  void _tickTitleHint() {
    if (!mounted || _keywords.isEmpty) return;
    final keywordRuneCount = _keywords[_currentIndex].runes.length;

    switch (_phase) {
      case _SearchHintPhase.typing:
        if (_visibleRunes < keywordRuneCount) {
          _visibleRunes += 1;
        } else {
          _phase = _SearchHintPhase.hold;
          _holdTicksRemaining = _holdTickCount;
        }
        break;
      case _SearchHintPhase.hold:
        if (_holdTicksRemaining > 0) {
          _holdTicksRemaining -= 1;
        } else {
          _phase = _SearchHintPhase.erasing;
        }
        break;
      case _SearchHintPhase.erasing:
        if (_visibleRunes > 0) {
          _visibleRunes -= 1;
        } else {
          _phase = _SearchHintPhase.gap;
          _gapTicksRemaining = _gapTickCount;
        }
        break;
      case _SearchHintPhase.gap:
        if (_gapTicksRemaining > 0) {
          _gapTicksRemaining -= 1;
        } else {
          _currentIndex = (_currentIndex + 1) % _keywords.length;
          _phase = _SearchHintPhase.typing;
          _visibleRunes = 0;
        }
        break;
    }

    setState(() {});
  }

  String _takeRunes(String input, int runeCount) {
    if (runeCount <= 0) return '';
    final iterator = input.runes.iterator;
    var taken = 0;
    final buffer = StringBuffer();
    while (taken < runeCount && iterator.moveNext()) {
      buffer.writeCharCode(iterator.current);
      taken += 1;
    }
    return buffer.toString();
  }

  Widget _buildMaskedHint(TextStyle? style) {
    final visibleKeyword = _takeRunes(_keywords[_currentIndex], _visibleRunes);
    if (visibleKeyword.isEmpty) return const SizedBox.shrink();

    final baseText = Text(
      '"$visibleKeyword"',
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: style,
    );

    final showGradientMask =
        _phase == _SearchHintPhase.typing || _phase == _SearchHintPhase.erasing;
    if (!showGradientMask) return baseText;

    return ShaderMask(
      shaderCallback: (bounds) => const LinearGradient(
        begin: Alignment.centerLeft,
        end: Alignment.centerRight,
        colors: [Colors.black, Colors.black, Colors.transparent],
        stops: [0.0, _fadeStopPercent / 100, 1.0],
      ).createShader(bounds),
      blendMode: BlendMode.dstIn,
      child: baseText,
    );
  }

  @override
  void dispose() {
    _titleHintTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_keywords.isEmpty) {
      return const SizedBox.shrink();
    }

    return Row(
      children: [
        Text('Search ', style: widget.style),
        Flexible(
          child: AnimatedOpacity(
            duration: const Duration(milliseconds: 90),
            curve: Curves.easeOut,
            opacity: _phase == _SearchHintPhase.gap ? 0 : 1,
            child: _buildMaskedHint(widget.style),
          ),
        ),
      ],
    );
  }
}

class _ProfileTab extends StatefulWidget {
  const _ProfileTab();

  @override
  State<_ProfileTab> createState() => _ProfileTabState();
}

class _ProfileTabState extends State<_ProfileTab> {
  User? get _user => FirebaseAuth.instance.currentUser;
  bool _isUpdatingName = false;
  bool _isEditingName = false;
  bool _isLoadingReferralData = false;
  DateTime? _lastReferralRefreshAttemptAt;
  String? _apiReferralCode;
  int? _apiDeliveryCreditsBalance;
  double? _apiOrderCreditsBalance;
  final TextEditingController _nameEditController = TextEditingController();
  static const String _referralShareBaseUrl =
      'https://share.dotdelivery.com.au/ref';

  Stream<DocumentSnapshot<Map<String, dynamic>>>? get _profileStream {
    final uid = _user?.uid;
    if (uid == null || uid.isEmpty) return null;
    return FirebaseFirestore.instance.collection('users').doc(uid).snapshots();
  }

  @override
  void initState() {
    super.initState();
    unawaited(_loadReferralData());
  }

  @override
  void dispose() {
    _nameEditController.dispose();
    super.dispose();
  }

  Future<void> _loadReferralData() async {
    if (_isLoadingReferralData) return;
    setState(() {
      _isLoadingReferralData = true;
    });
    try {
      final response = await ApiClient.instance.get(
        '/api/users/referral',
        authenticated: true,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return;
      }
      final json = jsonDecode(response.body) as Map<String, dynamic>? ?? {};
      final referral = json['referral'] as Map<String, dynamic>? ?? const {};
      final referralCode =
          (referral['referral_code']?.toString().trim() ?? '').toUpperCase();
      final creditsRaw = referral['delivery_credits_balance'];
      final credits = creditsRaw is num
          ? creditsRaw.toInt()
          : int.tryParse(creditsRaw?.toString() ?? '');
      final orderCreditsRaw = referral['order_credits_available_balance'] ??
          referral['order_credits_balance'];
      final orderCredits = orderCreditsRaw is num
          ? orderCreditsRaw.toDouble()
          : double.tryParse(orderCreditsRaw?.toString() ?? '');
      if (!mounted) return;
      setState(() {
        _apiReferralCode = referralCode.isEmpty ? null : referralCode;
        _apiDeliveryCreditsBalance = credits;
        _apiOrderCreditsBalance = orderCredits;
      });
    } catch (_) {
      // Fall back to Firestore-only profile data when API is unavailable.
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingReferralData = false;
        });
      }
    }
  }

  void _maybeRefreshReferralData() {
    if (_isLoadingReferralData) return;
    final now = DateTime.now().toUtc();
    if (_lastReferralRefreshAttemptAt != null &&
        now.difference(_lastReferralRefreshAttemptAt!) <
            const Duration(seconds: 20)) {
      return;
    }
    _lastReferralRefreshAttemptAt = now;
    unawaited(_loadReferralData());
  }

  String _buildReferralShareUrl(String referralCode) {
    final code = referralCode.trim().toUpperCase();
    if (code.isEmpty) return '';
    return '$_referralShareBaseUrl?code=${Uri.encodeQueryComponent(code)}';
  }

  Future<void> _shareReferralLink(String referralCode) async {
    final link = _buildReferralShareUrl(referralCode);
    if (link.isEmpty) {
      AppSnackBar.show(context, 'Referral code not available yet.');
      return;
    }
    final message =
        'Join BuyZo and get delivery credits.\nUse my invite code: $referralCode\n$link';
    try {
      final box = context.findRenderObject() as RenderBox?;
      final shareOrigin =
          box == null ? null : (box.localToGlobal(Offset.zero) & box.size);
      await Share.share(
        message,
        subject: 'BuyZo Invite',
        sharePositionOrigin: shareOrigin,
      );
    } on MissingPluginException {
      await Clipboard.setData(ClipboardData(text: link));
      if (!mounted) return;
      AppSnackBar.show(
        context,
        'Share plugin unavailable. Restart app and try again. Link copied.',
      );
    } catch (_) {
      await Clipboard.setData(ClipboardData(text: link));
      if (!mounted) return;
      AppSnackBar.show(
          context, 'Could not open share sheet. Invite link copied.');
    }
  }

  Future<void> _logout(BuildContext context) async {
    try {
      await FirebaseAuth.instance.signOut();
      if (!context.mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const LoginPage()),
        (route) => false,
      );
    } catch (_) {
      if (!context.mounted) return;
      AppSnackBar.show(context, 'Failed to logout. Please try again.');
    }
  }

  Future<void> _deleteAccount(BuildContext context) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      if (!context.mounted) return;
      AppSnackBar.show(context, 'No signed-in user found.');
      return;
    }

    try {
      await user.delete();
      if (!context.mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const LoginPage()),
        (route) => false,
      );
    } on FirebaseAuthException catch (e) {
      if (!context.mounted) return;
      final message = e.code == 'requires-recent-login'
          ? 'Please login again, then delete your account.'
          : (e.message ?? 'Failed to delete account.');
      AppSnackBar.show(context, message);
    } catch (_) {
      if (!context.mounted) return;
      AppSnackBar.show(context, 'Failed to delete account.');
    }
  }

  Future<void> _confirmDelete(BuildContext context) async {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final isLightMode = theme.brightness == Brightness.light;

    final shouldDelete = await showDialog<bool>(
      context: context,
      barrierColor: Colors.black.withOpacity(isLightMode ? 0.18 : 0.65),
      builder: (context) => Dialog(
        backgroundColor: Colors.transparent,
        insetPadding: const EdgeInsets.symmetric(horizontal: 24),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(24),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: isLightMode
                      ? [
                          Colors.white.withOpacity(0.72),
                          Colors.white.withOpacity(0.46),
                        ]
                      : [
                          colorScheme.surface.withOpacity(0.32),
                          colorScheme.surface.withOpacity(0.2),
                        ],
                ),
                borderRadius: BorderRadius.circular(24),
                border: Border.all(
                  color: isLightMode
                      ? Colors.white.withOpacity(0.82)
                      : colorScheme.onSurface.withOpacity(0.22),
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(isLightMode ? 0.12 : 0.22),
                    blurRadius: isLightMode ? 30 : 24,
                    offset: const Offset(0, 14),
                  ),
                ],
              ),
              child: Stack(
                children: [
                  if (isLightMode)
                    Positioned(
                      top: -64,
                      left: -24,
                      right: -24,
                      child: Container(
                        height: 150,
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              Colors.white.withOpacity(0.55),
                              Colors.white.withOpacity(0.0),
                            ],
                          ),
                        ),
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 18, 20, 14),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Delete Account?',
                          style: theme.textTheme.titleLarge?.copyWith(
                            fontWeight: FontWeight.w800,
                            color: colorScheme.onSurface,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'This action is permanent and cannot be undone.',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: colorScheme.onSurface.withOpacity(0.92),
                          ),
                        ),
                        const SizedBox(height: 18),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            TextButton(
                              onPressed: () => Navigator.of(context).pop(false),
                              child: const Text('Cancel'),
                            ),
                            const SizedBox(width: 6),
                            TextButton(
                              onPressed: () => Navigator.of(context).pop(true),
                              child: Text(
                                'Delete',
                                style: TextStyle(color: colorScheme.error),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );

    if (shouldDelete == true) {
      await _deleteAccount(context);
    }
  }

  Future<void> _confirmLogout(BuildContext context) async {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final isLightMode = theme.brightness == Brightness.light;

    final shouldLogout = await showDialog<bool>(
      context: context,
      barrierColor: Colors.black.withOpacity(isLightMode ? 0.18 : 0.65),
      builder: (context) => Dialog(
        backgroundColor: Colors.transparent,
        insetPadding: const EdgeInsets.symmetric(horizontal: 24),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(24),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: isLightMode
                      ? [
                          Colors.white.withOpacity(0.72),
                          Colors.white.withOpacity(0.46),
                        ]
                      : [
                          colorScheme.surface.withOpacity(0.32),
                          colorScheme.surface.withOpacity(0.2),
                        ],
                ),
                borderRadius: BorderRadius.circular(24),
                border: Border.all(
                  color: isLightMode
                      ? Colors.white.withOpacity(0.82)
                      : colorScheme.onSurface.withOpacity(0.22),
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(isLightMode ? 0.12 : 0.22),
                    blurRadius: isLightMode ? 30 : 24,
                    offset: const Offset(0, 14),
                  ),
                ],
              ),
              child: Stack(
                children: [
                  if (isLightMode)
                    Positioned(
                      top: -64,
                      left: -24,
                      right: -24,
                      child: Container(
                        height: 150,
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              Colors.white.withOpacity(0.55),
                              Colors.white.withOpacity(0.0),
                            ],
                          ),
                        ),
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 18, 20, 14),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Logout?',
                          style: theme.textTheme.titleLarge?.copyWith(
                            fontWeight: FontWeight.w800,
                            color: colorScheme.onSurface,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Are you sure you want to logout?',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: colorScheme.onSurface.withOpacity(0.92),
                          ),
                        ),
                        const SizedBox(height: 18),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            TextButton(
                              onPressed: () => Navigator.of(context).pop(false),
                              child: const Text('Cancel'),
                            ),
                            const SizedBox(width: 6),
                            TextButton(
                              onPressed: () => Navigator.of(context).pop(true),
                              child: const Text('Logout'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );

    if (shouldLogout == true) {
      await _logout(context);
    }
  }

  String _themeModeLabel(ThemeMode mode) {
    switch (mode) {
      case ThemeMode.system:
        return 'System';
      case ThemeMode.light:
        return 'Light';
      case ThemeMode.dark:
        return 'Dark';
    }
  }

  Future<void> _openThemeSettings(BuildContext context) async {
    final notifier = ThemeProvider.themeNotifier(context);
    if (notifier == null) {
      AppSnackBar.show(context, 'Theme settings unavailable right now.');
      return;
    }

    final currentMode = notifier.themeMode;
    final selected = await showModalBottomSheet<ThemeMode>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) {
        final theme = Theme.of(sheetContext);
        return FractionallySizedBox(
          heightFactor: 0.7,
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(0, 12, 0, 0),
              child: Column(
                children: [
                  ListTile(
                    title: Text(
                      'Theme',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    subtitle:
                        const Text('Choose how BuyZo looks on this device'),
                  ),
                  RadioListTile<ThemeMode>(
                    value: ThemeMode.system,
                    groupValue: currentMode,
                    title: const Text('System'),
                    subtitle: const Text('Follow device appearance'),
                    onChanged: (value) => Navigator.of(sheetContext).pop(value),
                  ),
                  RadioListTile<ThemeMode>(
                    value: ThemeMode.light,
                    groupValue: currentMode,
                    title: const Text('Light'),
                    onChanged: (value) => Navigator.of(sheetContext).pop(value),
                  ),
                  RadioListTile<ThemeMode>(
                    value: ThemeMode.dark,
                    groupValue: currentMode,
                    title: const Text('Dark'),
                    onChanged: (value) => Navigator.of(sheetContext).pop(value),
                  ),
                  const Spacer(),
                ],
              ),
            ),
          ),
        );
      },
    );
    if (selected == null || selected == currentMode) return;
    notifier.setThemeMode(selected);
    if (!mounted) return;
    setState(() {});
    AppSnackBar.show(context, 'Theme set to ${_themeModeLabel(selected)}');
  }

  void _startNameEdit({
    required String currentName,
    required String fallbackName,
  }) {
    if (_isUpdatingName) return;
    _nameEditController
      ..text = currentName == fallbackName ? '' : currentName
      ..selection = TextSelection.fromPosition(
        TextPosition(offset: _nameEditController.text.length),
      );
    setState(() {
      _isEditingName = true;
    });
  }

  Future<void> _saveEditedName() async {
    if (_isUpdatingName) return;
    final user = _user;
    if (user == null) {
      AppSnackBar.show(context, 'No signed-in user found.');
      return;
    }

    final nextName =
        _nameEditController.text.trim().replaceAll(RegExp(r'\s+'), ' ');
    if (nextName.isEmpty) {
      AppSnackBar.show(context, 'Name is required.');
      return;
    }

    setState(() {
      _isUpdatingName = true;
    });

    try {
      await FirebaseFirestore.instance.collection('users').doc(user.uid).set({
        'name': nextName,
        'display_name': nextName,
      }, SetOptions(merge: true));
      await user.updateDisplayName(nextName);
      await user.reload();

      if (!mounted) return;
      AppSnackBar.show(context, 'Name updated successfully.');
      setState(() {
        _isEditingName = false;
      });
    } on FirebaseException catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        (error.message ?? 'Failed to update name.').trim(),
      );
    } catch (_) {
      if (!mounted) return;
      AppSnackBar.show(context, 'Failed to update name.');
    } finally {
      if (mounted) {
        setState(() {
          _isUpdatingName = false;
        });
      }
    }
  }

  Widget _actionTile(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
    Color? iconColor,
  }) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
        leading: Icon(icon, color: iconColor ?? colorScheme.primary),
        title: Text(
          title,
          style:
              theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(subtitle),
        trailing: Icon(
          Icons.chevron_right_rounded,
          color: colorScheme.onSurface.withOpacity(0.72),
        ),
        onTap: onTap,
      ),
    );
  }

  String _initialsFromName(String name) {
    final parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList(growable: false);
    if (parts.isEmpty) return 'U';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    _maybeRefreshReferralData();
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final themeNotifier = ThemeProvider.themeNotifier(context);
    final currentThemeMode = themeNotifier?.themeMode ?? ThemeMode.system;
    final user = _user;
    const fallbackName = 'Name not set';
    final fallbackPhone = (user?.phoneNumber ?? '').trim().isNotEmpty
        ? user!.phoneNumber!.trim()
        : 'Not available';

    final stream = _profileStream;
    return SafeArea(
      child: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        stream: stream,
        builder: (context, snapshot) {
          final data = snapshot.data?.data();
          final firestoreName =
              (data?['name']?.toString().trim().isNotEmpty ?? false)
                  ? data!['name'].toString().trim()
                  : (data?['display_name']?.toString().trim() ?? '');
          final name =
              (firestoreName.isNotEmpty && firestoreName != 'BuyZo User')
              ? firestoreName
              : fallbackName;
          final firestorePhone =
              (data?['phone']?.toString().trim().isNotEmpty ?? false)
                  ? data!['phone'].toString().trim()
                  : (data?['phone_number']?.toString().trim() ?? '');
          final phone =
              firestorePhone.isNotEmpty ? firestorePhone : fallbackPhone;
          final initials = _initialsFromName(name);
          final creditBalanceRaw = data?['delivery_credits_balance'];
          final firestoreDeliveryCreditsBalance = creditBalanceRaw is num
              ? creditBalanceRaw.toInt()
              : int.tryParse(creditBalanceRaw?.toString() ?? '') ?? 0;
          final firestoreReferralCode =
              (data?['referral_code']?.toString().trim() ?? '').toUpperCase();
          final referralCode = firestoreReferralCode.isNotEmpty
              ? firestoreReferralCode
              : (_apiReferralCode ?? '');
          final orderCreditBalanceRaw =
              data?['order_credits_available_balance'] ??
                  data?['order_credits_balance'];
          final firestoreOrderCreditsBalance = orderCreditBalanceRaw is num
              ? orderCreditBalanceRaw.toDouble()
              : double.tryParse(orderCreditBalanceRaw?.toString() ?? '') ?? 0;
          final deliveryCreditsBalance = creditBalanceRaw != null
              ? firestoreDeliveryCreditsBalance
              : (_apiDeliveryCreditsBalance ?? 0);
          final orderCreditsBalance = _apiOrderCreditsBalance ??
              (orderCreditBalanceRaw != null
                  ? firestoreOrderCreditsBalance
                  : 0);

          return ListView(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 92),
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      'My Account',
                      style: theme.textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert_rounded),
                    onSelected: (value) {
                      if (value == 'delete') {
                        _confirmDelete(context);
                      }
                    },
                    itemBuilder: (context) => const [
                      PopupMenuItem<String>(
                        value: 'delete',
                        child: Text('Delete Account'),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      colorScheme.primary,
                      colorScheme.primaryContainer,
                    ],
                  ),
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: [
                    BoxShadow(
                      color: colorScheme.primary.withOpacity(0.28),
                      blurRadius: 22,
                      offset: const Offset(0, 10),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        CircleAvatar(
                          radius: 38,
                          backgroundColor:
                              colorScheme.onPrimary.withOpacity(0.18),
                          child: Text(
                            initials,
                            style: theme.textTheme.titleLarge?.copyWith(
                              color: colorScheme.onPrimary,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: _isEditingName
                                        ? TextField(
                                            controller: _nameEditController,
                                            autofocus: true,
                                            textInputAction:
                                                TextInputAction.done,
                                            textCapitalization:
                                                TextCapitalization.words,
                                            maxLength: 60,
                                            onSubmitted: (_) {
                                              _saveEditedName();
                                            },
                                            style: theme.textTheme.titleLarge
                                                ?.copyWith(
                                              color: colorScheme.onPrimary,
                                              fontWeight: FontWeight.w800,
                                            ),
                                            cursorColor: colorScheme.onPrimary,
                                            decoration: InputDecoration(
                                              counterText: '',
                                              isDense: true,
                                              isCollapsed: true,
                                              contentPadding: EdgeInsets.zero,
                                              hintText: 'Enter your name',
                                              hintStyle: theme
                                                  .textTheme.titleMedium
                                                  ?.copyWith(
                                                color: colorScheme.onPrimary
                                                    .withOpacity(0.72),
                                              ),
                                              filled: false,
                                              fillColor: Colors.transparent,
                                              border: InputBorder.none,
                                              enabledBorder: InputBorder.none,
                                              focusedBorder: InputBorder.none,
                                              disabledBorder: InputBorder.none,
                                            ),
                                          )
                                        : Text(
                                            name,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: theme.textTheme.titleLarge
                                                ?.copyWith(
                                              color: colorScheme.onPrimary,
                                              fontWeight: FontWeight.w800,
                                            ),
                                          ),
                                  ),
                                  const SizedBox(width: 4),
                                  if (_isEditingName) ...[
                                    IconButton(
                                      tooltip: 'Save name',
                                      onPressed: _isUpdatingName
                                          ? null
                                          : _saveEditedName,
                                      splashRadius: 18,
                                      visualDensity: VisualDensity.compact,
                                      icon: _isUpdatingName
                                          ? SizedBox(
                                              width: 16,
                                              height: 16,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                                valueColor:
                                                    AlwaysStoppedAnimation<
                                                        Color>(
                                                  colorScheme.onPrimary,
                                                ),
                                              ),
                                            )
                                          : Icon(
                                              Icons.check_rounded,
                                              color: colorScheme.onPrimary
                                                  .withOpacity(0.95),
                                            ),
                                    ),
                                    IconButton(
                                      tooltip: 'Cancel',
                                      onPressed: _isUpdatingName
                                          ? null
                                          : () {
                                              setState(() {
                                                _isEditingName = false;
                                              });
                                            },
                                      splashRadius: 18,
                                      visualDensity: VisualDensity.compact,
                                      icon: Icon(
                                        Icons.close_rounded,
                                        color: colorScheme.onPrimary
                                            .withOpacity(0.95),
                                      ),
                                    ),
                                  ] else
                                    IconButton(
                                      tooltip: 'Edit name',
                                      onPressed: _isUpdatingName
                                          ? null
                                          : () {
                                              _startNameEdit(
                                                currentName: name,
                                                fallbackName: fallbackName,
                                              );
                                            },
                                      splashRadius: 18,
                                      visualDensity: VisualDensity.compact,
                                      icon: Icon(
                                        Icons.edit_rounded,
                                        color: colorScheme.onPrimary
                                            .withOpacity(0.95),
                                      ),
                                    ),
                                ],
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'Signed in with phone',
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: colorScheme.onPrimary.withOpacity(0.9),
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                phone,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: colorScheme.onPrimary.withOpacity(0.9),
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'Status: Verified',
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: colorScheme.onPrimary.withOpacity(0.9),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: colorScheme.surface,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: colorScheme.outlineVariant.withOpacity(0.45),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 34,
                          height: 34,
                          decoration: BoxDecoration(
                            color: colorScheme.secondaryContainer
                                .withOpacity(0.24),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Icon(
                            Icons.local_shipping_rounded,
                            color: colorScheme.primary,
                            size: 20,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'Delivery Credits',
                            style: theme.textTheme.titleLarge?.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        if (referralCode.isNotEmpty)
                          OutlinedButton.icon(
                            onPressed: () => _shareReferralLink(referralCode),
                            icon: const Icon(Icons.share_rounded, size: 14),
                            label: const Text('Share Invite'),
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 8,
                              ),
                              textStyle: theme.textTheme.labelMedium?.copyWith(
                                fontWeight: FontWeight.w700,
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(10),
                              ),
                              visualDensity: VisualDensity.compact,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: BackdropFilter(
                              filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 10,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.white.withOpacity(0.22),
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(
                                    color: Colors.white.withOpacity(0.44),
                                  ),
                                  boxShadow: [
                                    BoxShadow(
                                      color: Colors.black.withOpacity(0.05),
                                      blurRadius: 10,
                                      offset: const Offset(0, 4),
                                    ),
                                  ],
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'Free Delivery',
                                      style:
                                          theme.textTheme.labelMedium?.copyWith(
                                        fontWeight: FontWeight.w700,
                                        color: colorScheme.onSurface
                                            .withOpacity(0.72),
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      '$deliveryCreditsBalance',
                                      style:
                                          theme.textTheme.titleLarge?.copyWith(
                                        fontWeight: FontWeight.w600,
                                        color: colorScheme.primary,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: BackdropFilter(
                              filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 10,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.white.withOpacity(0.22),
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(
                                    color: Colors.white.withOpacity(0.44),
                                  ),
                                  boxShadow: [
                                    BoxShadow(
                                      color: Colors.black.withOpacity(0.05),
                                      blurRadius: 10,
                                      offset: const Offset(0, 4),
                                    ),
                                  ],
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'Credits Balance',
                                      style:
                                          theme.textTheme.labelMedium?.copyWith(
                                        fontWeight: FontWeight.w700,
                                        color: colorScheme.onSurface
                                            .withOpacity(0.72),
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      '\$${orderCreditsBalance.toStringAsFixed(2)}',
                                      style:
                                          theme.textTheme.titleLarge?.copyWith(
                                        fontWeight: FontWeight.w600,
                                        color: colorScheme.primary,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (referralCode.isEmpty) ...[
                      const SizedBox(height: 12),
                      Text(
                        _isLoadingReferralData
                            ? 'Loading invite code...'
                            : 'Invite code not loaded. Tap refresh.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: colorScheme.onSurface.withOpacity(0.78),
                        ),
                      ),
                      const SizedBox(height: 8),
                      OutlinedButton.icon(
                        onPressed:
                            _isLoadingReferralData ? null : _loadReferralData,
                        icon: _isLoadingReferralData
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.refresh_rounded, size: 16),
                        label: Text(
                          _isLoadingReferralData
                              ? 'Loading...'
                              : 'Refresh Invite Code',
                        ),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 12,
                          ),
                          textStyle: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 14),
              Text(
                'Account Actions',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 10),
              _actionTile(
                context,
                icon: Icons.palette_rounded,
                title: 'Theme',
                subtitle: _themeModeLabel(currentThemeMode),
                onTap: () => _openThemeSettings(context),
              ),
              _actionTile(
                context,
                icon: Icons.location_on_rounded,
                title: 'Address Book',
                subtitle: 'Manage saved addresses with custom nicknames',
                onTap: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const _AddressBookPage(),
                    ),
                  );
                },
              ),
              _actionTile(
                context,
                icon: Icons.logout_rounded,
                title: 'Logout',
                subtitle: 'Sign out from this device',
                onTap: () => _confirmLogout(context),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _AddressBookPage extends StatefulWidget {
  const _AddressBookPage();

  @override
  State<_AddressBookPage> createState() => _AddressBookPageState();
}

class _AddressBookPageState extends State<_AddressBookPage> {
  bool _isLoading = true;
  String? _error;
  List<_SavedAddress> _addresses = const [];

  @override
  void initState() {
    super.initState();
    unawaited(_loadAddresses());
  }

  Future<void> _loadAddresses() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final response = await ApiClient.instance.get(
        '/api/addresses',
        authenticated: true,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('Failed to load addresses (${response.statusCode})');
      }
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final rows = (data['addresses'] as List<dynamic>? ?? [])
          .whereType<Map<String, dynamic>>()
          .toList(growable: false);
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _addresses = rows.map(_SavedAddress.fromJson).toList(growable: false);
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _addAddress() async {
    final picked = await showModalBottomSheet<_ResolvedAddress>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => FractionallySizedBox(
        heightFactor: 0.8,
        child: const _LocationPickerSheet(),
      ),
    );
    if (!mounted || picked == null || picked.fullAddress.trim().isEmpty) return;

    try {
      final response = await ApiClient.instance.post(
        '/api/addresses',
        authenticated: true,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'label': picked.label ?? 'Other',
          'full_address': picked.fullAddress.trim(),
          'lat': picked.lat,
          'lng': picked.lng,
          'is_default': _addresses.isEmpty,
        }),
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('Failed to add address (${response.statusCode})');
      }
      await _loadAddresses();
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', ''),
      );
    }
  }

  Future<void> _editAddress(_SavedAddress address) async {
    final edit = await showModalBottomSheet<_AddressEditInput>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _AddressEditSheet(
        initialLabel: address.label,
        initialAddress: address.fullAddress,
      ),
    );
    if (!mounted || edit == null) return;

    try {
      final response = await ApiClient.instance.patch(
        '/api/addresses/${address.id}',
        authenticated: true,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'label': edit.label,
          'full_address': edit.fullAddress.trim(),
        }),
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('Failed to update address (${response.statusCode})');
      }
      await _loadAddresses();
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', ''),
      );
    }
  }

  Future<void> _setDefault(_SavedAddress address) async {
    try {
      final response = await ApiClient.instance.patch(
        '/api/addresses/${address.id}/default',
        authenticated: true,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
            'Failed to set default address (${response.statusCode})');
      }
      await _loadAddresses();
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', ''),
      );
    }
  }

  Future<void> _deleteAddress(_SavedAddress address) async {
    final shouldDelete = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete address?'),
        content: Text(address.fullAddress),
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
    if (shouldDelete != true || !mounted) return;

    try {
      final response = await ApiClient.instance.delete(
        '/api/addresses/${address.id}',
        authenticated: true,
      );
      if (response.statusCode == 409) {
        final data = jsonDecode(response.body) as Map<String, dynamic>? ?? {};
        throw Exception(data['message']?.toString() ??
            'Address cannot be deleted right now');
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('Failed to delete address (${response.statusCode})');
      }
      await _loadAddresses();
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', ''),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Address Book'),
        actions: [
          IconButton(
            onPressed: _addAddress,
            icon: const Icon(Icons.add_location_alt_rounded),
            tooltip: 'Add address',
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadAddresses,
        child: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? ListView(
                    children: [
                      const SizedBox(height: 80),
                      Center(child: Text(_error!)),
                      const SizedBox(height: 8),
                      Center(
                        child: FilledButton(
                          onPressed: _loadAddresses,
                          child: const Text('Retry'),
                        ),
                      ),
                    ],
                  )
                : _addresses.isEmpty
                    ? ListView(
                        padding: const EdgeInsets.all(24),
                        children: [
                          const SizedBox(height: 80),
                          const Icon(Icons.location_off_rounded, size: 44),
                          const SizedBox(height: 10),
                          Text(
                            'No saved addresses yet',
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            'Add addresses with nicknames for quick checkout.',
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 16),
                          Center(
                            child: FilledButton(
                              onPressed: _addAddress,
                              child: const Text('Add Address'),
                            ),
                          ),
                        ],
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 18),
                        itemCount: _addresses.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (context, index) {
                          final address = _addresses[index];
                          return Container(
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(
                                color: Theme.of(context)
                                    .colorScheme
                                    .outlineVariant
                                    .withOpacity(0.5),
                              ),
                            ),
                            child: ListTile(
                              leading: Icon(
                                _iconForAddressLabel(address.label),
                              ),
                              title: Text(
                                address.fullAddress,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              subtitle: Text(address.label),
                              trailing: PopupMenuButton<String>(
                                onSelected: (value) {
                                  if (value == 'default') {
                                    _setDefault(address);
                                  } else if (value == 'edit') {
                                    _editAddress(address);
                                  } else if (value == 'delete') {
                                    _deleteAddress(address);
                                  }
                                },
                                itemBuilder: (_) => [
                                  if (!address.isDefault)
                                    const PopupMenuItem(
                                      value: 'default',
                                      child: Text('Set as default'),
                                    ),
                                  const PopupMenuItem(
                                    value: 'edit',
                                    child: Text('Edit'),
                                  ),
                                  const PopupMenuItem(
                                    value: 'delete',
                                    child: Text('Delete'),
                                  ),
                                ],
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    if (address.isDefault)
                                      const Padding(
                                        padding: EdgeInsets.only(right: 6),
                                        child: Icon(
                                          Icons.check_circle_rounded,
                                          size: 18,
                                        ),
                                      ),
                                    const Icon(Icons.more_vert_rounded),
                                  ],
                                ),
                              ),
                            ),
                          );
                        },
                      ),
      ),
    );
  }
}

class _AddressEditInput {
  const _AddressEditInput({
    required this.label,
    required this.fullAddress,
  });

  final String label;
  final String fullAddress;
}

class _AddressEditSheet extends StatefulWidget {
  const _AddressEditSheet({
    required this.initialLabel,
    required this.initialAddress,
  });

  final String initialLabel;
  final String initialAddress;

  @override
  State<_AddressEditSheet> createState() => _AddressEditSheetState();
}

class _AddressEditSheetState extends State<_AddressEditSheet> {
  late final TextEditingController _addressController;
  late final TextEditingController _labelController;
  late String _label;

  @override
  void initState() {
    super.initState();
    _addressController = TextEditingController(text: widget.initialAddress);
    _label = widget.initialLabel;
    _labelController = TextEditingController(text: widget.initialLabel);
  }

  @override
  void dispose() {
    _addressController.dispose();
    _labelController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final keyboardInset = MediaQuery.of(context).viewInsets.bottom;
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 12, 16, keyboardInset + 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Edit Address',
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 12),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final option in const ['Home', 'Work', 'Other'])
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(option),
                        selected: _label == option,
                        onSelected: (_) {
                          setState(() {
                            _label = option;
                            _labelController.text = option;
                          });
                        },
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _labelController,
              maxLength: 30,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Address nickname',
                hintText: 'e.g. Parent House, Hostel, Office',
                counterText: '',
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _addressController,
              minLines: 2,
              maxLines: 3,
              decoration: const InputDecoration(
                hintText: 'Full address',
              ),
            ),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(
                onPressed: () {
                  final fullAddress = _addressController.text.trim();
                  final normalizedLabel = _labelController.text.trim();
                  final finalLabel = normalizedLabel.isEmpty
                      ? 'Home'
                      : (normalizedLabel.length > 30
                          ? normalizedLabel.substring(0, 30)
                          : normalizedLabel);
                  if (fullAddress.isEmpty) return;
                  Navigator.of(context).pop(
                    _AddressEditInput(
                      label: finalLabel,
                      fullAddress: fullAddress,
                    ),
                  );
                },
                child: const Text('Save'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

IconData _iconForAddressLabel(String label) {
  final normalized = label.trim().toLowerCase();
  if (normalized == 'work' || normalized.contains('office')) {
    return Icons.work_outline_rounded;
  }
  if (normalized == 'other') {
    return Icons.place_outlined;
  }
  if (normalized == 'home' || normalized.contains('house')) {
    return Icons.home_outlined;
  }
  return Icons.bookmark_outline_rounded;
}

class _CategoryCard extends StatelessWidget {
  const _CategoryCard({
    required this.title,
    required this.imageUrl,
    required this.onTap,
  });

  final String title;
  final String imageUrl;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final normalizedUrl = imageUrl.trim();
    final placeholder = _CategoryCardImagePlaceholder(
      title: title,
    );

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (normalizedUrl.isEmpty)
              placeholder
            else
              Image.network(
                normalizedUrl,
                fit: BoxFit.cover,
                loadingBuilder: (context, child, loadingProgress) {
                  if (loadingProgress == null) return child;
                  return placeholder;
                },
                errorBuilder: (context, error, stackTrace) => placeholder,
              ),
            Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.transparent,
                    Color(0xAA000000),
                  ],
                ),
              ),
            ),
            Align(
              alignment: Alignment.bottomLeft,
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CategoryCardImagePlaceholder extends StatelessWidget {
  const _CategoryCardImagePlaceholder({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            colorScheme.surfaceContainerHighest,
            colorScheme.surfaceContainer,
          ],
        ),
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          Positioned(
            right: -12,
            top: -12,
            child: Icon(
              Icons.image_outlined,
              size: 48,
              color: colorScheme.onSurface.withOpacity(0.12),
            ),
          ),
          Positioned(
            left: -16,
            bottom: -18,
            child: Icon(
              Icons.category_rounded,
              size: 56,
              color: colorScheme.onSurface.withOpacity(0.1),
            ),
          ),
        ],
      ),
    );
  }
}

class _CategoryGridSection extends StatelessWidget {
  const _CategoryGridSection({
    required this.categories,
    required this.isLoading,
    required this.imageUrlForCategory,
    required this.onTap,
  });

  final List<String> categories;
  final bool isLoading;
  final String Function(String name) imageUrlForCategory;
  final ValueChanged<String> onTap;

  static const int _crossAxisCount = 3;
  static const double _crossAxisSpacing = 10;
  static const double _mainAxisSpacing = 10;
  static const double _childAspectRatio = 0.95;
  static const int _skeletonCount = 9;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final showSkeleton = isLoading && categories.isEmpty;
    final itemCount = showSkeleton ? _skeletonCount : categories.length;
    final rowCount =
        itemCount == 0 ? 1 : ((itemCount - 1) ~/ _crossAxisCount) + 1;

    return LayoutBuilder(
      builder: (context, constraints) {
        final itemWidth = (constraints.maxWidth -
                ((_crossAxisCount - 1) * _crossAxisSpacing)) /
            _crossAxisCount;
        final itemHeight = itemWidth / _childAspectRatio;
        final gridHeight =
            (rowCount * itemHeight) + ((rowCount - 1) * _mainAxisSpacing);
        final safeGridHeight = gridHeight.ceilToDouble();

        final children = List<Widget>.generate(itemCount, (index) {
          if (showSkeleton) {
            return SizedBox(
              width: itemWidth,
              height: itemHeight,
              child: const _CategoryCardSkeleton(),
            );
          }
          final categoryName = categories[index];
          return SizedBox(
            width: itemWidth,
            height: itemHeight,
            child: _CategoryCard(
              title: categoryName,
              imageUrl: imageUrlForCategory(categoryName),
              onTap: () => onTap(categoryName),
            ),
          );
        });

        return SizedBox(
          height: safeGridHeight,
          child: Stack(
            children: [
              Wrap(
                spacing: _crossAxisSpacing,
                runSpacing: _mainAxisSpacing,
                children: children,
              ),
              if (!showSkeleton && categories.isEmpty)
                Center(
                  child: Text(
                    'No categories available',
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _CategoryCardSkeleton extends StatelessWidget {
  const _CategoryCardSkeleton();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final baseColor = isDark
        ? Colors.white.withOpacity(0.08)
        : Colors.black.withOpacity(0.08);
    final highlightColor =
        isDark ? Colors.white.withOpacity(0.2) : Colors.white.withOpacity(0.85);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Shimmer.fromColors(
        baseColor: baseColor,
        highlightColor: highlightColor,
        period: const Duration(milliseconds: 1000),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Container(color: Colors.white),
            Align(
              alignment: Alignment.bottomLeft,
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Container(
                  height: 12,
                  width: 62,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FeaturedProductCard extends StatelessWidget {
  const _FeaturedProductCard({
    required this.title,
    required this.price,
    required this.imageUrl,
    required this.onTap,
  });

  final String title;
  final String price;
  final String imageUrl;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          width: 176,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: double.infinity,
                height: 118,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      colorScheme.primaryContainer,
                      colorScheme.primaryContainer.withOpacity(0.5),
                    ],
                  ),
                ),
                child: Icon(
                  Icons.image,
                  size: 46,
                  color: colorScheme.onPrimaryContainer.withOpacity(0.5),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      price,
                      style: theme.textTheme.titleSmall?.copyWith(
                        color: colorScheme.primary,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
