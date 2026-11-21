import '../../../core/errors/app_failure.dart';
import '../../seller/domain/seller_models.dart';

class CustomerProfileSummary {
  const CustomerProfileSummary({
    required this.fullName,
    required this.phone,
    required this.whatsappNumber,
    this.email,
  });

  final String fullName;
  final String phone;
  final String whatsappNumber;
  final String? email;

  factory CustomerProfileSummary.fromJson(Map<String, dynamic> json) {
    return CustomerProfileSummary(
      fullName: (json['fullName'] as String?) ?? 'Supporter',
      phone: (json['phone'] as String?) ?? '',
      whatsappNumber: (json['whatsappNumber'] as String?) ?? '',
      email: json['email'] as String?,
    );
  }
}

class CustomerOrderSummaryItem {
  const CustomerOrderSummaryItem({
    required this.id,
    required this.orderNumber,
    required this.quantity,
    required this.totalAmountPaise,
    required this.status,
    required this.createdAt,
    this.sellerCode,
    this.sellerDisplayName,
    required this.paymentStatus,
    this.utrReference,
    this.rejectionReason,
    required this.tickets,
  });

  final String id;
  final String orderNumber;
  final int quantity;
  final int totalAmountPaise;
  final String status;
  final String createdAt;
  final String? sellerCode;
  final String? sellerDisplayName;
  final String paymentStatus;
  final String? utrReference;
  final String? rejectionReason;
  final List<SellerOrderTicket> tickets;

  double get totalAmountInr => totalAmountPaise / 100.0;

  factory CustomerOrderSummaryItem.fromJson(Map<String, dynamic> json) {
    final rawTickets =
        (json['tickets'] as List<dynamic>?) ?? const <dynamic>[];
    return CustomerOrderSummaryItem(
      id: (json['id'] as String?) ?? '',
      orderNumber: (json['orderNumber'] as String?) ?? '',
      quantity: (json['quantity'] as num?)?.toInt() ?? 0,
      totalAmountPaise: (json['totalAmountPaise'] as num?)?.toInt() ?? 0,
      status: (json['status'] as String?) ?? 'PENDING_PAYMENT',
      createdAt: (json['createdAt'] as String?) ?? '',
      sellerCode: json['sellerCode'] as String?,
      sellerDisplayName: json['sellerDisplayName'] as String?,
      paymentStatus: (json['paymentStatus'] as String?) ?? 'PENDING',
      utrReference: json['utrReference'] as String?,
      rejectionReason: json['rejectionReason'] as String?,
      tickets: rawTickets
          .whereType<Map<String, dynamic>>()
          .map(SellerOrderTicket.fromJson)
          .toList(growable: false),
    );
  }
}

class CustomerIssuedTicketItem {
  const CustomerIssuedTicketItem({
    required this.ticketNumber,
    required this.status,
    required this.orderNumber,
    this.issuedAt,
  });

  final String ticketNumber;
  final String status;
  final String orderNumber;
  final String? issuedAt;

  factory CustomerIssuedTicketItem.fromJson(Map<String, dynamic> json) {
    return CustomerIssuedTicketItem(
      ticketNumber: (json['ticketNumber'] as String?) ?? '',
      status: (json['status'] as String?) ?? 'ISSUED',
      orderNumber: (json['orderNumber'] as String?) ?? '',
      issuedAt: json['issuedAt'] as String?,
    );
  }
}

class CertifiedPublicWinnerItem {
  const CertifiedPublicWinnerItem({
    required this.prizeNumber,
    required this.prizeTitle,
    required this.ticketNumber,
  });

  final int prizeNumber;
  final String prizeTitle;
  final String ticketNumber;

  factory CertifiedPublicWinnerItem.fromJson(Map<String, dynamic> json) {
    return CertifiedPublicWinnerItem(
      prizeNumber: (json['prizeNumber'] as num?)?.toInt() ?? 0,
      prizeTitle: (json['prizeTitle'] as String?) ?? 'Prize',
      ticketNumber: (json['ticketNumber'] as String?) ?? '',
    );
  }
}

class TicketVerificationDetails {
  const TicketVerificationDetails({
    required this.queriedTicketNumber,
    required this.ticketNumber,
    required this.found,
    required this.isValid,
    required this.isVoid,
    required this.status,
    this.campaignName,
    this.issuedAt,
    this.voidReason,
  });

  final String queriedTicketNumber;
  final String ticketNumber;
  final bool found;
  final bool isValid;
  final bool isVoid;
  final String status;
  final String? campaignName;
  final String? issuedAt;
  final String? voidReason;

  factory TicketVerificationDetails.fromEnvelope(
    Map<String, dynamic> envelope,
  ) {
    final data = envelope['data'];
    if (data is! Map<String, dynamic> ||
        data['verification'] is! Map<String, dynamic>) {
      throw const InvalidResponseFailure(
        'Invalid ticket verification envelope.',
      );
    }
    final json = data['verification'] as Map<String, dynamic>;
    return TicketVerificationDetails(
      queriedTicketNumber: (json['queriedTicketNumber'] as String?) ?? '',
      ticketNumber: (json['ticketNumber'] as String?) ?? '',
      found: json['found'] == true,
      isValid: json['isValid'] == true,
      isVoid: json['isVoid'] == true,
      status: (json['status'] as String?) ?? 'NOT_FOUND',
      campaignName: json['campaignName'] as String?,
      issuedAt: json['issuedAt'] as String?,
      voidReason: json['voidReason'] as String?,
    );
  }
}

class CustomerDashboardData {
  const CustomerDashboardData({
    required this.customer,
    required this.campaignName,
    required this.campaignStatus,
    required this.orders,
    required this.tickets,
    required this.certifiedWinners,
  });

  final CustomerProfileSummary customer;
  final String campaignName;
  final String campaignStatus;
  final List<CustomerOrderSummaryItem> orders;
  final List<CustomerIssuedTicketItem> tickets;
  final List<CertifiedPublicWinnerItem> certifiedWinners;

  factory CustomerDashboardData.fromEnvelope(Map<String, dynamic> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, dynamic> ||
        data['customer'] is! Map<String, dynamic>) {
      throw const InvalidResponseFailure(
        'Invalid customer dashboard envelope.',
      );
    }
    final camp =
        (data['campaign'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    final rawOrders = (data['orders'] as List<dynamic>?) ?? const <dynamic>[];
    final rawTickets = (data['tickets'] as List<dynamic>?) ?? const <dynamic>[];
    final rawWinners =
        (data['certifiedWinners'] as List<dynamic>?) ?? const <dynamic>[];

    return CustomerDashboardData(
      customer: CustomerProfileSummary.fromJson(
        data['customer'] as Map<String, dynamic>,
      ),
      campaignName:
          (camp['name'] as String?) ?? 'SSFI Fundraising Lucky Draw',
      campaignStatus: (camp['status'] as String?) ?? 'DRAFT',
      orders: rawOrders
          .whereType<Map<String, dynamic>>()
          .map(CustomerOrderSummaryItem.fromJson)
          .toList(growable: false),
      tickets: rawTickets
          .whereType<Map<String, dynamic>>()
          .map(CustomerIssuedTicketItem.fromJson)
          .toList(growable: false),
      certifiedWinners: rawWinners
          .whereType<Map<String, dynamic>>()
          .map(CertifiedPublicWinnerItem.fromJson)
          .toList(growable: false),
    );
  }
}
