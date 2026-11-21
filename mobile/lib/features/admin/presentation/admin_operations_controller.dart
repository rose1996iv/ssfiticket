import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_failure.dart';
import '../../auth/presentation/auth_controller.dart';
import '../data/admin_operations_remote_datasource.dart';
import '../data/admin_operations_repository_impl.dart';
import '../domain/admin_models.dart';
import '../domain/admin_operations_repository.dart';

final adminOperationsRepositoryProvider =
    Provider<AdminOperationsRepository>((ref) {
  final dio = ref.watch(mobileDioProvider);
  return AdminOperationsRepositoryImpl(AdminOperationsRemoteDataSource(dio));
});

enum AdminWorkspaceTab { overview, pendingPayments, directoryLookup }

class AdminOperationsState {
  const AdminOperationsState({
    this.activeTab = AdminWorkspaceTab.overview,
    this.isLoadingSummary = false,
    this.summary,
    this.summaryError,
    this.isLoadingPayments = false,
    this.payments = const [],
    this.paymentsError,
    this.paymentStatusFilter = 'SUBMITTED',
    this.paymentSearchQuery = '',
    this.selectedPayment,
    this.isProcessingDecision = false,
    this.decisionError,
    this.lastDecisionNotice,
    this.isSearchingDirectory = false,
    this.lookupType = 'ALL',
    this.lookupResults = const AdminLookupResults(),
    this.lookupError,
  });

  final AdminWorkspaceTab activeTab;
  final bool isLoadingSummary;
  final AdminCollectionSummary? summary;
  final AppFailure? summaryError;

  final bool isLoadingPayments;
  final List<AdminPaymentQueueItem> payments;
  final AppFailure? paymentsError;
  final String paymentStatusFilter;
  final String paymentSearchQuery;

  final AdminPaymentQueueItem? selectedPayment;
  final bool isProcessingDecision;
  final AppFailure? decisionError;
  final String? lastDecisionNotice;

  final bool isSearchingDirectory;
  final String lookupType;
  final AdminLookupResults lookupResults;
  final AppFailure? lookupError;

  AdminOperationsState copyWith({
    AdminWorkspaceTab? activeTab,
    bool? isLoadingSummary,
    AdminCollectionSummary? summary,
    AppFailure? summaryError,
    bool clearSummaryError = false,
    bool? isLoadingPayments,
    List<AdminPaymentQueueItem>? payments,
    AppFailure? paymentsError,
    bool clearPaymentsError = false,
    String? paymentStatusFilter,
    String? paymentSearchQuery,
    AdminPaymentQueueItem? selectedPayment,
    bool clearSelectedPayment = false,
    bool? isProcessingDecision,
    AppFailure? decisionError,
    bool clearDecisionError = false,
    String? lastDecisionNotice,
    bool clearLastDecisionNotice = false,
    bool? isSearchingDirectory,
    String? lookupType,
    AdminLookupResults? lookupResults,
    AppFailure? lookupError,
    bool clearLookupError = false,
  }) {
    return AdminOperationsState(
      activeTab: activeTab ?? this.activeTab,
      isLoadingSummary: isLoadingSummary ?? this.isLoadingSummary,
      summary: summary ?? this.summary,
      summaryError:
          clearSummaryError ? null : (summaryError ?? this.summaryError),
      isLoadingPayments: isLoadingPayments ?? this.isLoadingPayments,
      payments: payments ?? this.payments,
      paymentsError:
          clearPaymentsError ? null : (paymentsError ?? this.paymentsError),
      paymentStatusFilter: paymentStatusFilter ?? this.paymentStatusFilter,
      paymentSearchQuery: paymentSearchQuery ?? this.paymentSearchQuery,
      selectedPayment:
          clearSelectedPayment ? null : (selectedPayment ?? this.selectedPayment),
      isProcessingDecision: isProcessingDecision ?? this.isProcessingDecision,
      decisionError:
          clearDecisionError ? null : (decisionError ?? this.decisionError),
      lastDecisionNotice: clearLastDecisionNotice
          ? null
          : (lastDecisionNotice ?? this.lastDecisionNotice),
      isSearchingDirectory: isSearchingDirectory ?? this.isSearchingDirectory,
      lookupType: lookupType ?? this.lookupType,
      lookupResults: lookupResults ?? this.lookupResults,
      lookupError: clearLookupError ? null : (lookupError ?? this.lookupError),
    );
  }
}

final adminOperationsControllerProvider =
    NotifierProvider<AdminOperationsController, AdminOperationsState>(
  AdminOperationsController.new,
);

class AdminOperationsController extends Notifier<AdminOperationsState> {
  @override
  AdminOperationsState build() {
    ref.watch(adminOperationsRepositoryProvider);
    return const AdminOperationsState();
  }

  void setTab(AdminWorkspaceTab tab) {
    state = state.copyWith(
      activeTab: tab,
      clearDecisionError: true,
      clearLastDecisionNotice: true,
    );
  }

  void selectPayment(AdminPaymentQueueItem? item) {
    state = state.copyWith(
      selectedPayment: item,
      clearSelectedPayment: item == null,
      clearDecisionError: true,
      clearLastDecisionNotice: true,
    );
  }

  Future<void> loadCollectionSummary() async {
    final repo = ref.read(adminOperationsRepositoryProvider);
    state = state.copyWith(
      isLoadingSummary: true,
      clearSummaryError: true,
    );
    try {
      final summary = await repo.fetchCollectionSummary();
      state = state.copyWith(
        isLoadingSummary: false,
        summary: summary,
      );
    } on AppFailure catch (e) {
      state = state.copyWith(
        isLoadingSummary: false,
        summaryError: e,
      );
    } catch (_) {
      state = state.copyWith(
        isLoadingSummary: false,
        summaryError: const UnknownFailure(),
      );
    }
  }

  Future<void> loadPayments({String? status, String? query}) async {
    final repo = ref.read(adminOperationsRepositoryProvider);
    final nextStatus = status ?? state.paymentStatusFilter;
    final nextQuery = query ?? state.paymentSearchQuery;
    state = state.copyWith(
      isLoadingPayments: true,
      paymentStatusFilter: nextStatus,
      paymentSearchQuery: nextQuery,
      clearPaymentsError: true,
    );
    try {
      final list = await repo.listPayments(
        status: nextStatus,
        query: nextQuery,
      );
      state = state.copyWith(
        isLoadingPayments: false,
        payments: list,
      );
    } on AppFailure catch (e) {
      state = state.copyWith(
        isLoadingPayments: false,
        paymentsError: e,
      );
    } catch (_) {
      state = state.copyWith(
        isLoadingPayments: false,
        paymentsError: const UnknownFailure(),
      );
    }
  }

  Future<AdminPaymentDecisionResult?> verifyPaymentAndIssueTickets(
    String paymentId,
  ) async {
    if (state.isProcessingDecision) return null;

    final repo = ref.read(adminOperationsRepositoryProvider);
    state = state.copyWith(
      isProcessingDecision: true,
      clearDecisionError: true,
      clearLastDecisionNotice: true,
    );
    try {
      final result = await repo.verifyPaymentAndIssueTickets(paymentId);
      final updatedPayment = result.payment;
      final nextPayments = updatedPayment != null
          ? state.payments
              .map((p) => p.id == updatedPayment.id ? updatedPayment : p)
              .toList(growable: false)
          : state.payments;

      final ticketSummary = result.issuedTickets.isNotEmpty
          ? 'Issued tickets: ${result.issuedTickets.map((t) => t.ticketNumber).join(', ')}'
          : 'Tickets issued via issue_tickets().';

      state = state.copyWith(
        isProcessingDecision: false,
        selectedPayment: updatedPayment ?? state.selectedPayment,
        payments: nextPayments,
        lastDecisionNotice: 'Payment VERIFIED. $ticketSummary',
      );
      return result;
    } on AppFailure catch (e) {
      state = state.copyWith(
        isProcessingDecision: false,
        decisionError: e,
      );
      return null;
    } catch (_) {
      state = state.copyWith(
        isProcessingDecision: false,
        decisionError: const UnknownFailure(),
      );
      return null;
    }
  }

  Future<AdminPaymentDecisionResult?> rejectPayment({
    required String paymentId,
    required String reason,
  }) async {
    if (state.isProcessingDecision) return null;

    final cleanReason = reason.trim();
    if (cleanReason.length < 3) {
      state = state.copyWith(
        decisionError: const ValidationFailure(
          'Rejection reason must be at least 3 characters.',
        ),
      );
      return null;
    }

    final repo = ref.read(adminOperationsRepositoryProvider);
    state = state.copyWith(
      isProcessingDecision: true,
      clearDecisionError: true,
      clearLastDecisionNotice: true,
    );
    try {
      final result = await repo.rejectPayment(
        paymentId: paymentId,
        reason: cleanReason,
      );
      final updatedPayment = result.payment;
      final nextPayments = updatedPayment != null
          ? state.payments
              .map((p) => p.id == updatedPayment.id ? updatedPayment : p)
              .toList(growable: false)
          : state.payments;

      state = state.copyWith(
        isProcessingDecision: false,
        selectedPayment: updatedPayment ?? state.selectedPayment,
        payments: nextPayments,
        lastDecisionNotice: 'Payment REJECTED and returned to PENDING_PAYMENT.',
      );
      return result;
    } on AppFailure catch (e) {
      state = state.copyWith(
        isProcessingDecision: false,
        decisionError: e,
      );
      return null;
    } catch (_) {
      state = state.copyWith(
        isProcessingDecision: false,
        decisionError: const UnknownFailure(),
      );
      return null;
    }
  }

  Future<void> searchDirectory({required String query, String? type}) async {
    final cleanQuery = query.trim();
    final nextType = type ?? state.lookupType;
    if (cleanQuery.length < 2) {
      state = state.copyWith(
        lookupType: nextType,
        lookupError: const ValidationFailure(
          'Enter at least 2 characters to search sellers, customers, or orders.',
        ),
      );
      return;
    }

    final repo = ref.read(adminOperationsRepositoryProvider);
    state = state.copyWith(
      isSearchingDirectory: true,
      lookupType: nextType,
      clearLookupError: true,
    );
    try {
      final results = await repo.lookupDirectory(
        query: cleanQuery,
        type: nextType,
      );
      state = state.copyWith(
        isSearchingDirectory: false,
        lookupResults: results,
      );
    } on AppFailure catch (e) {
      state = state.copyWith(
        isSearchingDirectory: false,
        lookupError: e,
      );
    } catch (_) {
      state = state.copyWith(
        isSearchingDirectory: false,
        lookupError: const UnknownFailure(),
      );
    }
  }
}
