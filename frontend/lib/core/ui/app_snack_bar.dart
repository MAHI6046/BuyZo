import 'package:flutter/material.dart';
import 'dart:ui';

class AppSnackBar {
  AppSnackBar._();

  static final Set<String> _pendingMessages = <String>{};
  static final Map<String, DateTime> _lastClosedAt = <String, DateTime>{};
  static const Duration _repeatCooldown = Duration(seconds: 2);

  static void show(
    BuildContext context,
    String message, {
    Duration duration = const Duration(milliseconds: 1800),
    int maxLines = 2,
  }) {
    final normalizedMessage = message.trim();
    if (normalizedMessage.isEmpty) return;

    final now = DateTime.now();
    final lastClosedAt = _lastClosedAt[normalizedMessage];
    if (lastClosedAt != null &&
        now.difference(lastClosedAt) < _repeatCooldown) {
      return;
    }
    if (!_pendingMessages.add(normalizedMessage)) return;

    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final glassBase = (theme.snackBarTheme.backgroundColor ??
            colorScheme.surface)
        .withValues(alpha: theme.brightness == Brightness.light ? 0.5 : 0.38);
    final controller = ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
        content: Center(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: glassBase,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: colorScheme.outline.withValues(alpha: 0.28),
                  ),
                ),
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  child: Text(
                    normalizedMessage,
                    textAlign: TextAlign.center,
                    maxLines: maxLines,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.brightness == Brightness.light
                          ? Colors.black
                          : Colors.white,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        behavior: SnackBarBehavior.fixed,
        padding: EdgeInsets.zero,
        duration: duration,
      ),
    );

    controller.closed.whenComplete(() {
      _pendingMessages.remove(normalizedMessage);
      _lastClosedAt[normalizedMessage] = DateTime.now();
    });
  }
}
