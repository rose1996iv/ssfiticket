// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/route_paths.dart';
import '../../auth/domain/auth_identity.dart';
import '../../auth/domain/auth_state.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/seller_models.dart';
import 'seller_operations_controller.dart';

class SellerDashboardScreen extends ConsumerStatefulWidget {
  const SellerDashboardScreen({super.key});

  @override
  ConsumerState<SellerDashboardScreen> createState() =>
      _SellerDashboardScreenState();
}

class _SellerDashboardScreenState extends ConsumerState<SellerDashboardScreen> {
  final _nameCtrl = TextEditingController();
  final _whatsappCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _customerLookupCtrl = TextEditingController();
  final _orderSearchCtrl = TextEditingController();
  final _utrCtrl = TextEditingController();
  final _payerNameCtrl = TextEditingController();
  int _quantity = 1;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final config = ref.read(appConfigProvider);
      if (config.isSupabaseConfigured) {
        ref.read(sellerOperationsControllerProvider.notifier).loadDashboard();
      }
    });
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _whatsappCtrl.dispose();
    _emailCtrl.dispose();
    _customerLookupCtrl.dispose();
    _orderSearchCtrl.dispose();
    _utrCtrl.dispose();
    _payerNameCtrl.dispose();
    super.dispose();
  }

  void _applyCustomerLookup(SellerCustomerItem customer) {
    setState(() {
      _nameCtrl.text = customer.fullName;
      _whatsappCtrl.text = customer.whatsappNumber.isNotEmpty
          ? customer.whatsappNumber
          : customer.phone;
      _emailCtrl.text = customer.email ?? '';
    });
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authControllerProvider);
    final identity =
        authState is AuthAuthenticated ? authState.identity : null;
    final allowedWorkspaces = identity?.allowedWorkspaces ?? const [];
    final opsState = ref.watch(sellerOperationsControllerProvider);
    final opsCtrl = ref.read(sellerOperationsControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('SSFI • Seller'),
        actions: [
          IconButton(
            tooltip: 'Refresh session and roles',
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.read(authControllerProvider.notifier).refreshRoles();
              opsCtrl.loadDashboard();
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
                  if (opsState.lastSuccessNotice != null) ...[
                    Card(
                      color: Colors.green.shade50,
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Row(
                          children: [
                            Icon(Icons.check_circle_outline,
                                color: Colors.green.shade800),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                opsState.lastSuccessNotice!,
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
                  if (opsState.selectedOrder != null) ...[
                    _buildOrderDetailAndUpiCard(context, opsState, opsCtrl),
                    const SizedBox(height: 16),
                  ],
                  switch (opsState.activeTab) {
                    SellerWorkspaceTab.overview =>
                      _buildOverviewTab(context, opsState, opsCtrl),
                    SellerWorkspaceTab.newOrder =>
                      _buildNewOrderTab(context, opsState, opsCtrl),
                    SellerWorkspaceTab.myOrders =>
                      _buildMyOrdersTab(context, opsState, opsCtrl),
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
    SellerOperationsState opsState,
  ) {
    final seller = opsState.dashboard?.seller;
    final campaign = opsState.dashboard?.campaign;

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
                    'Seller Workspace',
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
                if (seller != null)
                  Chip(
                    label: Text(seller.sellerCode),
                    visualDensity: VisualDensity.compact,
                  ),
              ],
            ),
            const SizedBox(height: 6),
            const Text(
              'Authoritative SELLER workspace foundation. Direct sales, own-order tracking, and payment QR status will connect in subsequent phases.',
            ),
            if (seller != null) ...[
              const SizedBox(height: 8),
              Text(
                '${seller.displayName} • Payment QR: ${seller.isQrActive ? 'ACTIVE' : 'INACTIVE'}'
                '${seller.upiId != null ? ' (${seller.upiId})' : ''}',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ],
            if (campaign != null) ...[
              const SizedBox(height: 6),
              Text(
                'Campaign: ${campaign.status} • ₹${campaign.ticketPriceInr.toStringAsFixed(0)}/ticket • '
                '${campaign.remainingTicketCount}/${campaign.totalTicketLimit} remaining',
                style: Theme.of(context).textTheme.bodySmall,
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
                  final selected = ws == AppWorkspace.seller;
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
    SellerOperationsState opsState,
    SellerOperationsController opsCtrl,
  ) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        ChoiceChip(
          label: const Text('Operational Overview'),
          selected: opsState.activeTab == SellerWorkspaceTab.overview,
          onSelected: (_) => opsCtrl.setTab(SellerWorkspaceTab.overview),
        ),
        ChoiceChip(
          label: const Text('New Manual Sale'),
          selected: opsState.activeTab == SellerWorkspaceTab.newOrder,
          onSelected: (_) => opsCtrl.setTab(SellerWorkspaceTab.newOrder),
        ),
        ChoiceChip(
          label: const Text('My Orders & Payments'),
          selected: opsState.activeTab == SellerWorkspaceTab.myOrders,
          onSelected: (_) {
            opsCtrl.setTab(SellerWorkspaceTab.myOrders);
            if (opsState.orders.isEmpty) {
              opsCtrl.loadOrders();
            }
          },
        ),
      ],
    );
  }

  Widget _buildOverviewTab(
    BuildContext context,
    SellerOperationsState opsState,
    SellerOperationsController opsCtrl,
  ) {
    final metrics = opsState.dashboard?.metrics;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (opsState.dashboardError != null)
          Card(
            color: Colors.red.shade50,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    opsState.dashboardError!.message,
                    style: TextStyle(color: Colors.red.shade900),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: opsCtrl.loadDashboard,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Retry Dashboard Sync'),
                  ),
                ],
              ),
            ),
          ),
        if (metrics != null) ...[
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              _buildMetricTile(
                context,
                label: 'Tickets Issued',
                value: '${metrics.ticketsIssuedCount}',
                icon: Icons.confirmation_number_outlined,
              ),
              _buildMetricTile(
                context,
                label: 'Verified Collection',
                value: '₹${metrics.verifiedCollectionInr.toStringAsFixed(0)}',
                icon: Icons.currency_rupee,
              ),
              _buildMetricTile(
                context,
                label: 'Pending Verification',
                value: '${metrics.pendingPaymentsCount}',
                icon: Icons.hourglass_top_outlined,
              ),
              _buildMetricTile(
                context,
                label: 'Awaiting Payment',
                value: '${metrics.awaitingPaymentOrdersCount}',
                icon: Icons.payment_outlined,
              ),
            ],
          ),
          const SizedBox(height: 16),
        ],
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: const CircleAvatar(
              child: Icon(Icons.point_of_sale_outlined),
            ),
            title: const Text(
              'My Sales & Orders',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: const Text('Seller-scoped orders & manual sale creation'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => opsCtrl.setTab(SellerWorkspaceTab.newOrder),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: const CircleAvatar(
              child: Icon(Icons.qr_code_2_outlined),
            ),
            title: const Text(
              'Payment QR Status',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: Text(
              opsState.dashboard?.seller != null
                  ? (opsState.dashboard!.seller.isQrActive
                      ? 'Active personal UPI QR (${opsState.dashboard!.seller.upiId ?? ''})'
                      : 'Personal payment QR inactive or unconfigured')
                  : 'Verified seller UPI QR status',
            ),
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
              'Issued Tickets',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: const Text('Own customer orders, UTR status & issued tickets'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              opsCtrl.setTab(SellerWorkspaceTab.myOrders);
              opsCtrl.loadOrders();
            },
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: const CircleAvatar(
              child: Icon(Icons.forum_outlined),
            ),
            title: const Text(
              'Admin Messages',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: Text(
              metrics != null
                  ? '${metrics.unreadMessagesCount} unread notice(s)'
                  : 'Seller inbox placeholder (Phase 3.3+)',
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildMetricTile(
    BuildContext context, {
    required String label,
    required String value,
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
                    .headlineSmall
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),
              Text(label, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildNewOrderTab(
    BuildContext context,
    SellerOperationsState opsState,
    SellerOperationsController opsCtrl,
  ) {
    final campaign = opsState.dashboard?.campaign;
    final unitPriceInr = campaign?.ticketPriceInr ?? 100.0;
    final maxAllowed = campaign != null
        ? campaign.remainingTicketCount.clamp(1, 1000)
        : 1000;
    final totalInr = _quantity * unitPriceInr;

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
                  'Existing Customer Lookup (Own Sales Only)',
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('seller_customer_lookup_field'),
                        controller: _customerLookupCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Search by customer name, phone, or email',
                          border: OutlineInputBorder(),
                          isDense: true,
                        ),
                        onSubmitted: opsCtrl.searchCustomers,
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton.tonal(
                      key: const Key('seller_customer_lookup_button'),
                      onPressed: opsState.isSearchingCustomers
                          ? null
                          : () => opsCtrl.searchCustomers(
                                _customerLookupCtrl.text,
                              ),
                      child: const Text('Lookup'),
                    ),
                  ],
                ),
                if (opsState.customerLookupError != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    opsState.customerLookupError!.message,
                    style: TextStyle(color: Colors.red.shade800),
                  ),
                ],
                if (opsState.customerLookupResults.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  ...opsState.customerLookupResults.map(
                    (c) => ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text(c.fullName),
                      subtitle: Text(
                        '${c.whatsappNumber} • ${c.email ?? 'No email'} (${c.totalOrdersWithSeller} order(s))',
                      ),
                      trailing: TextButton(
                        onPressed: () => _applyCustomerLookup(c),
                        child: const Text('Use Details'),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Record New Manual Sale',
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 12),
                if (opsState.orderSubmissionError != null) ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.red.shade50,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      opsState.orderSubmissionError!.message,
                      style: TextStyle(color: Colors.red.shade900),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                TextField(
                  key: const Key('seller_order_name_field'),
                  controller: _nameCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Customer Full Name *',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  key: const Key('seller_order_whatsapp_field'),
                  controller: _whatsappCtrl,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(
                    labelText: 'WhatsApp Number *',
                    hintText: '+91 98765 43210',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  key: const Key('seller_order_email_field'),
                  controller: _emailCtrl,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(
                    labelText: 'Customer Email Address *',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Ticket Quantity',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    Row(
                      children: [
                        IconButton(
                          key: const Key('seller_order_qty_decrement'),
                          onPressed: _quantity > 1
                              ? () => setState(() => _quantity -= 1)
                              : null,
                          icon: const Icon(Icons.remove_circle_outline),
                        ),
                        Text(
                          '$_quantity',
                          key: const Key('seller_order_qty_text'),
                          style: Theme.of(context)
                              .textTheme
                              .titleMedium
                              ?.copyWith(fontWeight: FontWeight.bold),
                        ),
                        IconButton(
                          key: const Key('seller_order_qty_increment'),
                          onPressed: _quantity < maxAllowed
                              ? () => setState(() => _quantity += 1)
                              : null,
                          icon: const Icon(Icons.add_circle_outline),
                        ),
                      ],
                    ),
                  ],
                ),
                Wrap(
                  spacing: 8,
                  children: [1, 5, 10, 20].map((preset) {
                    return ActionChip(
                      label: Text('$preset'),
                      onPressed: preset <= maxAllowed
                          ? () => setState(() => _quantity = preset)
                          : null,
                    );
                  }).toList(),
                ),
                const SizedBox(height: 14),
                Text(
                  'Total Amount Due: ₹${totalInr.toStringAsFixed(2)}',
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  key: const Key('seller_create_order_submit_button'),
                  onPressed: opsState.isSubmittingOrder
                      ? null
                      : () async {
                          await opsCtrl.createOrder(
                            name: _nameCtrl.text,
                            whatsapp: _whatsappCtrl.text,
                            email: _emailCtrl.text,
                            quantity: _quantity,
                          );
                        },
                  child: Text(
                    opsState.isSubmittingOrder
                        ? 'Creating Order...'
                        : 'Create Order & View UPI Payment Instructions',
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildMyOrdersTab(
    BuildContext context,
    SellerOperationsState opsState,
    SellerOperationsController opsCtrl,
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
                        key: const Key('seller_orders_search_field'),
                        controller: _orderSearchCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Search own orders by number, customer, or UTR',
                          border: OutlineInputBorder(),
                          isDense: true,
                        ),
                        onSubmitted: (q) => opsCtrl.loadOrders(query: q),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton.tonal(
                      onPressed: () =>
                          opsCtrl.loadOrders(query: _orderSearchCtrl.text),
                      child: const Text('Filter'),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  children: [
                    'ALL',
                    'PENDING_PAYMENT',
                    'PAYMENT_SUBMITTED',
                    'TICKETS_ISSUED',
                  ].map((status) {
                    return ChoiceChip(
                      label: Text(status),
                      selected: opsState.orderStatusFilter == status,
                      onSelected: (_) => opsCtrl.loadOrders(status: status),
                    );
                  }).toList(),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        if (opsState.ordersError != null)
          Card(
            color: Colors.red.shade50,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    opsState.ordersError!.message,
                    style: TextStyle(color: Colors.red.shade900),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: () => opsCtrl.loadOrders(),
                    child: const Text('Retry Loading Orders'),
                  ),
                ],
              ),
            ),
          )
        else if (opsState.orders.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Text(
                'No orders found for your seller account matching the current filter.',
                textAlign: TextAlign.center,
              ),
            ),
          )
        else
          ...opsState.orders.map(
            (order) => Card(
              child: ListTile(
                contentPadding: const EdgeInsets.all(16),
                title: Text(
                  '${order.orderNumber} • ${order.customerFullName}',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                subtitle: Text(
                  '${order.quantity} ticket(s) • ₹${order.totalAmountInr.toStringAsFixed(0)} • '
                  'Order: ${order.status} • Payment: ${order.payment.status}'
                  '${order.payment.utrReference != null ? ' • UTR: ${order.payment.utrReference}' : ''}',
                ),
                trailing: TextButton(
                  onPressed: () {
                    _utrCtrl.text = order.payment.utrReference ?? '';
                    _payerNameCtrl.text = order.payment.payerName ?? '';
                    opsCtrl.selectOrder(order);
                  },
                  child: Text(
                    order.isAwaitingPayment ? 'Submit UPI' : 'View Detail',
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildOrderDetailAndUpiCard(
    BuildContext context,
    SellerOperationsState opsState,
    SellerOperationsController opsCtrl,
  ) {
    final order = opsState.selectedOrder!;
    final upi = order.upiInstructions;

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
                    'Order ${order.orderNumber} (${order.status})',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
                IconButton(
                  tooltip: 'Close order detail',
                  onPressed: () => opsCtrl.selectOrder(null),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Customer: ${order.customerFullName} • ${order.quantity} ticket(s) • '
              'Amount Due: ₹${order.totalAmountInr.toStringAsFixed(2)} ${upi.currency}',
            ),
            const SizedBox(height: 8),
            Text(
              'UPI Payee: ${upi.payeeName} • UPI ID: ${upi.upiId ?? 'Not configured'}',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            if (upi.upiUri != null && upi.upiUri!.isNotEmpty) ...[
              const SizedBox(height: 4),
              SelectableText(
                'UPI Intent: ${upi.upiUri}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            if (order.payment.rejectionReason != null) ...[
              const SizedBox(height: 8),
              Text(
                'Rejection Note: ${order.payment.rejectionReason}',
                style: TextStyle(
                  color: Colors.red.shade800,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
            if (order.tickets.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                'Issued Tickets (${order.tickets.length}): '
                '${order.tickets.map((t) => t.ticketNumber).join(', ')}',
                style: TextStyle(
                  color: Colors.green.shade800,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
            if (order.isAwaitingPayment) ...[
              const Divider(height: 24),
              const Text(
                'Step 1: Payment Confirmation Screenshot (Mandatory)',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),
              Text(
                order.payment.hasScreenshot
                    ? 'Payment screenshot proof is securely uploaded to private storage.'
                    : 'Upload a JPEG, PNG, or WebP payment screenshot (max 2 MB) before submitting UTR.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 8),
              if (opsState.screenshotUploadError != null) ...[
                Text(
                  opsState.screenshotUploadError!.message,
                  style: TextStyle(color: Colors.red.shade900),
                ),
                const SizedBox(height: 8),
              ],
              OutlinedButton.icon(
                key: const Key('seller_upload_screenshot_button'),
                onPressed: opsState.isUploadingScreenshot
                    ? null
                    : () async {
                        await opsCtrl.pickAndUploadScreenshot(order.id);
                      },
                icon: Icon(
                  order.payment.hasScreenshot
                      ? Icons.check_circle_outline
                      : Icons.upload_file_outlined,
                ),
                label: Text(
                  opsState.isUploadingScreenshot
                      ? 'Uploading Screenshot...'
                      : (order.payment.hasScreenshot
                          ? 'Replace Payment Screenshot'
                          : 'Upload Payment Screenshot (Required)'),
                ),
              ),
              const Divider(height: 24),
              const Text(
                'Step 2: Submit Manual UPI Reference (UTR)',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 10),
              if (opsState.upiSubmissionError != null) ...[
                Text(
                  opsState.upiSubmissionError!.message,
                  style: TextStyle(color: Colors.red.shade900),
                ),
                const SizedBox(height: 8),
              ],
              TextField(
                key: const Key('seller_upi_utr_field'),
                controller: _utrCtrl,
                decoration: const InputDecoration(
                  labelText: 'UTR / UPI Transaction Reference (min 6 chars)',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                key: const Key('seller_upi_payer_field'),
                controller: _payerNameCtrl,
                decoration: const InputDecoration(
                  labelText: 'Payer Account Holder Name (optional)',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 12),
              FilledButton(
                key: const Key('seller_submit_upi_button'),
                onPressed: (opsState.isSubmittingUpi ||
                        opsState.isUploadingScreenshot)
                    ? null
                    : () async {
                        await opsCtrl.submitManualUpi(
                          orderId: order.id,
                          utr: _utrCtrl.text,
                          payerName: _payerNameCtrl.text,
                        );
                      },
                child: Text(
                  opsState.isSubmittingUpi
                      ? 'Submitting Payment Reference...'
                      : 'Submit Manual UPI Payment Reference',
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
