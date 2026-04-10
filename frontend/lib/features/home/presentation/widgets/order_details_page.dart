part of '../pages/home_page.dart';

class _OrderDetailsPage extends StatefulWidget {
  const _OrderDetailsPage({required this.order});

  final _OrderSummary order;

  @override
  State<_OrderDetailsPage> createState() => _OrderDetailsPageState();
}

class _OrderDetailsPageState extends State<_OrderDetailsPage>
    with SingleTickerProviderStateMixin {
  late final AnimationController _breathingController;
  bool _isRetryingPayment = false;
  bool _isGeneratingDeliveryPin = false;
  String? _lastCreditsDeliveredNoticeKey;

  @override
  void initState() {
    super.initState();
    _breathingController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
      lowerBound: 0.0,
      upperBound: 1.0,
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _breathingController.dispose();
    super.dispose();
  }

  int? _trackingStepForStatus(String status, String paymentStatus) {
    final normalizedStatus = status.trim().toLowerCase();
    final normalizedPayment = paymentStatus.trim().toLowerCase();
    final isPaymentFailed = normalizedPayment == 'failed';
    final isCancelledFlow =
        normalizedStatus == 'cancelled' || normalizedStatus == 'failed';
    if (isPaymentFailed || isCancelledFlow) {
      return null;
    }

    switch (normalizedStatus) {
      case 'picked':
      case 'packed':
        return 1;
      case 'out_for_delivery':
        return 2;
      case 'delivered':
        return 3;
      case 'pending':
      case 'confirmed':
      default:
        return 0;
    }
  }

  Stream<DocumentSnapshot<Map<String, dynamic>>>? get _realtimeOrderStream {
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    if (uid.isEmpty) return null;
    return FirebaseFirestore.instance
        .collection('users')
        .doc(uid)
        .collection('orders')
        .doc(widget.order.id.toString())
        .snapshots();
  }

  bool _canRetryPayment(String status, String paymentStatus) {
    final normalizedStatus = status.trim().toLowerCase();
    final normalizedPayment = paymentStatus.trim().toLowerCase();
    if (normalizedPayment == 'paid') return false;

    const retryableStatuses = <String>{'pending', 'failed', 'cancelled'};
    const retryablePaymentStatuses = <String>{
      'failed',
      'requires_payment',
      'requires_payment_method',
    };

    return retryableStatuses.contains(normalizedStatus) &&
        retryablePaymentStatuses.contains(normalizedPayment);
  }

  Future<void> _retryPayment() async {
    if (_isRetryingPayment) return;
    setState(() {
      _isRetryingPayment = true;
    });

    try {
      final response = await ApiClient.instance.post(
        '/api/create-payment-intent',
        authenticated: true,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'order_id': widget.order.id,
          'currency': AppConstants.platformCurrency,
        }),
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('Failed to retry payment (${response.statusCode})');
      }
      final data = jsonDecode(response.body) as Map<String, dynamic>? ?? {};
      final paymentRequired = data['payment_required'] != false;
      if (!paymentRequired) {
        if (!mounted) return;
        AppSnackBar.show(
          context,
          'Order marked paid. Pull to refresh orders status.',
        );
        return;
      }
      final clientSecret = data['client_secret']?.toString() ?? '';
      final publishableKey = data['publishable_key']?.toString() ?? '';
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

      if (!mounted) return;
      AppSnackBar.show(
        context,
        'Payment successful. Pull to refresh orders status.',
      );
    } on StripeException catch (error) {
      if (!mounted) return;
      final message = error.error.localizedMessage?.trim() ?? '';
      if (message.toLowerCase().contains('canceled')) {
        AppSnackBar.show(context, 'Payment canceled');
      } else {
        AppSnackBar.show(context, message.isEmpty ? 'Payment failed' : message);
      }
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (!mounted) return;
      setState(() {
        _isRetryingPayment = false;
      });
    }
  }

  Future<void> _generateDeliveryPin() async {
    if (_isGeneratingDeliveryPin) return;
    setState(() {
      _isGeneratingDeliveryPin = true;
    });
    try {
      final response = await ApiClient.instance.post(
        '/api/orders/${widget.order.id}/generate-delivery-pin',
        authenticated: true,
      );
      final data = jsonDecode(response.body) as Map<String, dynamic>? ?? {};
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          data['message']?.toString() ??
              'Unable to generate delivery PIN (${response.statusCode})',
        );
      }
      if (!mounted) return;
      AppSnackBar.show(context, 'Delivery PIN generated');
    } catch (error) {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        error.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (!mounted) return;
      setState(() {
        _isGeneratingDeliveryPin = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final order = widget.order;
    final realtimeOrderStream = _realtimeOrderStream;
    const steps = [
      'Order Received',
      'Order Picked',
      'Out For Delivery',
      'Delivered',
    ];

    return Scaffold(
      appBar: AppBar(
        title: Text('Order #${order.id}'),
      ),
      body: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        stream: realtimeOrderStream,
        builder: (context, snapshot) {
          final realtimeData = snapshot.data?.data();
          final liveStatus = realtimeData?['status']?.toString().trim() ?? '';
          final livePaymentStatus =
              realtimeData?['payment_status']?.toString().trim() ?? '';
          final status = liveStatus.isEmpty ? order.status : liveStatus;
          final paymentStatus = livePaymentStatus.isEmpty
              ? order.paymentStatus
              : livePaymentStatus;
          final liveDeliveryPin =
              realtimeData?['delivery_pin']?.toString().trim() ?? '';
          final deliveryPin =
              liveDeliveryPin.isNotEmpty ? liveDeliveryPin : order.deliveryPin;
          final liveMissingItemsCreditEarned = realtimeData != null &&
                  realtimeData.containsKey('missing_items_credit_earned')
              ? _asDouble(realtimeData['missing_items_credit_earned'])
              : order.missingItemsCreditEarned;
          final activeStep = _trackingStepForStatus(status, paymentStatus);
          final normalizedStatus = status.trim().toLowerCase();
          if (normalizedStatus == 'delivered' &&
              liveMissingItemsCreditEarned > 0) {
            final noticeKey =
                '${order.id}:${liveMissingItemsCreditEarned.toStringAsFixed(2)}';
            if (_lastCreditsDeliveredNoticeKey != noticeKey) {
              _lastCreditsDeliveredNoticeKey = noticeKey;
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (!mounted) return;
                AppSnackBar.show(
                  context,
                  'Credits added for not found items: \$${liveMissingItemsCreditEarned.toStringAsFixed(2)}',
                );
              });
            }
          }
          final showTracking = [
            'confirmed',
            'assigned',
            'picked',
            'packed',
            'out_for_delivery',
            'delivered',
          ].contains(normalizedStatus);
          final canGenerateDeliveryPin = deliveryPin.isEmpty &&
              paymentStatus.trim().toLowerCase() == 'paid' &&
              const {
                'confirmed',
                'assigned',
                'picked',
                'packed',
                'out_for_delivery',
              }.contains(normalizedStatus);
          final itemTotal = order.itemTotal;
          final deliveryFee = order.deliveryFee;
          final discountAmount = order.discountAmount;
          final platformFee = order.platformFee;
          final orderTotal = order.totalAmount;
          final showDriverPickedState = const {
            'picked',
            'packed',
            'out_for_delivery',
            'delivered',
          }.contains(normalizedStatus);

          return ListView(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 24),
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                      color: colorScheme.outlineVariant.withOpacity(0.5)),
                  color: colorScheme.surface,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Status: ${status.replaceAll('_', ' ').toUpperCase()}',
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                        color: colorScheme.primary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Payment: ${paymentStatus.replaceAll('_', ' ').toUpperCase()}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: colorScheme.onSurface.withOpacity(0.75),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      order.createdAtLabel,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: colorScheme.onSurface.withOpacity(0.75),
                      ),
                    ),
                    if (deliveryPin.isNotEmpty &&
                        normalizedStatus != 'delivered') ...[
                      const SizedBox(height: 10),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(10),
                          color: colorScheme.primaryContainer.withOpacity(0.42),
                        ),
                        child: Text(
                          'Delivery PIN: $deliveryPin',
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ],
                    if (canGenerateDeliveryPin) ...[
                      const SizedBox(height: 10),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: _isGeneratingDeliveryPin
                              ? null
                              : _generateDeliveryPin,
                          icon: _isGeneratingDeliveryPin
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.pin_rounded, size: 16),
                          label: Text(
                            _isGeneratingDeliveryPin
                                ? 'Generating PIN...'
                                : 'Generate Delivery PIN',
                          ),
                        ),
                      ),
                    ],
                    if (liveMissingItemsCreditEarned > 0) ...[
                      const SizedBox(height: 10),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(10),
                          color:
                              colorScheme.tertiaryContainer.withOpacity(0.42),
                        ),
                        child: Text(
                          'Credits added: \$${liveMissingItemsCreditEarned.toStringAsFixed(2)}\nAuto-applied on your next order.',
                          style: theme.textTheme.bodySmall?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                    if (_canRetryPayment(status, paymentStatus)) ...[
                      const SizedBox(height: 10),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          onPressed: _isRetryingPayment ? null : _retryPayment,
                          icon: _isRetryingPayment
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              : const Icon(Icons.refresh_rounded, size: 16),
                          label: Text(
                            _isRetryingPayment
                                ? 'Retrying...'
                                : 'Retry Payment',
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (showTracking) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                        color: colorScheme.outlineVariant.withOpacity(0.45)),
                    color: colorScheme.surface,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Tracking',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 14),
                      LayoutBuilder(
                        builder: (context, constraints) {
                          const markerSize = 44.0;
                          const roadThickness = 4.0;
                          const logoOffsetXStart = 10.0;
                          const logoOffsetXDelivered = -14.0;
                          final activeIndex = activeStep == null
                              ? 0
                              : activeStep!.clamp(0, steps.length - 1);
                          final progressRatio = steps.length <= 1
                              ? 0.0
                              : activeIndex / (steps.length - 1);
                          final maxLineWidth =
                              constraints.maxWidth - markerSize;
                          final stepSpacing = steps.length <= 1
                              ? 0.0
                              : maxLineWidth / (steps.length - 1);
                          final progressWidth = (maxLineWidth * progressRatio)
                              .clamp(0.0, maxLineWidth);
                          final disableActivePulse =
                              normalizedStatus == 'delivered';
                          final logoOffsetX = disableActivePulse
                              ? logoOffsetXDelivered
                              : logoOffsetXStart;

                          return Column(
                            children: [
                              SizedBox(
                                height: markerSize + 12,
                                child: Stack(
                                  children: [
                                    Positioned(
                                      left: markerSize / 2,
                                      right: markerSize / 2,
                                      top: markerSize - 8,
                                      child: Container(
                                        height: roadThickness,
                                        decoration: BoxDecoration(
                                          color: colorScheme.outlineVariant
                                              .withOpacity(0.45),
                                          borderRadius:
                                              BorderRadius.circular(100),
                                        ),
                                      ),
                                    ),
                                    Positioned(
                                      left: markerSize / 2,
                                      top: markerSize - 8,
                                      child: Container(
                                        width: progressWidth,
                                        height: roadThickness,
                                        decoration: BoxDecoration(
                                          color: colorScheme.primary,
                                          borderRadius:
                                              BorderRadius.circular(100),
                                        ),
                                      ),
                                    ),
                                    Positioned(
                                      top: 0,
                                      left: 0,
                                      right: 0,
                                      child: Row(
                                        mainAxisAlignment:
                                            MainAxisAlignment.spaceBetween,
                                        children: List<Widget>.generate(
                                            steps.length, (stepIndex) {
                                          final isDone = activeStep != null &&
                                              activeStep! > stepIndex;
                                          final dotColor = isDone
                                              ? colorScheme.primary
                                              : colorScheme.outlineVariant
                                                  .withOpacity(0.55);
                                          return SizedBox(
                                            width: markerSize,
                                            height: markerSize + 12,
                                            child: Stack(
                                              alignment: Alignment.topCenter,
                                              children: [
                                                Positioned(
                                                  top: markerSize - 11,
                                                  child: Container(
                                                    width: 10,
                                                    height: 10,
                                                    decoration: BoxDecoration(
                                                      shape: BoxShape.circle,
                                                      color: dotColor,
                                                    ),
                                                  ),
                                                ),
                                              ],
                                            ),
                                          );
                                        }),
                                      ),
                                    ),
                                    AnimatedPositioned(
                                      duration:
                                          const Duration(milliseconds: 800),
                                      curve: Curves.easeInOutCubic,
                                      left: (activeIndex * stepSpacing) +
                                          logoOffsetX,
                                      top: 4,
                                      child: disableActivePulse
                                          ? Image.asset(
                                              'assets/images/Logo.PNG',
                                              width: markerSize,
                                              height: markerSize,
                                              fit: BoxFit.contain,
                                            )
                                          : AnimatedBuilder(
                                              animation: _breathingController,
                                              builder: (context, _) {
                                                final scale = 1 +
                                                    (_breathingController
                                                            .value *
                                                        0.15);
                                                return Transform.scale(
                                                  scale: scale,
                                                  child: Image.asset(
                                                    'assets/images/Logo.PNG',
                                                    width: markerSize,
                                                    height: markerSize,
                                                    fit: BoxFit.contain,
                                                  ),
                                                );
                                              },
                                            ),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 6),
                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: List<Widget>.generate(steps.length,
                                    (stepIndex) {
                                  final isDone = activeStep != null &&
                                      activeStep! > stepIndex;
                                  final isActive = activeStep != null &&
                                      activeStep! == stepIndex;
                                  return SizedBox(
                                    width: 72,
                                    child: Text(
                                      steps[stepIndex],
                                      textAlign: TextAlign.center,
                                      style:
                                          theme.textTheme.labelSmall?.copyWith(
                                        fontWeight: isActive || isDone
                                            ? FontWeight.w700
                                            : FontWeight.w500,
                                        color: isActive || isDone
                                            ? colorScheme.onSurface
                                            : colorScheme.onSurface
                                                .withOpacity(0.65),
                                      ),
                                    ),
                                  );
                                }),
                              ),
                            ],
                          );
                        },
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                      color: colorScheme.outlineVariant.withOpacity(0.45)),
                  color: colorScheme.surface,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Items',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (order.items.isEmpty)
                      Text(
                        'No item details available.',
                        style: theme.textTheme.bodySmall,
                      )
                    else
                      ...order.items.map(
                        (item) {
                          final isMissing = showDriverPickedState &&
                              item.pickedByDriver == false;
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        item.productName,
                                        style: theme.textTheme.bodyMedium
                                            ?.copyWith(
                                          fontWeight: FontWeight.w600,
                                          decoration: isMissing
                                              ? TextDecoration.lineThrough
                                              : null,
                                          color: isMissing
                                              ? colorScheme.onSurface
                                                  .withOpacity(0.6)
                                              : null,
                                        ),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        'Qty ${item.quantity} x \$${item.unitPrice.toStringAsFixed(2)}',
                                        style:
                                            theme.textTheme.bodySmall?.copyWith(
                                          color: colorScheme.onSurface
                                              .withOpacity(0.72),
                                          decoration: isMissing
                                              ? TextDecoration.lineThrough
                                              : null,
                                        ),
                                      ),
                                      if (isMissing)
                                        Text(
                                          'Item not available',
                                          style: theme.textTheme.labelSmall
                                              ?.copyWith(
                                            color: Colors.redAccent,
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Text(
                                  '\$${item.lineTotal.toStringAsFixed(2)}',
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                    fontWeight: FontWeight.w700,
                                    decoration: isMissing
                                        ? TextDecoration.lineThrough
                                        : null,
                                    color: isMissing
                                        ? colorScheme.onSurface.withOpacity(0.6)
                                        : null,
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                      color: colorScheme.outlineVariant.withOpacity(0.45)),
                  color: colorScheme.surface,
                ),
                child: Column(
                  children: [
                    _billRow(
                      context,
                      label: 'Item Total',
                      value: '\$${itemTotal.toStringAsFixed(2)}',
                    ),
                    const SizedBox(height: 6),
                    _billRow(
                      context,
                      label: 'Delivery Fee',
                      value: '\$${deliveryFee.toStringAsFixed(2)}',
                    ),
                    const SizedBox(height: 6),
                    _billRow(
                      context,
                      label: 'Platform Fee',
                      value: '\$${platformFee.toStringAsFixed(2)}',
                    ),
                    if (discountAmount > 0) ...[
                      const SizedBox(height: 6),
                      _billRow(
                        context,
                        label: order.promoCode.isEmpty
                            ? 'Discount'
                            : 'Discount (${order.promoCode})',
                        value: '-\$${discountAmount.toStringAsFixed(2)}',
                      ),
                    ],
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 10),
                      child: Divider(height: 1),
                    ),
                    _billRow(
                      context,
                      label: 'Order Total',
                      value: '\$${orderTotal.toStringAsFixed(2)}',
                      emphasize: true,
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _billRow(
    BuildContext context, {
    required String label,
    required String value,
    bool emphasize = false,
  }) {
    final style = Theme.of(context).textTheme.bodyMedium?.copyWith(
          fontWeight: emphasize ? FontWeight.w800 : FontWeight.w500,
        );
    return Row(
      children: [
        Text(label, style: style),
        const Spacer(),
        Text(value, style: style),
      ],
    );
  }
}
