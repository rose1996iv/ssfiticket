import 'package:dio/dio.dart';

import '../../../core/errors/app_failure.dart';
import '../../../core/network/dio_client.dart';
import '../domain/auth_identity.dart';

/// Remote datasource calling the authoritative Next.js Mobile API v1 endpoints.
class AuthRemoteDataSource {
  const AuthRemoteDataSource(this._dio);

  final Dio _dio;

  /// Calls `GET /api/mobile/v1/me` and strictly parses the authoritative identity.
  Future<AuthIdentity> getMe() async {
    try {
      final response = await _dio.get<dynamic>('/me');
      final data = response.data;
      if (data is! Map<String, dynamic>) {
        throw const InvalidResponseFailure(
          'Expected JSON object from /api/mobile/v1/me.',
        );
      }
      return AuthIdentity.fromMeEnvelope(data);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }
}
