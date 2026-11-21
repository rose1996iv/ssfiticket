import '../domain/super_admin_models.dart';
import '../domain/super_admin_repository.dart';
import 'super_admin_remote_datasource.dart';

class SuperAdminRepositoryImpl implements SuperAdminRepository {
  const SuperAdminRepositoryImpl(this._remote);

  final SuperAdminRemoteDataSource _remote;

  @override
  Future<SuperAdminOverviewData> fetchOverview() => _remote.getOverview();

  @override
  Future<String> requestFirstPrizeApproval({
    required String drawId,
    required String prizeId,
    required String snapshotId,
  }) =>
      _remote.requestFirstPrizeApproval(
        drawId: drawId,
        prizeId: prizeId,
        snapshotId: snapshotId,
      );

  @override
  Future<String> decideFirstPrizeApproval({
    required String approvalId,
    required String decision,
    String notes = '',
  }) =>
      _remote.decideFirstPrizeApproval(
        approvalId: approvalId,
        decision: decision,
        notes: notes,
      );

  @override
  Future<String> setSellerLifecycleStatus({
    required String sellerId,
    required bool activate,
  }) =>
      _remote.setSellerLifecycleStatus(
        sellerId: sellerId,
        activate: activate,
      );

  @override
  Future<SuperAdminPaymentScreenshotAccess> getPaymentScreenshotSignedUrl(
    String paymentId,
  ) =>
      _remote.getPaymentScreenshotSignedUrl(paymentId);
}
