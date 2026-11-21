import '../../../core/errors/app_failure.dart';
import '../../seller/domain/seller_models.dart';

class AdminCollectionSummary {
  const AdminCollectionSummary({
    required this.verifiedCollectionPaise,
    required this.verifiedPaymentsCount,
    required this.pendingPaymentsCount,
    required this.rejectedPaymentsCount,
    required this.totalOrdersCount,
    required this.activeSellersCount,
    required this.campaignName,
    required this.campaignStatus,
    required this.ticketPricePaise,
    required this.totalTicketLimit,
    required this.soldTicketCount,
    required this.remainingTicketCount,
  });

  final int verifiedCollectionPaise;
  final int verifiedPaymentsCount;
  final int pendingPaymentsCount;
  final int rejectedPaymentsCount;
  final int totalOrdersCount;
  final int activeSellersCount;
  final String campaignName;
  final String campaignStatus;
  final int ticketPricePaise;
  final int totalTicketLimit;
  final int soldTicketCount;
  final int remainingTicketCount;

  double get verifiedCollectionInr => verifiedCollectionPaise / 100.0;

  factory AdminCollectionSummary.fromEnvelope(Map<String, dynamic> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, dynamic> ||
        data['summary'] is! Map<String, dynamic>) {
      throw const InvalidResponseFailure(
        'Invalid admin summary response envelope.',
      );
    }
    final json = data['summary'] as Map<String, dynamic>;
    final camp =
        (json['campaign'] as Map<String, dynamic>?) ?? const <String, dynamic>{};

    return AdminCollectionSummary(
      verifiedCollectionPaise:
          (json['verifiedCollectionPaise'] as num?)?.toInt() ?? 0,
      verifiedPaymentsCount:
          (json['verifiedPaymentsCount'] as num?)?.toInt() ?? 0,
      pendingPaymentsCount:
          (json['pendingPaymentsCount'] as num?)?.toInt() ?? 0,
      rejectedPaymentsCount:
          (json['rejectedPaymentsCount'] as num?)?.toInt() ?? 0,
      totalOrdersCount: (json['totalOrdersCount'] as num?)?.toInt() ?? 0,
      activeSellersCount: (json['activeSellersCount'] as num?)?.toInt() ?? 0,
      campaignName:
          (camp['name'] as String?) ?? 'SSFI Fundraising Lucky Draw',
      campaignStatus: (camp['status'] as String?) ?? 'DRAFT',
      ticketPricePaise: (camp['ticketPricePaise'] as num?)?.toInt() ?? 10000,
      totalTicketLimit: (camp['totalTicketLimit'] as num?)?.toInt() ?? 1000,
      soldTicketCount: (camp['soldTicketCount'] as num?)?.toInt() ?? 0,
      remainingTicketCount:
          (camp['remainingTicketCount'] as num?)?.toInt() ?? 1000,
    );
  }
}

class AdminPaymentScreenshotMeta {
  const AdminPaymentScreenshotMeta({
    required this.uploadedAt,
    required this.fileSizeBytes,
    this.contentType,
  });

  final String uploadedAt;
  final int fileSizeBytes;
  final String? contentType;

  factory AdminPaymentScreenshotMeta.fromJson(Map<String, dynamic> json) {
    return AdminPaymentScreenshotMeta(
      uploadedAt: (json['uploadedAt'] as String?) ?? '',
      fileSizeBytes: (json['fileSizeBytes'] as num?)?.toInt() ?? 0,
      contentType: json['contentType'] as String?,
    );
  }
}

class AdminPaymentQueueItem {
  const AdminPaymentQueueItem({
    required this.id,
    required this.status,
    required this.amountPaise,
    this.utrReference,
    this.payerName,
    this.submittedAt,
    this.rejectionReason,
    this.sellerReviewStatus,
    this.sellerReviewNote,
    required this.hasScreenshot,
    this.screenshotMeta,
    required this.orderId,
    required this.orderNumber,
    required this.quantity,
    required this.totalAmountPaise,
    required this.orderStatus,
    this.snapshotUpiId,
    this.snapshotAccountName,
    required this.customerName,
    this.customerPhone,
    this.customerWhatsapp,
    this.customerEmail,
    this.sellerCode,
    this.sellerDisplayName,
    required this.tickets,
  });

  final String id;
  final String status;
  final int amountPaise;
  final String? utrReference;
  final String? payerName;
  final String? submittedAt;
  final String? rejectionReason;
  final String? sellerReviewStatus;
  final String? sellerReviewNote;
  final bool hasScreenshot;
  final AdminPaymentScreenshotMeta? screenshotMeta;
  final String orderId;
  final String orderNumber;
  final int quantity;
  final int totalAmountPaise;
  final String orderStatus;
  final String? snapshotUpiId;
  final String? snapshotAccountName;
  final String customerName;
  final String? customerPhone;
  final String? customerWhatsapp;
  final String? customerEmail;
  final String? sellerCode;
  final String? sellerDisplayName;
  final List<SellerOrderTicket> tickets;

  double get amountInr => amountPaise / 100.0;
  bool get isAwaitingVerification => status == 'SUBMITTED';

  factory AdminPaymentQueueItem.fromJson(Map<String, dynamic> json) {
    final order =
        (json['order'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    final cust = (order['customer'] as Map<String, dynamic>?) ??
        const <String, dynamic>{};
    final sell =
        (order['seller'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    final screenJson = json['screenshotMeta'] as Map<String, dynamic>?;
    final rawTickets =
        (order['tickets'] as List<dynamic>?) ?? const <dynamic>[];

    return AdminPaymentQueueItem(
      id: (json['id'] as String?) ?? '',
      status: (json['status'] as String?) ?? 'SUBMITTED',
      amountPaise: (json['amountPaise'] as num?)?.toInt() ?? 0,
      utrReference: json['utrReference'] as String?,
      payerName: json['payerName'] as String?,
      submittedAt: json['submittedAt'] as String?,
      rejectionReason: json['rejectionReason'] as String?,
      sellerReviewStatus: json['sellerReviewStatus'] as String?,
      sellerReviewNote: json['sellerReviewNote'] as String?,
      hasScreenshot: json['hasScreenshot'] == true,
      screenshotMeta: screenJson != null
          ? AdminPaymentScreenshotMeta.fromJson(screenJson)
          : null,
      orderId: (order['id'] as String?) ?? '',
      orderNumber: (order['orderNumber'] as String?) ?? '',
      quantity: (order['quantity'] as num?)?.toInt() ?? 0,
      totalAmountPaise: (order['totalAmountPaise'] as num?)?.toInt() ?? 0,
      orderStatus: (order['status'] as String?) ?? '',
      snapshotUpiId: order['snapshotUpiId'] as String?,
      snapshotAccountName: order['snapshotAccountName'] as String?,
      customerName: (cust['fullName'] as String?) ?? 'Customer',
      customerPhone: cust['phone'] as String?,
      customerWhatsapp: cust['whatsappNumber'] as String?,
      customerEmail: cust['email'] as String?,
      sellerCode: sell['sellerCode'] as String?,
      sellerDisplayName: sell['displayName'] as String?,
      tickets: rawTickets
          .whereType<Map<String, dynamic>>()
          .map(SellerOrderTicket.fromJson)
          .toList(growable: false),
    );
  }
}

class AdminPaymentDecisionResult {
  const AdminPaymentDecisionResult({
    required this.decision,
    required this.issuedTickets,
    this.payment,
  });

  final String decision;
  final List<SellerOrderTicket> issuedTickets;
  final AdminPaymentQueueItem? payment;

  factory AdminPaymentDecisionResult.fromEnvelope(
    Map<String, dynamic> envelope,
  ) {
    final data = envelope['data'];
    if (data is! Map<String, dynamic>) {
      throw const InvalidResponseFailure(
        'Invalid payment decision response envelope.',
      );
    }
    final rawTickets =
        (data['issuedTickets'] as List<dynamic>?) ?? const <dynamic>[];
    final payJson = data['payment'] as Map<String, dynamic>?;
    return AdminPaymentDecisionResult(
      decision: (data['decision'] as String?) ?? '',
      issuedTickets: rawTickets
          .whereType<Map<String, dynamic>>()
          .map(SellerOrderTicket.fromJson)
          .toList(growable: false),
      payment:
          payJson != null ? AdminPaymentQueueItem.fromJson(payJson) : null,
    );
  }
}

class AdminLookupSellerItem {
  const AdminLookupSellerItem({
    required this.id,
    required this.sellerCode,
    required this.displayName,
    required this.isActive,
    required this.isQrActive,
  });

  final String id;
  final String sellerCode;
  final String displayName;
  final bool isActive;
  final bool isQrActive;

  factory AdminLookupSellerItem.fromJson(Map<String, dynamic> json) {
    return AdminLookupSellerItem(
      id: (json['id'] as String?) ?? '',
      sellerCode: (json['sellerCode'] as String?) ?? '',
      displayName: (json['displayName'] as String?) ?? '',
      isActive: json['isActive'] == true,
      isQrActive: json['isQrActive'] == true,
    );
  }
}

class AdminLookupCustomerItem {
  const AdminLookupCustomerItem({
    required this.id,
    required this.fullName,
    required this.phone,
    required this.whatsappNumber,
    this.email,
  });

  final String id;
  final String fullName;
  final String phone;
  final String whatsappNumber;
  final String? email;

  factory AdminLookupCustomerItem.fromJson(Map<String, dynamic> json) {
    return AdminLookupCustomerItem(
      id: (json['id'] as String?) ?? '',
      fullName: (json['fullName'] as String?) ?? '',
      phone: (json['phone'] as String?) ?? '',
      whatsappNumber: (json['whatsappNumber'] as String?) ?? '',
      email: json['email'] as String?,
    );
  }
}

class AdminLookupOrderItem {
  const AdminLookupOrderItem({
    required this.id,
    required this.orderNumber,
    required this.quantity,
    required this.totalAmountPaise,
    required this.status,
    this.customerName,
    this.sellerCode,
  });

  final String id;
  final String orderNumber;
  final int quantity;
  final int totalAmountPaise;
  final String status;
  final String? customerName;
  final String? sellerCode;

  double get totalAmountInr => totalAmountPaise / 100.0;

  factory AdminLookupOrderItem.fromJson(Map<String, dynamic> json) {
    return AdminLookupOrderItem(
      id: (json['id'] as String?) ?? '',
      orderNumber: (json['orderNumber'] as String?) ?? '',
      quantity: (json['quantity'] as num?)?.toInt() ?? 0,
      totalAmountPaise: (json['totalAmountPaise'] as num?)?.toInt() ?? 0,
      status: (json['status'] as String?) ?? '',
      customerName: json['customerName'] as String?,
      sellerCode: json['sellerCode'] as String?,
    );
  }
}

class AdminLookupResults {
  const AdminLookupResults({
    this.sellers = const [],
    this.customers = const [],
    this.orders = const [],
  });

  final List<AdminLookupSellerItem> sellers;
  final List<AdminLookupCustomerItem> customers;
  final List<AdminLookupOrderItem> orders;

  bool get isEmpty => sellers.isEmpty && customers.isEmpty && orders.isEmpty;

  factory AdminLookupResults.fromEnvelope(Map<String, dynamic> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, dynamic>) {
      throw const InvalidResponseFailure(
        'Invalid admin lookup response envelope.',
      );
    }
    final rawSellers = (data['sellers'] as List<dynamic>?) ?? const <dynamic>[];
    final rawCustomers =
        (data['customers'] as List<dynamic>?) ?? const <dynamic>[];
    final rawOrders = (data['orders'] as List<dynamic>?) ?? const <dynamic>[];

    return AdminLookupResults(
      sellers: rawSellers
          .whereType<Map<String, dynamic>>()
          .map(AdminLookupSellerItem.fromJson)
          .toList(growable: false),
      customers: rawCustomers
          .whereType<Map<String, dynamic>>()
          .map(AdminLookupCustomerItem.fromJson)
          .toList(growable: false),
      orders: rawOrders
          .whereType<Map<String, dynamic>>()
          .map(AdminLookupOrderItem.fromJson)
          .toList(growable: false),
    );
  }
}
