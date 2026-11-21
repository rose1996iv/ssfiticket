import 'dart:typed_data';

import 'seller_models.dart';

abstract interface class SellerOperationsRepository {
  Future<SellerDashboardData> fetchDashboard();

  Future<List<SellerCustomerItem>> lookupCustomers(String query);

  Future<List<SellerOrderItem>> listOrders({
    String status = 'ALL',
    String query = '',
  });

  Future<SellerOrderItem> getOrderDetail(String orderId);

  Future<SellerOrderItem> createOrder({
    required String name,
    required String whatsapp,
    required String email,
    required int quantity,
  });

  Future<SellerScreenshotUploadResult> uploadOrderScreenshot({
    required String orderId,
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
  });

  Future<SellerOrderItem> submitManualUpi({
    required String orderId,
    required String utr,
    String payerName = '',
  });
}
