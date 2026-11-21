import 'dart:async';

// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:ssfi_lucky_draw_mobile/core/errors/app_failure.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/domain/auth_identity.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/domain/auth_repository.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/presentation/auth_controller.dart';
import 'package:ssfi_lucky_draw_mobile/features/super_admin/domain/super_admin_models.dart';
import 'package:ssfi_lucky_draw_mobile/features/super_admin/domain/super_admin_repository.dart';
import 'package:ssfi_lucky_draw_mobile/features/super_admin/presentation/super_admin_controller.dart';
import 'package:ssfi_lucky_draw_mobile/features/super_admin/presentation/super_admin_dashboard_screen.dart';

class _MockSuperAdminRepo extends Mock implements SuperAdminRepository {}

class _MockAuthRepo extends Mock implements AuthRepository {}

SuperAdminOverviewData _sampleOverview({
  FirstPrizeApprovalRecord? approval,
}) {
  return SuperAdminOverviewData(
    governance: const SuperAdminGovernanceMetrics(
      campaignName: 'SSFI Fundraising Lucky Draw',
      campaignStatus: 'ACTIVE',
      verifiedCollectionPaise: 3000000,
      verifiedPaymentsCount: 90,
      pendingPaymentsCount: 2,
      soldTicketCount: 300,
      totalTicketLimit: 1000,
      remainingTicketCount: 700,
      activeSellersCount: 6,
      totalSellersCount: 7,
      totalUsersCount: 15,
    ),
    users: const [
      SuperAdminUserRosterItem(
        id: 'u-1',
        fullName: 'Super Admin',
        email: 'senthangstudents@gmail.com',
        isActive: true,
        roles: ['SUPER_ADMIN'],
      ),
    ],
    sellers: const [
      SuperAdminSellerLifecycleItem(
        id: 'seller-1',
        sellerCode: 'SELLER-007',
        displayName: 'Alpha Seller',
        isActive: true,
        isQrActive: true,
        upiId: 'seller007@upi',
      ),
    ],
    firstPrizeDualAuth: FirstPrizeDualAuthStatus(
      drawId: 'draw-1',
      drawStatus: 'READY',
      firstPrizeId: 'prize-1',
      firstPrizeTitle: '1st Prize — ₹10,000 Cash',
      lockedSnapshotId: 'snap-1',
      snapshotHash: 'abc123hash',
      eligibleTicketCount: 300,
      approval: approval,
    ),
    recentAuditLogs: const [
      MobileAuditEventItem(
        id: 'aud-1',
        action: 'PAYMENT_VERIFIED',
        entityType: 'payment',
        createdAt: '2026-11-21T01:00:00Z',
        actorRole: 'ADMIN',
        summary: 'PAYMENT_VERIFIED (payment)',
      ),
    ],
  );
}

void main() {
  group('SuperAdminController & Policy A Dual Authorization / Screenshot Access', () {
    test('loads governance overview, initiates 1st Prize dual approval, and requests signed screenshot URL', () async {
      final repo = _MockSuperAdminRepo();
      when(() => repo.fetchOverview())
          .thenAnswer((_) async => _sampleOverview());
      when(
        () => repo.requestFirstPrizeApproval(
          drawId: 'draw-1',
          prizeId: 'prize-1',
          snapshotId: 'snap-1',
        ),
      ).thenAnswer((_) async => 'app-101');
      when(
        () => repo.getPaymentScreenshotSignedUrl(
          '44444444-4444-4444-8444-444444444401',
        ),
      ).thenAnswer(
        (_) async => const SuperAdminPaymentScreenshotAccess(
          url: 'https://signed.example.test/screenshot.jpg',
          fileName: 'SSFI-Payment-Screenshot.jpg',
          expiresInSeconds: 60,
        ),
      );

      final container = ProviderContainer(
        overrides: [superAdminRepositoryProvider.overrideWithValue(repo)],
      );
      addTearDown(container.dispose);

      final ctrl = container.read(superAdminControllerProvider.notifier);
      await ctrl.loadOverview();

      expect(
        container
            .read(superAdminControllerProvider)
            .overview
            ?.governance
            .verifiedCollectionInr,
        30000.0,
      );

      final okInit = await ctrl.initiateFirstPrizeApproval(
        drawId: 'draw-1',
        prizeId: 'prize-1',
        snapshotId: 'snap-1',
      );
      expect(okInit, isTrue);
      expect(
        container.read(superAdminControllerProvider).actionNotice,
        contains('app-101'),
      );

      final access = await ctrl.requestPaymentScreenshotAccess(
        '44444444-4444-4444-8444-444444444401',
      );
      expect(access?.expiresInSeconds, 60);
      expect(access?.fileName, 'SSFI-Payment-Screenshot.jpg');
    });

    test('surfaces ForbiddenFailure when self-approval is rejected by Policy A guard', () async {
      final repo = _MockSuperAdminRepo();
      when(
        () => repo.decideFirstPrizeApproval(
          approvalId: 'app-101',
          decision: 'APPROVED',
          notes: 'Self check',
        ),
      ).thenThrow(
        const ForbiddenFailure(
          'Policy A Violation: Self-approval is strictly forbidden.',
        ),
      );

      final container = ProviderContainer(
        overrides: [superAdminRepositoryProvider.overrideWithValue(repo)],
      );
      addTearDown(container.dispose);

      final ctrl = container.read(superAdminControllerProvider.notifier);
      final ok = await ctrl.decideFirstPrizeApproval(
        approvalId: 'app-101',
        decision: 'APPROVED',
        notes: 'Self check',
      );
      expect(ok, isFalse);
      expect(
        container.read(superAdminControllerProvider).actionError,
        isA<ForbiddenFailure>(),
      );
    });
  });

  testWidgets('SuperAdminDashboardScreen renders governance, seller lifecycle, and 1st Prize dual auth tabs', (tester) async {
    final saRepo = _MockSuperAdminRepo();
    final authRepo = _MockAuthRepo();
    final events = StreamController<AuthSessionEvent>.broadcast();
    addTearDown(events.close);

    when(() => authRepo.authEvents()).thenAnswer((_) => events.stream);
    when(() => authRepo.hasActiveSession()).thenAnswer((_) async => true);
    when(() => authRepo.fetchAuthoritativeIdentity()).thenAnswer(
      (_) async => const AuthIdentity(
        userId: 'sa-1',
        email: 'senthangstudents@gmail.com',
        accountStatus: 'ACTIVE',
        roles: [MobileRbacRole.superAdmin],
        primaryRole: MobileRbacRole.superAdmin,
        customerProfileLinked: false,
      ),
    );
    when(() => saRepo.fetchOverview())
        .thenAnswer((_) async => _sampleOverview());

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(authRepo),
          superAdminRepositoryProvider.overrideWithValue(saRepo),
        ],
        child: const MaterialApp(home: SuperAdminDashboardScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Super Admin Workspace'), findsOneWidget);
    final container = ProviderScope.containerOf(
      tester.element(find.byType(SuperAdminDashboardScreen)),
    );
    await container.read(superAdminControllerProvider.notifier).loadOverview();
    await tester.pumpAndSettle();

    await tester.tap(find.text('Users & Seller Lifecycle'));
    await tester.pumpAndSettle();
    expect(find.text('Alpha Seller (SELLER-007)'), findsOneWidget);

    await tester.tap(find.text('1st Prize Dual Auth'));
    await tester.pumpAndSettle();
    expect(
      find.text('Initiate 1st Prize Dual Approval (SUPER_ADMIN Only)'),
      findsOneWidget,
    );
  });
}
