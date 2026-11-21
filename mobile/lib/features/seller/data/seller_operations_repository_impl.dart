import 'dart:typed_data';

import '../domain/seller_models.dart';
import '../domain/seller_operations_repository.dart';
import 'seller_operations_remote_datasource.dart';

class SellerOperationsRepositoryImpl implements SellerOperationsRepository {
  const SellerOperationsRepositoryImpl(this._remote);

  final SellerOperationsRemoteDataSource _remote;

  @override
  Future<SellerDashboardData> fetchDashboard() => _remote.getDashboard();

  @override
  Future<List<SellerCustomerItem>> lookupCustomers(String query) =>
      _remote.lookupCustomers(query);

  @override
  Future<List<SellerOrderItem>> listOrders({
    String status = 'ALL',
    String query = '',
  }) =>
      _remote.listOrders(status: status, query: query);

  @override
  Future<SellerOrderItem> getOrderDetail(String orderId) =>
      _remote.getOrderDetail(orderId);

  @override
  Future<SellerOrderItem> createOrder({
    required String name,
    required String whatsapp,
    required String email,
    required int quantity,
  }) =>
      _remote.createOrder(
        name: name,
        whatsapp: whatsapp,
        email: email,
        quantity: quantity,
      );

  @override
  Future<SellerScreenshotUploadResult> uploadOrderScreenshot({
    required String orderId,
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
  }) =>
      _remote.uploadOrderScreenshot(
        orderId: orderId,
        bytes: bytes,
        fileName: fileName,
        mimeType: mimeType,
      );

  @override
  Future<SellerOrderItem> submitManualUpi({
    required String orderId,
    required String utr,
    String payerName = '',
  }) =>
      _remote.submitManualUpi(
        orderId: orderId,
        utr: utr,
        payerName: payerName,
      );
}
