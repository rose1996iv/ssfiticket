import '../../../core/errors/app_failure.dart';

class SuperAdminGovernanceMetrics {
  const SuperAdminGovernanceMetrics({
    required this.campaignName,
    required this.campaignStatus,
    required this.verifiedCollectionPaise,
    required this.verifiedPaymentsCount,
    required this.pendingPaymentsCount,
    required this.soldTicketCount,
    required this.totalTicketLimit,
    required this.remainingTicketCount,
    required this.activeSellersCount,
    required this.totalSellersCount,
    required this.totalUsersCount,
  });

  final String campaignName;
  final String campaignStatus;
  final int verifiedCollectionPaise;
  final int verifiedPaymentsCount;
  final int pendingPaymentsCount;
  final int soldTicketCount;
  final int totalTicketLimit;
  final int remainingTicketCount;
  final int activeSellersCount;
  final int totalSellersCount;
  final int totalUsersCount;

  double get verifiedCollectionInr => verifiedCollectionPaise / 100.0;

  factory SuperAdminGovernanceMetrics.fromJson(Map<String, dynamic> json) {
    return SuperAdminGovernanceMetrics(
      campaignName:
          (json['campaignName'] as String?) ?? 'SSFI Fundraising Lucky Draw',
      campaignStatus: (json['campaignStatus'] as String?) ?? 'DRAFT',
      verifiedCollectionPaise:
          (json['verifiedCollectionPaise'] as num?)?.toInt() ?? 0,
      verifiedPaymentsCount:
          (json['verifiedPaymentsCount'] as num?)?.toInt() ?? 0,
      pendingPaymentsCount:
          (json['pendingPaymentsCount'] as num?)?.toInt() ?? 0,
      soldTicketCount: (json['soldTicketCount'] as num?)?.toInt() ?? 0,
      totalTicketLimit: (json['totalTicketLimit'] as num?)?.toInt() ?? 1000,
      remainingTicketCount:
          (json['remainingTicketCount'] as num?)?.toInt() ?? 1000,
      activeSellersCount: (json['activeSellersCount'] as num?)?.toInt() ?? 0,
      totalSellersCount: (json['totalSellersCount'] as num?)?.toInt() ?? 0,
      totalUsersCount: (json['totalUsersCount'] as num?)?.toInt() ?? 0,
    );
  }
}

class SuperAdminUserRosterItem {
  const SuperAdminUserRosterItem({
    required this.id,
    required this.fullName,
    this.email,
    required this.isActive,
    required this.roles,
  });

  final String id;
  final String fullName;
  final String? email;
  final bool isActive;
  final List<String> roles;

  factory SuperAdminUserRosterItem.fromJson(Map<String, dynamic> json) {
    final rawRoles = (json['roles'] as List<dynamic>?) ?? const <dynamic>[];
    return SuperAdminUserRosterItem(
      id: (json['id'] as String?) ?? '',
      fullName: (json['fullName'] as String?) ?? 'Member',
      email: json['email'] as String?,
      isActive: json['isActive'] == true,
      roles: rawRoles.whereType<String>().toList(growable: false),
    );
  }
}

class SuperAdminSellerLifecycleItem {
  const SuperAdminSellerLifecycleItem({
    required this.id,
    required this.sellerCode,
    required this.displayName,
    required this.isActive,
    required this.isQrActive,
    this.upiId,
  });

  final String id;
  final String sellerCode;
  final String displayName;
  final bool isActive;
  final bool isQrActive;
  final String? upiId;

  factory SuperAdminSellerLifecycleItem.fromJson(Map<String, dynamic> json) {
    return SuperAdminSellerLifecycleItem(
      id: (json['id'] as String?) ?? '',
      sellerCode: (json['sellerCode'] as String?) ?? '',
      displayName: (json['displayName'] as String?) ?? '',
      isActive: json['isActive'] == true,
      isQrActive: json['isQrActive'] == true,
      upiId: json['upiId'] as String?,
    );
  }
}

class FirstPrizeApprovalRecord {
  const FirstPrizeApprovalRecord({
    required this.id,
    required this.status,
    required this.initiatorId,
    this.initiatorEmail,
    this.approverId,
    this.approverEmail,
    required this.requestedAt,
    this.reviewedAt,
    this.reviewNotes,
  });

  final String id;
  final String status;
  final String initiatorId;
  final String? initiatorEmail;
  final String? approverId;
  final String? approverEmail;
  final String requestedAt;
  final String? reviewedAt;
  final String? reviewNotes;

  factory FirstPrizeApprovalRecord.fromJson(Map<String, dynamic> json) {
    return FirstPrizeApprovalRecord(
      id: (json['id'] as String?) ?? '',
      status: (json['status'] as String?) ?? 'PENDING',
      initiatorId: (json['initiatorId'] as String?) ?? '',
      initiatorEmail: json['initiatorEmail'] as String?,
      approverId: json['approverId'] as String?,
      approverEmail: json['approverEmail'] as String?,
      requestedAt: (json['requestedAt'] as String?) ?? '',
      reviewedAt: json['reviewedAt'] as String?,
      reviewNotes: json['reviewNotes'] as String?,
    );
  }
}

class FirstPrizeDualAuthStatus {
  const FirstPrizeDualAuthStatus({
    this.drawId,
    required this.drawStatus,
    this.firstPrizeId,
    required this.firstPrizeTitle,
    this.lockedSnapshotId,
    this.snapshotHash,
    required this.eligibleTicketCount,
    this.approval,
  });

  final String? drawId;
  final String drawStatus;
  final String? firstPrizeId;
  final String firstPrizeTitle;
  final String? lockedSnapshotId;
  final String? snapshotHash;
  final int eligibleTicketCount;
  final FirstPrizeApprovalRecord? approval;

  bool get canRequestApproval =>
      drawId != null &&
      firstPrizeId != null &&
      lockedSnapshotId != null &&
      (approval == null || approval!.status == 'REJECTED');

  factory FirstPrizeDualAuthStatus.fromJson(Map<String, dynamic> json) {
    final appJson = json['approval'] as Map<String, dynamic>?;
    return FirstPrizeDualAuthStatus(
      drawId: json['drawId'] as String?,
      drawStatus: (json['drawStatus'] as String?) ?? 'DRAFT',
      firstPrizeId: json['firstPrizeId'] as String?,
      firstPrizeTitle:
          (json['firstPrizeTitle'] as String?) ?? '1st Prize — ₹10,000 Cash',
      lockedSnapshotId: json['lockedSnapshotId'] as String?,
      snapshotHash: json['snapshotHash'] as String?,
      eligibleTicketCount:
          (json['eligibleTicketCount'] as num?)?.toInt() ?? 0,
      approval:
          appJson != null ? FirstPrizeApprovalRecord.fromJson(appJson) : null,
    );
  }
}

class MobileAuditEventItem {
  const MobileAuditEventItem({
    required this.id,
    required this.action,
    required this.entityType,
    required this.createdAt,
    required this.actorRole,
    required this.summary,
  });

  final String id;
  final String action;
  final String entityType;
  final String createdAt;
  final String actorRole;
  final String summary;

  factory MobileAuditEventItem.fromJson(Map<String, dynamic> json) {
    return MobileAuditEventItem(
      id: (json['id'] as String?) ?? '',
      action: (json['action'] as String?) ?? '',
      entityType: (json['entityType'] as String?) ?? '',
      createdAt: (json['createdAt'] as String?) ?? '',
      actorRole: (json['actorRole'] as String?) ?? 'STAFF',
      summary: (json['summary'] as String?) ?? '',
    );
  }
}

class SuperAdminPaymentScreenshotAccess {
  const SuperAdminPaymentScreenshotAccess({
    required this.url,
    required this.fileName,
    required this.expiresInSeconds,
  });

  final String url;
  final String fileName;
  final int expiresInSeconds;

  factory SuperAdminPaymentScreenshotAccess.fromEnvelope(
    Map<String, dynamic> envelope,
  ) {
    final data = envelope['data'];
    if (data is! Map<String, dynamic>) {
      throw const InvalidResponseFailure(
        'Invalid screenshot download envelope.',
      );
    }
    return SuperAdminPaymentScreenshotAccess(
      url: (data['url'] as String?) ?? '',
      fileName: (data['fileName'] as String?) ?? '',
      expiresInSeconds: (data['expiresInSeconds'] as num?)?.toInt() ?? 60,
    );
  }
}

class SuperAdminOverviewData {
  const SuperAdminOverviewData({
    required this.governance,
    required this.users,
    required this.sellers,
    required this.firstPrizeDualAuth,
    required this.recentAuditLogs,
  });

  final SuperAdminGovernanceMetrics governance;
  final List<SuperAdminUserRosterItem> users;
  final List<SuperAdminSellerLifecycleItem> sellers;
  final FirstPrizeDualAuthStatus firstPrizeDualAuth;
  final List<MobileAuditEventItem> recentAuditLogs;

  factory SuperAdminOverviewData.fromEnvelope(Map<String, dynamic> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, dynamic> ||
        data['governance'] is! Map<String, dynamic> ||
        data['firstPrizeDualAuth'] is! Map<String, dynamic>) {
      throw const InvalidResponseFailure(
        'Invalid Super Admin overview envelope.',
      );
    }
    final rawUsers = (data['users'] as List<dynamic>?) ?? const <dynamic>[];
    final rawSellers = (data['sellers'] as List<dynamic>?) ?? const <dynamic>[];
    final rawAudit =
        (data['recentAuditLogs'] as List<dynamic>?) ?? const <dynamic>[];

    return SuperAdminOverviewData(
      governance: SuperAdminGovernanceMetrics.fromJson(
        data['governance'] as Map<String, dynamic>,
      ),
      users: rawUsers
          .whereType<Map<String, dynamic>>()
          .map(SuperAdminUserRosterItem.fromJson)
          .toList(growable: false),
      sellers: rawSellers
          .whereType<Map<String, dynamic>>()
          .map(SuperAdminSellerLifecycleItem.fromJson)
          .toList(growable: false),
      firstPrizeDualAuth: FirstPrizeDualAuthStatus.fromJson(
        data['firstPrizeDualAuth'] as Map<String, dynamic>,
      ),
      recentAuditLogs: rawAudit
          .whereType<Map<String, dynamic>>()
          .map(MobileAuditEventItem.fromJson)
          .toList(growable: false),
    );
  }
}
