import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../../core/errors/app_failure.dart';
import '../../../core/network/dio_client.dart';
import '../domain/seller_models.dart';

class SellerOperationsRemoteDataSource {
  const SellerOperationsRemoteDataSource(this._dio);

  final Dio _dio;

  Future<SellerDashboardData> getDashboard() async {
    try {
      final response = await _dio.get<dynamic>('/seller/dashboard');
      final body = response.data;
      if (body is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      return SellerDashboardData.fromEnvelope(body);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<List<SellerCustomerItem>> lookupCustomers(String query) async {
    try {
      final response = await _dio.get<dynamic>(
        '/seller/customers',
        queryParameters: {'q': query.trim()},
      );
      final body = response.data;
      if (body is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      final data = body['data'];
      if (data is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      final rawList = (data['customers'] as List<dynamic>?) ?? const <dynamic>[];
      return rawList
          .whereType<Map<String, dynamic>>()
          .map(SellerCustomerItem.fromJson)
          .toList(growable: false);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<List<SellerOrderItem>> listOrders({
    String status = 'ALL',
    String query = '',
  }) async {
    try {
      final response = await _dio.get<dynamic>(
        '/seller/orders',
        queryParameters: {
          'status': status,
          if (query.trim().isNotEmpty) 'q': query.trim(),
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
      final rawList = (data['orders'] as List<dynamic>?) ?? const <dynamic>[];
      return rawList
          .whereType<Map<String, dynamic>>()
          .map(SellerOrderItem.fromJson)
          .toList(growable: false);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<SellerOrderItem> getOrderDetail(String orderId) async {
    try {
      final response = await _dio.get<dynamic>('/seller/orders/$orderId');
      final body = response.data;
      if (body is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      final data = body['data'];
      if (data is! Map<String, dynamic> ||
          data['order'] is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      return SellerOrderItem.fromJson(data['order'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<SellerOrderItem> createOrder({
    required String name,
    required String whatsapp,
    required String email,
    required int quantity,
  }) async {
    try {
      final response = await _dio.post<dynamic>(
        '/seller/orders',
        data: {
          'name': name.trim(),
          'whatsapp': whatsapp.trim(),
          'email': email.trim(),
          'quantity': quantity,
        },
      );
      final body = response.data;
      if (body is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      final data = body['data'];
      if (data is! Map<String, dynamic> ||
          data['order'] is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      return SellerOrderItem.fromJson(data['order'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<SellerOrderItem> submitManualUpi({
    required String orderId,
    required String utr,
    String payerName = '',
  }) async {
    try {
      final response = await _dio.post<dynamic>(
        '/seller/orders/$orderId/payment',
        data: {
          'utr': utr.trim(),
          'payerName': payerName.trim(),
        },
      );
      final body = response.data;
      if (body is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      final data = body['data'];
      if (data is! Map<String, dynamic> ||
          data['order'] is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      return SellerOrderItem.fromJson(data['order'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }

  Future<SellerScreenshotUploadResult> uploadOrderScreenshot({
    required String orderId,
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
  }) async {
    try {
      final formData = FormData.fromMap({
        'screenshot': MultipartFile.fromBytes(
          bytes,
          filename: fileName,
          contentType: DioMediaType.parse(mimeType),
        ),
      });
      final response = await _dio.post<dynamic>(
        '/seller/orders/$orderId/screenshot',
        data: formData,
        options: Options(contentType: 'multipart/form-data'),
      );
      final body = response.data;
      if (body is! Map<String, dynamic>) {
        throw const InvalidResponseFailure();
      }
      return SellerScreenshotUploadResult.fromEnvelope(body);
    } on DioException catch (e) {
      throw mapDioException(e);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const InvalidResponseFailure();
    }
  }
}
