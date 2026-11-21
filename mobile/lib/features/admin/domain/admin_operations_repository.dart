import '../../super_admin/domain/super_admin_models.dart';
import 'admin_models.dart';

abstract interface class AdminOperationsRepository {
  Future<AdminCollectionSummary> fetchCollectionSummary();

  Future<List<AdminPaymentQueueItem>> listPayments({
    String status = 'SUBMITTED',
    String query = '',
    String? sellerId,
  });

  Future<AdminPaymentQueueItem> getPaymentDetail(String paymentId);

  Future<AdminPaymentDecisionResult> verifyPaymentAndIssueTickets(
    String paymentId,
  );

  Future<AdminPaymentDecisionResult> rejectPayment({
    required String paymentId,
    required String reason,
  });

  Future<AdminLookupResults> lookupDirectory({
    required String query,
    String type = 'ALL',
  });

  Future<List<MobileAuditEventItem>> listAuditLogs() =>
      Future.value(const <MobileAuditEventItem>[]);
}
