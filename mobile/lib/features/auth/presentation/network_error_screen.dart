// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_failure.dart';
import '../domain/auth_state.dart';
import 'auth_controller.dart';

/// Shown on connectivity failures, HTTP 429 rate limits, or HTTP 503 outages.
class NetworkErrorScreen extends ConsumerWidget {
  const NetworkErrorScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authControllerProvider);
    final failure = authState is AuthNetworkError
        ? authState.failure
        : const NetworkFailure();

    final retryAfter = switch (failure) {
      RateLimitedFailure(:final retryAfterSeconds) => retryAfterSeconds,
      ServiceUnavailableFailure(:final retryAfterSeconds) => retryAfterSeconds,
      _ => null,
    };

    return Scaffold(
      appBar: AppBar(title: const Text('Connection Issue')),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Icon(Icons.cloud_off_outlined, size: 56),
                      const SizedBox(height: 16),
                      Text(
                        'Unable to Reach SSFI Server',
                        style: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.copyWith(fontWeight: FontWeight.bold),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 8),
                      Text(failure.message, textAlign: TextAlign.center),
                      if (retryAfter != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          'Please wait approximately $retryAfter seconds before retrying.',
                          style: Theme.of(context).textTheme.bodySmall,
                          textAlign: TextAlign.center,
                        ),
                      ],
                      const SizedBox(height: 24),
                      FilledButton(
                        onPressed: () => ref
                            .read(authControllerProvider.notifier)
                            .restoreSession(),
                        child: const Text('Retry'),
                      ),
                      const SizedBox(height: 12),
                      OutlinedButton(
                        onPressed: () =>
                            ref.read(authControllerProvider.notifier).signOut(),
                        child: const Text('Return to Sign In'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
