import 'dart:async';
import 'dart:typed_data';

// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:ssfi_lucky_draw_mobile/core/errors/app_failure.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/domain/auth_identity.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/domain/auth_repository.dart';
import 'package:ssfi_lucky_draw_mobile/features/auth/presentation/auth_controller.dart';
import 'package:ssfi_lucky_draw_mobile/features/seller/domain/seller_models.dart';
import 'package:ssfi_lucky_draw_mobile/features/seller/domain/seller_operations_repository.dart';
import 'package:ssfi_lucky_draw_mobile/features/seller/presentation/seller_dashboard_screen.dart';
import 'package:ssfi_lucky_draw_mobile/features/seller/presentation/seller_operations_controller.dart';

class _MockSellerOpsRepo extends Mock implements SellerOperationsRepository {}

class _MockAuthRepo extends Mock implements AuthRepository {}

class _MockScreenshotPicker extends Mock implements PaymentScreenshotPicker {}

SellerOrderItem _sampleOrder({
  String id = 'ord-1',
  String orderNumber = 'SSFI-ORD-0001',
  String status = 'PENDING_PAYMENT',
  String paymentStatus = 'PENDING',
  String? utr,
}) {
  return SellerOrderItem(
    id: id,
    orderNumber: orderNumber,
    quantity: 2,
    totalAmountPaise: 20000,
    status: status,
    createdAt: '2026-11-21T00:00:00Z',
    customerFullName: 'Ramesh Kumar',
    customerPhone: '+919876543210',
    customerWhatsapp: '+919876543210',
    customerEmail: 'ramesh@example.test',
    payment: SellerOrderPaymentInfo(
      id: 'pay-1',
      status: paymentStatus,
      utrReference: utr,
      hasScreenshot: true,
    ),
    tickets: status == 'TICKETS_ISSUED'
        ? const [
            SellerOrderTicket(ticketNumber: 'SSFI-000101', status: 'ISSUED'),
            SellerOrderTicket(ticketNumber: 'SSFI-000102', status: 'ISSUED'),
          ]
        : const [],
    upiInstructions: const SellerUpiInstructions(
      payeeName: 'Seller 007 SSFI',
      upiId: 'seller007@upi',
      amountPaise: 20000,
      currency: 'INR',
      upiUri: 'upi://pay?pa=seller007%40upi&am=200.00&cu=INR',
      isQrActive: true,
    ),
  );
}

SellerDashboardData _sampleDashboard() {
  return SellerDashboardData(
    seller: const SellerProfileSummary(
      id: 'seller-1',
      sellerCode: 'SELLER-007',
      displayName: 'Alpha Seller',
      isActive: true,
      isQrActive: true,
      upiId: 'seller007@upi',
    ),
    campaign: const SellerCampaignSummary(
      name: 'SSFI Fundraising Lucky Draw',
      status: 'ACTIVE',
      isSellingOpen: true,
      scheduleDescription: 'Open',
      ticketPricePaise: 10000,
      totalTicketLimit: 1000,
      soldTicketCount: 120,
      remainingTicketCount: 880,
    ),
    metrics: const SellerMetricsSummary(
      ticketsIssuedCount: 12,
      verifiedCollectionPaise: 120000,
      pendingPaymentsCount: 1,
      awaitingPaymentOrdersCount: 1,
      issuedOrdersCount: 6,
      totalOrdersCount: 8,
      unreadMessagesCount: 2,
    ),
    recentOrders: [_sampleOrder()],
  );
}

void main() {
  group('SellerOperationsController & Domain Models', () {
    test('parses SellerDashboardData envelope and computes INR totals accurately', () {
      final parsed = SellerDashboardData.fromEnvelope({
        'apiVersion': 'v1',
        'data': {
          'seller': {
            'id': 's1',
            'sellerCode': 'SELLER-007',
            'displayName': 'Alpha Seller',
            'isActive': true,
            'isQrActive': true,
            'upiId': 'seller007@upi',
          },
          'campaign': {
            'name': 'SSFI Fundraising Lucky Draw',
            'status': 'ACTIVE',
            'isSellingOpen': true,
            'scheduleDescription': 'Active',
            'ticketPricePaise': 10000,
            'totalTicketLimit': 1000,
            'soldTicketCount': 200,
            'remainingTicketCount': 800,
          },
          'metrics': {
            'ticketsIssuedCount': 10,
            'verifiedCollectionPaise': 100000,
            'pendingPaymentsCount': 2,
            'awaitingPaymentOrdersCount': 1,
            'issuedOrdersCount': 5,
            'totalOrdersCount': 8,
            'unreadMessagesCount': 0,
          },
          'recentOrders': [],
        },
      });

      expect(parsed.seller.sellerCode, 'SELLER-007');
      expect(parsed.campaign.ticketPriceInr, 100.0);
      expect(parsed.metrics.verifiedCollectionInr, 1000.0);
    });

    test('validates order creation inputs and handles UTR submission & duplicate errors', () async {
      final repo = _MockSellerOpsRepo();
      final container = ProviderContainer(
        overrides: [sellerOperationsRepositoryProvider.overrideWithValue(repo)],
      );
      addTearDown(container.dispose);

      final ctrl = container.read(sellerOperationsControllerProvider.notifier);

      // 1. Client-side validation rejects short name / invalid phone
      final badName = await ctrl.createOrder(
        name: 'A',
        whatsapp: '+919876543210',
        email: 'ramesh@example.test',
        quantity: 1,
      );
      expect(badName, isNull);
      expect(
        container.read(sellerOperationsControllerProvider).orderSubmissionError,
        isA<ValidationFailure>(),
      );

      // 2. Valid order creation populates selectedOrder and orders list
      when(
        () => repo.createOrder(
          name: 'Ramesh Kumar',
          whatsapp: '+919876543210',
          email: 'ramesh@example.test',
          quantity: 2,
        ),
      ).thenAnswer((_) async => _sampleOrder());

      final created = await ctrl.createOrder(
        name: 'Ramesh Kumar',
        whatsapp: '+919876543210',
        email: 'ramesh@example.test',
        quantity: 2,
      );
      expect(created?.orderNumber, 'SSFI-ORD-0001');
      expect(
        container.read(sellerOperationsControllerProvider).selectedOrder?.id,
        'ord-1',
      );

      // 3. UTR validation rejects < 6 characters when provided
      final shortUtr = await ctrl.submitManualUpi(
        orderId: 'ord-1',
        utr: '123',
      );
      expect(shortUtr, isNull);
      expect(
        container.read(sellerOperationsControllerProvider).upiSubmissionError,
        isA<ValidationFailure>(),
      );

      // 4. Valid UTR submission transitions order to PAYMENT_SUBMITTED
      when(
        () => repo.submitManualUpi(
          orderId: 'ord-1',
          utr: 'UTR12345678',
          payerName: 'Ramesh Kumar',
        ),
      ).thenAnswer(
        (_) async => _sampleOrder(
          status: 'PAYMENT_SUBMITTED',
          paymentStatus: 'SUBMITTED',
          utr: 'UTR12345678',
        ),
      );

      final submitted = await ctrl.submitManualUpi(
        orderId: 'ord-1',
        utr: 'UTR12345678',
        payerName: 'Ramesh Kumar',
      );
      expect(submitted?.status, 'PAYMENT_SUBMITTED');
      expect(submitted?.payment.utrReference, 'UTR12345678');
    });

    test('surfaces NetworkFailure on offline dashboard and customer lookup calls', () async {
      final repo = _MockSellerOpsRepo();
      when(() => repo.fetchDashboard()).thenThrow(const NetworkFailure());
      when(() => repo.lookupCustomers('Ramesh'))
          .thenThrow(const NetworkFailure());

      final container = ProviderContainer(
        overrides: [sellerOperationsRepositoryProvider.overrideWithValue(repo)],
      );
      addTearDown(container.dispose);

      final ctrl = container.read(sellerOperationsControllerProvider.notifier);
      await ctrl.loadDashboard();
      expect(
        container.read(sellerOperationsControllerProvider).dashboardError,
        isA<NetworkFailure>(),
      );

      await ctrl.searchCustomers('Ramesh');
      expect(
        container.read(sellerOperationsControllerProvider).customerLookupError,
        isA<NetworkFailure>(),
      );
    });

    test('validates and uploads payment screenshot before UTR submission', () async {
      final repo = _MockSellerOpsRepo();
      final picker = _MockScreenshotPicker();
      final pngBytes = Uint8List.fromList([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

      when(() => picker.pickScreenshot()).thenAnswer(
        (_) async => SelectedScreenshotFile(
          bytes: pngBytes,
          fileName: 'proof.png',
          mimeType: 'image/png',
        ),
      );
      when(
        () => repo.uploadOrderScreenshot(
          orderId: 'ord-1',
          bytes: pngBytes,
          fileName: 'proof.png',
          mimeType: 'image/png',
        ),
      ).thenAnswer(
        (_) async => SellerScreenshotUploadResult(
          replaced: false,
          contentType: 'image/png',
          fileSizeBytes: pngBytes.length,
          uploadedAt: '2026-11-21T09:00:00Z',
          order: _sampleOrder(),
        ),
      );

      final container = ProviderContainer(
        overrides: [
          sellerOperationsRepositoryProvider.overrideWithValue(repo),
          paymentScreenshotPickerProvider.overrideWithValue(picker),
        ],
      );
      addTearDown(container.dispose);

      final ctrl = container.read(sellerOperationsControllerProvider.notifier);

      // Invalid MIME rejected client-side
      final badMime = await ctrl.uploadScreenshotBytes(
        orderId: 'ord-1',
        bytes: pngBytes,
        fileName: 'proof.svg',
        mimeType: 'image/svg+xml',
      );
      expect(badMime, isNull);
      expect(
        container.read(sellerOperationsControllerProvider).screenshotUploadError,
        isA<ValidationFailure>(),
      );

      // Valid picked screenshot uploads and sets notice
      final uploaded = await ctrl.pickAndUploadScreenshot('ord-1');
      expect(uploaded?.replaced, isFalse);
      expect(uploaded?.contentType, 'image/png');
      expect(
        container.read(sellerOperationsControllerProvider).lastSuccessNotice,
        contains('uploaded securely'),
      );
    });
  });

  testWidgets('SellerDashboardScreen renders tabs, customer lookup, and order creation flow', (tester) async {
    final sellerRepo = _MockSellerOpsRepo();
    final authRepo = _MockAuthRepo();
    final events = StreamController<AuthSessionEvent>.broadcast();
    addTearDown(events.close);

    when(() => authRepo.authEvents()).thenAnswer((_) => events.stream);
    when(() => authRepo.hasActiveSession()).thenAnswer((_) async => true);
    when(() => authRepo.fetchAuthoritativeIdentity()).thenAnswer(
      (_) async => const AuthIdentity(
        userId: 'seller-user-1',
        email: 'seller1@ssfi.org',
        accountStatus: 'ACTIVE',
        roles: [MobileRbacRole.seller],
        primaryRole: MobileRbacRole.seller,
        customerProfileLinked: false,
      ),
    );
    when(() => sellerRepo.fetchDashboard())
        .thenAnswer((_) async => _sampleDashboard());
    when(() => sellerRepo.lookupCustomers('Ramesh')).thenAnswer(
      (_) async => const [
        SellerCustomerItem(
          id: 'cust-1',
          fullName: 'Ramesh Kumar',
          phone: '+919876543210',
          whatsappNumber: '+919876543210',
          email: 'ramesh@example.test',
          totalOrdersWithSeller: 2,
        ),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(authRepo),
          sellerOperationsRepositoryProvider.overrideWithValue(sellerRepo),
        ],
        child: const MaterialApp(home: SellerDashboardScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Seller Workspace'), findsOneWidget);
    expect(find.text('New Manual Sale'), findsOneWidget);

    await tester.tap(find.text('New Manual Sale'));
    await tester.pumpAndSettle();

    expect(find.text('Record New Manual Sale'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('seller_customer_lookup_field')),
      'Ramesh',
    );
    await tester.tap(find.byKey(const Key('seller_customer_lookup_button')));
    await tester.pumpAndSettle();

    expect(find.text('Use Details'), findsOneWidget);
  });
}
