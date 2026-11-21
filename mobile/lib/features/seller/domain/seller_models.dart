import 'dart:typed_data';

import '../../../core/errors/app_failure.dart';

class SelectedScreenshotFile {
  const SelectedScreenshotFile({
    required this.bytes,
    required this.fileName,
    required this.mimeType,
  });

  final Uint8List bytes;
  final String fileName;
  final String mimeType;
}

class SellerScreenshotUploadResult {
  const SellerScreenshotUploadResult({
    required this.replaced,
    required this.contentType,
    required this.fileSizeBytes,
    required this.uploadedAt,
    this.order,
  });

  final bool replaced;
  final String contentType;
  final int fileSizeBytes;
  final String uploadedAt;
  final SellerOrderItem? order;

  factory SellerScreenshotUploadResult.fromEnvelope(
    Map<String, dynamic> envelope,
  ) {
    final data = envelope['data'];
    if (data is! Map<String, dynamic>) {
      throw const InvalidResponseFailure(
        'Invalid screenshot upload response envelope.',
      );
    }
    final orderJson = data['order'] as Map<String, dynamic>?;
    return SellerScreenshotUploadResult(
      replaced: data['replaced'] == true,
      contentType: (data['contentType'] as String?) ?? 'image/jpeg',
      fileSizeBytes: (data['fileSizeBytes'] as num?)?.toInt() ?? 0,
      uploadedAt: (data['uploadedAt'] as String?) ?? '',
      order: orderJson != null ? SellerOrderItem.fromJson(orderJson) : null,
    );
  }
}

class SellerProfileSummary {
  const SellerProfileSummary({
    required this.id,
    required this.sellerCode,
    required this.displayName,
    required this.isActive,
    required this.isQrActive,
    this.upiId,
    this.accountName,
  });

  final String id;
  final String sellerCode;
  final String displayName;
  final bool isActive;
  final bool isQrActive;
  final String? upiId;
  final String? accountName;

  factory SellerProfileSummary.fromJson(Map<String, dynamic> json) {
    return SellerProfileSummary(
      id: (json['id'] as String?) ?? '',
      sellerCode: (json['sellerCode'] as String?) ?? '',
      displayName: (json['displayName'] as String?) ?? 'Seller',
      isActive: json['isActive'] == true,
      isQrActive: json['isQrActive'] == true,
      upiId: json['upiId'] as String?,
      accountName: json['accountName'] as String?,
    );
  }
}

class SellerCampaignSummary {
  const SellerCampaignSummary({
    required this.name,
    required this.status,
    required this.isSellingOpen,
    required this.scheduleDescription,
    required this.ticketPricePaise,
    required this.totalTicketLimit,
    required this.soldTicketCount,
    required this.remainingTicketCount,
    this.startAt,
    this.endAt,
  });

  final String name;
  final String status;
  final bool isSellingOpen;
  final String scheduleDescription;
  final int ticketPricePaise;
  final int totalTicketLimit;
  final int soldTicketCount;
  final int remainingTicketCount;
  final String? startAt;
  final String? endAt;

  double get ticketPriceInr => ticketPricePaise / 100.0;

  factory SellerCampaignSummary.fromJson(Map<String, dynamic> json) {
    return SellerCampaignSummary(
      name: (json['name'] as String?) ?? 'SSFI Fundraising Lucky Draw',
      status: (json['status'] as String?) ?? 'DRAFT',
      isSellingOpen: json['isSellingOpen'] == true,
      scheduleDescription: (json['scheduleDescription'] as String?) ?? '',
      ticketPricePaise: (json['ticketPricePaise'] as num?)?.toInt() ?? 10000,
      totalTicketLimit: (json['totalTicketLimit'] as num?)?.toInt() ?? 1000,
      soldTicketCount: (json['soldTicketCount'] as num?)?.toInt() ?? 0,
      remainingTicketCount:
          (json['remainingTicketCount'] as num?)?.toInt() ?? 1000,
      startAt: json['startAt'] as String?,
      endAt: json['endAt'] as String?,
    );
  }
}

class SellerMetricsSummary {
  const SellerMetricsSummary({
    required this.ticketsIssuedCount,
    required this.verifiedCollectionPaise,
    required this.pendingPaymentsCount,
    required this.awaitingPaymentOrdersCount,
    required this.issuedOrdersCount,
    required this.totalOrdersCount,
    required this.unreadMessagesCount,
  });

  final int ticketsIssuedCount;
  final int verifiedCollectionPaise;
  final int pendingPaymentsCount;
  final int awaitingPaymentOrdersCount;
  final int issuedOrdersCount;
  final int totalOrdersCount;
  final int unreadMessagesCount;

  double get verifiedCollectionInr => verifiedCollectionPaise / 100.0;

  factory SellerMetricsSummary.fromJson(Map<String, dynamic> json) {
    return SellerMetricsSummary(
      ticketsIssuedCount: (json['ticketsIssuedCount'] as num?)?.toInt() ?? 0,
      verifiedCollectionPaise:
          (json['verifiedCollectionPaise'] as num?)?.toInt() ?? 0,
      pendingPaymentsCount:
          (json['pendingPaymentsCount'] as num?)?.toInt() ?? 0,
      awaitingPaymentOrdersCount:
          (json['awaitingPaymentOrdersCount'] as num?)?.toInt() ?? 0,
      issuedOrdersCount: (json['issuedOrdersCount'] as num?)?.toInt() ?? 0,
      totalOrdersCount: (json['totalOrdersCount'] as num?)?.toInt() ?? 0,
      unreadMessagesCount: (json['unreadMessagesCount'] as num?)?.toInt() ?? 0,
    );
  }
}

class SellerOrderTicket {
  const SellerOrderTicket({
    required this.ticketNumber,
    required this.status,
  });

  final String ticketNumber;
  final String status;

  factory SellerOrderTicket.fromJson(Map<String, dynamic> json) {
    return SellerOrderTicket(
      ticketNumber: (json['ticketNumber'] as String?) ?? '',
      status: (json['status'] as String?) ?? 'ISSUED',
    );
  }
}

class SellerOrderPaymentInfo {
  const SellerOrderPaymentInfo({
    this.id,
    required this.status,
    this.utrReference,
    this.payerName,
    this.rejectionReason,
    this.submittedAt,
    required this.hasScreenshot,
  });

  final String? id;
  final String status;
  final String? utrReference;
  final String? payerName;
  final String? rejectionReason;
  final String? submittedAt;
  final bool hasScreenshot;

  factory SellerOrderPaymentInfo.fromJson(Map<String, dynamic> json) {
    return SellerOrderPaymentInfo(
      id: json['id'] as String?,
      status: (json['status'] as String?) ?? 'PENDING',
      utrReference: json['utrReference'] as String?,
      payerName: json['payerName'] as String?,
      rejectionReason: json['rejectionReason'] as String?,
      submittedAt: json['submittedAt'] as String?,
      hasScreenshot: json['hasScreenshot'] == true,
    );
  }
}

class SellerUpiInstructions {
  const SellerUpiInstructions({
    required this.payeeName,
    this.upiId,
    required this.amountPaise,
    required this.currency,
    this.upiUri,
    this.paymentInstructions,
    required this.isQrActive,
  });

  final String payeeName;
  final String? upiId;
  final int amountPaise;
  final String currency;
  final String? upiUri;
  final String? paymentInstructions;
  final bool isQrActive;

  double get amountInr => amountPaise / 100.0;

  factory SellerUpiInstructions.fromJson(Map<String, dynamic> json) {
    return SellerUpiInstructions(
      payeeName: (json['payeeName'] as String?) ?? 'SSFI Seller',
      upiId: json['upiId'] as String?,
      amountPaise: (json['amountPaise'] as num?)?.toInt() ?? 0,
      currency: (json['currency'] as String?) ?? 'INR',
      upiUri: json['upiUri'] as String?,
      paymentInstructions: json['paymentInstructions'] as String?,
      isQrActive: json['isQrActive'] == true,
    );
  }
}

class SellerOrderItem {
  const SellerOrderItem({
    required this.id,
    required this.orderNumber,
    required this.quantity,
    required this.totalAmountPaise,
    required this.status,
    required this.createdAt,
    required this.customerFullName,
    this.customerPhone,
    this.customerWhatsapp,
    this.customerEmail,
    required this.payment,
    required this.tickets,
    required this.upiInstructions,
  });

  final String id;
  final String orderNumber;
  final int quantity;
  final int totalAmountPaise;
  final String status;
  final String createdAt;
  final String customerFullName;
  final String? customerPhone;
  final String? customerWhatsapp;
  final String? customerEmail;
  final SellerOrderPaymentInfo payment;
  final List<SellerOrderTicket> tickets;
  final SellerUpiInstructions upiInstructions;

  double get totalAmountInr => totalAmountPaise / 100.0;

  bool get isAwaitingPayment => status == 'PENDING_PAYMENT';
  bool get isPaymentSubmitted => status == 'PAYMENT_SUBMITTED';
  bool get isTicketsIssued => status == 'TICKETS_ISSUED';

  factory SellerOrderItem.fromJson(Map<String, dynamic> json) {
    final cust =
        (json['customer'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    final pay =
        (json['payment'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    final upi = (json['upiInstructions'] as Map<String, dynamic>?) ??
        const <String, dynamic>{};
    final rawTickets = (json['tickets'] as List<dynamic>?) ?? const <dynamic>[];

    return SellerOrderItem(
      id: (json['id'] as String?) ?? '',
      orderNumber: (json['orderNumber'] as String?) ?? '',
      quantity: (json['quantity'] as num?)?.toInt() ?? 0,
      totalAmountPaise: (json['totalAmountPaise'] as num?)?.toInt() ?? 0,
      status: (json['status'] as String?) ?? 'PENDING_PAYMENT',
      createdAt: (json['createdAt'] as String?) ?? '',
      customerFullName: (cust['fullName'] as String?) ?? 'Customer',
      customerPhone: cust['phone'] as String?,
      customerWhatsapp: cust['whatsappNumber'] as String?,
      customerEmail: cust['email'] as String?,
      payment: SellerOrderPaymentInfo.fromJson(pay),
      tickets: rawTickets
          .whereType<Map<String, dynamic>>()
          .map(SellerOrderTicket.fromJson)
          .toList(growable: false),
      upiInstructions: SellerUpiInstructions.fromJson(upi),
    );
  }
}

class SellerCustomerItem {
  const SellerCustomerItem({
    required this.id,
    required this.fullName,
    required this.phone,
    required this.whatsappNumber,
    this.email,
    required this.totalOrdersWithSeller,
  });

  final String id;
  final String fullName;
  final String phone;
  final String whatsappNumber;
  final String? email;
  final int totalOrdersWithSeller;

  factory SellerCustomerItem.fromJson(Map<String, dynamic> json) {
    return SellerCustomerItem(
      id: (json['id'] as String?) ?? '',
      fullName: (json['fullName'] as String?) ?? '',
      phone: (json['phone'] as String?) ?? '',
      whatsappNumber: (json['whatsappNumber'] as String?) ?? '',
      email: json['email'] as String?,
      totalOrdersWithSeller:
          (json['totalOrdersWithSeller'] as num?)?.toInt() ?? 1,
    );
  }
}

class SellerDashboardData {
  const SellerDashboardData({
    required this.seller,
    required this.campaign,
    required this.metrics,
    required this.recentOrders,
  });

  final SellerProfileSummary seller;
  final SellerCampaignSummary campaign;
  final SellerMetricsSummary metrics;
  final List<SellerOrderItem> recentOrders;

  factory SellerDashboardData.fromEnvelope(Map<String, dynamic> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, dynamic>) {
      throw const InvalidResponseFailure(
        'Invalid seller dashboard response envelope.',
      );
    }
    final sellerJson = data['seller'];
    final campaignJson = data['campaign'];
    final metricsJson = data['metrics'];
    if (sellerJson is! Map<String, dynamic> ||
        campaignJson is! Map<String, dynamic> ||
        metricsJson is! Map<String, dynamic>) {
      throw const InvalidResponseFailure(
        'Malformed seller dashboard payload.',
      );
    }
    final rawRecent =
        (data['recentOrders'] as List<dynamic>?) ?? const <dynamic>[];
    return SellerDashboardData(
      seller: SellerProfileSummary.fromJson(sellerJson),
      campaign: SellerCampaignSummary.fromJson(campaignJson),
      metrics: SellerMetricsSummary.fromJson(metricsJson),
      recentOrders: rawRecent
          .whereType<Map<String, dynamic>>()
          .map(SellerOrderItem.fromJson)
          .toList(growable: false),
    );
  }
}
