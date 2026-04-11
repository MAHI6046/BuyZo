import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/network/api_client.dart';
import '../../core/ui/app_snack_bar.dart';

class HeaderLocationTrigger extends StatelessWidget {
  const HeaderLocationTrigger({
    super.key,
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

class LocationPickerSheet extends StatefulWidget {
  const LocationPickerSheet({super.key});

  @override
  State<LocationPickerSheet> createState() => _LocationPickerSheetState();
}

class _LocationPickerSheetState extends State<LocationPickerSheet> {
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
          ResolvedAddress(
            fullAddress: (formatted ?? suggestion.fullText).trim(),
            lat: lat,
            lng: lng,
            label: _activeLabel,
          ),
        );
      } else {
        Navigator.of(context).pop(
          ResolvedAddress(
            fullAddress: suggestion.fullText,
            label: _activeLabel,
          ),
        );
      }
    } catch (_) {
      Navigator.of(context).pop(
        ResolvedAddress(
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
          ResolvedAddress(
            fullAddress: (address ??
                    '${position.latitude.toStringAsFixed(5)}, ${position.longitude.toStringAsFixed(5)}')
                .trim(),
            lat: position.latitude,
            lng: position.longitude,
            label: _activeLabel,
            isCurrentLocation: true,
          ),
        );
      } else {
        if (!mounted) return;
        Navigator.of(context).pop(
          ResolvedAddress(
            fullAddress:
                '${position.latitude.toStringAsFixed(5)}, ${position.longitude.toStringAsFixed(5)}',
            lat: position.latitude,
            lng: position.longitude,
            label: _activeLabel,
            isCurrentLocation: true,
          ),
        );
      }
    } on NoSuchMethodError {
      if (!mounted) return;
      AppSnackBar.show(
        context,
        'Current location is unavailable on this build. Please search or type your address.',
      );
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
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: _manualController.text.trim().isEmpty
                      ? null
                      : () {
                          Navigator.of(context).pop(
                            ResolvedAddress(
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
                            ResolvedAddress(
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
              const SizedBox(height: 10),
            ],
          ),
        ),
      ),
    );
  }
}

class ResolvedAddress {
  const ResolvedAddress({
    this.addressId,
    required this.fullAddress,
    this.lat,
    this.lng,
    this.label,
    this.isCurrentLocation = false,
  });

  final int? addressId;
  final String fullAddress;
  final double? lat;
  final double? lng;
  final String? label;
  final bool isCurrentLocation;
}

class _PlaceSuggestion {
  _PlaceSuggestion({required this.placeId, required this.fullText});

  final String placeId;
  final String fullText;
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
    int toInt(dynamic value) {
      if (value == null) return 0;
      if (value is int) return value;
      if (value is num) return value.toInt();
      return int.tryParse(value.toString().trim()) ?? 0;
    }

    double? toDouble(dynamic value) {
      if (value == null) return null;
      if (value is double) return value;
      if (value is num) return value.toDouble();
      return double.tryParse(value.toString().trim());
    }

    return _SavedAddress(
      id: toInt(json['id']),
      label: (json['label']?.toString().trim().isNotEmpty ?? false)
          ? json['label'].toString().trim()
          : 'Home',
      fullAddress: (json['full_address']?.toString() ?? '').trim(),
      isDefault: json['is_default'] == true,
      lat: toDouble(json['lat']),
      lng: toDouble(json['lng']),
    );
  }

  final int id;
  final String label;
  final String fullAddress;
  final bool isDefault;
  final double? lat;
  final double? lng;
}

IconData _iconForAddressLabel(String label) {
  final normalized = label.trim().toLowerCase();
  if (normalized == 'home') return Icons.home_rounded;
  if (normalized == 'work') return Icons.work_rounded;
  return Icons.place_rounded;
}
