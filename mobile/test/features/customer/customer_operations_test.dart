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
import 'package:ssfi_lucky_draw_mobile/features/customer/domain/customer_models.dart';
import 'package:ssfi_lucky_draw_mobile/features/customer/domain/customer_repository.dart';
import 'package:ssfi_lucky_draw_mobile/features/customer/presentation/customer_controller.dart';
import 'package:ssfi_lucky_draw_mobile/features/customer/presentation/customer_dashboard_screen.dart';
import 'package:ssfi_lucky_draw_mobile/features/seller/domain/seller_models.dart';

class _MockCustomerRepo extends Mock implements CustomerRepository {}

class _MockAuthRepo extends Mock implements AuthRepository {}

CustomerDashboardData _sampleCustomerDashboard({bool empty = false}) {
  return CustomerDashboardData(
    customer: const CustomerProfileSummary(
      fullName: 'Ramesh Kumar',
      phone: '+919876543210',
      whatsappNumber: '+919876543210',
      email: 'ramesh@example.test',
    ),
    campaignName: 'SSFI Fundraising Lucky Draw',
    campaignStatus: 'ACTIVE',
    orders: empty
        ? const []
        : const [
            CustomerOrderSummaryItem(
              id: 'ord-1',
              orderNumber: 'SSFI-ORD-0001',
              quantity: 1,
              totalAmountPaise: 10000,
              status: 'TICKETS_ISSUED',
              createdAt: '2026-11-21T00:00:00Z',
              sellerCode: 'SELLER-007',
              sellerDisplayName: 'Alpha Seller',
              paymentStatus: 'VERIFIED',
              utrReference: 'UTR12345678',
              tickets: [
                SellerOrderTicket(
                  ticketNumber: 'SSFI-000101',
                  status: 'ISSUED',
                ),
              ],
            ),
          ],
    tickets: empty
        ? const []
        : const [
            CustomerIssuedTicketItem(
              ticketNumber: 'SSFI-000101',
              status: 'ISSUED',
              orderNumber: 'SSFI-ORD-0001',
              issuedAt: '2026-11-21T01:00:00Z',
            ),
          ],
    certifiedWinners: const [
      CertifiedPublicWinnerItem(
        prizeNumber: 5,
        prizeTitle: '5th Prize — Mini Soundbox',
        ticketNumber: 'SSFI-000042',
      ),
    ],
  );
}

void main() {
  group('CustomerController & Ticket Verification', () {
    test('loads customer profile, orders, tickets, and validates SSFI-XXXXXX ticket verification', () async {
      final repo = _MockCustomerRepo();
      when(() => repo.fetchDashboard())
          .thenAnswer((_) async => _sampleCustomerDashboard());
      when(() => repo.verifyTicket('SSFI-000101')).thenAnswer(
        (_) async => const TicketVerificationDetails(
          queriedTicketNumber: 'SSFI-000101',
          ticketNumber: 'SSFI-000101',
          found: true,
          isValid: true,
          isVoid: false,
          status: 'ISSUED',
          campaignName: 'SSFI Fundraising Lucky Draw',
        ),
      );

      final container = ProviderContainer(
        overrides: [customerRepositoryProvider.overrideWithValue(repo)],
      );
      addTearDown(container.dispose);

      final ctrl = container.read(customerControllerProvider.notifier);
      await ctrl.loadDashboard();

      expect(
        container.read(customerControllerProvider).dashboard?.tickets.length,
        1,
      );

      // Invalid format rejected client-side
      final invalid = await ctrl.verifyTicket('INVALID-123');
      expect(invalid, isNull);
      expect(
        container.read(customerControllerProvider).verificationError,
        isA<ValidationFailure>(),
      );

      // Valid SSFI-XXXXXX ticket verified
      final valid = await ctrl.verifyTicket('ssfi-000101');
      expect(valid?.isValid, isTrue);
      expect(valid?.ticketNumber, 'SSFI-000101');
    });
  });

  testWidgets('CustomerDashboardScreen renders empty states and ticket verification workflow', (tester) async {
    final custRepo = _MockCustomerRepo();
    final authRepo = _MockAuthRepo();
    final events = StreamController<AuthSessionEvent>.broadcast();
    addTearDown(events.close);

    when(() => authRepo.authEvents()).thenAnswer((_) => events.stream);
    when(() => authRepo.hasActiveSession()).thenAnswer((_) async => true);
    when(() => authRepo.fetchAuthoritativeIdentity()).thenAnswer(
      (_) async => const AuthIdentity(
        userId: 'cust-1',
        email: 'ramesh@example.test',
        accountStatus: 'ACTIVE',
        roles: [],
        primaryRole: null,
        customerProfileLinked: true,
      ),
    );
    when(() => custRepo.fetchDashboard())
        .thenAnswer((_) async => _sampleCustomerDashboard(empty: true));
    when(() => custRepo.verifyTicket('SSFI-000101')).thenAnswer(
      (_) async => const TicketVerificationDetails(
        queriedTicketNumber: 'SSFI-000101',
        ticketNumber: 'SSFI-000101',
        found: true,
        isValid: true,
        isVoid: false,
        status: 'ISSUED',
        campaignName: 'SSFI Fundraising Lucky Draw',
      ),
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(authRepo),
          customerRepositoryProvider.overrideWithValue(custRepo),
        ],
        child: const MaterialApp(home: CustomerDashboardScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Customer Supporter Workspace'), findsOneWidget);
    final container = ProviderScope.containerOf(
      tester.element(find.byType(CustomerDashboardScreen)),
    );
    await container.read(customerControllerProvider.notifier).loadDashboard();
    await tester.pumpAndSettle();

    expect(
      find.textContaining('No issued tickets yet'),
      findsOneWidget,
    );

    await tester.tap(find.text('My Orders & Payment Status'));
    await tester.pumpAndSettle();
    expect(
      find.text('No orders found for your customer account yet.'),
      findsOneWidget,
    );

    await tester.tap(find.text('Verify Ticket Number'));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const Key('customer_ticket_verify_field')),
      'SSFI-000101',
    );
    await tester.tap(find.byKey(const Key('customer_ticket_verify_button')));
    await tester.pumpAndSettle();

    expect(
      find.text('Official Registered Ticket (SSFI-000101)'),
      findsOneWidget,
    );
  });
}
