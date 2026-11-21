import 'package:flutter_test/flutter_test.dart';
import 'package:ssfi_lucky_draw_mobile/app/router/app_router.dart';
import 'package:ssfi_lucky_draw_mobile/app/router/route_paths.dart';
import 'package:ssfi_lucky_draw_mobile/core/errors/app_failure.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/domain/auth_identity.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/domain/auth_state.dart';

void main() {
  group('GoRouter Authorization Redirects & Deep-Link Protection', () {
    test('redirects unauthenticated deep links to /login', () {
      const state = AuthUnauthenticated();
      expect(resolveAuthRedirect(state, RoutePaths.superAdmin), RoutePaths.login);
      expect(resolveAuthRedirect(state, RoutePaths.admin), RoutePaths.login);
      expect(resolveAuthRedirect(state, RoutePaths.seller), RoutePaths.login);
      expect(resolveAuthRedirect(state, RoutePaths.customer), RoutePaths.login);
      expect(resolveAuthRedirect(state, RoutePaths.login), isNull);
    });

    test('redirects initializing, unauthorized, and network error states safely', () {
      expect(
        resolveAuthRedirect(const AuthInitializing(), RoutePaths.admin),
        RoutePaths.splash,
      );
      expect(
        resolveAuthRedirect(
          const AuthUnauthorized(reason: 'No role'),
          RoutePaths.admin,
        ),
        RoutePaths.unauthorized,
      );
      expect(
        resolveAuthRedirect(
          const AuthNetworkError(failure: NetworkFailure(), hasSession: true),
          RoutePaths.seller,
        ),
        RoutePaths.networkError,
      );
    });

    test('blocks CUSTOMER deep links into staff and seller routes', () {
      const customerIdentity = AuthIdentity(
        userId: 'cust-1',
        email: 'cust@example.test',
        accountStatus: 'ACTIVE',
        roles: [],
        primaryRole: null,
        customerProfileLinked: true,
      );
      const state = AuthAuthenticated(
        identity: customerIdentity,
        activeWorkspace: AppWorkspace.customer,
      );

      expect(resolveAuthRedirect(state, RoutePaths.customer), isNull);
      expect(resolveAuthRedirect(state, RoutePaths.profile), isNull);
      expect(resolveAuthRedirect(state, RoutePaths.seller), RoutePaths.unauthorized);
      expect(resolveAuthRedirect(state, RoutePaths.admin), RoutePaths.unauthorized);
      expect(resolveAuthRedirect(state, RoutePaths.superAdmin), RoutePaths.unauthorized);
    });

    test('blocks SELLER and ADMIN from escalating to SUPER_ADMIN via deep link', () {
      const sellerState = AuthAuthenticated(
        identity: AuthIdentity(
          userId: 'seller-1',
          email: 'seller@example.test',
          accountStatus: 'ACTIVE',
          roles: [MobileRbacRole.seller],
          primaryRole: MobileRbacRole.seller,
          customerProfileLinked: false,
        ),
        activeWorkspace: AppWorkspace.seller,
      );

      expect(resolveAuthRedirect(sellerState, RoutePaths.seller), isNull);
      expect(resolveAuthRedirect(sellerState, RoutePaths.admin), RoutePaths.unauthorized);
      expect(resolveAuthRedirect(sellerState, RoutePaths.superAdmin), RoutePaths.unauthorized);

      const adminState = AuthAuthenticated(
        identity: AuthIdentity(
          userId: 'admin-1',
          email: 'admin@example.test',
          accountStatus: 'ACTIVE',
          roles: [MobileRbacRole.admin],
          primaryRole: MobileRbacRole.admin,
          customerProfileLinked: false,
        ),
        activeWorkspace: AppWorkspace.admin,
      );

      expect(resolveAuthRedirect(adminState, RoutePaths.admin), isNull);
      expect(resolveAuthRedirect(adminState, RoutePaths.superAdmin), RoutePaths.unauthorized);
    });
  });
}
