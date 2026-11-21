// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/route_paths.dart';
import '../../auth/domain/auth_identity.dart';
import '../../auth/domain/auth_state.dart';
import '../../auth/presentation/auth_controller.dart';
import 'super_admin_controller.dart';

class SuperAdminDashboardScreen extends ConsumerStatefulWidget {
  const SuperAdminDashboardScreen({super.key});

  @override
  ConsumerState<SuperAdminDashboardScreen> createState() =>
      _SuperAdminDashboardScreenState();
}

class _SuperAdminDashboardScreenState
    extends ConsumerState<SuperAdminDashboardScreen> {
  final _dualAuthNotesCtrl = TextEditingController();
  final _screenshotPaymentIdCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final config = ref.read(appConfigProvider);
      if (config.isSupabaseConfigured) {
        ref.read(superAdminControllerProvider.notifier).loadOverview();
      }
    });
  }

  @override
  void dispose() {
    _dualAuthNotesCtrl.dispose();
    _screenshotPaymentIdCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authControllerProvider);
    final identity =
        authState is AuthAuthenticated ? authState.identity : null;
    final allowedWorkspaces = identity?.allowedWorkspaces ?? const [];
    final saState = ref.watch(superAdminControllerProvider);
    final saCtrl = ref.read(superAdminControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('SSFI • Super Admin'),
        actions: [
          IconButton(
            tooltip: 'Refresh session and roles',
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.read(authControllerProvider.notifier).refreshRoles();
              saCtrl.loadOverview();
            },
          ),
          IconButton(
            tooltip: 'Profile',
            icon: const Icon(Icons.person_outline),
            onPressed: () => context.push(RoutePaths.profile),
          ),
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () =>
                ref.read(authControllerProvider.notifier).signOut(),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 880),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildHeaderCard(context, identity, allowedWorkspaces, saState),
                  const SizedBox(height: 16),
                  _buildTabSelector(saState, saCtrl),
                  const SizedBox(height: 16),
                  if (saState.actionNotice != null) ...[
                    Card(
                      color: Colors.green.shade50,
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Text(
                          saState.actionNotice!,
                          style: TextStyle(
                            color: Colors.green.shade900,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (saState.actionError != null) ...[
                    Card(
                      color: Colors.red.shade50,
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Text(
                          saState.actionError!.message,
                          style: TextStyle(
                            color: Colors.red.shade900,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  switch (saState.activeTab) {
                    SuperAdminWorkspaceTab.governance =>
                      _buildGovernanceTab(context, saState, saCtrl),
                    SuperAdminWorkspaceTab.usersAndSellers =>
                      _buildUsersAndSellersTab(context, saState, saCtrl),
                    SuperAdminWorkspaceTab.firstPrizeDualAuth =>
                      _buildFirstPrizeDualAuthTab(
                        context,
                        identity,
                        saState,
                        saCtrl,
                      ),
                    SuperAdminWorkspaceTab.auditAndScreenshots =>
                      _buildAuditAndScreenshotsTab(context, saState, saCtrl),
                  },
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeaderCard(
    BuildContext context,
    AuthIdentity? identity,
    List<AppWorkspace> allowedWorkspaces,
    SuperAdminState saState,
  ) {
    final gov = saState.overview?.governance;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Super Admin Workspace',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            const Text(
              'Authoritative SUPER_ADMIN control foundation. Governance, dual-authorization, and seller lifecycle modules will connect in subsequent phases.',
            ),
            if (gov != null) ...[
              const SizedBox(height: 8),
              Text(
                'Campaign: ${gov.campaignStatus} • Verified Collection: ₹${gov.verifiedCollectionInr.toStringAsFixed(0)} • '
                'Tickets Sold: ${gov.soldTicketCount}/${gov.totalTicketLimit} • '
                'Active Sellers: ${gov.activeSellersCount}/${gov.totalSellersCount}',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ],
            if (identity?.email != null) ...[
              const SizedBox(height: 12),
              Text(
                'Signed in as: ${identity!.email}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            if (allowedWorkspaces.length > 1) ...[
              const SizedBox(height: 14),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: allowedWorkspaces.map((ws) {
                  final selected = ws == AppWorkspace.superAdmin;
                  return ChoiceChip(
                    label: Text(ws.label),
                    selected: selected,
                    onSelected: selected
                        ? null
                        : (_) {
                            final ok = ref
                                .read(authControllerProvider.notifier)
                                .switchWorkspace(ws);
                            if (ok && context.mounted) {
                              context.go(ws.path);
                            }
                          },
                  );
                }).toList(),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildTabSelector(
    SuperAdminState saState,
    SuperAdminController saCtrl,
  ) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        ChoiceChip(
          label: const Text('System Governance'),
          selected: saState.activeTab == SuperAdminWorkspaceTab.governance,
          onSelected: (_) => saCtrl.setTab(SuperAdminWorkspaceTab.governance),
        ),
        ChoiceChip(
          label: const Text('Users & Seller Lifecycle'),
          selected:
              saState.activeTab == SuperAdminWorkspaceTab.usersAndSellers,
          onSelected: (_) =>
              saCtrl.setTab(SuperAdminWorkspaceTab.usersAndSellers),
        ),
        ChoiceChip(
          label: const Text('1st Prize Dual Auth'),
          selected:
              saState.activeTab == SuperAdminWorkspaceTab.firstPrizeDualAuth,
          onSelected: (_) =>
              saCtrl.setTab(SuperAdminWorkspaceTab.firstPrizeDualAuth),
        ),
        ChoiceChip(
          label: const Text('Audit & Screenshot Access'),
          selected:
              saState.activeTab == SuperAdminWorkspaceTab.auditAndScreenshots,
          onSelected: (_) =>
              saCtrl.setTab(SuperAdminWorkspaceTab.auditAndScreenshots),
        ),
      ],
    );
  }

  Widget _buildGovernanceTab(
    BuildContext context,
    SuperAdminState saState,
    SuperAdminController saCtrl,
  ) {
    final gov = saState.overview?.governance;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (saState.overviewError != null)
          Card(
            color: Colors.red.shade50,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    saState.overviewError!.message,
                    style: TextStyle(color: Colors.red.shade900),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: saCtrl.loadOverview,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Retry Governance Sync'),
                  ),
                ],
              ),
            ),
          ),
        if (gov != null) ...[
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Administrative & Financial Report Summary',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Verified Collection: ₹${gov.verifiedCollectionInr.toStringAsFixed(0)} '
                    '(${gov.verifiedPaymentsCount} verified payments) • '
                    'Pending Payments: ${gov.pendingPaymentsCount}',
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Ticket Allocation: ${gov.soldTicketCount} issued / '
                    '${gov.totalTicketLimit} cap (${gov.remainingTicketCount} remaining)',
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Accounts: ${gov.totalUsersCount} profiles • '
                    '${gov.activeSellersCount} active sellers (${gov.totalSellersCount} total)',
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
        ],
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: const CircleAvatar(
              child: Icon(Icons.verified_user_outlined),
            ),
            title: const Text(
              'RBAC & Governance',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: const Text(
              'User & role roster, active profile checks, and system reports',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => saCtrl.setTab(SuperAdminWorkspaceTab.usersAndSellers),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: const CircleAvatar(
              child: Icon(Icons.emoji_events_outlined),
            ),
            title: const Text(
              'First Prize Dual Authorization',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: const Text(
              'Policy A four-eyes initiation & second-administrator approval',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () =>
                saCtrl.setTab(SuperAdminWorkspaceTab.firstPrizeDualAuth),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: const CircleAvatar(
              child: Icon(Icons.storefront_outlined),
            ),
            title: const Text(
              'Seller Lifecycle',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: const Text(
              'Seller activation, deactivation, and personal payment QR status',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => saCtrl.setTab(SuperAdminWorkspaceTab.usersAndSellers),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: const CircleAvatar(
              child: Icon(Icons.mark_email_read_outlined),
            ),
            title: const Text(
              'Delivery & Audit Status',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: const Text(
              'Centralized security audit trail & SUPER_ADMIN screenshot access',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () =>
                saCtrl.setTab(SuperAdminWorkspaceTab.auditAndScreenshots),
          ),
        ),
      ],
    );
  }

  Widget _buildUsersAndSellersTab(
    BuildContext context,
    SuperAdminState saState,
    SuperAdminController saCtrl,
  ) {
    final sellers = saState.overview?.sellers ?? const [];
    final users = saState.overview?.users ?? const [];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Seller Lifecycle Administration (${sellers.length})',
          style: Theme.of(context)
              .textTheme
              .titleMedium
              ?.copyWith(fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        if (sellers.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text('No seller records loaded yet.'),
            ),
          )
        else
          ...sellers.map(
            (s) => Card(
              child: ListTile(
                title: Text(
                  '${s.displayName} (${s.sellerCode})',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                subtitle: Text(
                  'Status: ${s.isActive ? 'ACTIVE' : 'INACTIVE'} • '
                  'Payment QR: ${s.isQrActive ? 'ACTIVE' : 'INACTIVE'} '
                  '${s.upiId != null ? '(${s.upiId})' : ''}',
                ),
                trailing: OutlinedButton(
                  key: Key('sa_toggle_seller_${s.id}'),
                  onPressed: saState.isProcessingAction
                      ? null
                      : () => saCtrl.toggleSellerStatus(
                            sellerId: s.id,
                            activate: !s.isActive,
                          ),
                  child: Text(s.isActive ? 'Deactivate' : 'Reactivate'),
                ),
              ),
            ),
          ),
        const SizedBox(height: 16),
        Text(
          'User & Role Directory (${users.length})',
          style: Theme.of(context)
              .textTheme
              .titleMedium
              ?.copyWith(fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        if (users.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text('No user profiles loaded yet.'),
            ),
          )
        else
          ...users.map(
            (u) => Card(
              child: ListTile(
                title: Text(u.fullName),
                subtitle: Text(
                  '${u.email ?? 'No email'} • '
                  'Status: ${u.isActive ? 'ACTIVE' : 'INACTIVE'} • '
                  'Roles: ${u.roles.isEmpty ? 'None' : u.roles.join(', ')}',
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildFirstPrizeDualAuthTab(
    BuildContext context,
    AuthIdentity? identity,
    SuperAdminState saState,
    SuperAdminController saCtrl,
  ) {
    final dual = saState.overview?.firstPrizeDualAuth;
    if (dual == null) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(20),
          child: Text('Loading 1st Prize Dual Authorization status...'),
        ),
      );
    }

    final approval = dual.approval;
    final isSelfInitiator =
        approval != null && identity != null && approval.initiatorId == identity.userId;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'First Prize Dual Authorization (Policy A Four-Eyes Control)',
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              'Prize: ${dual.firstPrizeTitle} • Draw Status: ${dual.drawStatus} • '
              'Eligible Tickets: ${dual.eligibleTicketCount}',
            ),
            const SizedBox(height: 4),
            Text(
              'Locked Snapshot Hash: ${dual.snapshotHash ?? 'Not locked yet'}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const Divider(height: 24),
            if (approval == null) ...[
              const Text(
                'Current Approval State: NOT REQUESTED',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                key: const Key('sa_initiate_first_prize_button'),
                onPressed: (!dual.canRequestApproval ||
                        saState.isProcessingAction)
                    ? null
                    : () => saCtrl.initiateFirstPrizeApproval(
                          drawId: dual.drawId!,
                          prizeId: dual.firstPrizeId!,
                          snapshotId: dual.lockedSnapshotId!,
                        ),
                icon: const Icon(Icons.security_outlined),
                label: const Text(
                  'Initiate 1st Prize Dual Approval (SUPER_ADMIN Only)',
                ),
              ),
            ] else ...[
              Text(
                'Approval Status: ${approval.status}',
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),
              Text(
                'Initiated by: ${approval.initiatorEmail ?? approval.initiatorId}',
              ),
              if (approval.approverEmail != null)
                Text('Reviewed by: ${approval.approverEmail}'),
              if (approval.reviewNotes != null &&
                  approval.reviewNotes!.isNotEmpty)
                Text('Review Notes: ${approval.reviewNotes}'),
              if (approval.status == 'PENDING') ...[
                const SizedBox(height: 12),
                if (isSelfInitiator)
                  Text(
                    'Policy A Four-Eyes Guard: You initiated this request. A separate administrator must approve or reject it.',
                    style: TextStyle(
                      color: Colors.amber.shade900,
                      fontWeight: FontWeight.w600,
                    ),
                  )
                else ...[
                  TextField(
                    key: const Key('sa_dual_auth_notes_field'),
                    controller: _dualAuthNotesCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Review Notes (optional)',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton(
                          key: const Key('sa_approve_first_prize_button'),
                          onPressed: saState.isProcessingAction
                              ? null
                              : () => saCtrl.decideFirstPrizeApproval(
                                    approvalId: approval.id,
                                    decision: 'APPROVED',
                                    notes: _dualAuthNotesCtrl.text,
                                  ),
                          child: const Text('Approve 1st Prize Draw'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton(
                          key: const Key('sa_reject_first_prize_button'),
                          onPressed: saState.isProcessingAction
                              ? null
                              : () => saCtrl.decideFirstPrizeApproval(
                                    approvalId: approval.id,
                                    decision: 'REJECTED',
                                    notes: _dualAuthNotesCtrl.text,
                                  ),
                          child: const Text('Reject Request'),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildAuditAndScreenshotsTab(
    BuildContext context,
    SuperAdminState saState,
    SuperAdminController saCtrl,
  ) {
    final logs = saState.overview?.recentAuditLogs ?? const [];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'SUPER_ADMIN Payment Screenshot Signed Access',
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Generates a 60-second signed download link from the private payment-screenshots bucket and records an audit entry.',
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('sa_screenshot_payment_id_field'),
                        controller: _screenshotPaymentIdCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Payment UUID',
                          border: OutlineInputBorder(),
                          isDense: true,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton.tonal(
                      key: const Key('sa_request_screenshot_button'),
                      onPressed: saState.isProcessingAction
                          ? null
                          : () => saCtrl.requestPaymentScreenshotAccess(
                                _screenshotPaymentIdCtrl.text,
                              ),
                      child: const Text('Get Signed Link'),
                    ),
                  ],
                ),
                if (saState.screenshotAccess != null) ...[
                  const SizedBox(height: 10),
                  SelectableText(
                    'File: ${saState.screenshotAccess!.fileName} '
                    '(TTL: ${saState.screenshotAccess!.expiresInSeconds}s)\n'
                    'Signed URL: ${saState.screenshotAccess!.url}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text(
          'Security & Operational Audit Logs (${logs.length})',
          style: Theme.of(context)
              .textTheme
              .titleMedium
              ?.copyWith(fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        if (logs.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text('No audit log events loaded yet.'),
            ),
          )
        else
          ...logs.map(
            (log) => Card(
              child: ListTile(
                dense: true,
                title: Text(
                  log.action,
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                subtitle: Text('${log.summary}\n${log.createdAt}'),
                trailing: Chip(
                  label: Text(log.actorRole),
                  visualDensity: VisualDensity.compact,
                ),
              ),
            ),
          ),
      ],
    );
  }
}
