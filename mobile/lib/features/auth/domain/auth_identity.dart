import '../../../core/errors/app_failure.dart';

/// Authoritative database RBAC roles backed strictly by `public.roles` /
/// `public.profile_roles` / `public.has_role`.
/// Customer linkage (`customerProfileLinked`) is NEVER merged into this enum.
enum MobileRbacRole {
  superAdmin('SUPER_ADMIN', 'Super Admin'),
  admin('ADMIN', 'Admin'),
  fundraisingManager('FUNDRAISING_MANAGER', 'Fundraising Manager'),
  seller('SELLER', 'Seller');

  const MobileRbacRole(this.wireValue, this.displayLabel);

  final String wireValue;
  final String displayLabel;

  static MobileRbacRole? fromWire(String value) {
    for (final role in MobileRbacRole.values) {
      if (role.wireValue == value) return role;
    }
    return null;
  }
}

/// High-level workspace destinations corresponding to the four supported mobile roles.
enum AppWorkspace {
  superAdmin('/super-admin', 'Super Admin'),
  admin('/admin', 'Admin'),
  seller('/seller', 'Seller'),
  customer('/customer', 'Customer');

  const AppWorkspace(this.path, this.label);

  final String path;
  final String label;
}

/// Exact client representation of `GET /api/mobile/v1/me` response payload.
/// Authoritative source of truth is strictly the Next.js backend response.
class AuthIdentity {
  const AuthIdentity({
    required this.userId,
    required this.email,
    required this.accountStatus,
    required this.roles,
    required this.primaryRole,
    required this.customerProfileLinked,
  });

  final String userId;
  final String? email;
  final String accountStatus;

  /// Strictly authoritative DB RBAC roles from `public.profile_roles`.
  final List<MobileRbacRole> roles;

  /// Highest-priority authoritative RBAC role, or null if none.
  final MobileRbacRole? primaryRole;

  /// Separate non-RBAC classification (`public.customers.profile_id`).
  /// Never implicitly grants staff or seller privileges.
  final bool customerProfileLinked;

  bool get isAccountActive => accountStatus == 'ACTIVE';

  bool hasRole(MobileRbacRole role) => roles.contains(role);

  bool get isSuperAdmin => hasRole(MobileRbacRole.superAdmin);
  bool get isAdminStaff =>
      hasRole(MobileRbacRole.admin) ||
      hasRole(MobileRbacRole.fundraisingManager);
  bool get isSeller => hasRole(MobileRbacRole.seller);

  /// All workspaces this identity is authorized to enter.
  List<AppWorkspace> get allowedWorkspaces {
    if (!isAccountActive) return const [];
    final list = <AppWorkspace>[];
    if (isSuperAdmin) list.add(AppWorkspace.superAdmin);
    if (isAdminStaff) list.add(AppWorkspace.admin);
    if (isSeller) list.add(AppWorkspace.seller);
    if (customerProfileLinked) list.add(AppWorkspace.customer);
    return List.unmodifiable(list);
  }

  bool get hasAnyAuthorizedWorkspace => allowedWorkspaces.isNotEmpty;

  /// Deterministic default landing workspace respecting role priority:
  /// SUPER_ADMIN -> ADMIN -> SELLER -> CUSTOMER.
  AppWorkspace? get defaultWorkspace {
    final workspaces = allowedWorkspaces;
    return workspaces.isEmpty ? null : workspaces.first;
  }

  bool canAccessWorkspace(AppWorkspace workspace) =>
      allowedWorkspaces.contains(workspace);

  /// Strictly parses and validates the `GET /api/mobile/v1/me` JSON envelope.
  /// Throws [InvalidResponseFailure] on missing/malformed contract fields.
  factory AuthIdentity.fromMeEnvelope(Map<String, dynamic> json) {
    if (json['apiVersion'] != 'v1') {
      throw const InvalidResponseFailure(
        'Unsupported mobile API version received from server.',
      );
    }

    final data = json['data'];
    if (data is! Map<String, dynamic>) {
      throw const InvalidResponseFailure('Missing data payload in /me response.');
    }

    final user = data['user'];
    if (user is! Map<String, dynamic>) {
      throw const InvalidResponseFailure('Missing user object in /me response.');
    }

    final id = user['id'];
    final accountStatus = user['accountStatus'];
    final email = user['email'];
    if (id is! String || id.trim().isEmpty) {
      throw const InvalidResponseFailure('Missing user ID in /me response.');
    }
    if (accountStatus is! String || accountStatus.trim().isEmpty) {
      throw const InvalidResponseFailure(
        'Missing accountStatus in /me response.',
      );
    }
    if (email != null && email is! String) {
      throw const InvalidResponseFailure('Invalid email field in /me response.');
    }

    final rawRoles = data['roles'];
    if (rawRoles is! List) {
      throw const InvalidResponseFailure('Invalid roles list in /me response.');
    }

    final parsedRoles = <MobileRbacRole>[];
    for (final entry in rawRoles) {
      if (entry is! String) {
        throw const InvalidResponseFailure('Non-string role in /me response.');
      }
      final role = MobileRbacRole.fromWire(entry);
      if (role != null && !parsedRoles.contains(role)) {
        parsedRoles.add(role);
      }
    }

    final rawPrimary = data['primaryRole'];
    if (rawPrimary != null && rawPrimary is! String) {
      throw const InvalidResponseFailure(
        'Invalid primaryRole field in /me response.',
      );
    }
    final primaryRole =
        rawPrimary is String ? MobileRbacRole.fromWire(rawPrimary) : null;

    final rawCustomerLinked = data['customerProfileLinked'];
    if (rawCustomerLinked is! bool) {
      throw const InvalidResponseFailure(
        'Missing customerProfileLinked boolean in /me response.',
      );
    }

    return AuthIdentity(
      userId: id.trim(),
      email: (email as String?)?.trim(),
      accountStatus: accountStatus.trim(),
      roles: List.unmodifiable(parsedRoles),
      primaryRole: primaryRole,
      customerProfileLinked: rawCustomerLinked,
    );
  }
}
