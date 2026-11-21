// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/domain/auth_state.dart';
import '../../auth/presentation/auth_controller.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authControllerProvider);
    final identity =
        authState is AuthAuthenticated ? authState.identity : null;

    return Scaffold(
      appBar: AppBar(title: const Text('Account & Permissions')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: identity == null
              ? const Center(child: Text('No active authenticated session.'))
              : ListView(
                  children: [
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(20),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Server-Verified Identity',
                              style: Theme.of(context)
                                  .textTheme
                                  .titleMedium
                                  ?.copyWith(fontWeight: FontWeight.bold),
                            ),
                            const SizedBox(height: 12),
                            Text('Email: ${identity.email ?? 'Not provided'}'),
                            const SizedBox(height: 6),
                            Text('Account Status: ${identity.accountStatus}'),
                            const SizedBox(height: 6),
                            Text(
                              'RBAC Roles: ${identity.roles.isEmpty ? 'None' : identity.roles.map((r) => r.displayLabel).join(', ')}',
                            ),
                            const SizedBox(height: 6),
                            Text(
                              'Customer Account Linked: ${identity.customerProfileLinked ? 'Yes' : 'No'}',
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    FilledButton.tonal(
                      onPressed: () => ref
                          .read(authControllerProvider.notifier)
                          .refreshRoles(),
                      child: const Text('Refresh Authoritative Roles'),
                    ),
                    const SizedBox(height: 12),
                    OutlinedButton(
                      onPressed: () =>
                          ref.read(authControllerProvider.notifier).signOut(),
                      child: const Text('Sign Out'),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}
