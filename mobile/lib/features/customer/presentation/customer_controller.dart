import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_failure.dart';
import '../../auth/presentation/auth_controller.dart';
import '../data/customer_remote_datasource.dart';
import '../data/customer_repository_impl.dart';
import '../domain/customer_models.dart';
import '../domain/customer_repository.dart';

final customerRepositoryProvider = Provider<CustomerRepository>((ref) {
  final dio = ref.watch(mobileDioProvider);
  return CustomerRepositoryImpl(CustomerRemoteDataSource(dio));
});

enum CustomerWorkspaceTab { overviewAndTickets, myOrders, verifyTicket }

class CustomerState {
  const CustomerState({
    this.activeTab = CustomerWorkspaceTab.overviewAndTickets,
    this.isLoadingDashboard = false,
    this.dashboard,
    this.dashboardError,
    this.isVerifyingTicket = false,
    this.verificationResult,
    this.verificationError,
  });

  final CustomerWorkspaceTab activeTab;
  final bool isLoadingDashboard;
  final CustomerDashboardData? dashboard;
  final AppFailure? dashboardError;

  final bool isVerifyingTicket;
  final TicketVerificationDetails? verificationResult;
  final AppFailure? verificationError;

  CustomerState copyWith({
    CustomerWorkspaceTab? activeTab,
    bool? isLoadingDashboard,
    CustomerDashboardData? dashboard,
    AppFailure? dashboardError,
    bool clearDashboardError = false,
    bool? isVerifyingTicket,
    TicketVerificationDetails? verificationResult,
    bool clearVerificationResult = false,
    AppFailure? verificationError,
    bool clearVerificationError = false,
  }) {
    return CustomerState(
      activeTab: activeTab ?? this.activeTab,
      isLoadingDashboard: isLoadingDashboard ?? this.isLoadingDashboard,
      dashboard: dashboard ?? this.dashboard,
      dashboardError:
          clearDashboardError ? null : (dashboardError ?? this.dashboardError),
      isVerifyingTicket: isVerifyingTicket ?? this.isVerifyingTicket,
      verificationResult: clearVerificationResult
          ? null
          : (verificationResult ?? this.verificationResult),
      verificationError: clearVerificationError
          ? null
          : (verificationError ?? this.verificationError),
    );
  }
}

final customerControllerProvider =
    NotifierProvider<CustomerController, CustomerState>(
  CustomerController.new,
);

class CustomerController extends Notifier<CustomerState> {
  static final _ticketPattern = RegExp(r'^(?:PRV-)?SSFI-[0-9]{6}$', caseSensitive: false);

  @override
  CustomerState build() {
    ref.watch(customerRepositoryProvider);
    return const CustomerState();
  }

  void setTab(CustomerWorkspaceTab tab) {
    state = state.copyWith(
      activeTab: tab,
      clearVerificationError: true,
    );
  }

  Future<void> loadDashboard() async {
    final repo = ref.read(customerRepositoryProvider);
    state = state.copyWith(
      isLoadingDashboard: true,
      clearDashboardError: true,
    );
    try {
      final data = await repo.fetchDashboard();
      state = state.copyWith(
        isLoadingDashboard: false,
        dashboard: data,
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

  Future<TicketVerificationDetails?> verifyTicket(String rawTicketNumber) async {
    if (state.isVerifyingTicket) return null;
    final clean = rawTicketNumber.trim().toUpperCase();
    if (!_ticketPattern.hasMatch(clean)) {
      state = state.copyWith(
        verificationError: const ValidationFailure(
          'Enter a valid ticket number in SSFI-XXXXXX format (e.g. SSFI-000101).',
        ),
        clearVerificationResult: true,
      );
      return null;
    }

    final repo = ref.read(customerRepositoryProvider);
    state = state.copyWith(
      isVerifyingTicket: true,
      clearVerificationError: true,
    );
    try {
      final result = await repo.verifyTicket(clean);
      state = state.copyWith(
        isVerifyingTicket: false,
        verificationResult: result,
      );
      return result;
    } on AppFailure catch (e) {
      state = state.copyWith(
        isVerifyingTicket: false,
        verificationError: e,
      );
      return null;
    } catch (_) {
      state = state.copyWith(
        isVerifyingTicket: false,
        verificationError: const UnknownFailure(),
      );
      return null;
    }
  }
}
