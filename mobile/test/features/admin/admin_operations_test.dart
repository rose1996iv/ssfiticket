import 'dart:async';

// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:ssfi_lucky_draw_mobile/core/errors/app_failure.dart';
import 'package:ssfi_lucky_draw_mobile/features/admin/domain/admin_models.dart';
import 'package:ssfi_lucky_draw_mobile/features/admin/domain/admin_operations_repository.dart';
import 'package:ssfi_lucky_draw_mobile/features/admin/presentation/admin_dashboard_screen.dart';
import 'package:ssfi_lucky_draw_mobile/features/admin/presentation/admin_operations_controller.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/domain/auth_identity.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/domain/auth_repository.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/presentation/auth_controller.dart';
import 'package:ssfi_lucky_draw_mobile/features/seller/domain/seller_models.dart';

class _MockAdminOpsRepo extends Mock implements AdminOperationsRepository {}

class _MockAuthRepo extends Mock implements AuthRepository {}

AdminCollectionSummary _sampleSummary() {
  return const AdminCollectionSummary(
    verifiedCollectionPaise: 2500000,
    verifiedPaymentsCount: 80,
    pendingPaymentsCount: 2,
    rejectedPaymentsCount: 1,
    totalOrdersCount: 85,
    activeSellersCount: 7,
    campaignName: 'SSFI Fundraising Lucky Draw',
    campaignStatus: 'ACTIVE',
    ticketPricePaise: 10000,
    totalTicketLimit: 1000,
    soldTicketCount: 250,
    remainingTicketCount: 750,
  );
}

AdminPaymentQueueItem _samplePayment({
  String status = 'SUBMITTED',
  List<SellerOrderTicket> tickets = const [],
}) {
  return AdminPaymentQueueItem(
    id: 'pay-1',
    status: status,
    amountPaise: 20000,
    utrReference: 'UTR9988776655',
    payerName: 'Ramesh Kumar',
    submittedAt: '2026-11-21T01:00:00Z',
    sellerReviewStatus: 'RECOMMENDED_APPROVAL',
    sellerReviewNote: 'Received in seller UPI account',
    hasScreenshot: true,
    orderId: 'ord-1',
    orderNumber: 'SSFI-ORD-0001',
    quantity: 2,
    totalAmountPaise: 20000,
    orderStatus:
        status == 'VERIFIED' ? 'TICKETS_ISSUED' : 'PAYMENT_SUBMITTED',
    snapshotUpiId: 'seller007@upi',
    snapshotAccountName: 'Alpha Seller SSFI',
    customerName: 'Ramesh Kumar',
    customerPhone: '+919876543210',
    customerWhatsapp: '+919876543210',
    customerEmail: 'ramesh@example.test',
    sellerCode: 'SELLER-007',
    sellerDisplayName: 'Alpha Seller',
    tickets: tickets,
  );
}

void main() {
  group('AdminOperationsController & Payment Verification / Ticket Issuance', () {
    test('loads collection summary and pending payments queue', () async {
      final repo = _MockAdminOpsRepo();
      when(() => repo.fetchCollectionSummary())
          .thenAnswer((_) async => _sampleSummary());
      when(() => repo.listPayments(status: 'SUBMITTED', query: ''))
          .thenAnswer((_) async => [_samplePayment()]);

      final container = ProviderContainer(
        overrides: [adminOperationsRepositoryProvider.overrideWithValue(repo)],
      );
      addTearDown(container.dispose);

      final ctrl = container.read(adminOperationsControllerProvider.notifier);
      await ctrl.loadCollectionSummary();
      await ctrl.loadPayments();

      final state = container.read(adminOperationsControllerProvider);
      expect(state.summary?.verifiedCollectionInr, 25000.0);
      expect(state.summary?.remainingTicketCount, 750);
      expect(state.payments.length, 1);
      expect(state.payments.first.orderNumber, 'SSFI-ORD-0001');
    });

    test('verifyPaymentAndIssueTickets issues sequential tickets and updates state', () async {
      final repo = _MockAdminOpsRepo();
      const issued = [
        SellerOrderTicket(ticketNumber: 'SSFI-000251', status: 'ISSUED'),
        SellerOrderTicket(ticketNumber: 'SSFI-000252', status: 'ISSUED'),
      ];
      when(() => repo.verifyPaymentAndIssueTickets('pay-1')).thenAnswer(
        (_) async => AdminPaymentDecisionResult(
          decision: 'VERIFIED',
          issuedTickets: issued,
          payment: _samplePayment(status: 'VERIFIED', tickets: issued),
        ),
      );

      final container = ProviderContainer(
        overrides: [adminOperationsRepositoryProvider.overrideWithValue(repo)],
      );
      addTearDown(container.dispose);

      final ctrl = container.read(adminOperationsControllerProvider.notifier);
      ctrl.selectPayment(_samplePayment());

      final res = await ctrl.verifyPaymentAndIssueTickets('pay-1');
      expect(res?.decision, 'VERIFIED');
      expect(res?.issuedTickets.length, 2);
      expect(res?.issuedTickets.first.ticketNumber, 'SSFI-000251');

      final state = container.read(adminOperationsControllerProvider);
      expect(state.selectedPayment?.status, 'VERIFIED');
      expect(state.lastDecisionNotice, contains('SSFI-000251'));
    });

    test('rejectPayment enforces minimum 3-char reason and handles ForbiddenFailure', () async {
      final repo = _MockAdminOpsRepo();
      final container = ProviderContainer(
        overrides: [adminOperationsRepositoryProvider.overrideWithValue(repo)],
      );
      addTearDown(container.dispose);

      final ctrl = container.read(adminOperationsControllerProvider.notifier);

      // Short reason rejected client-side
      final badReject = await ctrl.rejectPayment(
        paymentId: 'pay-1',
        reason: 'no',
      );
      expect(badReject, isNull);
      expect(
        container.read(adminOperationsControllerProvider).decisionError,
        isA<ValidationFailure>(),
      );

      // Server authorization failure surfaces ForbiddenFailure
      when(
        () => repo.rejectPayment(
          paymentId: 'pay-1',
          reason: 'UTR mismatch on bank statement',
        ),
      ).thenThrow(const ForbiddenFailure());

      final forbiddenRes = await ctrl.rejectPayment(
        paymentId: 'pay-1',
        reason: 'UTR mismatch on bank statement',
      );
      expect(forbiddenRes, isNull);
      expect(
        container.read(adminOperationsControllerProvider).decisionError,
        isA<ForbiddenFailure>(),
      );
    });
  });

  testWidgets('AdminDashboardScreen renders tabs, pending payment review, and directory lookup', (tester) async {
    final adminRepo = _MockAdminOpsRepo();
    final authRepo = _MockAuthRepo();
    final events = StreamController<AuthSessionEvent>.broadcast();
    addTearDown(events.close);

    when(() => authRepo.authEvents()).thenAnswer((_) => events.stream);
    when(() => authRepo.hasActiveSession()).thenAnswer((_) async => true);
    when(() => authRepo.fetchAuthoritativeIdentity()).thenAnswer(
      (_) async => const AuthIdentity(
        userId: 'admin-user-1',
        email: 'admin@ssfi.org',
        accountStatus: 'ACTIVE',
        roles: [MobileRbacRole.admin],
        primaryRole: MobileRbacRole.admin,
        customerProfileLinked: false,
      ),
    );
    when(() => adminRepo.listPayments(status: 'SUBMITTED', query: ''))
        .thenAnswer((_) async => [_samplePayment()]);
    when(
      () => adminRepo.lookupDirectory(query: 'SELLER-007', type: 'ALL'),
    ).thenAnswer(
      (_) async => const AdminLookupResults(
        sellers: [
          AdminLookupSellerItem(
            id: 's1',
            sellerCode: 'SELLER-007',
            displayName: 'Alpha Seller',
            isActive: true,
            isQrActive: true,
          ),
        ],
      ),
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(authRepo),
          adminOperationsRepositoryProvider.overrideWithValue(adminRepo),
        ],
        child: const MaterialApp(home: AdminDashboardScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Admin Operations Workspace'), findsOneWidget);

    await tester.tap(find.text('Pending Payments & Issuance'));
    await tester.pumpAndSettle();

    expect(find.textContaining('SSFI-ORD-0001'), findsOneWidget);
    await tester.ensureVisible(find.text('Review'));
    await tester.tap(find.text('Review'));
    await tester.pumpAndSettle();

    expect(
      find.text('Verify Payment & Issue Tickets (issue_tickets)'),
      findsOneWidget,
    );

    await tester.ensureVisible(
      find.text('Seller / Customer / Order Lookup'),
    );
    await tester.tap(find.text('Seller / Customer / Order Lookup'));
    await tester.pumpAndSettle();

    await tester.ensureVisible(
      find.byKey(const Key('admin_directory_lookup_field')),
    );
    await tester.enterText(
      find.byKey(const Key('admin_directory_lookup_field')),
      'SELLER-007',
    );
    await tester.ensureVisible(
      find.byKey(const Key('admin_directory_lookup_button')),
    );
    await tester.tap(find.byKey(const Key('admin_directory_lookup_button')));
    await tester.pumpAndSettle();

    expect(find.text('Alpha Seller (SELLER-007)'), findsOneWidget);
  });
}
