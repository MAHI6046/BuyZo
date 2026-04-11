part of '../pages/home_page.dart';

class _DotBotSheet extends StatefulWidget {
  const _DotBotSheet({
    required this.conversation,
    required this.context,
    required this.cartItems,
    required this.onApplyActions,
    required this.onSetCartQuantity,
    required this.onConversationChanged,
    required this.onContextChanged,
  });

  final List<_DotBotMessage> conversation;
  final Map<String, dynamic> context;
  final List<_DotBotCartItem> cartItems;
  final Future<void> Function(List<_DotBotAction> actions) onApplyActions;
  final Future<void> Function(int productId, int quantity) onSetCartQuantity;
  final ValueChanged<List<_DotBotMessage>> onConversationChanged;
  final ValueChanged<Map<String, dynamic>> onContextChanged;

  @override
  State<_DotBotSheet> createState() => _DotBotSheetState();
}

class _DotBotSheetState extends State<_DotBotSheet>
    with SingleTickerProviderStateMixin {
  final TextEditingController _textController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final AudioRecorder _audioRecorder = AudioRecorder();
  final AudioPlayer _audioPlayer = AudioPlayer();
  late final AnimationController _typingController;

  late List<_DotBotMessage> _messages;
  late Map<String, dynamic> _context;
  final Map<int, int> _localCartQuantities = {};
  final Map<int, _DotBotProductMeta> _productMetaById = {};
  final Set<int> _adjustingProductIds = {};
  final Set<int> _adjustingSuggestionProductIds = {};
  List<_DotBotSuggestionOption> _pendingAddSuggestions = const [];
  int _pendingSuggestionStepQty = 1;
  String _recordingMimeType = 'audio/mp4';
  bool _isSending = false;
  bool _isVoiceMode = false;
  bool _isRecording = false;
  int _messageSequence = 0;

  @override
  void initState() {
    super.initState();
    _typingController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 920),
    )..repeat();
    _messages = widget.conversation.map((message) {
      _messageSequence += 1;
      return message.copyWith(
        localId: _messageSequence,
        animateIn: false,
      );
    }).toList(growable: true);
    _context = Map<String, dynamic>.from(widget.context);
    for (final item in widget.cartItems) {
      _localCartQuantities[item.productId] = item.quantity;
      _productMetaById[item.productId] = _DotBotProductMeta(
        name: item.name,
        unitPrice: item.unitPrice,
        sizeLabel: item.sizeLabel,
      );
    }
    unawaited(_configureAudioPlayback());
    if (_messages.isEmpty) {
      _messageSequence += 1;
      _messages = [
        _DotBotMessage(
          role: 'assistant',
          content:
              'Hello, I am your DOTBOT. List the items that you want to buy',
          localId: _messageSequence,
          animateIn: false,
        ),
      ];
    }
    _syncPendingSuggestionsFromContext(notify: false);
  }

  Future<void> _configureAudioPlayback() async {
    try {
      await _audioPlayer.setAudioContext(
        AudioContext(
          iOS: AudioContextIOS(
            category: AVAudioSessionCategory.playback,
          ),
          android: const AudioContextAndroid(
            usageType: AndroidUsageType.media,
            contentType: AndroidContentType.speech,
            audioFocus: AndroidAudioFocus.gain,
          ),
        ),
      );
    } catch (_) {
      // Ignore; player will use platform defaults.
    }
  }

  @override
  void dispose() {
    _textController.dispose();
    _scrollController.dispose();
    _audioRecorder.dispose();
    _audioPlayer.dispose();
    _typingController.dispose();
    widget.onConversationChanged(_messages);
    widget.onContextChanged(_context);
    super.dispose();
  }

  bool _isNearBottom({double threshold = 96}) {
    if (!_scrollController.hasClients) return true;
    final position = _scrollController.position;
    return (position.maxScrollExtent - position.pixels) <= threshold;
  }

  void _scrollToBottom({bool force = false}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      final position = _scrollController.position;
      if (!force && !_isNearBottom()) return;

      final target = position.maxScrollExtent;
      final delta = (target - position.pixels).abs();
      if (delta < 2) return;

      final ms = (120 + (delta * 0.18)).round().clamp(120, 280);
      _scrollController.animateTo(
        target,
        duration: Duration(milliseconds: ms),
        curve: Curves.easeOutCubic,
      );
    });
  }

  void _appendMessage(_DotBotMessage message) {
    _messageSequence += 1;
    final nextMessage = message.copyWith(
      localId: _messageSequence,
      animateIn: true,
    );
    setState(() {
      _messages = [..._messages, nextMessage];
    });
    widget.onConversationChanged(_messages);
    _scrollToBottom(force: true);
  }

  List<Map<String, dynamic>> _conversationPayload() {
    const maxTurns = 14;
    final trimmed = _messages.length > maxTurns
        ? _messages.sublist(_messages.length - maxTurns)
        : _messages;
    return trimmed
        .map((message) => {'role': message.role, 'content': message.content})
        .toList(growable: false);
  }

  List<Map<String, dynamic>> _cartPayload() {
    final payload = <Map<String, dynamic>>[];
    for (final entry in _localCartQuantities.entries) {
      final quantity = entry.value;
      if (quantity <= 0) continue;
      final productId = entry.key;
      final meta = _productMetaById[productId];
      payload.add({
        'product_id': productId,
        'name': meta?.name ?? 'Product $productId',
        'quantity': quantity,
        'unit_price': meta?.unitPrice ?? 0,
        'size_label': meta?.sizeLabel ?? '',
      });
    }
    return payload;
  }

  double _asDouble(dynamic value) {
    if (value is double) return value;
    if (value is num) return value.toDouble();
    return double.tryParse('$value') ?? 0;
  }

  int _asInt(dynamic value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    return int.tryParse('$value') ?? 0;
  }

  void _syncPendingSuggestionsFromContext({bool notify = true}) {
    final pendingRaw = _context['pending_selection'];
    final parsedSuggestions = <_DotBotSuggestionOption>[];
    var stepQty = 1;

    if (pendingRaw is Map) {
      final pending = Map<String, dynamic>.from(pendingRaw);
      final operation = '${pending['operation'] ?? ''}'.trim().toLowerCase();
      final optionsRaw = pending['options'];
      final candidateStep = _asInt(pending['quantity']);
      if (candidateStep > 0) {
        stepQty = candidateStep;
      }

      if (operation == 'add' && optionsRaw is List) {
        final seenIds = <int>{};
        for (final raw in optionsRaw) {
          if (raw is! Map) continue;
          final map = Map<String, dynamic>.from(raw);
          final productId = _asInt(map['id']);
          if (productId <= 0 || seenIds.contains(productId)) continue;
          seenIds.add(productId);

          final name = '${map['name'] ?? ''}'.trim();
          if (name.isEmpty) continue;
          final sizeLabel = '${map['size_label'] ?? map['size'] ?? ''}'.trim();
          final unitPrice = _asDouble(map['price_sale']);
          parsedSuggestions.add(
            _DotBotSuggestionOption(
              productId: productId,
              name: name,
              sizeLabel: sizeLabel,
              unitPrice: unitPrice,
            ),
          );

          final existingMeta = _productMetaById[productId];
          final fallbackPrice = existingMeta?.unitPrice ?? 0;
          final fallbackSize = existingMeta?.sizeLabel ?? '';
          _productMetaById[productId] = _DotBotProductMeta(
            name: name,
            unitPrice: unitPrice > 0 ? unitPrice : fallbackPrice,
            sizeLabel: sizeLabel.isNotEmpty ? sizeLabel : fallbackSize,
            selectedVariantId: existingMeta?.selectedVariantId,
            variants: existingMeta?.variants ?? const [],
          );
        }
      }
    }

    if (notify) {
      setState(() {
        _pendingAddSuggestions = parsedSuggestions;
        _pendingSuggestionStepQty = stepQty;
      });
      if (parsedSuggestions.isNotEmpty && _isNearBottom()) {
        _scrollToBottom();
      }
    } else {
      _pendingAddSuggestions = parsedSuggestions;
      _pendingSuggestionStepQty = stepQty;
    }
  }

  Future<void> _adjustSuggestedProduct({
    required _DotBotSuggestionOption suggestion,
    required int delta,
  }) async {
    if (delta == 0) return;
    final productId = suggestion.productId;
    if (_adjustingSuggestionProductIds.contains(productId)) return;

    final currentQty = _localCartQuantities[productId] ?? 0;
    final stepQty = math.max(1, _pendingSuggestionStepQty);
    final nextQty = math.max(0, currentQty + (delta * stepQty));
    if (nextQty == currentQty) return;

    setState(() {
      _adjustingSuggestionProductIds.add(productId);
      if (nextQty <= 0) {
        _localCartQuantities.remove(productId);
      } else {
        _localCartQuantities[productId] = nextQty;
      }
    });

    try {
      await widget.onSetCartQuantity(productId, nextQty);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        if (currentQty <= 0) {
          _localCartQuantities.remove(productId);
        } else {
          _localCartQuantities[productId] = currentQty;
        }
      });
    } finally {
      if (!mounted) return;
      setState(() {
        _adjustingSuggestionProductIds.remove(productId);
      });
    }
  }

  List<_DotBotVariantOption> _parseVariantOptions(
    dynamic rawVariants, {
    required double fallbackPrice,
    required String fallbackSize,
  }) {
    final parsed = <_DotBotVariantOption>[];
    if (rawVariants is List) {
      for (final raw in rawVariants) {
        if (raw is! Map) continue;
        final map = Map<String, dynamic>.from(raw);
        final id = _asInt(map['id']);
        final label = '${map['label'] ?? ''}'.trim();
        final grams = _asInt(map['grams']);
        final sizeCode = '${map['size_code'] ?? ''}'.trim();
        final title = label.isNotEmpty
            ? label
            : grams > 0
                ? '$grams g'
                : sizeCode;
        if (title.isEmpty) continue;
        final salePrice = _asDouble(map['sale_price']);
        if (salePrice <= 0) continue;
        parsed.add(
          _DotBotVariantOption(
            id: id > 0 ? id : title.hashCode,
            title: title,
            salePrice: salePrice,
            isDefault: map['is_default'] == true,
          ),
        );
      }
    }

    final deduped = <_DotBotVariantOption>[];
    final seen = <String>{};
    for (final option in parsed) {
      final key = '${option.id}|${option.title.toLowerCase()}';
      if (seen.contains(key)) continue;
      seen.add(key);
      deduped.add(option);
    }
    if (deduped.isNotEmpty) return deduped;

    final fallbackTitle = fallbackSize.trim();
    if (fallbackTitle.isNotEmpty && fallbackPrice > 0) {
      return [
        _DotBotVariantOption(
          id: fallbackTitle.hashCode,
          title: fallbackTitle,
          salePrice: fallbackPrice,
          isDefault: true,
        ),
      ];
    }
    return const [];
  }

  _DotBotVariantOption? _pickSelectedVariant(
    List<_DotBotVariantOption> options, {
    int? preferredId,
    String preferredLabel = '',
  }) {
    String normalizeLabel(String value) {
      return value.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');
    }

    if (options.isEmpty) return null;
    if (preferredId != null) {
      for (final option in options) {
        if (option.id == preferredId) return option;
      }
    }
    final normalizedPreferred = normalizeLabel(preferredLabel.trim());
    if (normalizedPreferred.isNotEmpty) {
      for (final option in options) {
        if (normalizeLabel(option.title.trim()) == normalizedPreferred) {
          return option;
        }
      }
    }
    return options.first;
  }

  List<_DotBotCartPreviewItem> _buildCartPreviewItems(
    List<_DotBotAction> actions,
  ) {
    var hasCartMutation = false;
    for (final action in actions) {
      final type = action.type;
      if (type != 'add_to_cart' &&
          type != 'set_cart_quantity' &&
          type != 'remove_from_cart') {
        continue;
      }

      final payload = action.productPayload ?? const <String, dynamic>{};
      final payloadName = '${payload['name'] ?? ''}'.trim();
      final knownMeta = _productMetaById[action.productId];
      final name = payloadName.isNotEmpty
          ? payloadName
          : (knownMeta?.name ?? 'Product ${action.productId}');

      final payloadUnitPrice = _asDouble(payload['price_sale']);
      final payloadSizeLabel =
          '${payload['size_label'] ?? payload['size'] ?? ''}'.trim();
      final knownSizeLabel = knownMeta?.sizeLabel ?? '';
      final knownUnitPrice = knownMeta?.unitPrice ?? 0;
      final variantOptions = _parseVariantOptions(
        payload['variants'],
        fallbackPrice: payloadUnitPrice > 0 ? payloadUnitPrice : knownUnitPrice,
        fallbackSize:
            payloadSizeLabel.isNotEmpty ? payloadSizeLabel : knownSizeLabel,
      );
      final selectedVariant = _pickSelectedVariant(
        variantOptions,
        preferredId: knownMeta?.selectedVariantId,
        preferredLabel:
            payloadSizeLabel.isNotEmpty ? payloadSizeLabel : knownSizeLabel,
      );
      final unitPrice = selectedVariant?.salePrice ??
          (payloadUnitPrice > 0 ? payloadUnitPrice : knownUnitPrice);
      final sizeLabel = selectedVariant?.title ??
          (payloadSizeLabel.isNotEmpty ? payloadSizeLabel : knownSizeLabel);

      _productMetaById[action.productId] = _DotBotProductMeta(
        name: name,
        unitPrice: unitPrice,
        sizeLabel: sizeLabel,
        selectedVariantId: selectedVariant?.id,
        variants: variantOptions,
      );

      final currentQty = _localCartQuantities[action.productId] ?? 0;
      if (type == 'add_to_cart') {
        if (action.quantity <= 0) continue;
        hasCartMutation = true;
        final nextQty = currentQty + action.quantity;
        _localCartQuantities[action.productId] = nextQty;
        continue;
      }
      if (type == 'set_cart_quantity') {
        if (action.quantity < 0) continue;
        hasCartMutation = true;
        if (action.quantity == 0) {
          _localCartQuantities.remove(action.productId);
        } else {
          _localCartQuantities[action.productId] = action.quantity;
        }
        continue;
      }
      if (action.quantity <= 0) continue;
      hasCartMutation = true;
      final nextQty = math.max(0, currentQty - action.quantity);
      if (nextQty <= 0) {
        _localCartQuantities.remove(action.productId);
      } else {
        _localCartQuantities[action.productId] = nextQty;
      }
    }

    if (!hasCartMutation) return const [];

    final previewItems = <_DotBotCartPreviewItem>[];
    for (final entry in _localCartQuantities.entries) {
      final quantity = entry.value;
      if (quantity <= 0) continue;
      final productId = entry.key;
      final meta = _productMetaById[productId];
      final name = meta?.name ?? 'Product $productId';
      final unitPrice = meta?.unitPrice ?? 0;
      final sizeLabel = meta?.sizeLabel ?? '';
      previewItems.add(
        _DotBotCartPreviewItem(
          productId: productId,
          name: name,
          quantity: quantity,
          unitPrice: unitPrice,
          sizeLabel: sizeLabel,
          selectedVariantId: meta?.selectedVariantId,
          variants: meta?.variants ?? const [],
        ),
      );
    }

    previewItems
        .sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    return previewItems;
  }

  Future<void> _adjustPreviewItem({
    required int messageIndex,
    required int productId,
    required int delta,
  }) async {
    if (delta == 0 || _adjustingProductIds.contains(productId)) return;
    final currentQty = _localCartQuantities[productId] ?? 0;
    final nextQty = math.max(0, currentQty + delta);
    if (nextQty == currentQty) return;

    setState(() {
      _adjustingProductIds.add(productId);
    });

    try {
      await widget.onSetCartQuantity(productId, nextQty);
      if (nextQty <= 0) {
        _localCartQuantities.remove(productId);
      } else {
        _localCartQuantities[productId] = nextQty;
      }

      setState(() {
        _messages = [
          for (var i = 0; i < _messages.length; i++)
            if (i == messageIndex)
              _messages[i].withUpdatedPreviewItem(
                productId: productId,
                quantity: nextQty,
              )
            else
              _messages[i],
        ];
      });
      widget.onConversationChanged(_messages);
    } catch (_) {
      // Keep UI stable if cart update fails.
    } finally {
      if (!mounted) return;
      setState(() {
        _adjustingProductIds.remove(productId);
      });
    }
  }

  void _selectPreviewItemVariant({
    required int messageIndex,
    required int productId,
    required int variantId,
  }) {
    final meta = _productMetaById[productId];
    if (meta == null || meta.variants.isEmpty) return;
    final selected = meta.variants.firstWhere(
      (item) => item.id == variantId,
      orElse: () => meta.variants.first,
    );

    _productMetaById[productId] = meta.copyWith(
      selectedVariantId: selected.id,
      sizeLabel: selected.title,
      unitPrice: selected.salePrice,
    );

    setState(() {
      _messages = [
        for (var i = 0; i < _messages.length; i++)
          if (i == messageIndex)
            _messages[i].withUpdatedPreviewVariant(
              productId: productId,
              selectedVariantId: selected.id,
              sizeLabel: selected.title,
              unitPrice: selected.salePrice,
            )
          else
            _messages[i],
      ];
    });
    widget.onConversationChanged(_messages);
  }

  Future<void> _sendTextMessage(String rawText,
      {bool speakReply = false}) async {
    final text = rawText.trim();
    if (text.isEmpty || _isSending) return;

    _textController.clear();
    _appendMessage(_DotBotMessage(role: 'user', content: text));
    setState(() {
      _isSending = true;
    });
    _scrollToBottom(force: true);

    try {
      final response = await ApiClient.instance.post(
        '/api/dotbot/message',
        authenticated: true,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'message': text,
          'conversation': _conversationPayload(),
          'context': _context,
          'cart_items': _cartPayload(),
        }),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('DOTBOT request failed (${response.statusCode})');
      }

      final json =
          jsonDecode(response.body) as Map<String, dynamic>? ?? const {};
      final reply = '${json['reply'] ?? ''}'.trim();
      final actions = _parseActions(json['actions']);
      final rawContext = json['context'];
      _context = rawContext is Map
          ? Map<String, dynamic>.from(rawContext)
          : const <String, dynamic>{};
      widget.onContextChanged(_context);
      _syncPendingSuggestionsFromContext();

      final suppressReplyForPendingSuggestions =
          actions.isEmpty && _pendingAddSuggestions.isNotEmpty;

      if (reply.isNotEmpty && !suppressReplyForPendingSuggestions) {
        final previewItems = _buildCartPreviewItems(actions);
        _appendMessage(
          _DotBotMessage(
            role: 'assistant',
            content: reply,
            cartPreviewItems: previewItems,
          ),
        );
        if (speakReply || _isVoiceMode) {
          unawaited(_speakReply(reply));
        }
      }

      if (actions.isNotEmpty) {
        unawaited(widget.onApplyActions(actions).catchError((_) {}));
      }
    } on SessionExpiredException catch (error) {
      _appendMessage(_DotBotMessage(role: 'assistant', content: error.message));
    } catch (error) {
      _appendMessage(
        _DotBotMessage(
          role: 'assistant',
          content: error.toString().replaceFirst('Exception: ', ''),
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSending = false;
        });
      }
    }
  }

  List<_DotBotAction> _parseActions(dynamic rawActions) {
    if (rawActions is! List) return const [];
    final actions = <_DotBotAction>[];

    for (final raw in rawActions) {
      if (raw is! Map) continue;
      final rawMap = Map<String, dynamic>.from(raw);
      final type = '${rawMap['type'] ?? ''}'.trim().toLowerCase();
      final quantityValue = rawMap['quantity'];
      final quantity = quantityValue is num
          ? quantityValue.toInt()
          : int.tryParse('${rawMap['quantity']}') ?? 0;
      final productPayload = rawMap['product'];
      final productMap = productPayload is Map
          ? Map<String, dynamic>.from(productPayload)
          : null;
      final productIdFromProduct = productMap?['id'] is num
          ? (productMap!['id'] as num).toInt()
          : int.tryParse('${productMap?['id']}');
      final productIdValue = rawMap['product_id'];
      final productId = productIdValue is num
          ? productIdValue.toInt()
          : int.tryParse('${rawMap['product_id']}') ??
              productIdFromProduct ??
              0;
      if (productId <= 0 || type.isEmpty) continue;
      final isValid = switch (type) {
        'add_to_cart' => quantity > 0,
        'set_cart_quantity' => quantity >= 0,
        'remove_from_cart' => quantity > 0,
        _ => false,
      };
      if (!isValid) continue;

      actions.add(
        _DotBotAction(
          type: type,
          productId: productId,
          quantity: quantity,
          productPayload: productMap,
        ),
      );
    }

    return actions;
  }

  Future<void> _startRecording() async {
    if (_isRecording || _isSending) return;
    if (kIsWeb) {
      _appendMessage(
        const _DotBotMessage(
          role: 'assistant',
          content: 'Voice mode is not supported on web yet. Use text mode.',
        ),
      );
      return;
    }

    try {
      // Ensure playback session is not holding the AVAudioSession before recording.
      await _audioPlayer.stop();
      await _audioPlayer.release();

      final hasPermission = await _audioRecorder.hasPermission();
      if (!hasPermission) {
        throw Exception('Microphone permission is required for voice mode');
      }

      final supportsWav = await _audioRecorder.isEncoderSupported(
        AudioEncoder.wav,
      );
      final useWav = supportsWav;
      final extension = useWav ? 'wav' : 'm4a';
      final mimeType = useWav ? 'audio/wav' : 'audio/mp4';
      final path =
          '${Directory.systemTemp.path}/dotbot-${DateTime.now().millisecondsSinceEpoch}.$extension';
      await _audioRecorder.start(
        useWav
            ? const RecordConfig(
                encoder: AudioEncoder.wav,
                sampleRate: 16000,
                numChannels: 1,
              )
            : const RecordConfig(
                encoder: AudioEncoder.aacLc,
                bitRate: 128000,
                sampleRate: 16000,
                numChannels: 1,
              ),
        path: path,
      );
      _recordingMimeType = mimeType;

      if (!mounted) return;
      setState(() {
        _isRecording = true;
      });
    } catch (error) {
      _appendMessage(
        _DotBotMessage(
          role: 'assistant',
          content: error.toString().replaceFirst('Exception: ', ''),
        ),
      );
    }
  }

  Future<void> _stopRecordingAndSend() async {
    if (!_isRecording || _isSending) return;
    setState(() {
      _isRecording = false;
    });

    try {
      final path = await _audioRecorder.stop();
      if (path == null || path.isEmpty) {
        throw Exception('No voice recording captured');
      }

      final bytes = await File(path).readAsBytes();
      if (bytes.isEmpty) {
        throw Exception('Voice recording is empty');
      }

      final lowerPath = path.toLowerCase();
      final mimeType = lowerPath.endsWith('.wav')
          ? 'audio/wav'
          : lowerPath.endsWith('.mp3')
              ? 'audio/mpeg'
              : _recordingMimeType;

      final transcript = await _transcribeVoice(bytes, mimeType: mimeType);
      if (transcript.isEmpty) {
        throw Exception('Could not understand voice input');
      }

      await _sendTextMessage(transcript, speakReply: true);
    } catch (error) {
      _appendMessage(
        _DotBotMessage(
          role: 'assistant',
          content: error.toString().replaceFirst('Exception: ', ''),
        ),
      );
    }
  }

  Future<String> _transcribeVoice(
    Uint8List audioBytes, {
    required String mimeType,
  }) async {
    final response = await ApiClient.instance.post(
      '/api/dotbot/transcribe',
      authenticated: true,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'audio_base64': base64Encode(audioBytes),
        'mime_type': mimeType,
      }),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final payload =
          jsonDecode(response.body) as Map<String, dynamic>? ?? const {};
      final message = '${payload['message'] ?? ''}'.trim();
      if (message.isNotEmpty) {
        throw Exception(message);
      }
      throw Exception('Voice transcription failed (${response.statusCode})');
    }

    final json = jsonDecode(response.body) as Map<String, dynamic>? ?? const {};
    return '${json['transcript'] ?? ''}'.trim();
  }

  Future<void> _speakReply(String text) async {
    try {
      final speechText = _toSpeechText(text);
      if (speechText.isEmpty) return;
      final response = await ApiClient.instance.post(
        '/api/dotbot/tts',
        authenticated: true,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'text': speechText}),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        return;
      }

      final json =
          jsonDecode(response.body) as Map<String, dynamic>? ?? const {};
      final audioBase64 = '${json['audio_base64'] ?? ''}'.trim();
      if (audioBase64.isEmpty) return;
      final mimeType = '${json['mime_type'] ?? ''}'.trim();
      final bytes = base64Decode(audioBase64);
      await _audioPlayer.stop();
      await _audioPlayer.play(
        BytesSource(
          bytes,
          mimeType: mimeType.isEmpty ? null : mimeType,
        ),
      );
    } catch (_) {
      // Keep chat responsive even when TTS is temporarily unavailable.
    }
  }

  String _toSpeechText(String text) {
    final normalized =
        text.replaceAll('\n', ' ').replaceAll(RegExp(r'\s+'), ' ').trim();
    if (normalized.isEmpty) return '';

    // Keep spoken response short for low latency.
    final firstSentence = normalized.split(RegExp(r'[.!?]')).first.trim();
    final candidate = firstSentence.isNotEmpty ? firstSentence : normalized;
    if (candidate.length <= 160) return candidate;
    return '${candidate.substring(0, 157).trim()}...';
  }

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final showPendingSuggestions =
        _pendingAddSuggestions.isNotEmpty && !_isSending;

    return Container(
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      ),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      child: SizedBox(
        height: mediaQuery.size.height * 0.78,
        child: Column(
          children: [
            Container(
              width: 46,
              height: 4,
              decoration: BoxDecoration(
                color: colorScheme.outlineVariant,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                CircleAvatar(
                  backgroundColor: colorScheme.primary,
                  foregroundColor: colorScheme.onPrimary,
                  child: const Icon(Icons.smart_toy_rounded),
                ),
                const SizedBox(width: 10),
                Text(
                  'DOTBOT',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const Spacer(),
                SegmentedButton<bool>(
                  segments: const [
                    ButtonSegment<bool>(
                      value: false,
                      icon: Icon(Icons.chat_bubble_outline_rounded),
                      label: Text('Text'),
                    ),
                    ButtonSegment<bool>(
                      value: true,
                      icon: Icon(Icons.mic_rounded),
                      label: Text('Voice'),
                    ),
                  ],
                  selected: {_isVoiceMode},
                  onSelectionChanged: (selection) {
                    if (_isSending || _isRecording) return;
                    setState(() {
                      _isVoiceMode = selection.first;
                    });
                  },
                ),
              ],
            ),
            const SizedBox(height: 12),
            Expanded(
              child: ListView.builder(
                controller: _scrollController,
                itemCount: _messages.length +
                    (showPendingSuggestions ? 1 : 0) +
                    (_isSending ? 1 : 0),
                itemBuilder: (context, index) {
                  var cursor = _messages.length;
                  if (showPendingSuggestions && index == cursor) {
                    return _DotBotSuggestionsPanel(
                      suggestions: _pendingAddSuggestions,
                      quantityByProduct: _localCartQuantities,
                      isAdjustingProduct: (productId) =>
                          _adjustingSuggestionProductIds.contains(productId),
                      onAdjust: (suggestion, delta) => _adjustSuggestedProduct(
                        suggestion: suggestion,
                        delta: delta,
                      ),
                      colorScheme: colorScheme,
                      textTheme: theme.textTheme,
                      stepQty: _pendingSuggestionStepQty,
                    );
                  }
                  if (showPendingSuggestions) {
                    cursor += 1;
                  }
                  if (_isSending && index == cursor) {
                    return _TypingIndicatorBubble(
                      colorScheme: colorScheme,
                      textStyle: theme.textTheme.bodyMedium,
                      animation: _typingController,
                    );
                  }
                  final message = _messages[index];
                  final isUser = message.role == 'user';
                  final previewItems = message.cartPreviewItems;
                  final previewTotal = previewItems.fold<double>(
                    0,
                    (sum, item) => sum + item.lineTotal,
                  );
                  final bubble = Align(
                    alignment:
                        isUser ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                      constraints: const BoxConstraints(maxWidth: 320),
                      decoration: BoxDecoration(
                        color: isUser
                            ? colorScheme.primaryContainer
                            : colorScheme.surfaceContainerHigh
                                .withValues(alpha: 0.92),
                        borderRadius: BorderRadius.circular(16),
                        border: isUser
                            ? null
                            : Border.all(
                                color:
                                    colorScheme.outline.withValues(alpha: 0.42),
                              ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (isUser)
                            Text(message.content)
                          else
                            _BotReplyText(
                              content: message.content,
                              textTheme: theme.textTheme,
                              colorScheme: colorScheme,
                            ),
                          if (previewItems.isNotEmpty) ...[
                            const SizedBox(height: 8),
                            Divider(
                              height: 1,
                              color: colorScheme.outlineVariant,
                            ),
                            const SizedBox(height: 8),
                            for (final item in previewItems)
                              Container(
                                margin: const EdgeInsets.only(bottom: 6),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 6,
                                ),
                                decoration: BoxDecoration(
                                  color: colorScheme.surface.withValues(
                                    alpha: 0.65,
                                  ),
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(
                                    color: colorScheme.outlineVariant
                                        .withValues(alpha: 0.5),
                                  ),
                                ),
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            item.name,
                                            style: theme.textTheme.bodySmall
                                                ?.copyWith(
                                              fontWeight: FontWeight.w700,
                                            ),
                                          ),
                                          Text(
                                            item.sizeLabel.isEmpty
                                                ? '${item.quantity} x \$${item.unitPrice.toStringAsFixed(2)}'
                                                : '${item.quantity} x \$${item.unitPrice.toStringAsFixed(2)} • ${item.sizeLabel}',
                                            style: theme.textTheme.bodySmall,
                                          ),
                                          if (item.variants.length > 1)
                                            DropdownButtonHideUnderline(
                                              child: DropdownButton<int>(
                                                isDense: true,
                                                value: item.selectedVariantId ??
                                                    item.variants.first.id,
                                                items: item.variants
                                                    .map(
                                                      (variant) =>
                                                          DropdownMenuItem<int>(
                                                        value: variant.id,
                                                        child: Text(
                                                          '${variant.title} • \$${variant.salePrice.toStringAsFixed(2)}',
                                                          style: theme.textTheme
                                                              .labelSmall,
                                                        ),
                                                      ),
                                                    )
                                                    .toList(growable: false),
                                                onChanged: (value) {
                                                  if (value == null) return;
                                                  _selectPreviewItemVariant(
                                                    messageIndex: index,
                                                    productId: item.productId,
                                                    variantId: value,
                                                  );
                                                },
                                              ),
                                            ),
                                        ],
                                      ),
                                    ),
                                    IconButton(
                                      visualDensity: VisualDensity.compact,
                                      splashRadius: 18,
                                      onPressed: _adjustingProductIds
                                              .contains(item.productId)
                                          ? null
                                          : () => _adjustPreviewItem(
                                                messageIndex: index,
                                                productId: item.productId,
                                                delta: -1,
                                              ),
                                      icon: const Icon(
                                        Icons.remove_circle_outline_rounded,
                                        size: 18,
                                      ),
                                    ),
                                    Text(
                                      '${item.quantity}',
                                      style:
                                          theme.textTheme.bodySmall?.copyWith(
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    IconButton(
                                      visualDensity: VisualDensity.compact,
                                      splashRadius: 18,
                                      onPressed: _adjustingProductIds
                                              .contains(item.productId)
                                          ? null
                                          : () => _adjustPreviewItem(
                                                messageIndex: index,
                                                productId: item.productId,
                                                delta: 1,
                                              ),
                                      icon: const Icon(
                                        Icons.add_circle_outline_rounded,
                                        size: 18,
                                      ),
                                    ),
                                    Text(
                                      '\$${item.lineTotal.toStringAsFixed(2)}',
                                      style:
                                          theme.textTheme.bodySmall?.copyWith(
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            const SizedBox(height: 2),
                            Align(
                              alignment: Alignment.centerRight,
                              child: Text(
                                'Total: \$${previewTotal.toStringAsFixed(2)}',
                                style: theme.textTheme.bodySmall?.copyWith(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  );
                  return TweenAnimationBuilder<double>(
                    key: ValueKey<int>(message.localId),
                    tween:
                        Tween<double>(begin: message.animateIn ? 0 : 1, end: 1),
                    duration: const Duration(milliseconds: 180),
                    curve: Curves.easeOutCubic,
                    builder: (context, value, child) {
                      return Opacity(
                        opacity: value,
                        child: Transform.translate(
                          offset: Offset(0, (1 - value) * 12),
                          child: child,
                        ),
                      );
                    },
                    child: bubble,
                  );
                },
              ),
            ),
            Builder(
              builder: (context) {
                final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
                return Padding(
                  padding: EdgeInsets.only(bottom: keyboardInset),
                  child: SafeArea(
                    top: false,
                    left: false,
                    right: false,
                    maintainBottomViewPadding: true,
                    child: !_isVoiceMode
                        ? Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: _textController,
                                  enabled: !_isSending,
                                  textInputAction: TextInputAction.send,
                                  decoration: InputDecoration(
                                    isDense: true,
                                    contentPadding: const EdgeInsets.symmetric(
                                      horizontal: 12,
                                      vertical: 10,
                                    ),
                                    hintText: 'Ask DOTBOT to add products...',
                                    border: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    enabledBorder: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    focusedBorder: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    disabledBorder: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                  ),
                                  onSubmitted: (value) =>
                                      _sendTextMessage(value),
                                ),
                              ),
                              const SizedBox(width: 8),
                              FilledButton(
                                onPressed: _isSending
                                    ? null
                                    : () =>
                                        _sendTextMessage(_textController.text),
                                child: const Icon(Icons.send_rounded),
                              ),
                            ],
                          )
                        : Row(
                            children: [
                              Expanded(
                                child: Text(
                                  _isRecording
                                      ? 'Listening... tap stop when done.'
                                      : 'Tap record and say what items you want.',
                                ),
                              ),
                              const SizedBox(width: 8),
                              FilledButton.icon(
                                onPressed: _isSending
                                    ? null
                                    : _isRecording
                                        ? _stopRecordingAndSend
                                        : _startRecording,
                                icon: Icon(
                                  _isRecording
                                      ? Icons.stop_circle_rounded
                                      : Icons.mic_rounded,
                                ),
                                label: Text(_isRecording ? 'Stop' : 'Record'),
                              ),
                            ],
                          ),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _DotBotSuggestionsPanel extends StatelessWidget {
  const _DotBotSuggestionsPanel({
    required this.suggestions,
    required this.quantityByProduct,
    required this.isAdjustingProduct,
    required this.onAdjust,
    required this.colorScheme,
    required this.textTheme,
    required this.stepQty,
  });

  final List<_DotBotSuggestionOption> suggestions;
  final Map<int, int> quantityByProduct;
  final bool Function(int productId) isAdjustingProduct;
  final Future<void> Function(_DotBotSuggestionOption suggestion, int delta)
      onAdjust;
  final ColorScheme colorScheme;
  final TextTheme textTheme;
  final int stepQty;

  @override
  Widget build(BuildContext context) {
    if (suggestions.isEmpty) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      constraints: const BoxConstraints(maxWidth: 330),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHigh.withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: colorScheme.outline.withValues(alpha: 0.42),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Select products to add',
            style: textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          Text(
            'Use + to add directly to cart',
            style: textTheme.bodySmall?.copyWith(
              color: colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 10),
          for (var i = 0; i < suggestions.length; i++) ...[
            _SuggestionRow(
              suggestion: suggestions[i],
              quantity: quantityByProduct[suggestions[i].productId] ?? 0,
              isBusy: isAdjustingProduct(suggestions[i].productId),
              onAdjust: (delta) => onAdjust(suggestions[i], delta),
              colorScheme: colorScheme,
              textTheme: textTheme,
              stepQty: stepQty,
            ),
            if (i != suggestions.length - 1) const SizedBox(height: 8),
          ],
        ],
      ),
    );
  }
}

class _SuggestionRow extends StatelessWidget {
  const _SuggestionRow({
    required this.suggestion,
    required this.quantity,
    required this.isBusy,
    required this.onAdjust,
    required this.colorScheme,
    required this.textTheme,
    required this.stepQty,
  });

  final _DotBotSuggestionOption suggestion;
  final int quantity;
  final bool isBusy;
  final Future<void> Function(int delta) onAdjust;
  final ColorScheme colorScheme;
  final TextTheme textTheme;
  final int stepQty;

  @override
  Widget build(BuildContext context) {
    final subtitle = [
      if (suggestion.sizeLabel.isNotEmpty) suggestion.sizeLabel,
      if (suggestion.unitPrice > 0)
        '\$${suggestion.unitPrice.toStringAsFixed(2)}',
    ].join(' • ');

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        color: colorScheme.surface.withValues(alpha: 0.55),
        border: Border.all(
          color: colorScheme.outlineVariant.withValues(alpha: 0.6),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  suggestion.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: textTheme.bodySmall
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
                if (subtitle.isNotEmpty)
                  Text(
                    subtitle,
                    style: textTheme.labelSmall,
                  ),
              ],
            ),
          ),
          IconButton(
            visualDensity: VisualDensity.compact,
            splashRadius: 16,
            onPressed:
                isBusy || quantity <= 0 ? null : () => unawaited(onAdjust(-1)),
            icon: const Icon(Icons.remove_circle_outline_rounded, size: 18),
          ),
          Text(
            '$quantity',
            style: textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          IconButton(
            visualDensity: VisualDensity.compact,
            splashRadius: 16,
            onPressed: isBusy ? null : () => unawaited(onAdjust(1)),
            icon: const Icon(Icons.add_circle_outline_rounded, size: 18),
          ),
          if (stepQty > 1)
            Text(
              'x$stepQty',
              style: textTheme.labelSmall?.copyWith(
                color: colorScheme.onSurfaceVariant,
                fontWeight: FontWeight.w700,
              ),
            ),
        ],
      ),
    );
  }
}

class _TypingIndicatorBubble extends StatelessWidget {
  const _TypingIndicatorBubble({
    required this.colorScheme,
    required this.textStyle,
    required this.animation,
  });

  final ColorScheme colorScheme;
  final TextStyle? textStyle;
  final Animation<double> animation;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: AnimatedBuilder(
        animation: animation,
        builder: (context, _) {
          final phase = animation.value * math.pi * 2;
          final bubbleOffset = -math.sin(phase) * 2.2;
          double dotLift(double shift) =>
              -math.max(0, math.sin(phase + shift)) * 4;

          Widget dot(double shift) {
            return Transform.translate(
              offset: Offset(0, dotLift(shift)),
              child: Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(
                  color: colorScheme.onSurfaceVariant.withValues(alpha: 0.9),
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            );
          }

          return Transform.translate(
            offset: Offset(0, bubbleOffset),
            child: Container(
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              constraints: const BoxConstraints(maxWidth: 260),
              decoration: BoxDecoration(
                color: colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: colorScheme.outline.withValues(alpha: 0.38),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    '',
                    style: textStyle?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Row(
                    children: [
                      dot(0),
                      const SizedBox(width: 5),
                      dot(0.8),
                      const SizedBox(width: 5),
                      dot(1.6),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _BotReplyText extends StatelessWidget {
  const _BotReplyText({
    required this.content,
    required this.textTheme,
    required this.colorScheme,
  });

  final String content;
  final TextTheme textTheme;
  final ColorScheme colorScheme;

  bool _isNumberedLine(String line) => RegExp(r'^\d+\.\s+').hasMatch(line);

  @override
  Widget build(BuildContext context) {
    final normalized = content.replaceAll('\r\n', '\n').trimRight();
    final lines = normalized.split('\n');
    final widgets = <Widget>[];

    for (var i = 0; i < lines.length; i++) {
      final line = lines[i].trimRight();
      final trimmed = line.trim();
      if (trimmed.isEmpty) {
        widgets.add(const SizedBox(height: 8));
        continue;
      }

      if (widgets.isNotEmpty && widgets.last is! SizedBox) {
        widgets.add(const SizedBox(height: 4));
      }

      if (_isNumberedLine(trimmed)) {
        final match = RegExp(r'^(\d+)\.\s+(.*)$').firstMatch(trimmed);
        final indexLabel = match?.group(1) ?? '';
        final bodyText = match?.group(2) ?? trimmed;
        widgets.add(
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '$indexLabel.',
                style: textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  bodyText,
                  style: textTheme.bodyMedium?.copyWith(height: 1.35),
                ),
              ),
            ],
          ),
        );
        continue;
      }

      final isInstruction = trimmed.toLowerCase().startsWith('reply with');
      if (isInstruction) {
        widgets.add(
          Container(
            margin: const EdgeInsets.only(top: 2),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: colorScheme.surface.withValues(alpha: 0.55),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: colorScheme.outline.withValues(alpha: 0.4),
              ),
            ),
            child: Text(
              trimmed,
              style: textTheme.bodySmall?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        );
        continue;
      }

      widgets.add(
        Text(
          trimmed,
          style: textTheme.bodyMedium?.copyWith(height: 1.35),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: widgets,
    );
  }
}

class _DotBotMessage {
  const _DotBotMessage({
    required this.role,
    required this.content,
    this.cartPreviewItems = const [],
    this.localId = 0,
    this.animateIn = false,
  });

  final String role;
  final String content;
  final List<_DotBotCartPreviewItem> cartPreviewItems;
  final int localId;
  final bool animateIn;

  _DotBotMessage copyWith({
    String? role,
    String? content,
    List<_DotBotCartPreviewItem>? cartPreviewItems,
    int? localId,
    bool? animateIn,
  }) {
    return _DotBotMessage(
      role: role ?? this.role,
      content: content ?? this.content,
      cartPreviewItems: cartPreviewItems ?? this.cartPreviewItems,
      localId: localId ?? this.localId,
      animateIn: animateIn ?? this.animateIn,
    );
  }

  _DotBotMessage withUpdatedPreviewItem({
    required int productId,
    required int quantity,
  }) {
    if (cartPreviewItems.isEmpty) return this;
    final updated = <_DotBotCartPreviewItem>[];
    for (final item in cartPreviewItems) {
      if (item.productId != productId) {
        updated.add(item);
        continue;
      }
      if (quantity <= 0) {
        continue;
      }
      updated.add(item.copyWith(quantity: quantity));
    }
    return copyWith(cartPreviewItems: updated);
  }

  _DotBotMessage withUpdatedPreviewVariant({
    required int productId,
    required int selectedVariantId,
    required String sizeLabel,
    required double unitPrice,
  }) {
    if (cartPreviewItems.isEmpty) return this;
    final updated = <_DotBotCartPreviewItem>[];
    for (final item in cartPreviewItems) {
      if (item.productId != productId) {
        updated.add(item);
        continue;
      }
      updated.add(
        item.copyWith(
          selectedVariantId: selectedVariantId,
          sizeLabel: sizeLabel,
          unitPrice: unitPrice,
        ),
      );
    }
    return copyWith(cartPreviewItems: updated);
  }
}

class _DotBotCartItem {
  const _DotBotCartItem({
    required this.productId,
    required this.name,
    required this.quantity,
    required this.unitPrice,
    this.sizeLabel = '',
  });

  final int productId;
  final String name;
  final int quantity;
  final double unitPrice;
  final String sizeLabel;

  Map<String, dynamic> toJson() {
    return {
      'product_id': productId,
      'name': name,
      'quantity': quantity,
      'unit_price': unitPrice,
      'size_label': sizeLabel,
    };
  }
}

class _DotBotAction {
  const _DotBotAction({
    required this.type,
    required this.productId,
    required this.quantity,
    this.productPayload,
  });

  final String type;
  final int productId;
  final int quantity;
  final Map<String, dynamic>? productPayload;
}

class _DotBotSuggestionOption {
  const _DotBotSuggestionOption({
    required this.productId,
    required this.name,
    this.sizeLabel = '',
    this.unitPrice = 0,
  });

  final int productId;
  final String name;
  final String sizeLabel;
  final double unitPrice;
}

class _DotBotProductMeta {
  const _DotBotProductMeta({
    required this.name,
    required this.unitPrice,
    this.sizeLabel = '',
    this.selectedVariantId,
    this.variants = const [],
  });

  final String name;
  final double unitPrice;
  final String sizeLabel;
  final int? selectedVariantId;
  final List<_DotBotVariantOption> variants;

  _DotBotProductMeta copyWith({
    String? name,
    double? unitPrice,
    String? sizeLabel,
    int? selectedVariantId,
    List<_DotBotVariantOption>? variants,
  }) {
    return _DotBotProductMeta(
      name: name ?? this.name,
      unitPrice: unitPrice ?? this.unitPrice,
      sizeLabel: sizeLabel ?? this.sizeLabel,
      selectedVariantId: selectedVariantId ?? this.selectedVariantId,
      variants: variants ?? this.variants,
    );
  }
}

class _DotBotCartPreviewItem {
  const _DotBotCartPreviewItem({
    required this.productId,
    required this.name,
    required this.quantity,
    required this.unitPrice,
    this.sizeLabel = '',
    this.selectedVariantId,
    this.variants = const [],
  });

  final int productId;
  final String name;
  final int quantity;
  final double unitPrice;
  final String sizeLabel;
  final int? selectedVariantId;
  final List<_DotBotVariantOption> variants;

  double get lineTotal => quantity * unitPrice;

  _DotBotCartPreviewItem copyWith({
    int? productId,
    String? name,
    int? quantity,
    double? unitPrice,
    String? sizeLabel,
    int? selectedVariantId,
    List<_DotBotVariantOption>? variants,
  }) {
    return _DotBotCartPreviewItem(
      productId: productId ?? this.productId,
      name: name ?? this.name,
      quantity: quantity ?? this.quantity,
      unitPrice: unitPrice ?? this.unitPrice,
      sizeLabel: sizeLabel ?? this.sizeLabel,
      selectedVariantId: selectedVariantId ?? this.selectedVariantId,
      variants: variants ?? this.variants,
    );
  }
}

class _DotBotVariantOption {
  const _DotBotVariantOption({
    required this.id,
    required this.title,
    required this.salePrice,
    this.isDefault = false,
  });

  final int id;
  final String title;
  final double salePrice;
  final bool isDefault;
}
