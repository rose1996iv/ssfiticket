import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/admin/presentation/admin_dashboard_screen.dart';
import '../../features/auth/domain/auth_identity.dart';
import '../../features/auth/domain/auth_state.dart';
import '../../features/auth/presentation/auth_controller.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/network_error_screen.dart';
import '../../features/auth/presentation/session_restore_screen.dart';
import '../../features/auth/presentation/unauthorized_screen.dart';
import '../../features/customer/presentation/customer_dashboard_screen.dart';
import '../../features/profile/presentation/profile_screen.dart';
import '../../features/seller/presentation/seller_dashboard_screen.dart';
import '../../features/super_admin/presentation/super_admin_dashboard_screen.dart';
import 'route_paths.dart';

/// Pure, deterministic GoRouter redirect evaluator enforcing four-role RBAC
/// and deep-link protection against the server-verified [AuthState].
String? resolveAuthRedirect(AuthState authState, String location) {
  final cleanPath = Uri.tryParse(location)?.path ?? location;

  return switch (authState) {
    AuthInitializing() =>
      cleanPath == RoutePaths.splash ? null : RoutePaths.splash,
    AuthUnauthenticated() =>
      cleanPath == RoutePaths.login ? null : RoutePaths.login,
    AuthUnauthorized() =>
      cleanPath == RoutePaths.unauthorized ? null : RoutePaths.unauthorized,
    AuthNetworkError() =>
      cleanPath == RoutePaths.networkError ? null : RoutePaths.networkError,
    AuthAuthenticated(:final identity, :final activeWorkspace) =>
      _resolveAuthenticatedRedirect(identity, activeWorkspace, cleanPath),
  };
}

String? _resolveAuthenticatedRedirect(
  AuthIdentity identity,
  AppWorkspace activeWorkspace,
  String cleanPath,
) {
  if (!identity.isAccountActive || !identity.hasAnyAuthorizedWorkspace) {
    return RoutePaths.unauthorized;
  }

  // Redirect away from auth/status screens once authenticated
  if (cleanPath == RoutePaths.splash ||
      cleanPath == RoutePaths.login ||
      cleanPath == RoutePaths.unauthorized ||
      cleanPath == RoutePaths.networkError ||
      cleanPath == '/') {
    return activeWorkspace.path;
  }

  if (cleanPath == RoutePaths.profile) {
    return null;
  }

  // Enforce workspace-level authorization on every navigation and deep link
  if (cleanPath.startsWith(RoutePaths.superAdmin)) {
    return identity.canAccessWorkspace(AppWorkspace.superAdmin)
        ? null
        : RoutePaths.unauthorized;
  }
  if (cleanPath.startsWith(RoutePaths.admin)) {
    return identity.canAccessWorkspace(AppWorkspace.admin)
        ? null
        : RoutePaths.unauthorized;
  }
  if (cleanPath.startsWith(RoutePaths.seller)) {
    return identity.canAccessWorkspace(AppWorkspace.seller)
        ? null
        : RoutePaths.unauthorized;
  }
  if (cleanPath.startsWith(RoutePaths.customer)) {
    return identity.canAccessWorkspace(AppWorkspace.customer)
        ? null
        : RoutePaths.unauthorized;
  }

  return activeWorkspace.path;
}

class _AuthStateRefreshNotifier extends ChangeNotifier {
  void trigger() => notifyListeners();
}

final appRouterProvider = Provider<GoRouter>((ref) {
  final refreshNotifier = _AuthStateRefreshNotifier();
  ref.listen<AuthState>(authControllerProvider, (_, _) {
    refreshNotifier.trigger();
  });
  ref.onDispose(refreshNotifier.dispose);

  final router = GoRouter(
    initialLocation: RoutePaths.splash,
    refreshListenable: refreshNotifier,
    redirect: (context, state) {
      final authState = ref.read(authControllerProvider);
      return resolveAuthRedirect(authState, state.uri.toString());
    },
    routes: [
      GoRoute(
        path: RoutePaths.splash,
        builder: (context, state) => const SessionRestoreScreen(),
      ),
      GoRoute(
        path: RoutePaths.login,
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: RoutePaths.unauthorized,
        builder: (context, state) => const UnauthorizedScreen(),
      ),
      GoRoute(
        path: RoutePaths.networkError,
        builder: (context, state) => const NetworkErrorScreen(),
      ),
      GoRoute(
        path: RoutePaths.superAdmin,
        builder: (context, state) => const SuperAdminDashboardScreen(),
      ),
      GoRoute(
        path: RoutePaths.admin,
        builder: (context, state) => const AdminDashboardScreen(),
      ),
      GoRoute(
        path: RoutePaths.seller,
        builder: (context, state) => const SellerDashboardScreen(),
      ),
      GoRoute(
        path: RoutePaths.customer,
        builder: (context, state) => const CustomerDashboardScreen(),
      ),
      GoRoute(
        path: RoutePaths.profile,
        builder: (context, state) => const ProfileScreen(),
      ),
    ],
  );

  ref.onDispose(router.dispose);
  return router;
});
