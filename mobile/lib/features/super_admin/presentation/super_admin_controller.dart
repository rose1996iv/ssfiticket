import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_failure.dart';
import '../../auth/presentation/auth_controller.dart';
import '../data/super_admin_remote_datasource.dart';
import '../data/super_admin_repository_impl.dart';
import '../domain/super_admin_models.dart';
import '../domain/super_admin_repository.dart';

final superAdminRepositoryProvider = Provider<SuperAdminRepository>((ref) {
  final dio = ref.watch(mobileDioProvider);
  return SuperAdminRepositoryImpl(SuperAdminRemoteDataSource(dio));
});

enum SuperAdminWorkspaceTab {
  governance,
  usersAndSellers,
  firstPrizeDualAuth,
  auditAndScreenshots,
}

class SuperAdminState {
  const SuperAdminState({
    this.activeTab = SuperAdminWorkspaceTab.governance,
    this.isLoadingOverview = false,
    this.overview,
    this.overviewError,
    this.isProcessingAction = false,
    this.actionError,
    this.actionNotice,
    this.screenshotAccess,
  });

  final SuperAdminWorkspaceTab activeTab;
  final bool isLoadingOverview;
  final SuperAdminOverviewData? overview;
  final AppFailure? overviewError;
  final bool isProcessingAction;
  final AppFailure? actionError;
  final String? actionNotice;
  final SuperAdminPaymentScreenshotAccess? screenshotAccess;

  SuperAdminState copyWith({
    SuperAdminWorkspaceTab? activeTab,
    bool? isLoadingOverview,
    SuperAdminOverviewData? overview,
    AppFailure? overviewError,
    bool clearOverviewError = false,
    bool? isProcessingAction,
    AppFailure? actionError,
    bool clearActionError = false,
    String? actionNotice,
    bool clearActionNotice = false,
    SuperAdminPaymentScreenshotAccess? screenshotAccess,
    bool clearScreenshotAccess = false,
  }) {
    return SuperAdminState(
      activeTab: activeTab ?? this.activeTab,
      isLoadingOverview: isLoadingOverview ?? this.isLoadingOverview,
      overview: overview ?? this.overview,
      overviewError:
          clearOverviewError ? null : (overviewError ?? this.overviewError),
      isProcessingAction: isProcessingAction ?? this.isProcessingAction,
      actionError: clearActionError ? null : (actionError ?? this.actionError),
      actionNotice:
          clearActionNotice ? null : (actionNotice ?? this.actionNotice),
      screenshotAccess: clearScreenshotAccess
          ? null
          : (screenshotAccess ?? this.screenshotAccess),
    );
  }
}

final superAdminControllerProvider =
    NotifierProvider<SuperAdminController, SuperAdminState>(
  SuperAdminController.new,
);

class SuperAdminController extends Notifier<SuperAdminState> {
  @override
  SuperAdminState build() {
    ref.watch(superAdminRepositoryProvider);
    return const SuperAdminState();
  }

  void setTab(SuperAdminWorkspaceTab tab) {
    state = state.copyWith(
      activeTab: tab,
      clearActionError: true,
      clearActionNotice: true,
    );
  }

  Future<void> loadOverview() async {
    final repo = ref.read(superAdminRepositoryProvider);
    state = state.copyWith(
      isLoadingOverview: true,
      clearOverviewError: true,
    );
    try {
      final data = await repo.fetchOverview();
      state = state.copyWith(
        isLoadingOverview: false,
        overview: data,
      );
    } on AppFailure catch (e) {
      state = state.copyWith(
        isLoadingOverview: false,
        overviewError: e,
      );
    } catch (_) {
      state = state.copyWith(
        isLoadingOverview: false,
        overviewError: const UnknownFailure(),
      );
    }
  }

  Future<bool> initiateFirstPrizeApproval({
    required String drawId,
    required String prizeId,
    required String snapshotId,
  }) async {
    if (state.isProcessingAction) return false;
    final repo = ref.read(superAdminRepositoryProvider);
    state = state.copyWith(
      isProcessingAction: true,
      clearActionError: true,
      clearActionNotice: true,
    );
    try {
      final approvalId = await repo.requestFirstPrizeApproval(
        drawId: drawId,
        prizeId: prizeId,
        snapshotId: snapshotId,
      );
      state = state.copyWith(
        isProcessingAction: false,
        actionNotice:
            '1st Prize dual approval initiated ($approvalId). Awaiting review by a separate administrator.',
      );
      await loadOverview();
      return true;
    } on AppFailure catch (e) {
      state = state.copyWith(
        isProcessingAction: false,
        actionError: e,
      );
      return false;
    } catch (_) {
      state = state.copyWith(
        isProcessingAction: false,
        actionError: const UnknownFailure(),
      );
      return false;
    }
  }

  Future<bool> decideFirstPrizeApproval({
    required String approvalId,
    required String decision,
    String notes = '',
  }) async {
    if (state.isProcessingAction) return false;
    final repo = ref.read(superAdminRepositoryProvider);
    state = state.copyWith(
      isProcessingAction: true,
      clearActionError: true,
      clearActionNotice: true,
    );
    try {
      final status = await repo.decideFirstPrizeApproval(
        approvalId: approvalId,
        decision: decision,
        notes: notes,
      );
      state = state.copyWith(
        isProcessingAction: false,
        actionNotice: '1st Prize dual-approval decision recorded: $status.',
      );
      await loadOverview();
      return true;
    } on AppFailure catch (e) {
      state = state.copyWith(
        isProcessingAction: false,
        actionError: e,
      );
      return false;
    } catch (_) {
      state = state.copyWith(
        isProcessingAction: false,
        actionError: const UnknownFailure(),
      );
      return false;
    }
  }

  Future<bool> toggleSellerStatus({
    required String sellerId,
    required bool activate,
  }) async {
    if (state.isProcessingAction) return false;
    final repo = ref.read(superAdminRepositoryProvider);
    state = state.copyWith(
      isProcessingAction: true,
      clearActionError: true,
      clearActionNotice: true,
    );
    try {
      final msg = await repo.setSellerLifecycleStatus(
        sellerId: sellerId,
        activate: activate,
      );
      state = state.copyWith(
        isProcessingAction: false,
        actionNotice: msg,
      );
      await loadOverview();
      return true;
    } on AppFailure catch (e) {
      state = state.copyWith(
        isProcessingAction: false,
        actionError: e,
      );
      return false;
    } catch (_) {
      state = state.copyWith(
        isProcessingAction: false,
        actionError: const UnknownFailure(),
      );
      return false;
    }
  }

  Future<SuperAdminPaymentScreenshotAccess?> requestPaymentScreenshotAccess(
    String paymentId,
  ) async {
    if (state.isProcessingAction) return null;
    final cleanId = paymentId.trim();
    if (cleanId.length < 10) {
      state = state.copyWith(
        actionError: const ValidationFailure(
          'Enter a valid Payment UUID to request SUPER_ADMIN signed screenshot access.',
        ),
      );
      return null;
    }

    final repo = ref.read(superAdminRepositoryProvider);
    state = state.copyWith(
      isProcessingAction: true,
      clearActionError: true,
      clearActionNotice: true,
      clearScreenshotAccess: true,
    );
    try {
      final access = await repo.getPaymentScreenshotSignedUrl(cleanId);
      state = state.copyWith(
        isProcessingAction: false,
        screenshotAccess: access,
        actionNotice:
            'Signed screenshot URL generated (${access.fileName}, expires in ${access.expiresInSeconds}s). Audit log recorded.',
      );
      return access;
    } on AppFailure catch (e) {
      state = state.copyWith(
        isProcessingAction: false,
        actionError: e,
      );
      return null;
    } catch (_) {
      state = state.copyWith(
        isProcessingAction: false,
        actionError: const UnknownFailure(),
      );
      return null;
    }
  }
}
