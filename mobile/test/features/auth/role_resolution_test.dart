import 'package:flutter_test/flutter_test.dart';
import 'package:ssfi_lucky_draw_mobile/core/errors/app_failure.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/domain/auth_identity.dart';

void main() {
  group('AuthIdentity.fromMeEnvelope & RBAC Role Resolution', () {
    test('parses SUPER_ADMIN authoritative response accurately', () {
      final identity = AuthIdentity.fromMeEnvelope({
        'apiVersion': 'v1',
        'data': {
          'user': {
            'id': '11111111-1111-4111-8111-111111111101',
            'email': 'super@example.test',
            'accountStatus': 'ACTIVE',
          },
          'roles': ['SUPER_ADMIN'],
          'primaryRole': 'SUPER_ADMIN',
          'customerProfileLinked': false,
        },
      });

      expect(identity.isAccountActive, isTrue);
      expect(identity.roles, [MobileRbacRole.superAdmin]);
      expect(identity.primaryRole, MobileRbacRole.superAdmin);
      expect(identity.customerProfileLinked, isFalse);
      expect(identity.defaultWorkspace, AppWorkspace.superAdmin);
      expect(identity.canAccessWorkspace(AppWorkspace.superAdmin), isTrue);
      expect(identity.canAccessWorkspace(AppWorkspace.customer), isFalse);
    });

    test('keeps CUSTOMER linkage strictly separate from authoritative RBAC roles', () {
      final identity = AuthIdentity.fromMeEnvelope({
        'apiVersion': 'v1',
        'data': {
          'user': {
            'id': '11111111-1111-4111-8111-111111111104',
            'email': 'customer@example.test',
            'accountStatus': 'ACTIVE',
          },
          'roles': <String>[],
          'primaryRole': null,
          'customerProfileLinked': true,
        },
      });

      expect(identity.roles, isEmpty);
      expect(identity.primaryRole, isNull);
      expect(identity.customerProfileLinked, isTrue);
      expect(identity.defaultWorkspace, AppWorkspace.customer);
      expect(identity.canAccessWorkspace(AppWorkspace.customer), isTrue);
      expect(identity.canAccessWorkspace(AppWorkspace.seller), isFalse);
      expect(identity.canAccessWorkspace(AppWorkspace.admin), isFalse);
      expect(identity.canAccessWorkspace(AppWorkspace.superAdmin), isFalse);
    });

    test('handles multiple roles safely with deterministic priority', () {
      final identity = AuthIdentity.fromMeEnvelope({
        'apiVersion': 'v1',
        'data': {
          'user': {
            'id': '11111111-1111-4111-8111-111111111102',
            'email': 'multi@example.test',
            'accountStatus': 'ACTIVE',
          },
          'roles': ['ADMIN', 'SELLER'],
          'primaryRole': 'ADMIN',
          'customerProfileLinked': true,
        },
      });

      expect(identity.defaultWorkspace, AppWorkspace.admin);
      expect(identity.allowedWorkspaces, [
        AppWorkspace.admin,
        AppWorkspace.seller,
        AppWorkspace.customer,
      ]);
      expect(identity.canAccessWorkspace(AppWorkspace.superAdmin), isFalse);
    });

    test('user with no roles and no customer linkage has zero authorized workspaces', () {
      final identity = AuthIdentity.fromMeEnvelope({
        'apiVersion': 'v1',
        'data': {
          'user': {
            'id': '11111111-1111-4111-8111-111111111105',
            'email': 'norole@example.test',
            'accountStatus': 'ACTIVE',
          },
          'roles': <String>[],
          'primaryRole': null,
          'customerProfileLinked': false,
        },
      });

      expect(identity.hasAnyAuthorizedWorkspace, isFalse);
      expect(identity.defaultWorkspace, isNull);
    });

    test('rejects invalid /me API envelopes with InvalidResponseFailure', () {
      expect(
        () => AuthIdentity.fromMeEnvelope({'apiVersion': 'v2', 'data': {}}),
        throwsA(isA<InvalidResponseFailure>()),
      );
      expect(
        () => AuthIdentity.fromMeEnvelope({
          'apiVersion': 'v1',
          'data': {
            'user': {'id': '', 'accountStatus': 'ACTIVE'},
            'roles': <String>[],
            'customerProfileLinked': false,
          },
        }),
        throwsA(isA<InvalidResponseFailure>()),
      );
      expect(
        () => AuthIdentity.fromMeEnvelope({
          'apiVersion': 'v1',
          'data': {
            'user': {'id': 'abc', 'accountStatus': 'ACTIVE'},
            'roles': <String>[],
            // missing customerProfileLinked
          },
        }),
        throwsA(isA<InvalidResponseFailure>()),
      );
    });
  });
}
