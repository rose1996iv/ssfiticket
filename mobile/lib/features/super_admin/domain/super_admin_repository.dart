import 'super_admin_models.dart';

abstract interface class SuperAdminRepository {
  Future<SuperAdminOverviewData> fetchOverview();

  Future<String> requestFirstPrizeApproval({
    required String drawId,
    required String prizeId,
    required String snapshotId,
  });

  Future<String> decideFirstPrizeApproval({
    required String approvalId,
    required String decision,
    String notes = '',
  });

  Future<String> setSellerLifecycleStatus({
    required String sellerId,
    required bool activate,
  });

  Future<SuperAdminPaymentScreenshotAccess> getPaymentScreenshotSignedUrl(
    String paymentId,
  );
}
