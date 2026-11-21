import 'dart:async';

// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:ssfi_lucky_draw_mobile/app/app.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/domain/auth_identity.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/domain/auth_repository.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/presentation/auth_controller.dart';

class _MockAuthRepository extends Mock implements AuthRepository {}

void main() {
  testWidgets('renders Login screen when unauthenticated and routes to Seller dashboard on sign-in', (tester) async {
    final repo = _MockAuthRepository();
    final events = StreamController<AuthSessionEvent>.broadcast();
    addTearDown(events.close);

    when(() => repo.authEvents()).thenAnswer((_) => events.stream);
    when(() => repo.hasActiveSession()).thenAnswer((_) async => false);
    when(() => repo.signInWithPassword(
          email: 'seller@example.test',
          password: 'password123',
        )).thenAnswer((_) async {});
    when(() => repo.fetchAuthoritativeIdentity()).thenAnswer(
      (_) async => const AuthIdentity(
        userId: 'seller-1',
        email: 'seller@example.test',
        accountStatus: 'ACTIVE',
        roles: [MobileRbacRole.seller],
        primaryRole: MobileRbacRole.seller,
        customerProfileLinked: false,
      ),
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [authRepositoryProvider.overrideWithValue(repo)],
        child: const SsfiLuckyDrawApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('SSFI Lucky Draw'), findsOneWidget);
    expect(find.text('Sign In'), findsOneWidget);

    await tester.enterText(
      find.byType(TextFormField).first,
      'seller@example.test',
    );
    await tester.enterText(
      find.byType(TextFormField).last,
      'password123',
    );
    await tester.tap(find.text('Sign In'));
    await tester.pumpAndSettle();

    expect(find.text('Seller Workspace'), findsOneWidget);
  });
}
