import '../../super_admin/domain/super_admin_models.dart';
import '../domain/admin_models.dart';
import '../domain/admin_operations_repository.dart';
import 'admin_operations_remote_datasource.dart';

class AdminOperationsRepositoryImpl implements AdminOperationsRepository {
  const AdminOperationsRepositoryImpl(this._remote);

  final AdminOperationsRemoteDataSource _remote;

  @override
  Future<AdminCollectionSummary> fetchCollectionSummary() =>
      _remote.getCollectionSummary();

  @override
  Future<List<AdminPaymentQueueItem>> listPayments({
    String status = 'SUBMITTED',
    String query = '',
    String? sellerId,
  }) =>
      _remote.listPayments(
        status: status,
        query: query,
        sellerId: sellerId,
      );

  @override
  Future<AdminPaymentQueueItem> getPaymentDetail(String paymentId) =>
      _remote.getPaymentDetail(paymentId);

  @override
  Future<AdminPaymentDecisionResult> verifyPaymentAndIssueTickets(
    String paymentId,
  ) =>
      _remote.verifyPaymentAndIssueTickets(paymentId);

  @override
  Future<AdminPaymentDecisionResult> rejectPayment({
    required String paymentId,
    required String reason,
  }) =>
      _remote.rejectPayment(paymentId: paymentId, reason: reason);

  @override
  Future<AdminLookupResults> lookupDirectory({
    required String query,
    String type = 'ALL',
  }) =>
      _remote.lookupDirectory(query: query, type: type);

  @override
  Future<List<MobileAuditEventItem>> listAuditLogs() => _remote.listAuditLogs();
}
