import 'package:dio/dio.dart';

import '../../../core/errors/app_failure.dart';
import '../../../core/network/dio_client.dart';
import '../domain/customer_models.dart';

class CustomerRemoteDataSource {
  const CustomerRemoteDataSource(this._dio);

  final Dio _dio;

  Future<CustomerDashboardData> getDashboard() async {
    try {
      final response = await _dio.get<dynamic>('/customer/dashboard');
      final body = response.data;
      if (body is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      return CustomerDashboardData.fromEnvelope(body);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<TicketVerificationDetails> verifyTicket(String ticketNumber) async {
    try {
      final clean = Uri.encodeComponent(ticketNumber.trim().toUpperCase());
      final response = await _dio.get<dynamic>('/tickets/verify/$clean');
      final body = response.data;
      if (body is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      return TicketVerificationDetails.fromEnvelope(body);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }
}
