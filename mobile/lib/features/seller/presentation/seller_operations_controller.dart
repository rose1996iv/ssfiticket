import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/errors/app_failure.dart';
import '../../auth/presentation/auth_controller.dart';
import '../data/seller_operations_remote_datasource.dart';
import '../data/seller_operations_repository_impl.dart';
import '../domain/seller_models.dart';
import '../domain/seller_operations_repository.dart';

const int kMaxPaymentScreenshotBytes = 2 * 1024 * 1024;

abstract interface class PaymentScreenshotPicker {
  Future<SelectedScreenshotFile?> pickScreenshot();
}

class ImagePickerPaymentScreenshotPicker implements PaymentScreenshotPicker {
  ImagePickerPaymentScreenshotPicker({ImagePicker? picker})
      : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  @override
  Future<SelectedScreenshotFile?> pickScreenshot() async {
    final xFile = await _picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 2048,
      imageQuality: 85,
    );
    if (xFile == null) return null;
    final bytes = await xFile.readAsBytes();
    final name = xFile.name.trim().isNotEmpty ? xFile.name.trim() : 'proof.jpg';
    final lower = name.toLowerCase();
    final mime = lower.endsWith('.png')
        ? 'image/png'
        : (lower.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    return SelectedScreenshotFile(
      bytes: bytes,
      fileName: name,
      mimeType: mime,
    );
  }
}

final paymentScreenshotPickerProvider = Provider<PaymentScreenshotPicker>(
  (ref) => ImagePickerPaymentScreenshotPicker(),
);

final sellerOperationsRepositoryProvider =
    Provider<SellerOperationsRepository>((ref) {
  final dio = ref.watch(mobileDioProvider);
  return SellerOperationsRepositoryImpl(SellerOperationsRemoteDataSource(dio));
});

enum SellerWorkspaceTab { overview, newOrder, myOrders }

class SellerOperationsState {
  const SellerOperationsState({
    this.activeTab = SellerWorkspaceTab.overview,
    this.isLoadingDashboard = false,
    this.dashboard,
    this.dashboardError,
    this.isLoadingOrders = false,
    this.orders = const [],
    this.ordersError,
    this.orderStatusFilter = 'ALL',
    this.orderSearchQuery = '',
    this.isSearchingCustomers = false,
    this.customerLookupResults = const [],
    this.customerLookupError,
    this.selectedOrder,
    this.isSubmittingOrder = false,
    this.orderSubmissionError,
    this.isUploadingScreenshot = false,
    this.screenshotUploadError,
    this.isSubmittingUpi = false,
    this.upiSubmissionError,
    this.lastSuccessNotice,
  });

  final SellerWorkspaceTab activeTab;
  final bool isLoadingDashboard;
  final SellerDashboardData? dashboard;
  final AppFailure? dashboardError;

  final bool isLoadingOrders;
  final List<SellerOrderItem> orders;
  final AppFailure? ordersError;
  final String orderStatusFilter;
  final String orderSearchQuery;

  final bool isSearchingCustomers;
  final List<SellerCustomerItem> customerLookupResults;
  final AppFailure? customerLookupError;

  final SellerOrderItem? selectedOrder;
  final bool isSubmittingOrder;
  final AppFailure? orderSubmissionError;

  final bool isUploadingScreenshot;
  final AppFailure? screenshotUploadError;

  final bool isSubmittingUpi;
  final AppFailure? upiSubmissionError;
  final String? lastSuccessNotice;

  SellerOperationsState copyWith({
    SellerWorkspaceTab? activeTab,
    bool? isLoadingDashboard,
    SellerDashboardData? dashboard,
    AppFailure? dashboardError,
    bool clearDashboardError = false,
    bool? isLoadingOrders,
    List<SellerOrderItem>? orders,
    AppFailure? ordersError,
    bool clearOrdersError = false,
    String? orderStatusFilter,
    String? orderSearchQuery,
    bool? isSearchingCustomers,
    List<SellerCustomerItem>? customerLookupResults,
    AppFailure? customerLookupError,
    bool clearCustomerLookupError = false,
    SellerOrderItem? selectedOrder,
    bool clearSelectedOrder = false,
    bool? isSubmittingOrder,
    AppFailure? orderSubmissionError,
    bool clearOrderSubmissionError = false,
    bool? isUploadingScreenshot,
    AppFailure? screenshotUploadError,
    bool clearScreenshotUploadError = false,
    bool? isSubmittingUpi,
    AppFailure? upiSubmissionError,
    bool clearUpiSubmissionError = false,
    String? lastSuccessNotice,
    bool clearLastSuccessNotice = false,
  }) {
    return SellerOperationsState(
      activeTab: activeTab ?? this.activeTab,
      isLoadingDashboard: isLoadingDashboard ?? this.isLoadingDashboard,
      dashboard: dashboard ?? this.dashboard,
      dashboardError:
          clearDashboardError ? null : (dashboardError ?? this.dashboardError),
      isLoadingOrders: isLoadingOrders ?? this.isLoadingOrders,
      orders: orders ?? this.orders,
      ordersError: clearOrdersError ? null : (ordersError ?? this.ordersError),
      orderStatusFilter: orderStatusFilter ?? this.orderStatusFilter,
      orderSearchQuery: orderSearchQuery ?? this.orderSearchQuery,
      isSearchingCustomers: isSearchingCustomers ?? this.isSearchingCustomers,
      customerLookupResults:
          customerLookupResults ?? this.customerLookupResults,
      customerLookupError: clearCustomerLookupError
          ? null
          : (customerLookupError ?? this.customerLookupError),
      selectedOrder:
          clearSelectedOrder ? null : (selectedOrder ?? this.selectedOrder),
      isSubmittingOrder: isSubmittingOrder ?? this.isSubmittingOrder,
      orderSubmissionError: clearOrderSubmissionError
          ? null
          : (orderSubmissionError ?? this.orderSubmissionError),
      isUploadingScreenshot:
          isUploadingScreenshot ?? this.isUploadingScreenshot,
      screenshotUploadError: clearScreenshotUploadError
          ? null
          : (screenshotUploadError ?? this.screenshotUploadError),
      isSubmittingUpi: isSubmittingUpi ?? this.isSubmittingUpi,
      upiSubmissionError: clearUpiSubmissionError
          ? null
          : (upiSubmissionError ?? this.upiSubmissionError),
      lastSuccessNotice: clearLastSuccessNotice
          ? null
          : (lastSuccessNotice ?? this.lastSuccessNotice),
    );
  }
}

final sellerOperationsControllerProvider =
    NotifierProvider<SellerOperationsController, SellerOperationsState>(
  SellerOperationsController.new,
);

class SellerOperationsController extends Notifier<SellerOperationsState> {
  static const _allowedMimes = {'image/jpeg', 'image/png', 'image/webp'};

  @override
  SellerOperationsState build() {
    ref.watch(sellerOperationsRepositoryProvider);
    return const SellerOperationsState();
  }

  void setTab(SellerWorkspaceTab tab) {
    state = state.copyWith(
      activeTab: tab,
      clearOrderSubmissionError: true,
      clearScreenshotUploadError: true,
      clearUpiSubmissionError: true,
      clearLastSuccessNotice: true,
    );
  }

  void selectOrder(SellerOrderItem? order) {
    state = state.copyWith(
      selectedOrder: order,
      clearSelectedOrder: order == null,
      clearScreenshotUploadError: true,
      clearUpiSubmissionError: true,
      clearLastSuccessNotice: true,
    );
  }

  Future<void> loadDashboard() async {
    final repo = ref.read(sellerOperationsRepositoryProvider);
    state = state.copyWith(
      isLoadingDashboard: true,
      clearDashboardError: true,
    );
    try {
      final data = await repo.fetchDashboard();
      state = state.copyWith(
        isLoadingDashboard: false,
        dashboard: data,
        orders: state.orders.isEmpty ? data.recentOrders : state.orders,
      );
    } on AppFailure catch (e) {
      state = state.copyWith(
        isLoadingDashboard: false,
        dashboardError: e,
      );
    } catch (_) {
      state = state.copyWith(
        isLoadingDashboard: false,
        dashboardError: const UnknownFailure(),
      );
    }
  }

  Future<void> loadOrders({String? status, String? query}) async {
    final repo = ref.read(sellerOperationsRepositoryProvider);
    final nextStatus = status ?? state.orderStatusFilter;
    final nextQuery = query ?? state.orderSearchQuery;
    state = state.copyWith(
      isLoadingOrders: true,
      orderStatusFilter: nextStatus,
      orderSearchQuery: nextQuery,
      clearOrdersError: true,
    );
    try {
      final list = await repo.listOrders(status: nextStatus, query: nextQuery);
      state = state.copyWith(
        isLoadingOrders: false,
        orders: list,
      );
    } on AppFailure catch (e) {
      state = state.copyWith(
        isLoadingOrders: false,
        ordersError: e,
      );
    } catch (_) {
      state = state.copyWith(
        isLoadingOrders: false,
        ordersError: const UnknownFailure(),
      );
    }
  }

  Future<void> searchCustomers(String query) async {
    final trimmed = query.trim();
    if (trimmed.isEmpty) {
      state = state.copyWith(
        customerLookupResults: const [],
        clearCustomerLookupError: true,
      );
      return;
    }
    if (trimmed.length < 2) {
      state = state.copyWith(
        customerLookupError: const ValidationFailure(
          'Enter at least 2 characters to search customers.',
        ),
      );
      return;
    }

    final repo = ref.read(sellerOperationsRepositoryProvider);
    state = state.copyWith(
      isSearchingCustomers: true,
      clearCustomerLookupError: true,
    );
    try {
      final results = await repo.lookupCustomers(trimmed);
      state = state.copyWith(
        isSearchingCustomers: false,
        customerLookupResults: results,
      );
    } on AppFailure catch (e) {
      state = state.copyWith(
        isSearchingCustomers: false,
        customerLookupError: e,
      );
    } catch (_) {
      state = state.copyWith(
        isSearchingCustomers: false,
        customerLookupError: const UnknownFailure(),
      );
    }
  }

  Future<SellerOrderItem?> createOrder({
    required String name,
    required String whatsapp,
    required String email,
    required int quantity,
  }) async {
    if (state.isSubmittingOrder) return null;

    final cleanName = name.trim();
    final cleanWhatsapp = whatsapp.trim();
    final cleanEmail = email.trim();
    if (cleanName.length < 2) {
      state = state.copyWith(
        orderSubmissionError: const ValidationFailure(
          'Customer full name must be at least 2 characters.',
        ),
      );
      return null;
    }
    final digits = cleanWhatsapp.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.length < 7 || digits.length > 15) {
      state = state.copyWith(
        orderSubmissionError: const ValidationFailure(
          'WhatsApp number must contain between 7 and 15 digits.',
        ),
      );
      return null;
    }
    if (!cleanEmail.contains('@') || !cleanEmail.contains('.')) {
      state = state.copyWith(
        orderSubmissionError: const ValidationFailure(
          'Enter a valid customer email address.',
        ),
      );
      return null;
    }
    if (quantity < 1 || quantity > 1000) {
      state = state.copyWith(
        orderSubmissionError: const ValidationFailure(
          'Ticket quantity must be between 1 and 1,000.',
        ),
      );
      return null;
    }

    final repo = ref.read(sellerOperationsRepositoryProvider);
    state = state.copyWith(
      isSubmittingOrder: true,
      clearOrderSubmissionError: true,
      clearLastSuccessNotice: true,
    );
    try {
      final created = await repo.createOrder(
        name: cleanName,
        whatsapp: cleanWhatsapp,
        email: cleanEmail,
        quantity: quantity,
      );
      state = state.copyWith(
        isSubmittingOrder: false,
        selectedOrder: created,
        orders: [created, ...state.orders.where((o) => o.id != created.id)],
        lastSuccessNotice:
            'Order ${created.orderNumber} created. Upload payment screenshot and submit UTR reference.',
      );
      return created;
    } on AppFailure catch (e) {
      state = state.copyWith(
        isSubmittingOrder: false,
        orderSubmissionError: e,
      );
      return null;
    } catch (_) {
      state = state.copyWith(
        isSubmittingOrder: false,
        orderSubmissionError: const UnknownFailure(),
      );
      return null;
    }
  }

  Future<SellerScreenshotUploadResult?> pickAndUploadScreenshot(
    String orderId,
  ) async {
    if (state.isUploadingScreenshot) return null;
    final picker = ref.read(paymentScreenshotPickerProvider);
    final selected = await picker.pickScreenshot();
    if (selected == null) return null;
    return uploadScreenshotBytes(
      orderId: orderId,
      bytes: selected.bytes,
      fileName: selected.fileName,
      mimeType: selected.mimeType,
    );
  }

  Future<SellerScreenshotUploadResult?> uploadScreenshotBytes({
    required String orderId,
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
  }) async {
    if (state.isUploadingScreenshot) return null;

    if (!_allowedMimes.contains(mimeType.toLowerCase())) {
      state = state.copyWith(
        screenshotUploadError: const ValidationFailure(
          'Upload a JPEG, PNG, or WebP payment screenshot.',
        ),
      );
      return null;
    }
    if (bytes.isEmpty || bytes.length > kMaxPaymentScreenshotBytes) {
      state = state.copyWith(
        screenshotUploadError: const ValidationFailure(
          'The payment screenshot must be 2 MB or smaller.',
        ),
      );
      return null;
    }

    final repo = ref.read(sellerOperationsRepositoryProvider);
    state = state.copyWith(
      isUploadingScreenshot: true,
      clearScreenshotUploadError: true,
      clearLastSuccessNotice: true,
    );
    try {
      final result = await repo.uploadOrderScreenshot(
        orderId: orderId,
        bytes: bytes,
        fileName: fileName,
        mimeType: mimeType,
      );
      final updatedOrder = result.order;
      final nextOrders = updatedOrder != null
          ? state.orders
              .map((o) => o.id == updatedOrder.id ? updatedOrder : o)
              .toList(growable: false)
          : state.orders;
      state = state.copyWith(
        isUploadingScreenshot: false,
        selectedOrder: updatedOrder ?? state.selectedOrder,
        orders: nextOrders,
        lastSuccessNotice: result.replaced
            ? 'Payment screenshot replaced. You can now submit the UTR reference.'
            : 'Payment screenshot uploaded securely. You can now submit the UTR reference.',
      );
      return result;
    } on AppFailure catch (e) {
      state = state.copyWith(
        isUploadingScreenshot: false,
        screenshotUploadError: e,
      );
      return null;
    } catch (_) {
      state = state.copyWith(
        isUploadingScreenshot: false,
        screenshotUploadError: const UnknownFailure(),
      );
      return null;
    }
  }

  Future<SellerOrderItem?> submitManualUpi({
    required String orderId,
    required String utr,
    String payerName = '',
  }) async {
    if (state.isSubmittingUpi) return null;

    final cleanUtr = utr.trim();
    if (cleanUtr.isNotEmpty && cleanUtr.length < 6) {
      state = state.copyWith(
        upiSubmissionError: const ValidationFailure(
          'UTR / Reference must be at least 6 characters when provided.',
        ),
      );
      return null;
    }

    final repo = ref.read(sellerOperationsRepositoryProvider);
    state = state.copyWith(
      isSubmittingUpi: true,
      clearUpiSubmissionError: true,
      clearLastSuccessNotice: true,
    );
    try {
      final updated = await repo.submitManualUpi(
        orderId: orderId,
        utr: cleanUtr,
        payerName: payerName.trim(),
      );
      final nextOrders = state.orders
          .map((o) => o.id == updated.id ? updated : o)
          .toList(growable: false);
      state = state.copyWith(
        isSubmittingUpi: false,
        selectedOrder: updated,
        orders: nextOrders,
        lastSuccessNotice:
            'Payment reference submitted for ${updated.orderNumber}. Awaiting admin verification.',
      );
      return updated;
    } on AppFailure catch (e) {
      state = state.copyWith(
        isSubmittingUpi: false,
        upiSubmissionError: e,
      );
      return null;
    } catch (_) {
      state = state.copyWith(
        isSubmittingUpi: false,
        upiSubmissionError: const UnknownFailure(),
      );
      return null;
    }
  }
}
