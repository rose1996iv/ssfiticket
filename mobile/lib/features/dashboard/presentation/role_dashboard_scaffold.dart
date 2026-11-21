// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/route_paths.dart';
import '../../auth/domain/auth_identity.dart';
import '../../auth/domain/auth_state.dart';
import '../../auth/presentation/auth_controller.dart';

class DashboardModuleItem {
  const DashboardModuleItem({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;
}

/// Shared responsive scaffold for the four role-specific dashboard placeholders.
class RoleDashboardScaffold extends ConsumerWidget {
  const RoleDashboardScaffold({
    super.key,
    required this.workspace,
    required this.headline,
    required this.description,
    required this.modules,
  });

  final AppWorkspace workspace;
  final String headline;
  final String description;
  final List<DashboardModuleItem> modules;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authControllerProvider);
    final identity =
        authState is AuthAuthenticated ? authState.identity : null;
    final allowedWorkspaces = identity?.allowedWorkspaces ?? const [];

    return Scaffold(
      appBar: AppBar(
        title: Text('SSFI • ${workspace.label}'),
        actions: [
          IconButton(
            tooltip: 'Refresh session and roles',
            icon: const Icon(Icons.refresh),
            onPressed: () =>
                ref.read(authControllerProvider.notifier).refreshRoles(),
          ),
          IconButton(
            tooltip: 'Profile',
            icon: const Icon(Icons.person_outline),
            onPressed: () => context.push(RoutePaths.profile),
          ),
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () =>
                ref.read(authControllerProvider.notifier).signOut(),
          ),
        ],
      ),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final isWide = constraints.maxWidth >= 680;
            return SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 880),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(20),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                headline,
                                style: Theme.of(context)
                                    .textTheme
                                    .titleLarge
                                    ?.copyWith(fontWeight: FontWeight.bold),
                              ),
                              const SizedBox(height: 6),
                              Text(description),
                              if (identity?.email != null) ...[
                                const SizedBox(height: 12),
                                Text(
                                  'Signed in as: ${identity!.email}',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              ],
                              if (allowedWorkspaces.length > 1) ...[
                                const SizedBox(height: 14),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: allowedWorkspaces.map((ws) {
                                    final selected = ws == workspace;
                                    return ChoiceChip(
                                      label: Text(ws.label),
                                      selected: selected,
                                      onSelected: selected
                                          ? null
                                          : (_) {
                                              final ok = ref
                                                  .read(
                                                    authControllerProvider
                                                        .notifier,
                                                  )
                                                  .switchWorkspace(ws);
                                              if (ok && context.mounted) {
                                                context.go(ws.path);
                                              }
                                            },
                                    );
                                  }).toList(),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                      GridView.builder(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        itemCount: modules.length,
                        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: isWide ? 2 : 1,
                          crossAxisSpacing: 12,
                          mainAxisSpacing: 12,
                          mainAxisExtent: 108,
                        ),
                        itemBuilder: (context, index) {
                          final item = modules[index];
                          return Card(
                            child: ListTile(
                              contentPadding: const EdgeInsets.all(16),
                              leading: CircleAvatar(
                                child: Icon(item.icon),
                              ),
                              title: Text(
                                item.title,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              subtitle: Text(item.subtitle),
                            ),
                          );
                        },
                      ),
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
