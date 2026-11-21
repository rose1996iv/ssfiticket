import 'package:dio/dio.dart';

import '../../../core/errors/app_failure.dart';
import '../../../core/network/dio_client.dart';
import '../domain/super_admin_models.dart';

class SuperAdminRemoteDataSource {
  const SuperAdminRemoteDataSource(this._dio);

  final Dio _dio;

  Future<SuperAdminOverviewData> getOverview() async {
    try {
      final response = await _dio.get<dynamic>('/super-admin/overview');
      final body = response.data;
      if (body is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      return SuperAdminOverviewData.fromEnvelope(body);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<String> requestFirstPrizeApproval({
    required String drawId,
    required String prizeId,
    required String snapshotId,
  }) async {
    try {
      final response = await _dio.post<dynamic>(
        '/super-admin/first-prize-approval',
        data: {
          'action': 'REQUEST',
          'drawId': drawId,
          'prizeId': prizeId,
          'snapshotId': snapshotId,
        },
      );
      final body = response.data;
      if (body is! Map<String, dynamic> ||
          body['data'] is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      final data = body['data'] as Map<String, dynamic>;
      return (data['approvalId'] as String?) ?? '';
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<String> decideFirstPrizeApproval({
    required String approvalId,
    required String decision,
    String notes = '',
  }) async {
    try {
      final response = await _dio.post<dynamic>(
        '/super-admin/first-prize-approval',
        data: {
          'action': 'DECIDE',
          'approvalId': approvalId,
          'decision': decision,
          'notes': notes.trim(),
        },
      );
      final body = response.data;
      if (body is! Map<String, dynamic> ||
          body['data'] is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      final data = body['data'] as Map<String, dynamic>;
      return (data['status'] as String?) ?? decision;
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<String> setSellerLifecycleStatus({
    required String sellerId,
    required bool activate,
  }) async {
    try {
      final response = await _dio.post<dynamic>(
        '/super-admin/sellers/$sellerId/status',
        data: {
          'action': activate ? 'REACTIVATE' : 'DEACTIVATE',
        },
      );
      final body = response.data;
      if (body is! Map<String, dynamic> ||
          body['data'] is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      final data = body['data'] as Map<String, dynamic>;
      return (data['message'] as String?) ??
          (activate ? 'Seller reactivated.' : 'Seller deactivated.');
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<SuperAdminPaymentScreenshotAccess> getPaymentScreenshotSignedUrl(
    String paymentId,
  ) async {
    try {
      final response = await _dio.get<dynamic>(
        '/super-admin/payments/$paymentId/screenshot',
      );
      final body = response.data;
      if (body is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      return SuperAdminPaymentScreenshotAccess.fromEnvelope(body);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }
}
