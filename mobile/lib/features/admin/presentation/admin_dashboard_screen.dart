// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/route_paths.dart';
import '../../auth/domain/auth_identity.dart';
import '../../auth/domain/auth_state.dart';
import '../../auth/presentation/auth_controller.dart';
import 'admin_operations_controller.dart';

class AdminDashboardScreen extends ConsumerStatefulWidget {
  const AdminDashboardScreen({super.key});

  @override
  ConsumerState<AdminDashboardScreen> createState() =>
      _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends ConsumerState<AdminDashboardScreen> {
  final _paymentSearchCtrl = TextEditingController();
  final _rejectionReasonCtrl = TextEditingController();
  final _directoryQueryCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final config = ref.read(appConfigProvider);
      if (config.isSupabaseConfigured) {
        final ctrl = ref.read(adminOperationsControllerProvider.notifier);
        ctrl.loadCollectionSummary();
        ctrl.loadPayments();
      }
    });
  }

  @override
  void dispose() {
    _paymentSearchCtrl.dispose();
    _rejectionReasonCtrl.dispose();
    _directoryQueryCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authControllerProvider);
    final identity =
        authState is AuthAuthenticated ? authState.identity : null;
    final allowedWorkspaces = identity?.allowedWorkspaces ?? const [];
    final opsState = ref.watch(adminOperationsControllerProvider);
    final opsCtrl = ref.read(adminOperationsControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('SSFI • Admin'),
        actions: [
          IconButton(
            tooltip: 'Refresh session and roles',
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.read(authControllerProvider.notifier).refreshRoles();
              opsCtrl.loadCollectionSummary();
              opsCtrl.loadPayments();
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
                  _buildHeaderCard(context, identity, allowedWorkspaces, opsState),
                  const SizedBox(height: 16),
                  _buildTabSelector(opsState, opsCtrl),
                  const SizedBox(height: 16),
                  if (opsState.lastDecisionNotice != null) ...[
                    Card(
                      color: Colors.green.shade50,
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Row(
                          children: [
                            Icon(Icons.verified_outlined,
                                color: Colors.green.shade800),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                opsState.lastDecisionNotice!,
                                style: TextStyle(
                                  color: Colors.green.shade900,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (opsState.selectedPayment != null) ...[
                    _buildPaymentDetailCard(context, opsState, opsCtrl),
                    const SizedBox(height: 16),
                  ],
                  switch (opsState.activeTab) {
                    AdminWorkspaceTab.overview =>
                      _buildOverviewTab(context, opsState, opsCtrl),
                    AdminWorkspaceTab.pendingPayments =>
                      _buildPendingPaymentsTab(context, opsState, opsCtrl),
                    AdminWorkspaceTab.directoryLookup =>
                      _buildDirectoryLookupTab(context, opsState, opsCtrl),
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
    AdminOperationsState opsState,
  ) {
    final summary = opsState.summary;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    'Admin Operations Workspace',
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
                if (summary != null)
                  Chip(
                    label: Text('Campaign: ${summary.campaignStatus}'),
                    visualDensity: VisualDensity.compact,
                  ),
              ],
            ),
            const SizedBox(height: 6),
            const Text(
              'Authoritative ADMIN / Staff workspace foundation. Payment review, ticket lifecycle, and draw approval modules will connect in subsequent phases.',
            ),
            if (summary != null) ...[
              const SizedBox(height: 8),
              Text(
                'Verified Collection: ₹${summary.verifiedCollectionInr.toStringAsFixed(0)} '
                '(${summary.verifiedPaymentsCount} verified) • '
                'Tickets Sold: ${summary.soldTicketCount}/${summary.totalTicketLimit} • '
                'Pending Payments: ${summary.pendingPaymentsCount}',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ],
            if (identity?.email != null) ...[
              const SizedBox(height: 8),
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
                  final selected = ws == AppWorkspace.admin;
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
    AdminOperationsState opsState,
    AdminOperationsController opsCtrl,
  ) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        ChoiceChip(
          label: const Text('Collection Summary'),
          selected: opsState.activeTab == AdminWorkspaceTab.overview,
          onSelected: (_) => opsCtrl.setTab(AdminWorkspaceTab.overview),
        ),
        ChoiceChip(
          label: const Text('Pending Payments & Issuance'),
          selected: opsState.activeTab == AdminWorkspaceTab.pendingPayments,
          onSelected: (_) {
            opsCtrl.setTab(AdminWorkspaceTab.pendingPayments);
            if (opsState.payments.isEmpty) {
              opsCtrl.loadPayments();
            }
          },
        ),
        ChoiceChip(
          label: const Text('Seller / Customer / Order Lookup'),
          selected: opsState.activeTab == AdminWorkspaceTab.directoryLookup,
          onSelected: (_) => opsCtrl.setTab(AdminWorkspaceTab.directoryLookup),
        ),
      ],
    );
  }

  Widget _buildOverviewTab(
    BuildContext context,
    AdminOperationsState opsState,
    AdminOperationsController opsCtrl,
  ) {
    final summary = opsState.summary;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (opsState.summaryError != null)
          Card(
            color: Colors.red.shade50,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    opsState.summaryError!.message,
                    style: TextStyle(color: Colors.red.shade900),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: opsCtrl.loadCollectionSummary,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Retry Summary Sync'),
                  ),
                ],
              ),
            ),
          ),
        if (summary != null) ...[
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              _buildKpiCard(
                context,
                title: 'Verified Collection',
                value: '₹${summary.verifiedCollectionInr.toStringAsFixed(0)}',
                subtitle: '${summary.verifiedPaymentsCount} verified payment(s)',
                icon: Icons.account_balance_wallet_outlined,
              ),
              _buildKpiCard(
                context,
                title: 'Tickets Issued',
                value: '${summary.soldTicketCount} / ${summary.totalTicketLimit}',
                subtitle: '${summary.remainingTicketCount} remaining (1,000 cap)',
                icon: Icons.confirmation_number_outlined,
              ),
              _buildKpiCard(
                context,
                title: 'Pending Verification',
                value: '${summary.pendingPaymentsCount}',
                subtitle: 'Awaiting UTR & screenshot review',
                icon: Icons.pending_actions_outlined,
              ),
              _buildKpiCard(
                context,
                title: 'Active Sellers',
                value: '${summary.activeSellersCount}',
                subtitle: '${summary.totalOrdersCount} total orders',
                icon: Icons.people_outline,
              ),
            ],
          ),
          const SizedBox(height: 16),
        ],
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: const CircleAvatar(
              child: Icon(Icons.receipt_long_outlined),
            ),
            title: const Text(
              'Orders & Payments',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: const Text(
              'Verify submitted payments & issue sequential tickets via issue_tickets()',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              opsCtrl.setTab(AdminWorkspaceTab.pendingPayments);
              opsCtrl.loadPayments();
            },
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: const CircleAvatar(
              child: Icon(Icons.confirmation_number_outlined),
            ),
            title: const Text(
              'Tickets & Verification',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: const Text('Issued ticket lookup & order search'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => opsCtrl.setTab(AdminWorkspaceTab.directoryLookup),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: const CircleAvatar(
              child: Icon(Icons.people_outline),
            ),
            title: const Text(
              'Sellers & Members',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: const Text('Seller & customer directory lookup'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => opsCtrl.setTab(AdminWorkspaceTab.directoryLookup),
          ),
        ),
        const SizedBox(height: 12),
        const Card(
          child: ListTile(
            contentPadding: EdgeInsets.all(16),
            leading: CircleAvatar(
              child: Icon(Icons.mail_outline),
            ),
            title: Text(
              'Email Delivery Status',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: Text('Transactional outbox view (Phase 3.2+)'),
          ),
        ),
      ],
    );
  }

  Widget _buildKpiCard(
    BuildContext context, {
    required String title,
    required String value,
    required String subtitle,
    required IconData icon,
  }) {
    return SizedBox(
      width: 195,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 20),
              const SizedBox(height: 8),
              Text(
                value,
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),
              Text(
                title,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 2),
              Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPendingPaymentsTab(
    BuildContext context,
    AdminOperationsState opsState,
    AdminOperationsController opsCtrl,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('admin_payments_search_field'),
                        controller: _paymentSearchCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Search by order number, UTR, customer, or seller',
                          border: OutlineInputBorder(),
                          isDense: true,
                        ),
                        onSubmitted: (q) => opsCtrl.loadPayments(query: q),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton.tonal(
                      onPressed: () =>
                          opsCtrl.loadPayments(query: _paymentSearchCtrl.text),
                      child: const Text('Search'),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  children: ['SUBMITTED', 'VERIFIED', 'FAILED', 'ALL']
                      .map((status) {
                    return ChoiceChip(
                      label: Text(status),
                      selected: opsState.paymentStatusFilter == status,
                      onSelected: (_) => opsCtrl.loadPayments(status: status),
                    );
                  }).toList(),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        if (opsState.paymentsError != null)
          Card(
            color: Colors.red.shade50,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    opsState.paymentsError!.message,
                    style: TextStyle(color: Colors.red.shade900),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: () => opsCtrl.loadPayments(),
                    child: const Text('Retry Payments Queue'),
                  ),
                ],
              ),
            ),
          )
        else if (opsState.payments.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Text(
                'No payments found matching the selected filter.',
                textAlign: TextAlign.center,
              ),
            ),
          )
        else
          ...opsState.payments.map(
            (item) => Card(
              child: ListTile(
                contentPadding: const EdgeInsets.all(16),
                title: Text(
                  '${item.orderNumber} • ₹${item.amountInr.toStringAsFixed(0)} (${item.quantity} ticket(s))',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                subtitle: Text(
                  'Customer: ${item.customerName} • '
                  'Seller: ${item.sellerCode ?? 'Public'} • '
                  'Status: ${item.status} • '
                  'UTR: ${item.utrReference ?? 'None'} • '
                  'Screenshot: ${item.hasScreenshot ? 'Uploaded' : 'Missing'}',
                ),
                trailing: TextButton(
                  onPressed: () {
                    _rejectionReasonCtrl.clear();
                    opsCtrl.selectPayment(item);
                  },
                  child: Text(
                    item.isAwaitingVerification ? 'Review' : 'Details',
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildPaymentDetailCard(
    BuildContext context,
    AdminOperationsState opsState,
    AdminOperationsController opsCtrl,
  ) {
    final item = opsState.selectedPayment!;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    'Payment Review • ${item.orderNumber} (${item.status})',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
                IconButton(
                  tooltip: 'Close payment review',
                  onPressed: () => opsCtrl.selectPayment(null),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Customer: ${item.customerName} (${item.customerWhatsapp ?? item.customerPhone ?? '—'}) • '
              'Email: ${item.customerEmail ?? '—'}',
            ),
            const SizedBox(height: 4),
            Text(
              'Amount: ₹${item.amountInr.toStringAsFixed(2)} • Quantity: ${item.quantity} ticket(s) • '
              'UTR: ${item.utrReference ?? 'Not provided'} • Payer: ${item.payerName ?? 'Not provided'}',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            Text(
              'Attributed Seller: ${item.sellerDisplayName ?? 'Direct/Public'} '
              '${item.sellerCode != null ? '(${item.sellerCode})' : ''} • '
              'Snapshot UPI: ${item.snapshotUpiId ?? '—'} • '
              'Proof Screenshot: ${item.hasScreenshot ? 'Uploaded' : 'Missing'}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (item.sellerReviewStatus != null) ...[
              const SizedBox(height: 6),
              Text(
                'Seller Advisory Review: ${item.sellerReviewStatus}'
                '${item.sellerReviewNote != null ? ' — ${item.sellerReviewNote}' : ''}',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ],
            if (item.tickets.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                'Issued Tickets (${item.tickets.length}): '
                '${item.tickets.map((t) => t.ticketNumber).join(', ')}',
                style: TextStyle(
                  color: Colors.green.shade800,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
            if (opsState.decisionError != null) ...[
              const SizedBox(height: 8),
              Text(
                opsState.decisionError!.message,
                style: TextStyle(color: Colors.red.shade900),
              ),
            ],
            if (item.isAwaitingVerification) ...[
              const Divider(height: 24),
              FilledButton.icon(
                key: const Key('admin_verify_payment_button'),
                onPressed: opsState.isProcessingDecision
                    ? null
                    : () async {
                        await opsCtrl.verifyPaymentAndIssueTickets(item.id);
                      },
                icon: const Icon(Icons.check_circle_outline),
                label: Text(
                  opsState.isProcessingDecision
                      ? 'Processing...'
                      : 'Verify Payment & Issue Tickets (issue_tickets)',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('admin_reject_reason_field'),
                controller: _rejectionReasonCtrl,
                decoration: const InputDecoration(
                  labelText: 'Rejection Reason (required to reject, min 3 chars)',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                key: const Key('admin_reject_payment_button'),
                onPressed: opsState.isProcessingDecision
                    ? null
                    : () async {
                        await opsCtrl.rejectPayment(
                          paymentId: item.id,
                          reason: _rejectionReasonCtrl.text,
                        );
                      },
                icon: const Icon(Icons.cancel_outlined),
                label: const Text('Reject Payment'),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildDirectoryLookupTab(
    BuildContext context,
    AdminOperationsState opsState,
    AdminOperationsController opsCtrl,
  ) {
    final results = opsState.lookupResults;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('admin_directory_lookup_field'),
                        controller: _directoryQueryCtrl,
                        decoration: const InputDecoration(
                          labelText:
                              'Lookup seller code, customer name/phone, or order number',
                          border: OutlineInputBorder(),
                          isDense: true,
                        ),
                        onSubmitted: (q) =>
                            opsCtrl.searchDirectory(query: q),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton.tonal(
                      key: const Key('admin_directory_lookup_button'),
                      onPressed: opsState.isSearchingDirectory
                          ? null
                          : () => opsCtrl.searchDirectory(
                                query: _directoryQueryCtrl.text,
                              ),
                      child: const Text('Lookup'),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  children: ['ALL', 'SELLERS', 'CUSTOMERS', 'ORDERS']
                      .map((type) {
                    return ChoiceChip(
                      label: Text(type),
                      selected: opsState.lookupType == type,
                      onSelected: (_) => opsCtrl.searchDirectory(
                        query: _directoryQueryCtrl.text,
                        type: type,
                      ),
                    );
                  }).toList(),
                ),
                if (opsState.lookupError != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    opsState.lookupError!.message,
                    style: TextStyle(color: Colors.red.shade900),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        if (results.sellers.isNotEmpty) ...[
          Text(
            'Sellers (${results.sellers.length})',
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 6),
          ...results.sellers.map(
            (s) => Card(
              child: ListTile(
                title: Text('${s.displayName} (${s.sellerCode})'),
                subtitle: Text(
                  'Account: ${s.isActive ? 'ACTIVE' : 'INACTIVE'} • '
                  'QR: ${s.isQrActive ? 'ACTIVE' : 'INACTIVE'}',
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
        ],
        if (results.customers.isNotEmpty) ...[
          Text(
            'Customers (${results.customers.length})',
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 6),
          ...results.customers.map(
            (c) => Card(
              child: ListTile(
                title: Text(c.fullName),
                subtitle: Text(
                  'WhatsApp: ${c.whatsappNumber} • Phone: ${c.phone} • '
                  'Email: ${c.email ?? '—'}',
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
        ],
        if (results.orders.isNotEmpty) ...[
          Text(
            'Orders (${results.orders.length})',
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 6),
          ...results.orders.map(
            (o) => Card(
              child: ListTile(
                title: Text(
                  '${o.orderNumber} • ₹${o.totalAmountInr.toStringAsFixed(0)} (${o.quantity} ticket(s))',
                ),
                subtitle: Text(
                  'Status: ${o.status} • Customer: ${o.customerName ?? '—'} • '
                  'Seller: ${o.sellerCode ?? 'Public'}',
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }
}
