import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:ssfi_lucky_draw_mobile/core/errors/app_failure.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/domain/auth_identity.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/domain/auth_repository.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/domain/auth_state.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/presentation/auth_controller.dart';

class _MockAuthRepository extends Mock implements AuthRepository {}

AuthIdentity _makeIdentity({
  List<MobileRbacRole> roles = const [MobileRbacRole.admin],
  MobileRbacRole? primaryRole = MobileRbacRole.admin,
  bool customerProfileLinked = false,
  String accountStatus = 'ACTIVE',
}) {
  return AuthIdentity(
    userId: '11111111-1111-4111-8111-111111111101',
    email: 'test@example.test',
    accountStatus: accountStatus,
    roles: roles,
    primaryRole: primaryRole,
    customerProfileLinked: customerProfileLinked,
  );
}

void main() {
  late _MockAuthRepository mockRepo;
  late StreamController<AuthSessionEvent> eventController;

  setUp(() {
    mockRepo = _MockAuthRepository();
    eventController = StreamController<AuthSessionEvent>.broadcast();
    when(() => mockRepo.authEvents()).thenAnswer((_) => eventController.stream);
    when(() => mockRepo.signOut()).thenAnswer((_) async {});
  });

  tearDown(() async {
    await eventController.close();
  });

  ProviderContainer createContainer() {
    return ProviderContainer(
      overrides: [authRepositoryProvider.overrideWithValue(mockRepo)],
    );
  }

  test('restores unauthenticated state when no active session exists', () async {
    when(() => mockRepo.hasActiveSession()).thenAnswer((_) async => false);

    final container = createContainer();
    addTearDown(container.dispose);

    container.read(authControllerProvider);
    await Future<void>.delayed(Duration.zero);

    expect(container.read(authControllerProvider), isA<AuthUnauthenticated>());
  });

  test('restores authenticated ADMIN session from authoritative /me endpoint', () async {
    when(() => mockRepo.hasActiveSession()).thenAnswer((_) async => true);
    when(() => mockRepo.fetchAuthoritativeIdentity())
        .thenAnswer((_) async => _makeIdentity());

    final container = createContainer();
    addTearDown(container.dispose);

    container.read(authControllerProvider);
    await Future<void>.delayed(Duration.zero);

    final state = container.read(authControllerProvider);
    expect(state, isA<AuthAuthenticated>());
    final auth = state as AuthAuthenticated;
    expect(auth.activeWorkspace, AppWorkspace.admin);
  });

  test('signs out and redirects to unauthenticated on expired token (401)', () async {
    when(() => mockRepo.hasActiveSession()).thenAnswer((_) async => true);
    when(() => mockRepo.fetchAuthoritativeIdentity())
        .thenThrow(const UnauthorizedFailure('Token expired'));

    final container = createContainer();
    addTearDown(container.dispose);

    container.read(authControllerProvider);
    await Future<void>.delayed(Duration.zero);

    final state = container.read(authControllerProvider);
    expect(state, isA<AuthUnauthenticated>());
    verify(() => mockRepo.signOut()).called(1);
  });

  test('blocks user with no roles and no customer linkage as AuthUnauthorized', () async {
    when(() => mockRepo.hasActiveSession()).thenAnswer((_) async => true);
    when(() => mockRepo.fetchAuthoritativeIdentity()).thenAnswer(
      (_) async => _makeIdentity(
        roles: const [],
        primaryRole: null,
        customerProfileLinked: false,
      ),
    );

    final container = createContainer();
    addTearDown(container.dispose);

    container.read(authControllerProvider);
    await Future<void>.delayed(Duration.zero);

    expect(container.read(authControllerProvider), isA<AuthUnauthorized>());
  });

  test('surfaces 429 and 503 as AuthNetworkError with Retry-After metadata', () async {
    when(() => mockRepo.hasActiveSession()).thenAnswer((_) async => true);
    when(() => mockRepo.fetchAuthoritativeIdentity()).thenThrow(
      const RateLimitedFailure(retryAfterSeconds: 120),
    );

    final container = createContainer();
    addTearDown(container.dispose);

    container.read(authControllerProvider);
    await Future<void>.delayed(Duration.zero);

    final state = container.read(authControllerProvider);
    expect(state, isA<AuthNetworkError>());
    final failure = (state as AuthNetworkError).failure as RateLimitedFailure;
    expect(failure.retryAfterSeconds, 120);
  });

  test('reflects server-side role changes after refreshRoles and enforces workspace switching', () async {
    when(() => mockRepo.hasActiveSession()).thenAnswer((_) async => true);
    when(() => mockRepo.fetchAuthoritativeIdentity()).thenAnswer(
      (_) async => _makeIdentity(
        roles: const [MobileRbacRole.admin, MobileRbacRole.seller],
        primaryRole: MobileRbacRole.admin,
      ),
    );
    when(() => mockRepo.refreshSessionAndIdentity()).thenAnswer(
      (_) async => _makeIdentity(
        roles: const [MobileRbacRole.seller],
        primaryRole: MobileRbacRole.seller,
      ),
    );

    final container = createContainer();
    addTearDown(container.dispose);

    container.read(authControllerProvider);
    await Future<void>.delayed(Duration.zero);

    final notifier = container.read(authControllerProvider.notifier);
    expect(notifier.switchWorkspace(AppWorkspace.superAdmin), isFalse);
    expect(notifier.switchWorkspace(AppWorkspace.seller), isTrue);

    await notifier.refreshRoles();
    final updated = container.read(authControllerProvider) as AuthAuthenticated;
    expect(updated.identity.roles, [MobileRbacRole.seller]);
    expect(updated.activeWorkspace, AppWorkspace.seller);
  });

  test('logout clears state to AuthUnauthenticated', () async {
    when(() => mockRepo.hasActiveSession()).thenAnswer((_) async => true);
    when(() => mockRepo.fetchAuthoritativeIdentity())
        .thenAnswer((_) async => _makeIdentity());

    final container = createContainer();
    addTearDown(container.dispose);

    container.read(authControllerProvider);
    await Future<void>.delayed(Duration.zero);

    await container.read(authControllerProvider.notifier).signOut();
    expect(container.read(authControllerProvider), isA<AuthUnauthenticated>());
    verify(() => mockRepo.signOut()).called(1);
  });
}
