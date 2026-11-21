import 'package:dio/dio.dart';

import '../../../core/errors/app_failure.dart';
import '../../../core/network/dio_client.dart';
import '../../super_admin/domain/super_admin_models.dart';
import '../domain/admin_models.dart';

class AdminOperationsRemoteDataSource {
  const AdminOperationsRemoteDataSource(this._dio);

  final Dio _dio;

  Future<AdminCollectionSummary> getCollectionSummary() async {
    try {
      final response = await _dio.get<dynamic>('/admin/summary');
      final body = response.data;
      if (body is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      return AdminCollectionSummary.fromEnvelope(body);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<List<AdminPaymentQueueItem>> listPayments({
    String status = 'SUBMITTED',
    String query = '',
    String? sellerId,
  }) async {
    try {
      final response = await _dio.get<dynamic>(
        '/admin/payments',
        queryParameters: {
          'status': status,
          if (query.trim().isNotEmpty) 'q': query.trim(),
          if (sellerId != null && sellerId.trim().isNotEmpty)
            'sellerId': sellerId.trim(),
        },
      );
      final body = response.data;
      if (body is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      final data = body['data'];
      if (data is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      final rawList = (data['payments'] as List<dynamic>?) ?? const <dynamic>[];
      return rawList
          .whereType<Map<String, dynamic>>()
          .map(AdminPaymentQueueItem.fromJson)
          .toList(growable: false);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<AdminPaymentQueueItem> getPaymentDetail(String paymentId) async {
    try {
      final response = await _dio.get<dynamic>('/admin/payments/$paymentId');
      final body = response.data;
      if (body is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      final data = body['data'];
      if (data is! Map<String, dynamic> ||
          data['payment'] is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      return AdminPaymentQueueItem.fromJson(
        data['payment'] as Map<String, dynamic>,
      );
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<AdminPaymentDecisionResult> verifyPaymentAndIssueTickets(
    String paymentId,
  ) async {
    try {
      final response = await _dio.post<dynamic>(
        '/admin/payments/$paymentId/decision',
        data: {'action': 'VERIFY'},
      );
      final body = response.data;
      if (body is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      return AdminPaymentDecisionResult.fromEnvelope(body);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<AdminPaymentDecisionResult> rejectPayment({
    required String paymentId,
    required String reason,
  }) async {
    try {
      final response = await _dio.post<dynamic>(
        '/admin/payments/$paymentId/decision',
        data: {
          'action': 'REJECT',
          'reason': reason.trim(),
        },
      );
      final body = response.data;
      if (body is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      return AdminPaymentDecisionResult.fromEnvelope(body);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<AdminLookupResults> lookupDirectory({
    required String query,
    String type = 'ALL',
  }) async {
    try {
      final response = await _dio.get<dynamic>(
        '/admin/lookup',
        queryParameters: {
          'q': query.trim(),
          'type': type,
        },
      );
      final body = response.data;
      if (body is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      return AdminLookupResults.fromEnvelope(body);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<List<MobileAuditEventItem>> listAuditLogs() async {
    try {
      final response = await _dio.get<dynamic>('/admin/audit-logs');
      final body = response.data;
      if (body is! Map<String, dynamic> ||
          body['data'] is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      final data = body['data'] as Map<String, dynamic>;
      final raw = (data['auditLogs'] as List<dynamic>?) ?? const <dynamic>[];
      return raw
          .whereType<Map<String, dynamic>>()
          .map(MobileAuditEventItem.fromJson)
          .toList(growable: false);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }
}
