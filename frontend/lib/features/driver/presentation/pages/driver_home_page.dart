import 'dart:async';
import 'dart:convert';
import 'dart:ui';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/constants/app_constants.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/theme_provider.dart';
import '../../../../core/ui/app_snack_bar.dart';
import '../../../../shared/widgets/location_picker_sheet.dart';
import '../../../auth/presentation/pages/login_page.dart';

class DriverHomePage extends StatefulWidget {
  const DriverHomePage({super.key});

  @override
  State<DriverHomePage> createState() => _DriverHomePageState();
}

class _DriverHomePageState extends State<DriverHomePage> {
  static const int _ordersPageSize = 20;
  int _currentIndex = 0;
  bool _isLoading = true;
  bool _isMutating = false;
  bool _isSortingAvailableByDistance = false;
  bool _isLoadingMoreAvailable = false;
  bool _isLoadingMoreAssigned = false;
  bool _isLoadingMoreExecuted = false;
  bool _availableSortedByNearest = false;
  bool _availableHasMore = false;
  bool _assignedHasMore = false;
  bool _executedHasMore = false;
  String? _availableNextCursor;
  String? _assignedNextCursor;
  String? _executedNextCursor;
  String? _error;
  String _selectedAddress = 'Set delivery location';
  double? _selectedAddressLat;
  double? _selectedAddressLng;
  String _driverPhone = '';
  String _driverName = '';
  List<DriverOrderSummary> _availableOrders = const [];
  List<DriverOrderSummary> _assignedOrders = const [];
  List<DriverOrderSummary> _executedOrders = const [];
  final Map<int, int> _availableNearestRankByOrderId = <int, int>{};
  final List<int> _manualAssignedOrderIds = <int>[];
  bool _hasManualAssignedOrder = false;
  final Set<int> _selectedAvailableOrderIds = <int>{};
  final Set<int> _assigningOrderIds = <int>{};
  bool _isAssigningSelectedAvailable = false;
  int _homeOrdersSegmentIndex = 0;
  final PageController _pageController = PageController();
  StreamSubscription<User?>? _authStateSub;
  bool _redirectingToLogin = false;

  static const List<({IconData icon, String label})> _navItems = [
    (icon: Icons.delivery_dining_rounded, label: 'Home'),
    (icon: Icons.assignment_turned_in_rounded, label: 'Executed'),
    (icon: Icons.person_rounded, label: 'Profile'),
  ];

  @override
  void initState() {
    super.initState();
    _authStateSub = FirebaseAuth.instance.authStateChanges().listen((user) {
      if (user != null || !mounted) return;
      _redirectToLogin();
    });
    unawaited(_loadDefaultAddress());
    _refreshAll();
  }

  @override
  void dispose() {
    _authStateSub?.cancel();
    _pageController.dispose();
    super.dispose();
  }

  void _redirectToLogin() {
    if (!mounted || _redirectingToLogin) return;
    _redirectingToLogin = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final navigator = Navigator.maybeOf(context);
      if (navigator == null) return;
      navigator.pushAndRemoveUntil(
        MaterialPageRoute(
          builder: (_) => const LoginPage(
            successRoute: '/driver-home',
            requiredRole: 'driver',
          ),
        ),
        (route) => false,
      );
    });
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
          builder: (_) => const FractionallySizedBox(
            heightFactor: 0.8,
            child: LocationPickerSheet(),
          ),
        );
      }
    } catch (_) {
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
        final nextAddress =
            (address['full_address']?.toString().trim().isNotEmpty ?? false)
                ? address['full_address'].toString().trim()
                : 'Set delivery location';
        final nextLat = _asNullableDouble(address['lat']);
        final nextLng = _asNullableDouble(address['lng']);
        final sortedAvailable = _sortAvailableByNearestIfPossible(
          _availableOrders,
          originLat: nextLat,
          originLng: nextLng,
        );
        setState(() {
          _selectedAddress = nextAddress;
          _selectedAddressLat = nextLat;
          _selectedAddressLng = nextLng;
          _availableOrders = sortedAvailable.orders;
          _availableSortedByNearest = sortedAvailable.sorted;
          _syncAvailableNearestRank(sortedAvailable.orders);
          _assignedOrders = _applyAssignedOrderPreference(_assignedOrders);
          _syncManualAssignedOrderIds(_assignedOrders);
        });
        return;
      }

      if (response.statusCode == 404) {
        setState(() {
          _selectedAddress = 'Set delivery location';
          _selectedAddressLat = null;
          _selectedAddressLng = null;
        });
      }
    } catch (_) {
      // Keep fallback label.
    }
  }

  Future<void> _saveAddress(ResolvedAddress pickedAddress) async {
    try {
      final previousAddress = _selectedAddress;
      final previousLat = _selectedAddressLat;
      final previousLng = _selectedAddressLng;
      Map<String, dynamic>? savedAddress;
      double? nextLat = pickedAddress.lat;
      double? nextLng = pickedAddress.lng;

      if (nextLat == null || nextLng == null) {
        final resolved = await _resolveCoordinatesFromAddressText(
          pickedAddress.fullAddress,
        );
        nextLat ??= resolved.lat;
        nextLng ??= resolved.lng;
      }

      // Only existing saved addresses are persisted here by setting default.
      // Current location / typed / searched picks are session-only selections.
      if (pickedAddress.addressId != null) {
        final response = await ApiClient.instance.patch(
          '/api/addresses/${pickedAddress.addressId}/default',
          authenticated: true,
        );
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw Exception('Failed to save address (${response.statusCode})');
        }
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        savedAddress = data['address'] as Map<String, dynamic>? ?? const {};
      }

      final nextAddress =
          (savedAddress?['full_address']?.toString().trim().isNotEmpty ?? false)
              ? savedAddress!['full_address'].toString().trim()
              : pickedAddress.fullAddress.trim();
      nextLat = _asNullableDouble(savedAddress?['lat']) ?? nextLat;
      nextLng = _asNullableDouble(savedAddress?['lng']) ?? nextLng;

      final didAddressChange = nextAddress != previousAddress ||
          nextLat != previousLat ||
          nextLng != previousLng;
      final sortedAvailable = _sortAvailableByNearestIfPossible(
        _availableOrders,
        originLat: nextLat,
        originLng: nextLng,
      );

      if (!mounted) return;
      setState(() {
        _selectedAddress = nextAddress;
        _selectedAddressLat = nextLat;
        _selectedAddressLng = nextLng;
        if (didAddressChange) {
          _availableOrders = sortedAvailable.orders;
          _availableSortedByNearest = sortedAvailable.sorted;
          _selectedAvailableOrderIds.clear();
          _hasManualAssignedOrder = false;
          _syncAvailableNearestRank(sortedAvailable.orders);
          _assignedOrders = _applyAssignedOrderPreference(_assignedOrders);
          _syncManualAssignedOrderIds(_assignedOrders);
        }
      });
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', ''),
      );
    }
  }

  Future<void> _refreshAll() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final meFuture =
          ApiClient.instance.get('/api/driver/me', authenticated: true);
      final availableFuture = _fetchOrdersPage('available');
      final assignedFuture = _fetchOrdersPage('assigned');
      final executedFuture = _fetchOrdersPage('executed');

      final results = await Future.wait<dynamic>([
        meFuture,
        availableFuture,
        assignedFuture,
        executedFuture,
      ]);

      final meRes = results[0] as dynamic;
      if (meRes.statusCode < 200 || meRes.statusCode >= 300) {
        throw Exception('Driver session check failed (${meRes.statusCode})');
      }
      final meJson = jsonDecode(meRes.body) as Map<String, dynamic>;
      final driver = meJson['driver'] as Map<String, dynamic>? ?? const {};
      final availablePage = results[1] as _DriverOrdersPage;
      final assignedPage = results[2] as _DriverOrdersPage;
      final executedPage = results[3] as _DriverOrdersPage;
      final fetchedAvailable = availablePage.orders;
      final sortedAvailable = _sortAvailableByNearestIfPossible(
        fetchedAvailable,
        originLat: _selectedAddressLat,
        originLng: _selectedAddressLng,
      );
      final fetchedAssigned = assignedPage.orders;
      _syncAvailableNearestRank(sortedAvailable.orders);
      final orderedAssigned = _applyAssignedOrderPreference(fetchedAssigned);

      if (!mounted) return;
      setState(() {
        _driverPhone = (driver['phone_number']?.toString() ?? '').trim();
        _driverName = (driver['display_name']?.toString() ?? '').trim();
        _availableOrders = sortedAvailable.orders;
        _availableSortedByNearest = sortedAvailable.sorted;
        _selectedAvailableOrderIds.clear();
        _assignedOrders = orderedAssigned;
        _syncManualAssignedOrderIds(orderedAssigned);
        _executedOrders = executedPage.orders;
        _availableHasMore = availablePage.hasMore;
        _assignedHasMore = assignedPage.hasMore;
        _executedHasMore = executedPage.hasMore;
        _availableNextCursor = availablePage.nextCursor;
        _assignedNextCursor = assignedPage.nextCursor;
        _executedNextCursor = executedPage.nextCursor;
        _isLoadingMoreAvailable = false;
        _isLoadingMoreAssigned = false;
        _isLoadingMoreExecuted = false;
        _isLoading = false;
      });
    } on SessionExpiredException {
      if (!mounted) return;
      await FirebaseAuth.instance.signOut();
      _redirectToLogin();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _error = error.toString().replaceFirst('Exception: ', '').trim();
        _isLoadingMoreAvailable = false;
        _isLoadingMoreAssigned = false;
        _isLoadingMoreExecuted = false;
      });
    }
  }

  Future<void> _refreshAvailableAndAssigned() async {
    try {
      final results = await Future.wait<dynamic>([
        _fetchOrdersPage('available'),
        _fetchOrdersPage('assigned'),
      ]);
      final availablePage = results[0] as _DriverOrdersPage;
      final assignedPage = results[1] as _DriverOrdersPage;
      final sortedAvailable = _sortAvailableByNearestIfPossible(
        availablePage.orders,
        originLat: _selectedAddressLat,
        originLng: _selectedAddressLng,
      );
      _syncAvailableNearestRank(sortedAvailable.orders);
      final orderedAssigned =
          _applyAssignedOrderPreference(assignedPage.orders);
      final availableIds =
          sortedAvailable.orders.map((order) => order.id).toSet();

      if (!mounted) return;
      setState(() {
        _availableOrders = sortedAvailable.orders;
        _availableSortedByNearest = sortedAvailable.sorted;
        _selectedAvailableOrderIds
            .removeWhere((id) => !availableIds.contains(id));
        _assignedOrders = orderedAssigned;
        _syncManualAssignedOrderIds(orderedAssigned);
        _availableHasMore = availablePage.hasMore;
        _assignedHasMore = assignedPage.hasMore;
        _availableNextCursor = availablePage.nextCursor;
        _assignedNextCursor = assignedPage.nextCursor;
        _isLoadingMoreAvailable = false;
        _isLoadingMoreAssigned = false;
      });
    } on SessionExpiredException {
      if (!mounted) return;
      await FirebaseAuth.instance.signOut();
      _redirectToLogin();
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', '').trim(),
      );
    }
  }

  List<DriverOrderSummary> _mergeOrdersById(
    List<DriverOrderSummary> existing,
    List<DriverOrderSummary> incoming,
  ) {
    if (incoming.isEmpty) return List<DriverOrderSummary>.from(existing);
    final seenIds = existing.map((order) => order.id).toSet();
    final merged = List<DriverOrderSummary>.from(existing);
    for (final order in incoming) {
      if (seenIds.add(order.id)) {
        merged.add(order);
      }
    }
    return merged;
  }

  Future<_DriverOrdersPage> _fetchOrdersPage(
    String type, {
    String? cursor,
  }) async {
    final limit = _ordersPageSize.toString();
    final queryParameters = <String, String>{
      'type': type,
      'limit': limit,
    };
    if (cursor != null && cursor.trim().isNotEmpty) {
      queryParameters['cursor'] = cursor.trim();
    }
    final response = await ApiClient.instance.get(
      '/api/driver/orders',
      authenticated: true,
      queryParameters: queryParameters,
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to load $type orders (${response.statusCode})');
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    final rawOrders = (data['orders'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .toList(growable: false);
    final pageInfo =
        data['page_info'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final nextCursor =
        (pageInfo['next_cursor']?.toString().trim().isNotEmpty ?? false)
            ? pageInfo['next_cursor'].toString().trim()
            : null;
    return _DriverOrdersPage(
      orders:
          rawOrders.map(DriverOrderSummary.fromJson).toList(growable: false),
      hasMore: pageInfo['has_more'] == true,
      nextCursor: nextCursor,
    );
  }

  Future<void> _loadMoreAvailableOrders() async {
    final cursor = _availableNextCursor;
    if (_isLoading ||
        _isLoadingMoreAvailable ||
        !_availableHasMore ||
        cursor == null ||
        cursor.isEmpty) {
      return;
    }
    setState(() {
      _isLoadingMoreAvailable = true;
    });
    try {
      final page = await _fetchOrdersPage('available', cursor: cursor);
      if (!mounted) return;

      final merged = _mergeOrdersById(_availableOrders, page.orders);
      final sortedAvailable = _availableSortedByNearest
          ? _sortAvailableByNearestIfPossible(
              merged,
              originLat: _selectedAddressLat,
              originLng: _selectedAddressLng,
            )
          : (orders: merged, sorted: false);

      setState(() {
        _availableOrders =
            _availableSortedByNearest ? sortedAvailable.orders : merged;
        if (_availableSortedByNearest) {
          _availableSortedByNearest = sortedAvailable.sorted;
        }
        _availableNextCursor = page.nextCursor;
        _availableHasMore = page.hasMore;
        _syncAvailableNearestRank(_availableOrders);
        _assignedOrders = _applyAssignedOrderPreference(_assignedOrders);
        _syncManualAssignedOrderIds(_assignedOrders);
      });
    } on SessionExpiredException {
      if (!mounted) return;
      await FirebaseAuth.instance.signOut();
      _redirectToLogin();
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', '').trim(),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingMoreAvailable = false;
        });
      }
    }
  }

  Future<void> _loadMoreAssignedOrders() async {
    final cursor = _assignedNextCursor;
    if (_isLoading ||
        _isLoadingMoreAssigned ||
        !_assignedHasMore ||
        cursor == null ||
        cursor.isEmpty) {
      return;
    }
    setState(() {
      _isLoadingMoreAssigned = true;
    });
    try {
      final page = await _fetchOrdersPage('assigned', cursor: cursor);
      if (!mounted) return;
      final merged = _mergeOrdersById(_assignedOrders, page.orders);
      final ordered = _applyAssignedOrderPreference(merged);
      setState(() {
        _assignedOrders = ordered;
        _assignedNextCursor = page.nextCursor;
        _assignedHasMore = page.hasMore;
        _syncManualAssignedOrderIds(ordered);
      });
    } on SessionExpiredException {
      if (!mounted) return;
      await FirebaseAuth.instance.signOut();
      _redirectToLogin();
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', '').trim(),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingMoreAssigned = false;
        });
      }
    }
  }

  Future<void> _loadMoreExecutedOrders() async {
    final cursor = _executedNextCursor;
    if (_isLoading ||
        _isLoadingMoreExecuted ||
        !_executedHasMore ||
        cursor == null ||
        cursor.isEmpty) {
      return;
    }
    setState(() {
      _isLoadingMoreExecuted = true;
    });
    try {
      final page = await _fetchOrdersPage('executed', cursor: cursor);
      if (!mounted) return;
      setState(() {
        _executedOrders = _mergeOrdersById(_executedOrders, page.orders);
        _executedNextCursor = page.nextCursor;
        _executedHasMore = page.hasMore;
      });
    } on SessionExpiredException {
      if (!mounted) return;
      await FirebaseAuth.instance.signOut();
      _redirectToLogin();
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', '').trim(),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingMoreExecuted = false;
        });
      }
    }
  }

  Future<bool> _assignOrder(int orderId) async {
    if (_assigningOrderIds.contains(orderId)) return false;
    setState(() {
      _assigningOrderIds.add(orderId);
    });
    try {
      final response = await ApiClient.instance.post(
        '/api/driver/orders/$orderId/assign',
        authenticated: true,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('Unable to assign order (${response.statusCode})');
      }

      if (!mounted) return false;
      AppSnackBar.show(context, 'Order #$orderId assigned to you');
      await _refreshAvailableAndAssigned();
      return true;
    } catch (error) {
      if (error is SessionExpiredException) {
        _redirectToLogin();
        return false;
      }
      if (!mounted) return false;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', '').trim(),
      );
      return false;
    } finally {
      if (mounted) {
        setState(() {
          _assigningOrderIds.remove(orderId);
        });
      }
    }
  }

  void _toggleAvailableOrderSelection(int orderId) {
    if (_isAssigningSelectedAvailable || _assigningOrderIds.contains(orderId)) {
      return;
    }
    setState(() {
      if (_selectedAvailableOrderIds.contains(orderId)) {
        _selectedAvailableOrderIds.remove(orderId);
      } else {
        _selectedAvailableOrderIds.add(orderId);
      }
    });
  }

  Future<void> _assignSelectedAvailableOrders() async {
    if (_isAssigningSelectedAvailable) return;
    final selectedIds = _availableOrders
        .map((order) => order.id)
        .where(_selectedAvailableOrderIds.contains)
        .toList(growable: false);
    if (selectedIds.isEmpty) return;

    setState(() {
      _isAssigningSelectedAvailable = true;
    });

    var successCount = 0;
    var failedCount = 0;
    try {
      for (final orderId in selectedIds) {
        if (!mounted) return;
        setState(() {
          _assigningOrderIds.add(orderId);
        });
        try {
          final response = await ApiClient.instance.post(
            '/api/driver/orders/$orderId/assign',
            authenticated: true,
          );
          if (response.statusCode >= 200 && response.statusCode < 300) {
            successCount += 1;
          } else {
            failedCount += 1;
          }
        } on SessionExpiredException {
          if (!mounted) return;
          await FirebaseAuth.instance.signOut();
          _redirectToLogin();
          return;
        } catch (_) {
          failedCount += 1;
        } finally {
          if (mounted) {
            setState(() {
              _assigningOrderIds.remove(orderId);
            });
          }
        }
      }

      if (!mounted) return;
      await _refreshAvailableAndAssigned();
      if (!mounted) return;
      setState(() {
        _selectedAvailableOrderIds.clear();
      });
      if (successCount > 0 && failedCount == 0) {
        AppSnackBar.show(
          context,
          'Assigned $successCount order${successCount == 1 ? '' : 's'}.',
        );
      } else if (successCount > 0) {
        AppSnackBar.show(
          context,
          'Assigned $successCount, failed $failedCount.',
        );
      } else {
        AppSnackBar.show(context, 'Could not assign selected orders.');
      }
    } finally {
      if (mounted) {
        setState(() {
          _isAssigningSelectedAvailable = false;
        });
      }
    }
  }

  Future<bool> _updateOrderStatus(
    int orderId,
    String nextStatus, {
    String? deliveryPin,
    List<int>? pickedItemIds,
  }) async {
    if (_isMutating) return false;
    setState(() {
      _isMutating = true;
    });
    try {
      final response = await ApiClient.instance.patch(
        '/api/driver/orders/$orderId/status',
        authenticated: true,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'status': nextStatus,
          if (deliveryPin != null && deliveryPin.trim().isNotEmpty)
            'delivery_pin': deliveryPin.trim(),
          if (pickedItemIds != null) 'picked_item_ids': pickedItemIds,
        }),
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        var message = 'Unable to update order status (${response.statusCode})';
        try {
          final payload = jsonDecode(response.body);
          if (payload is Map<String, dynamic>) {
            final apiMessage = (payload['message']?.toString() ?? '').trim();
            if (apiMessage.isNotEmpty) {
              message = apiMessage;
            }
          }
        } catch (_) {}
        if (message ==
            'Unable to update order status (${response.statusCode})') {
          if (response.statusCode == 409 && nextStatus == 'delivered') {
            message = 'Incorrect delivery PIN';
          } else if (response.statusCode == 400 && nextStatus == 'delivered') {
            message = 'Enter a valid 4-digit delivery PIN';
          }
        }
        throw Exception(message);
      }

      if (!mounted) return false;
      AppSnackBar.show(
        context,
        'Order #$orderId updated: ${_statusLabel(nextStatus)}',
      );
      await _refreshAll();
      if (nextStatus == 'delivered' && mounted) {
        setState(() {
          _currentIndex = 0;
          _homeOrdersSegmentIndex = 1;
        });
        if (_pageController.hasClients) {
          _pageController.jumpToPage(0);
        } else {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted || !_pageController.hasClients) return;
            _pageController.jumpToPage(0);
          });
        }
      }
      return true;
    } catch (error) {
      if (error is SessionExpiredException) {
        _redirectToLogin();
        return false;
      }
      if (!mounted) return false;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', '').trim(),
      );
      return false;
    } finally {
      if (mounted) {
        setState(() {
          _isMutating = false;
        });
      }
    }
  }

  Future<bool> _unassignOrder(int orderId) async {
    if (_isMutating) return false;
    setState(() {
      _isMutating = true;
    });
    try {
      final response = await ApiClient.instance.post(
        '/api/driver/orders/$orderId/unassign',
        authenticated: true,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('Unable to unassign order (${response.statusCode})');
      }

      if (!mounted) return false;
      AppSnackBar.show(
        context,
        'Order #$orderId unassigned and moved to Available.',
      );
      await _refreshAvailableAndAssigned();
      return true;
    } catch (error) {
      if (error is SessionExpiredException) {
        _redirectToLogin();
        return false;
      }
      if (!mounted) return false;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', '').trim(),
      );
      return false;
    } finally {
      if (mounted) {
        setState(() {
          _isMutating = false;
        });
      }
    }
  }

  Future<void> _openOrderDetails(DriverOrderSummary order) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => DriverOrderDetailsPage(
          order: order,
          driverUid: FirebaseAuth.instance.currentUser?.uid ?? '',
          onAssign: () => _assignOrder(order.id),
          onUnassign: () => _unassignOrder(order.id),
          onUpdateStatus: (status, {deliveryPin, pickedItemIds}) =>
              _updateOrderStatus(
            order.id,
            status,
            deliveryPin: deliveryPin,
            pickedItemIds: pickedItemIds,
          ),
          isMutating: _isMutating || _assigningOrderIds.contains(order.id),
        ),
      ),
    );

    if (changed == true && mounted) {
      await _refreshAvailableAndAssigned();
    }
  }

  void _syncAvailableNearestRank(List<DriverOrderSummary> orders) {
    _availableNearestRankByOrderId.clear();
    for (final entry in orders.asMap().entries) {
      _availableNearestRankByOrderId[entry.value.id] = entry.key;
    }
  }

  void _syncManualAssignedOrderIds(List<DriverOrderSummary> orders) {
    _manualAssignedOrderIds
      ..clear()
      ..addAll(orders.map((order) => order.id));
  }

  ({List<DriverOrderSummary> orders, bool sorted})
      _sortAvailableByNearestIfPossible(
    List<DriverOrderSummary> source, {
    required double? originLat,
    required double? originLng,
  }) {
    if (source.length <= 1) {
      return (orders: List<DriverOrderSummary>.from(source), sorted: false);
    }
    if (originLat == null ||
        originLng == null ||
        !originLat.isFinite ||
        !originLng.isFinite ||
        originLat < -90 ||
        originLat > 90 ||
        originLng < -180 ||
        originLng > 180) {
      return (orders: List<DriverOrderSummary>.from(source), sorted: false);
    }

    final sortedResult = _sortOrdersByNearest(source, originLat, originLng);
    if (sortedResult.sortableCount == 0) {
      return (orders: List<DriverOrderSummary>.from(source), sorted: false);
    }
    return (orders: sortedResult.orders, sorted: true);
  }

  List<DriverOrderSummary> _applyAssignedOrderPreference(
    List<DriverOrderSummary> source,
  ) {
    if (source.length <= 1) return List<DriverOrderSummary>.from(source);

    var remaining = List<DriverOrderSummary>.from(source);
    final ordered = <DriverOrderSummary>[];

    if (_hasManualAssignedOrder && _manualAssignedOrderIds.isNotEmpty) {
      final byId = <int, DriverOrderSummary>{
        for (final order in source) order.id: order,
      };
      for (final id in _manualAssignedOrderIds) {
        final order = byId.remove(id);
        if (order != null) {
          ordered.add(order);
        }
      }
      remaining = byId.values.toList(growable: false);
    }

    if (_availableNearestRankByOrderId.isNotEmpty && remaining.length > 1) {
      final originalIndex = <int, int>{
        for (var i = 0; i < source.length; i++) source[i].id: i,
      };
      remaining.sort((a, b) {
        final rankA = _availableNearestRankByOrderId[a.id];
        final rankB = _availableNearestRankByOrderId[b.id];
        if (rankA == null && rankB == null) {
          return (originalIndex[a.id] ?? 0).compareTo(originalIndex[b.id] ?? 0);
        }
        if (rankA == null) return 1;
        if (rankB == null) return -1;
        final byRank = rankA.compareTo(rankB);
        if (byRank != 0) return byRank;
        return (originalIndex[a.id] ?? 0).compareTo(originalIndex[b.id] ?? 0);
      });
    }

    ordered.addAll(remaining);
    return ordered;
  }

  void _reorderAssignedOrders(int oldIndex, int newIndex) {
    final current = _assignedOrders;
    if (current.length <= 1) return;
    if (oldIndex < 0 || oldIndex >= current.length) return;
    if (newIndex < 0 || newIndex > current.length) return;

    var normalizedNewIndex = newIndex;
    if (oldIndex < normalizedNewIndex) {
      normalizedNewIndex -= 1;
    }
    if (oldIndex == normalizedNewIndex) return;

    final next = current.toList(growable: true);
    final moved = next.removeAt(oldIndex);
    next.insert(normalizedNewIndex, moved);

    final ordered = List<DriverOrderSummary>.from(next, growable: false);
    setState(() {
      _hasManualAssignedOrder = true;
      _assignedOrders = ordered;
      _syncManualAssignedOrderIds(ordered);
    });
  }

  double? _distanceKmToOrder(
    DriverOrderSummary order,
    double originLat,
    double originLng,
  ) {
    if (!originLat.isFinite ||
        !originLng.isFinite ||
        originLat < -90 ||
        originLat > 90 ||
        originLng < -180 ||
        originLng > 180) {
      return null;
    }
    final lat = order.deliveryLat;
    final lng = order.deliveryLng;
    if (lat == null || lng == null) return null;
    if (!lat.isFinite || !lng.isFinite) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    final meters = Geolocator.distanceBetween(
      originLat,
      originLng,
      lat,
      lng,
    );
    if (!meters.isFinite || meters < 0) return null;
    return meters / 1000;
  }

  ({List<DriverOrderSummary> orders, int sortableCount}) _sortOrdersByNearest(
    List<DriverOrderSummary> source,
    double originLat,
    double originLng,
  ) {
    final indexed = source.asMap().entries.map((entry) {
      final order = entry.value;
      final distance = _distanceKmToOrder(order, originLat, originLng);
      return (index: entry.key, order: order, distance: distance);
    }).toList(growable: false);

    final sortableCount = indexed.where((item) => item.distance != null).length;

    indexed.sort((a, b) {
      final distanceA = a.distance;
      final distanceB = b.distance;

      if (distanceA == null && distanceB == null) {
        return a.index.compareTo(b.index);
      }
      if (distanceA == null) return 1;
      if (distanceB == null) return -1;

      final byDistance = distanceA.compareTo(distanceB);
      if (byDistance != 0) return byDistance;
      return a.index.compareTo(b.index);
    });

    return (
      orders: indexed.map((item) => item.order).toList(growable: false),
      sortableCount: sortableCount,
    );
  }

  ({double lat, double lng}) _resolveSortOrigin() {
    final originLat = _selectedAddressLat;
    final originLng = _selectedAddressLng;
    if (originLat == null || originLng == null) {
      throw Exception(
        'Header location has no coordinates. Pick location again to sort by nearest.',
      );
    }
    return (lat: originLat, lng: originLng);
  }

  Future<void> _sortAvailableOrdersByNearest() async {
    if (_isSortingAvailableByDistance || _availableOrders.isEmpty) return;
    setState(() {
      _isSortingAvailableByDistance = true;
    });

    try {
      final origin = _resolveSortOrigin();
      final sortedResult = _sortOrdersByNearest(
        _availableOrders,
        origin.lat,
        origin.lng,
      );
      if (sortedResult.sortableCount == 0) {
        throw Exception('No delivery coordinates available to sort yet.');
      }

      if (!mounted) return;
      setState(() {
        _availableOrders = sortedResult.orders;
        _availableSortedByNearest = true;
        _hasManualAssignedOrder = false;
        _syncAvailableNearestRank(sortedResult.orders);
        _assignedOrders = _applyAssignedOrderPreference(_assignedOrders);
        _syncManualAssignedOrderIds(_assignedOrders);
      });
      AppSnackBar.show(context, 'Available orders sorted by nearest first.');
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', '').trim(),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSortingAvailableByDistance = false;
        });
      }
    }
  }

  Future<void> _switchTab(int index) async {
    if (index == _currentIndex) return;
    setState(() {
      _currentIndex = index;
    });
    if (!_pageController.hasClients) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || !_pageController.hasClients) return;
        final currentPage = _pageController.page?.round() ?? 0;
        if (currentPage == _currentIndex) return;
        _pageController.jumpToPage(_currentIndex);
      });
      return;
    }
    await _pageController.animateToPage(
      index,
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOutCubic,
    );
  }

  Future<void> _signOut() async {
    await FirebaseAuth.instance.signOut();
    _redirectToLogin();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 10,
        title: HeaderLocationTrigger(
          address: _selectedAddress,
          onTap: () => _openLocationPicker(),
        ),
        actions: [
          IconButton(
            onPressed: _isLoading || _isMutating ? null : _refreshAll,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(_error!, textAlign: TextAlign.center),
                  ),
                )
              : PageView(
                  controller: _pageController,
                  onPageChanged: (index) {
                    if (!mounted) return;
                    setState(() {
                      _currentIndex = index;
                    });
                  },
                  children: [
                    _DriverOrdersHomeTab(
                      initialTabIndex: _homeOrdersSegmentIndex,
                      onTabChanged: (index) {
                        if (!mounted) return;
                        setState(() {
                          _homeOrdersSegmentIndex = index;
                        });
                      },
                      availableOrders: _availableOrders,
                      assignedOrders: _assignedOrders,
                      isAssigningOrder: (orderId) =>
                          _assigningOrderIds.contains(orderId),
                      selectedAvailableOrderIds: _selectedAvailableOrderIds,
                      isAssigningSelectedAvailable:
                          _isAssigningSelectedAvailable,
                      isSortingAvailableByDistance:
                          _isSortingAvailableByDistance,
                      availableSortedByNearest: _availableSortedByNearest,
                      onSortAvailableByNearest: _sortAvailableOrdersByNearest,
                      onToggleAvailableSelection:
                          _toggleAvailableOrderSelection,
                      onAssignSelectedAvailableOrders:
                          _assignSelectedAvailableOrders,
                      onRefreshAvailableOrders: _refreshAvailableAndAssigned,
                      availableHasMore: _availableHasMore,
                      isLoadingMoreAvailable: _isLoadingMoreAvailable,
                      onLoadMoreAvailableOrders: _loadMoreAvailableOrders,
                      assignedHasMore: _assignedHasMore,
                      isLoadingMoreAssigned: _isLoadingMoreAssigned,
                      onLoadMoreAssignedOrders: _loadMoreAssignedOrders,
                      onReorderAssignedOrders: _reorderAssignedOrders,
                      onOpenOrder: _openOrderDetails,
                    ),
                    _DriverExecutedOrdersTab(
                      executedOrders: _executedOrders,
                      hasMore: _executedHasMore,
                      isLoadingMore: _isLoadingMoreExecuted,
                      onLoadMoreOrders: _loadMoreExecutedOrders,
                      onOpenOrder: _openOrderDetails,
                    ),
                    _DriverProfileTab(
                      driverName: _driverName,
                      driverPhone: _driverPhone,
                      onSignOut: _signOut,
                    ),
                  ],
                ),
      bottomNavigationBar: SafeArea(
        child: _DriverBottomNavBar(
          currentIndex: _currentIndex,
          navItems: _navItems,
          onTabSelected: _switchTab,
        ),
      ),
    );
  }
}

class _DriverBottomNavBar extends StatefulWidget {
  const _DriverBottomNavBar({
    required this.currentIndex,
    required this.navItems,
    required this.onTabSelected,
  });

  final int currentIndex;
  final List<({IconData icon, String label})> navItems;
  final ValueChanged<int> onTabSelected;

  @override
  State<_DriverBottomNavBar> createState() => _DriverBottomNavBarState();
}

class _DriverBottomNavBarState extends State<_DriverBottomNavBar> {
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
      child: LayoutBuilder(
        builder: (context, constraints) {
          final selectionProgress =
              _dragTabProgress ?? widget.currentIndex.toDouble();
          const horizontalInset = 8.0;
          final trackWidth = (constraints.maxWidth - (horizontalInset * 2))
              .clamp(0.0, constraints.maxWidth);
          final tabWidth = trackWidth / widget.navItems.length;
          final holdScale = _isNavHolding ? 1.18 : 1.0;
          final lensWidth = ((tabWidth - 8) * holdScale).clamp(0.0, trackWidth);
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
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(36),
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          Colors.white.withOpacity(isDark ? 0.06 : 0.18),
                          colorScheme.surface.withOpacity(isDark ? 0.24 : 0.34),
                          colorScheme.surface.withOpacity(isDark ? 0.2 : 0.28),
                        ],
                      ),
                      border: Border.all(
                        color: Colors.white.withOpacity(isDark ? 0.12 : 0.3),
                        width: 0.9,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withOpacity(isDark ? 0.36 : 0.12),
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
                                padding:
                                    const EdgeInsets.symmetric(vertical: 6),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    SizedBox(
                                      width: 28,
                                      height: 22,
                                      child: Align(
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
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      item.label,
                                      style:
                                          theme.textTheme.labelSmall?.copyWith(
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
                        color: Colors.white.withOpacity(isDark ? 0.24 : 0.65),
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
    );
  }
}

class _DriverOrdersHomeTab extends StatelessWidget {
  const _DriverOrdersHomeTab({
    required this.initialTabIndex,
    required this.onTabChanged,
    required this.availableOrders,
    required this.assignedOrders,
    required this.isAssigningOrder,
    required this.selectedAvailableOrderIds,
    required this.isAssigningSelectedAvailable,
    required this.isSortingAvailableByDistance,
    required this.availableSortedByNearest,
    required this.onSortAvailableByNearest,
    required this.onToggleAvailableSelection,
    required this.onAssignSelectedAvailableOrders,
    required this.onRefreshAvailableOrders,
    required this.availableHasMore,
    required this.isLoadingMoreAvailable,
    required this.onLoadMoreAvailableOrders,
    required this.assignedHasMore,
    required this.isLoadingMoreAssigned,
    required this.onLoadMoreAssignedOrders,
    required this.onReorderAssignedOrders,
    required this.onOpenOrder,
  });

  final int initialTabIndex;
  final ValueChanged<int> onTabChanged;
  final List<DriverOrderSummary> availableOrders;
  final List<DriverOrderSummary> assignedOrders;
  final bool Function(int orderId) isAssigningOrder;
  final Set<int> selectedAvailableOrderIds;
  final bool isAssigningSelectedAvailable;
  final bool isSortingAvailableByDistance;
  final bool availableSortedByNearest;
  final Future<void> Function() onSortAvailableByNearest;
  final ValueChanged<int> onToggleAvailableSelection;
  final Future<void> Function() onAssignSelectedAvailableOrders;
  final Future<void> Function() onRefreshAvailableOrders;
  final bool availableHasMore;
  final bool isLoadingMoreAvailable;
  final Future<void> Function() onLoadMoreAvailableOrders;
  final bool assignedHasMore;
  final bool isLoadingMoreAssigned;
  final Future<void> Function() onLoadMoreAssignedOrders;
  final ReorderCallback onReorderAssignedOrders;
  final ValueChanged<DriverOrderSummary> onOpenOrder;

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      initialIndex: initialTabIndex.clamp(0, 1),
      child: Column(
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: _DriverSegmentedTabBar(
              compact: true,
              onTap: onTabChanged,
              tabs: [
                _DriverSegmentedTabBarItem(
                  label: 'Available',
                  icon: Icons.inventory_2_rounded,
                  height: 38,
                ),
                _DriverSegmentedTabBarItem(
                  label: 'Active',
                  icon: Icons.local_shipping_rounded,
                  height: 38,
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: TabBarView(
              children: [
                RefreshIndicator(
                  onRefresh: onRefreshAvailableOrders,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(12, 0, 12, 20),
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Spacer(),
                          Tooltip(
                            message: 'Sort nearest first',
                            child: OutlinedButton.icon(
                              onPressed: isSortingAvailableByDistance
                                  ? null
                                  : onSortAvailableByNearest,
                              icon: isSortingAvailableByDistance
                                  ? const SizedBox(
                                      width: 14,
                                      height: 14,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    )
                                  : Icon(
                                      Icons.sort_rounded,
                                      color: availableSortedByNearest
                                          ? Theme.of(context)
                                              .colorScheme
                                              .primary
                                          : null,
                                    ),
                              label: Text(
                                isSortingAvailableByDistance
                                    ? 'Sorting...'
                                    : 'Sort',
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          FilledButton.icon(
                            onPressed: (selectedAvailableOrderIds.isEmpty ||
                                    isAssigningSelectedAvailable)
                                ? null
                                : onAssignSelectedAvailableOrders,
                            icon: isAssigningSelectedAvailable
                                ? const SizedBox(
                                    width: 14,
                                    height: 14,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Icon(
                                    Icons.assignment_turned_in_rounded),
                            label: Text(
                              isAssigningSelectedAvailable
                                  ? 'Assigning...'
                                  : 'Assign',
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      if (availableSortedByNearest)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Text(
                            'Sorted by nearest delivery location',
                            style:
                                Theme.of(context).textTheme.bodySmall?.copyWith(
                                      color: Theme.of(context)
                                          .colorScheme
                                          .onSurface
                                          .withOpacity(0.68),
                                    ),
                          ),
                        )
                      else
                        const SizedBox(height: 8),
                      if (availableOrders.isEmpty)
                        const _EmptyStateCard(
                          message: 'No paid unassigned orders right now.',
                        )
                      else
                        ...availableOrders.map((order) {
                          final assigning = isAssigningOrder(order.id);
                          final isSelected =
                              selectedAvailableOrderIds.contains(order.id);
                          return DriverOrderCard(
                            order: order,
                            onTap: () => onOpenOrder(order),
                            selectionControl: Checkbox(
                              value: isSelected,
                              onChanged:
                                  assigning || isAssigningSelectedAvailable
                                      ? null
                                      : (_) => onToggleAvailableSelection(
                                            order.id,
                                          ),
                            ),
                          );
                        }),
                      if (availableHasMore || isLoadingMoreAvailable)
                        _OrdersLoadMoreFooter(
                          hasMore: availableHasMore,
                          isLoading: isLoadingMoreAvailable,
                          onPressed: onLoadMoreAvailableOrders,
                        ),
                    ],
                  ),
                ),
                ListView(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 20),
                  children: [
                    const _SectionTitle(
                      title: 'Active Paid Orders',
                      subtitle:
                          'Follows available sort order. Drag handle to reorder.',
                    ),
                    const SizedBox(height: 8),
                    if (assignedOrders.isEmpty)
                      const _EmptyStateCard(message: 'No assigned orders yet.')
                    else
                      ReorderableListView.builder(
                        shrinkWrap: true,
                        buildDefaultDragHandles: false,
                        physics: const NeverScrollableScrollPhysics(),
                        onReorder: onReorderAssignedOrders,
                        itemCount: assignedOrders.length,
                        itemBuilder: (context, index) {
                          final order = assignedOrders[index];
                          return DriverOrderCard(
                            key: ValueKey('assigned-order-${order.id}'),
                            order: order,
                            onTap: () => onOpenOrder(order),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  '#${index + 1}',
                                  style: Theme.of(context)
                                      .textTheme
                                      .labelMedium
                                      ?.copyWith(fontWeight: FontWeight.w700),
                                ),
                                const SizedBox(width: 8),
                                ReorderableDragStartListener(
                                  index: index,
                                  child: const Tooltip(
                                    message: 'Drag to reorder',
                                    child: Icon(Icons.drag_indicator_rounded),
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    if (assignedHasMore || isLoadingMoreAssigned)
                      _OrdersLoadMoreFooter(
                        hasMore: assignedHasMore,
                        isLoading: isLoadingMoreAssigned,
                        onPressed: onLoadMoreAssignedOrders,
                      ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DriverSegmentedTabBarItem extends StatelessWidget {
  const _DriverSegmentedTabBarItem({
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

class _DriverSegmentedTabBar extends StatelessWidget {
  const _DriverSegmentedTabBar({
    required this.tabs,
    this.compact = false,
    this.onTap,
  });

  final List<Widget> tabs;
  final bool compact;
  final ValueChanged<int>? onTap;

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
        onTap: onTap,
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

class _DriverExecutedOrdersTab extends StatelessWidget {
  const _DriverExecutedOrdersTab({
    required this.executedOrders,
    required this.hasMore,
    required this.isLoadingMore,
    required this.onLoadMoreOrders,
    required this.onOpenOrder,
  });

  final List<DriverOrderSummary> executedOrders;
  final bool hasMore;
  final bool isLoadingMore;
  final Future<void> Function() onLoadMoreOrders;
  final ValueChanged<DriverOrderSummary> onOpenOrder;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 20),
      children: [
        const _SectionTitle(
          title: 'Executed Orders',
          subtitle: 'Completed deliveries',
        ),
        const SizedBox(height: 8),
        if (executedOrders.isEmpty)
          const _EmptyStateCard(message: 'No delivered orders yet.')
        else
          ...executedOrders.map(
            (order) => DriverOrderCard(
              order: order,
              onTap: () => onOpenOrder(order),
            ),
          ),
        if (hasMore || isLoadingMore)
          _OrdersLoadMoreFooter(
            hasMore: hasMore,
            isLoading: isLoadingMore,
            onPressed: onLoadMoreOrders,
          ),
      ],
    );
  }
}

class _DriverProfileTab extends StatefulWidget {
  const _DriverProfileTab({
    required this.driverName,
    required this.driverPhone,
    required this.onSignOut,
  });

  final String driverName;
  final String driverPhone;
  final VoidCallback onSignOut;

  @override
  State<_DriverProfileTab> createState() => _DriverProfileTabState();
}

class _DriverProfileTabState extends State<_DriverProfileTab> {
  String _initialsFromName(String name) {
    final parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList(growable: false);
    if (parts.isEmpty) return 'D';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
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
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: colorScheme.outlineVariant.withOpacity(0.45),
        ),
      ),
      child: ListTile(
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

    if (shouldLogout == true && mounted) {
      widget.onSignOut();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final themeNotifier = ThemeProvider.themeNotifier(context);
    final currentThemeMode = themeNotifier?.themeMode ?? ThemeMode.system;
    final driverName = widget.driverName.trim().isEmpty
        ? 'Name not set'
        : widget.driverName.trim();
    final driverPhone = widget.driverPhone.trim().isEmpty
        ? 'Not available'
        : widget.driverPhone.trim();
    final initials = _initialsFromName(driverName);

    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 92),
      children: [
        Text(
          'My Account',
          style: theme.textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w800,
          ),
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
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 38,
                backgroundColor: colorScheme.onPrimary.withOpacity(0.18),
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
                    Text(
                      driverName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleLarge?.copyWith(
                        color: colorScheme.onPrimary,
                        fontWeight: FontWeight.w800,
                      ),
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
                      driverPhone,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: colorScheme.onPrimary.withOpacity(0.9),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Role: Driver',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: colorScheme.onPrimary.withOpacity(0.9),
                      ),
                    ),
                  ],
                ),
              ),
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
          subtitle: 'Add, delete, and set your saved addresses',
          onTap: () {
            Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => const _DriverAddressBookPage(),
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
  }
}

class _DriverAddressBookPage extends StatefulWidget {
  const _DriverAddressBookPage();

  @override
  State<_DriverAddressBookPage> createState() => _DriverAddressBookPageState();
}

class _DriverAddressBookPageState extends State<_DriverAddressBookPage> {
  bool _isLoading = true;
  bool _isMutating = false;
  String? _error;
  List<_DriverSavedAddress> _addresses = const [];

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
        _addresses =
            rows.map(_DriverSavedAddress.fromJson).toList(growable: false);
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
    if (_isMutating) return;
    final picked = await showModalBottomSheet<ResolvedAddress>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const FractionallySizedBox(
        heightFactor: 0.8,
        child: LocationPickerSheet(),
      ),
    );
    if (!mounted || picked == null || picked.fullAddress.trim().isEmpty) return;
    if (picked.addressId != null) {
      AppSnackBar.show(context, 'Address already exists in your address book.');
      return;
    }

    var lat = picked.lat;
    var lng = picked.lng;
    if (lat == null || lng == null) {
      final resolved = await _resolveCoordinatesFromAddressText(
        picked.fullAddress,
      );
      lat ??= resolved.lat;
      lng ??= resolved.lng;
    }

    setState(() {
      _isMutating = true;
    });
    try {
      final response = await ApiClient.instance.post(
        '/api/addresses',
        authenticated: true,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'label': (picked.label?.trim().isNotEmpty ?? false)
              ? picked.label!.trim()
              : 'Other',
          'full_address': picked.fullAddress.trim(),
          'lat': lat,
          'lng': lng,
          'is_default': _addresses.isEmpty,
        }),
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('Failed to add address (${response.statusCode})');
      }
      if (!mounted) return;
      AppSnackBar.show(context, 'Address added');
      await _loadAddresses();
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isMutating = false;
        });
      }
    }
  }

  Future<void> _setDefault(_DriverSavedAddress address) async {
    if (_isMutating) return;
    setState(() {
      _isMutating = true;
    });
    try {
      final response = await ApiClient.instance.patch(
        '/api/addresses/${address.id}/default',
        authenticated: true,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          'Failed to set default address (${response.statusCode})',
        );
      }
      if (!mounted) return;
      await _loadAddresses();
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isMutating = false;
        });
      }
    }
  }

  Future<void> _deleteAddress(_DriverSavedAddress address) async {
    if (_isMutating) return;
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

    setState(() {
      _isMutating = true;
    });
    try {
      final response = await ApiClient.instance.delete(
        '/api/addresses/${address.id}',
        authenticated: true,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('Failed to delete address (${response.statusCode})');
      }
      if (!mounted) return;
      await _loadAddresses();
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isMutating = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Address Book'),
        actions: [
          IconButton(
            onPressed: _isMutating ? null : _addAddress,
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
                            'Add addresses for quick switching.',
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 16),
                          Center(
                            child: FilledButton(
                              onPressed: _isMutating ? null : _addAddress,
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
                                _driverAddressIconForLabel(address.label),
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

class DriverOrderDetailsPage extends StatefulWidget {
  const DriverOrderDetailsPage({
    super.key,
    required this.order,
    required this.driverUid,
    required this.onAssign,
    required this.onUnassign,
    required this.onUpdateStatus,
    required this.isMutating,
  });

  final DriverOrderSummary order;
  final String driverUid;
  final Future<bool> Function() onAssign;
  final Future<bool> Function() onUnassign;
  final Future<bool> Function(
    String status, {
    String? deliveryPin,
    List<int>? pickedItemIds,
  }) onUpdateStatus;
  final bool isMutating;

  @override
  State<DriverOrderDetailsPage> createState() => _DriverOrderDetailsPageState();
}

enum _OrderDetailsMenuAction { unassign }

class _DriverOrderDetailsPageState extends State<DriverOrderDetailsPage> {
  String? _statusActionInFlight;
  bool _isUnassigning = false;
  bool _isAssigningSelf = false;
  bool _isEditingPickedSelection = false;
  late String _currentStatus;
  late final Set<int> _checkedPickedItemIds;
  late final Set<int> _touchedPickupItemIds;

  @override
  void initState() {
    super.initState();
    _currentStatus = widget.order.status;
    _checkedPickedItemIds = widget.order.items
        .where((item) => item.pickedByDriver == true)
        .map((item) => item.id)
        .where((id) => id > 0)
        .toSet();
    _touchedPickupItemIds = widget.order.items
        .where((item) => item.pickedByDriver != null)
        .map((item) => item.id)
        .where((id) => id > 0)
        .toSet();
  }

  bool get _isAssignedToCurrentDriver =>
      widget.driverUid.isNotEmpty &&
      widget.order.assignedDriverUid == widget.driverUid;

  bool get _canAssign =>
      widget.order.assignedDriverUid.isEmpty && _currentStatus == 'confirmed';

  bool get _canMarkPicked =>
      _isAssignedToCurrentDriver &&
      {'assigned', 'confirmed', 'packed', 'picked'}.contains(_currentStatus);

  bool get _isPickupChecklistLocked =>
      _isAssignedToCurrentDriver &&
      _currentStatus == 'picked' &&
      !_isEditingPickedSelection;

  bool get _canMarkOutForDelivery =>
      _isAssignedToCurrentDriver && _currentStatus == 'picked';

  bool get _hasAnyPickedItems => _checkedPickedItemIds.isNotEmpty;

  bool get _canCancelUnavailable =>
      _isAssignedToCurrentDriver &&
      {'assigned', 'confirmed', 'packed', 'picked'}.contains(_currentStatus) &&
      !_hasAnyPickedItems;

  bool get _canMarkDelivered =>
      _isAssignedToCurrentDriver && _currentStatus == 'out_for_delivery';

  bool get _canUnassign =>
      _isAssignedToCurrentDriver &&
      {'assigned', 'confirmed', 'packed'}.contains(_currentStatus);

  String _currencySymbol() {
    return AppConstants.platformCurrencySymbol;
  }

  String _formatAmount(double value) {
    return '${_currencySymbol()}${value.toStringAsFixed(2)}';
  }

  bool get _isAnyStatusUpdating => _statusActionInFlight != null;

  bool _isActionUpdating(String status) => _statusActionInFlight == status;

  bool _isItemCheckedForPickup(DriverOrderItemSummary item) =>
      _checkedPickedItemIds.contains(item.id);

  bool _isItemLockedPicked(DriverOrderItemSummary item) =>
      _isPickupChecklistLocked && _isItemCheckedForPickup(item);

  bool get _isAtOrAfterPickedStatus =>
      {'picked', 'out_for_delivery', 'delivered'}.contains(_currentStatus);

  bool _isItemMarkedMissing(DriverOrderItemSummary item) {
    if (!_isAtOrAfterPickedStatus) return false;
    final savedAsMissing = item.pickedByDriver == false;
    final locallyTouchedMissing = _touchedPickupItemIds.contains(item.id) &&
        !_checkedPickedItemIds.contains(item.id);
    final lockedAsMissing = _isPickupChecklistLocked &&
        item.id > 0 &&
        !_checkedPickedItemIds.contains(item.id);
    return savedAsMissing || locallyTouchedMissing || lockedAsMissing;
  }

  bool get _canSubmitPickedSelection {
    if (!_canMarkPicked) return false;
    final actionableItems = widget.order.items.where((item) => item.id > 0);
    if (actionableItems.isEmpty) return false;
    return _checkedPickedItemIds.isNotEmpty;
  }

  void _togglePickupItem(DriverOrderItemSummary item, bool checked) {
    if (!_canMarkPicked || _isPickupChecklistLocked || item.id <= 0) return;
    setState(() {
      _touchedPickupItemIds.add(item.id);
      if (checked) {
        _checkedPickedItemIds.add(item.id);
      } else {
        _checkedPickedItemIds.remove(item.id);
      }
    });
  }

  Future<void> _openDeliveryLocationInMaps() async {
    final order = widget.order;
    final hasCoordinates = order.deliveryLat != null &&
        order.deliveryLng != null &&
        order.deliveryLat!.isFinite &&
        order.deliveryLng!.isFinite;
    final address = order.deliveryAddressText.trim();

    if (!hasCoordinates && address.isEmpty) {
      if (!mounted) return;
      AppSnackBar.show(context, 'Delivery location unavailable');
      return;
    }

    final destination = hasCoordinates
        ? '${order.deliveryLat!.toStringAsFixed(6)},${order.deliveryLng!.toStringAsFixed(6)}'
        : address;
    final mapsUri = Uri.parse(
      'https://www.google.com/maps/dir/?api=1&destination=${Uri.encodeComponent(destination)}&travelmode=driving',
    );

    try {
      final launched = await launchUrl(
        mapsUri,
        mode: LaunchMode.externalApplication,
      );
      if (launched || !mounted) return;
      AppSnackBar.show(context, 'Could not open Google Maps');
    } catch (_) {
      if (!mounted) return;
      AppSnackBar.show(context, 'Could not open Google Maps');
    }
  }

  Future<String?> _promptDeliveryPin() async {
    final value = await showDialog<String>(
      context: context,
      builder: (dialogContext) {
        var pinValue = '';
        return StatefulBuilder(
          builder: (context, setDialogState) => AlertDialog(
            title: const Text('Enter Delivery PIN'),
            content: TextField(
              autofocus: true,
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.done,
              maxLength: 4,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                hintText: '4-digit PIN',
                counterText: '',
              ),
              onChanged: (value) {
                final sanitized = value.trim();
                if (sanitized == pinValue) return;
                setDialogState(() {
                  pinValue = sanitized;
                });
              },
              onSubmitted: (_) {
                Navigator.of(dialogContext).pop(pinValue);
              },
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: pinValue.isEmpty
                    ? null
                    : () => Navigator.of(dialogContext).pop(pinValue),
                child: const Text('Verify'),
              ),
            ],
          ),
        );
      },
    );
    return value?.trim();
  }

  Future<void> _handleStatusUpdate(String status) async {
    if (_isAnyStatusUpdating || widget.isMutating) return;
    String? deliveryPin;
    if (status == 'delivered') {
      deliveryPin = await _promptDeliveryPin();
      if (!mounted) return;
      if (deliveryPin == null || deliveryPin.isEmpty) return;
    }
    List<int>? pickedItemIds;
    if (status == 'picked' || status == 'out_for_delivery') {
      if (widget.order.items.isEmpty) {
        if (mounted) AppSnackBar.show(context, 'No order items found');
        return;
      }
      final actionableItems =
          widget.order.items.where((item) => item.id > 0).toList();
      if (actionableItems.length != widget.order.items.length) {
        if (mounted) {
          AppSnackBar.show(
              context, 'Pickup checklist unavailable for this order');
        }
        return;
      }
      if (status == 'picked' && _checkedPickedItemIds.isEmpty) {
        if (mounted) {
          AppSnackBar.show(context, 'Select at least one picked item');
        }
        return;
      }
      pickedItemIds = _checkedPickedItemIds.toList(growable: false);
    }
    setState(() {
      _statusActionInFlight = status;
    });

    final updated = await widget.onUpdateStatus(
      status,
      deliveryPin: deliveryPin,
      pickedItemIds: pickedItemIds,
    );
    if (!mounted) return;
    if (updated) {
      setState(() {
        _statusActionInFlight = null;
        _currentStatus = status;
        if (status == 'picked') {
          _isEditingPickedSelection = false;
        }
      });
      if (status == 'delivered') {
        await Navigator.of(context).maybePop(true);
      }
      return;
    }

    setState(() {
      _statusActionInFlight = null;
    });
  }

  Future<void> _handleUnassign() async {
    if (_isUnassigning || widget.isMutating || !_canUnassign) return;
    setState(() {
      _isUnassigning = true;
    });
    final unassigned = await widget.onUnassign();
    if (!mounted) return;
    setState(() {
      _isUnassigning = false;
    });
    if (unassigned) {
      await Navigator.of(context).maybePop();
    }
  }

  Future<void> _handleSelfAssign() async {
    if (_isAssigningSelf || widget.isMutating || !_canAssign) return;
    setState(() {
      _isAssigningSelf = true;
    });
    try {
      final assigned = await widget.onAssign();
      if (!mounted) return;
      if (assigned) {
        await Navigator.of(context).maybePop(true);
      }
    } finally {
      if (mounted) {
        setState(() {
          _isAssigningSelf = false;
        });
      }
    }
  }

  Future<void> _confirmAndUnassign() async {
    if (_isUnassigning || widget.isMutating || !_canUnassign) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Unassign order?'),
        content: const Text(
          'This will move the order back to Available orders.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Unassign'),
          ),
        ],
      ),
    );
    if (!mounted || confirmed != true) return;
    await _handleUnassign();
  }

  Widget _statusButtonChild({
    required String label,
    required bool loading,
    required Color spinnerColor,
  }) {
    return Stack(
      alignment: Alignment.center,
      children: [
        Opacity(
          opacity: loading ? 0 : 1,
          child: Text(label),
        ),
        if (loading)
          SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: spinnerColor,
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final order = widget.order;
    final itemTotal = order.itemTotal;
    final deliveryFee = order.deliveryFee;
    final discountAmount = order.discountAmount;
    final platformFee = order.platformFee;
    final totalAmount = order.totalAmount;

    return Scaffold(
      appBar: AppBar(
        title: Text('Order #${order.id}'),
        actions: [
          if (_canUnassign)
            PopupMenuButton<_OrderDetailsMenuAction>(
              enabled: !_isUnassigning && !widget.isMutating,
              tooltip: 'More options',
              icon: const Icon(Icons.more_vert_rounded),
              onSelected: (action) {
                if (action == _OrderDetailsMenuAction.unassign) {
                  _confirmAndUnassign();
                }
              },
              itemBuilder: (context) => [
                PopupMenuItem<_OrderDetailsMenuAction>(
                  value: _OrderDetailsMenuAction.unassign,
                  enabled: !_isUnassigning && !widget.isMutating,
                  child: Row(
                    children: [
                      const Icon(Icons.assignment_return_rounded, size: 18),
                      const SizedBox(width: 8),
                      const Text('Unassign Order'),
                    ],
                  ),
                ),
              ],
            ),
        ],
      ),
      body: Stack(
        children: [
          ListView(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 20),
            children: [
              Container(
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
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Customer',
                          style: theme.textTheme.titleSmall
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            order.customerName,
                            textAlign: TextAlign.right,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodyMedium
                                ?.copyWith(fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    const Divider(height: 1),
                    const SizedBox(height: 12),
                    Text(
                      'Order Summary',
                      style: theme.textTheme.titleSmall
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Text('Items', style: theme.textTheme.bodyMedium),
                        const Spacer(),
                        Text(
                          '${order.itemsCount} item${order.itemsCount == 1 ? '' : 's'}',
                          style: theme.textTheme.bodyMedium
                              ?.copyWith(fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Text('Item Total', style: theme.textTheme.bodyMedium),
                        const Spacer(),
                        Text(
                          _formatAmount(itemTotal),
                          style: theme.textTheme.bodyMedium
                              ?.copyWith(fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Text('Delivery Fee', style: theme.textTheme.bodyMedium),
                        const Spacer(),
                        Text(
                          _formatAmount(deliveryFee),
                          style: theme.textTheme.bodyMedium
                              ?.copyWith(fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Text('Platform Fee', style: theme.textTheme.bodyMedium),
                        const Spacer(),
                        Text(
                          _formatAmount(platformFee),
                          style: theme.textTheme.bodyMedium
                              ?.copyWith(fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                    if (discountAmount > 0) ...[
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Text(
                            order.promoCode.isEmpty
                                ? 'Discount'
                                : 'Discount (${order.promoCode})',
                            style: theme.textTheme.bodyMedium,
                          ),
                          const Spacer(),
                          Text(
                            '-${_formatAmount(discountAmount)}',
                            style: theme.textTheme.bodyMedium
                                ?.copyWith(fontWeight: FontWeight.w600),
                          ),
                        ],
                      ),
                    ],
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8),
                      child: Divider(height: 1),
                    ),
                    Row(
                      children: [
                        Text(
                          'Total',
                          style: theme.textTheme.titleSmall
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const Spacer(),
                        Text(
                          _formatAmount(totalAmount),
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w800,
                            color: colorScheme.primary,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: _openDeliveryLocationInMaps,
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: colorScheme.surface,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                        color: colorScheme.outlineVariant.withOpacity(0.45)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            'Delivery Location',
                            style: theme.textTheme.titleSmall
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          const Spacer(),
                          Icon(
                            Icons.map_rounded,
                            size: 18,
                            color: colorScheme.primary,
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(order.deliveryAddressText.isEmpty
                          ? 'Address unavailable'
                          : order.deliveryAddressText),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 10),
              if (_canAssign)
                FilledButton(
                  onPressed: (_isAssigningSelf ||
                          widget.isMutating ||
                          _isAnyStatusUpdating)
                      ? null
                      : _handleSelfAssign,
                  child: _statusButtonChild(
                    label: 'Self Assign Order',
                    loading: _isAssigningSelf,
                    spinnerColor: Colors.white,
                  ),
                ),
              const SizedBox(height: 12),
              Text(
                'Items',
                style: theme.textTheme.titleMedium
                    ?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              if (order.items.isEmpty)
                const _EmptyStateCard(message: 'No items found for this order.')
              else
                ...order.items.map(
                  (item) => Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: colorScheme.surface,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: colorScheme.outlineVariant.withOpacity(0.4),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            if (_canMarkPicked)
                              Padding(
                                padding:
                                    const EdgeInsets.only(right: 8, top: 2),
                                child: Checkbox(
                                  value: _isItemCheckedForPickup(item),
                                  onChanged: _isPickupChecklistLocked
                                      ? null
                                      : (value) => _togglePickupItem(
                                            item,
                                            value == true,
                                          ),
                                  visualDensity: VisualDensity.compact,
                                ),
                              ),
                            Expanded(
                              child: Text(
                                item.productName,
                                style: theme.textTheme.bodyMedium?.copyWith(
                                  fontWeight: FontWeight.w600,
                                  decoration: _isItemMarkedMissing(item)
                                      ? TextDecoration.lineThrough
                                      : TextDecoration.none,
                                  color: _isItemMarkedMissing(item)
                                      ? colorScheme.onSurface.withOpacity(0.55)
                                      : (_isItemLockedPicked(item)
                                          ? colorScheme.onSurface
                                              .withOpacity(0.55)
                                          : null),
                                ),
                              ),
                            ),
                            Text(
                              _formatAmount(item.lineTotal),
                              style: theme.textTheme.bodyMedium?.copyWith(
                                fontWeight: FontWeight.w700,
                                decoration: _isItemMarkedMissing(item)
                                    ? TextDecoration.lineThrough
                                    : TextDecoration.none,
                                color: _isItemMarkedMissing(item)
                                    ? colorScheme.onSurface.withOpacity(0.55)
                                    : (_isItemLockedPicked(item)
                                        ? colorScheme.onSurface
                                            .withOpacity(0.55)
                                        : null),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${item.quantity} x ${_formatAmount(item.unitPrice)}',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: _isItemMarkedMissing(item)
                                ? colorScheme.onSurface.withOpacity(0.55)
                                : (_isItemLockedPicked(item)
                                    ? colorScheme.onSurface.withOpacity(0.55)
                                    : colorScheme.onSurface.withOpacity(0.72)),
                            decoration: _isItemMarkedMissing(item)
                                ? TextDecoration.lineThrough
                                : TextDecoration.none,
                          ),
                        ),
                        if (_isItemMarkedMissing(item)) ...[
                          const SizedBox(height: 4),
                          Text(
                            'Not found',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: colorScheme.error,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              if (_isAssignedToCurrentDriver) ...[
                const SizedBox(height: 10),
                Text(
                  'Update Delivery State',
                  style: theme.textTheme.titleSmall
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
                if (_canMarkPicked) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Select found items, then tap Picked. Unchecked items are treated as unavailable. You can tap Picked again to edit.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: colorScheme.onSurface.withOpacity(0.7),
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton(
                      onPressed: (_canMarkPicked &&
                              !_isAnyStatusUpdating &&
                              !widget.isMutating)
                          ? () {
                              if (_currentStatus == 'picked' &&
                                  !_isEditingPickedSelection) {
                                setState(() {
                                  _isEditingPickedSelection = true;
                                });
                                return;
                              }
                              if (_canSubmitPickedSelection) {
                                _handleStatusUpdate('picked');
                              }
                            }
                          : null,
                      child: _statusButtonChild(
                        label: (_currentStatus == 'picked' &&
                                !_isEditingPickedSelection)
                            ? 'Edit Items'
                            : (_currentStatus == 'picked'
                                ? 'Confirm Picked'
                                : 'Picked'),
                        loading: _isActionUpdating('picked'),
                        spinnerColor: colorScheme.primary,
                      ),
                    ),
                    OutlinedButton(
                      onPressed: (_canMarkOutForDelivery &&
                              !_isAnyStatusUpdating &&
                              !widget.isMutating)
                          ? () => _handleStatusUpdate('out_for_delivery')
                          : null,
                      child: _statusButtonChild(
                        label: 'Out for Delivery',
                        loading: _isActionUpdating('out_for_delivery'),
                        spinnerColor: colorScheme.primary,
                      ),
                    ),
                    OutlinedButton(
                      onPressed: (_canCancelUnavailable &&
                              !_isAnyStatusUpdating &&
                              !widget.isMutating)
                          ? () => _handleStatusUpdate('cancelled')
                          : null,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: colorScheme.error,
                      ),
                      child: _statusButtonChild(
                        label: 'Cancel Unavailable',
                        loading: _isActionUpdating('cancelled'),
                        spinnerColor: colorScheme.error,
                      ),
                    ),
                    FilledButton(
                      onPressed: (_canMarkDelivered &&
                              !_isAnyStatusUpdating &&
                              !widget.isMutating)
                          ? () => _handleStatusUpdate('delivered')
                          : null,
                      child: _statusButtonChild(
                        label: 'Delivered',
                        loading: _isActionUpdating('delivered'),
                        spinnerColor: Colors.white,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 84),
              ],
            ],
          ),
          if (_isUnassigning) ...[
            const ModalBarrier(
              dismissible: false,
              color: Colors.black38,
            ),
            const Center(
              child: CircularProgressIndicator(),
            ),
          ],
        ],
      ),
    );
  }
}

class DriverOrderCard extends StatelessWidget {
  const DriverOrderCard({
    super.key,
    required this.order,
    required this.onTap,
    this.trailing,
    this.selectionControl,
  });

  final DriverOrderSummary order;
  final VoidCallback onTap;
  final Widget? trailing;
  final Widget? selectionControl;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Ink(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: colorScheme.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                  color: colorScheme.outlineVariant.withOpacity(0.45)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      'Order #${order.id}',
                      style: theme.textTheme.titleSmall
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    const Spacer(),
                    Text(
                      _statusLabel(order.status),
                      style: theme.textTheme.labelMedium?.copyWith(
                        color: colorScheme.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (selectionControl != null) ...[
                      const SizedBox(width: 4),
                      selectionControl!,
                    ],
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  '${order.itemsCount} item${order.itemsCount == 1 ? '' : 's'} • ${order.createdAtLabel}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: colorScheme.onSurface.withOpacity(0.72),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  order.deliveryAddressText.isEmpty
                      ? 'Delivery location unavailable'
                      : order.deliveryAddressText,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodyMedium,
                ),
                if (trailing != null) ...[
                  const SizedBox(height: 8),
                  Align(alignment: Alignment.centerRight, child: trailing!),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: theme.textTheme.titleMedium
              ?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 2),
        Text(
          subtitle,
          style: theme.textTheme.bodySmall?.copyWith(
            color: colorScheme.onSurface.withOpacity(0.72),
          ),
        ),
      ],
    );
  }
}

class _EmptyStateCard extends StatelessWidget {
  const _EmptyStateCard({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: colorScheme.outlineVariant.withOpacity(0.45)),
      ),
      child: Text(
        message,
        style: theme.textTheme.bodyMedium?.copyWith(
          color: colorScheme.onSurface.withOpacity(0.75),
        ),
      ),
    );
  }
}

class _OrdersLoadMoreFooter extends StatelessWidget {
  const _OrdersLoadMoreFooter({
    required this.hasMore,
    required this.isLoading,
    required this.onPressed,
  });

  final bool hasMore;
  final bool isLoading;
  final Future<void> Function() onPressed;

  @override
  Widget build(BuildContext context) {
    if (!hasMore && !isLoading) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 4, bottom: 6),
      child: Center(
        child: isLoading
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : OutlinedButton(
                onPressed: hasMore ? () => onPressed() : null,
                child: const Text('Load more'),
              ),
      ),
    );
  }
}

class _DriverOrdersPage {
  const _DriverOrdersPage({
    required this.orders,
    required this.hasMore,
    required this.nextCursor,
  });

  final List<DriverOrderSummary> orders;
  final bool hasMore;
  final String? nextCursor;
}

class DriverOrderItemSummary {
  const DriverOrderItemSummary({
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

  factory DriverOrderItemSummary.fromJson(Map<String, dynamic> json) {
    return DriverOrderItemSummary(
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

class DriverOrderSummary {
  const DriverOrderSummary({
    required this.id,
    required this.status,
    required this.paymentStatus,
    required this.currency,
    required this.itemTotal,
    required this.subtotal,
    required this.deliveryFee,
    required this.discountAmount,
    required this.platformFee,
    required this.totalAmount,
    required this.promoCode,
    required this.customerName,
    required this.deliveryAddressText,
    required this.deliveryAddressLabel,
    required this.deliveryLat,
    required this.deliveryLng,
    required this.assignedDriverUid,
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
  final double totalAmount;
  final String promoCode;
  final String customerName;
  final String deliveryAddressText;
  final String deliveryAddressLabel;
  final double? deliveryLat;
  final double? deliveryLng;
  final String assignedDriverUid;
  final List<DriverOrderItemSummary> items;
  final String createdAtLabel;

  int get itemsCount => items.fold(0, (sum, item) => sum + item.quantity);

  factory DriverOrderSummary.fromJson(Map<String, dynamic> json) {
    final items = (json['items'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(DriverOrderItemSummary.fromJson)
        .toList(growable: false);

    final createdAtRaw = json['created_at']?.toString();
    DateTime? createdAt;
    if (createdAtRaw != null) {
      createdAt = DateTime.tryParse(createdAtRaw)?.toLocal();
    }

    final createdAtLabel = createdAt == null
        ? 'Just now'
        : '${createdAt.day.toString().padLeft(2, '0')}/${createdAt.month.toString().padLeft(2, '0')}/${createdAt.year} ${createdAt.hour.toString().padLeft(2, '0')}:${createdAt.minute.toString().padLeft(2, '0')}';

    return DriverOrderSummary(
      id: _asInt(json['id']),
      status: (json['status']?.toString() ?? 'pending').trim().toLowerCase(),
      paymentStatus: (json['payment_status']?.toString() ?? 'pending')
          .trim()
          .toLowerCase(),
      currency: AppConstants.platformCurrency,
      itemTotal: (() {
        final itemTotalRaw = _asDouble(json['item_total']);
        final subtotal = _asDouble(json['subtotal']);
        return itemTotalRaw > 0 ? itemTotalRaw : subtotal;
      })(),
      subtotal: _asDouble(json['subtotal']),
      deliveryFee: _asDouble(json['delivery_fee']),
      discountAmount: _asDouble(json['discount_amount']),
      platformFee: _asDouble(json['platform_fee']),
      totalAmount: (() {
        final itemTotalRaw = _asDouble(json['item_total']);
        final subtotal = _asDouble(json['subtotal']);
        final itemTotal = itemTotalRaw > 0 ? itemTotalRaw : subtotal;
        final deliveryFee = _asDouble(json['delivery_fee']);
        final discountAmount = _asDouble(json['discount_amount']);
        final platformFee = _asDouble(json['platform_fee']);
        final total = _asDouble(json['total_amount']);
        return total > 0
            ? total
            : itemTotal + deliveryFee + platformFee - discountAmount;
      })(),
      promoCode: (json['promo_code']?.toString() ?? '').trim(),
      customerName:
          (json['customer_name']?.toString().trim().isNotEmpty ?? false)
              ? json['customer_name'].toString().trim()
              : 'Customer',
      deliveryAddressText:
          (json['delivery_address_text']?.toString() ?? '').trim(),
      deliveryAddressLabel:
          (json['delivery_address_label']?.toString() ?? '').trim(),
      deliveryLat: _asNullableDouble(json['delivery_lat']),
      deliveryLng: _asNullableDouble(json['delivery_lng']),
      assignedDriverUid: (json['assigned_driver_uid']?.toString() ?? '').trim(),
      items: items,
      createdAtLabel: createdAtLabel,
    );
  }
}

Future<({double? lat, double? lng})> _resolveCoordinatesFromAddressText(
  String fullAddress,
) async {
  final query = fullAddress.trim();
  if (query.isEmpty) return (lat: null, lng: null);

  try {
    final autocompleteResponse = await ApiClient.instance.post(
      '/api/location/autocomplete',
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'input': query,
        'sessionToken': 'driver-${DateTime.now().millisecondsSinceEpoch}',
      }),
    );
    if (autocompleteResponse.statusCode < 200 ||
        autocompleteResponse.statusCode >= 300) {
      return (lat: null, lng: null);
    }

    final autocompleteJson =
        jsonDecode(autocompleteResponse.body) as Map<String, dynamic>;
    final suggestions =
        (autocompleteJson['suggestions'] as List<dynamic>? ?? const []);
    String placeId = '';
    for (final item in suggestions) {
      if (item is! Map<String, dynamic>) continue;
      final prediction = item['placePrediction'];
      if (prediction is! Map<String, dynamic>) continue;
      final candidate = (prediction['placeId']?.toString() ?? '').trim();
      if (candidate.isNotEmpty) {
        placeId = candidate;
        break;
      }
    }
    if (placeId.isEmpty) return (lat: null, lng: null);

    final detailResponse = await ApiClient.instance.get(
      '/api/location/place-details',
      queryParameters: {'placeId': placeId},
    );
    if (detailResponse.statusCode < 200 || detailResponse.statusCode >= 300) {
      return (lat: null, lng: null);
    }

    final detailJson = jsonDecode(detailResponse.body) as Map<String, dynamic>;
    final location =
        detailJson['location'] as Map<String, dynamic>? ?? const {};
    final lat = _asNullableDouble(location['latitude']);
    final lng = _asNullableDouble(location['longitude']);
    if (lat == null ||
        lng == null ||
        !lat.isFinite ||
        !lng.isFinite ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180) {
      return (lat: null, lng: null);
    }
    return (lat: lat, lng: lng);
  } catch (_) {
    return (lat: null, lng: null);
  }
}

class _DriverSavedAddress {
  const _DriverSavedAddress({
    required this.id,
    required this.label,
    required this.fullAddress,
    required this.isDefault,
    this.lat,
    this.lng,
  });

  factory _DriverSavedAddress.fromJson(Map<String, dynamic> json) {
    return _DriverSavedAddress(
      id: _asInt(json['id']),
      label: (json['label']?.toString().trim().isNotEmpty ?? false)
          ? json['label'].toString().trim()
          : 'Home',
      fullAddress: (json['full_address']?.toString() ?? '').trim(),
      isDefault: json['is_default'] == true,
      lat: _asNullableDouble(json['lat']),
      lng: _asNullableDouble(json['lng']),
    );
  }

  final int id;
  final String label;
  final String fullAddress;
  final bool isDefault;
  final double? lat;
  final double? lng;
}

IconData _driverAddressIconForLabel(String label) {
  final normalized = label.trim().toLowerCase();
  if (normalized == 'home') return Icons.home_rounded;
  if (normalized == 'work') return Icons.work_rounded;
  return Icons.place_rounded;
}

int _asInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

double _asDouble(Object? value) {
  if (value is double) return value;
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0;
}

double? _asNullableDouble(Object? value) {
  if (value == null) return null;
  if (value is double) return value;
  if (value is num) return value.toDouble();
  return double.tryParse(value.toString());
}

String _statusLabel(String rawStatus) {
  final normalized = rawStatus.trim().toLowerCase();
  switch (normalized) {
    case 'out_for_delivery':
      return 'Out for Delivery';
    case 'assigned':
      return 'Assigned';
    case 'picked':
      return 'Picked';
    case 'confirmed':
      return 'Confirmed';
    case 'delivered':
      return 'Delivered';
    case 'paid':
      return 'Paid';
    default:
      if (normalized.isEmpty) return 'Unknown';
      return normalized.replaceAll('_', ' ').split(' ').map((segment) {
        if (segment.isEmpty) return '';
        return '${segment[0].toUpperCase()}${segment.substring(1)}';
      }).join(' ');
  }
}
