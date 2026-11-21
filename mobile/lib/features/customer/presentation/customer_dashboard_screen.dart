// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/route_paths.dart';
import '../../auth/domain/auth_identity.dart';
import '../../auth/domain/auth_state.dart';
import '../../auth/presentation/auth_controller.dart';
import 'customer_controller.dart';

class CustomerDashboardScreen extends ConsumerStatefulWidget {
  const CustomerDashboardScreen({super.key});

  @override
  ConsumerState<CustomerDashboardScreen> createState() =>
      _CustomerDashboardScreenState();
}

class _CustomerDashboardScreenState
    extends ConsumerState<CustomerDashboardScreen> {
  final _ticketVerifyCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final config = ref.read(appConfigProvider);
      if (config.isSupabaseConfigured) {
        ref.read(customerControllerProvider.notifier).loadDashboard();
      }
    });
  }

  @override
  void dispose() {
    _ticketVerifyCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authControllerProvider);
    final identity =
        authState is AuthAuthenticated ? authState.identity : null;
    final allowedWorkspaces = identity?.allowedWorkspaces ?? const [];
    final custState = ref.watch(customerControllerProvider);
    final custCtrl = ref.read(customerControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('SSFI • Customer'),
        actions: [
          IconButton(
            tooltip: 'Refresh session and roles',
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.read(authControllerProvider.notifier).refreshRoles();
              custCtrl.loadDashboard();
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
                  _buildHeaderCard(
                    context,
                    identity,
                    allowedWorkspaces,
                    custState,
                  ),
                  const SizedBox(height: 16),
                  _buildTabSelector(custState, custCtrl),
                  const SizedBox(height: 16),
                  switch (custState.activeTab) {
                    CustomerWorkspaceTab.overviewAndTickets =>
                      _buildOverviewAndTicketsTab(context, custState, custCtrl),
                    CustomerWorkspaceTab.myOrders =>
                      _buildMyOrdersTab(context, custState, custCtrl),
                    CustomerWorkspaceTab.verifyTicket =>
                      _buildVerifyTicketTab(context, custState, custCtrl),
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
    CustomerState custState,
  ) {
    final customer = custState.dashboard?.customer;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Customer Supporter Workspace',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            const Text(
              'Customer-linked account workspace (kept strictly separate from staff RBAC roles). Order status, digital tickets, and certified draw results will connect in subsequent phases.',
            ),
            if (customer != null) ...[
              const SizedBox(height: 8),
              Text(
                'Supporter: ${customer.fullName} • WhatsApp: ${customer.whatsappNumber}'
                '${customer.email != null ? ' • ${customer.email}' : ''}',
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
                  final selected = ws == AppWorkspace.customer;
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
    CustomerState custState,
    CustomerController custCtrl,
  ) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        ChoiceChip(
          label: const Text('My Tickets & Overview'),
          selected:
              custState.activeTab == CustomerWorkspaceTab.overviewAndTickets,
          onSelected: (_) =>
              custCtrl.setTab(CustomerWorkspaceTab.overviewAndTickets),
        ),
        ChoiceChip(
          label: const Text('My Orders & Payment Status'),
          selected: custState.activeTab == CustomerWorkspaceTab.myOrders,
          onSelected: (_) => custCtrl.setTab(CustomerWorkspaceTab.myOrders),
        ),
        ChoiceChip(
          label: const Text('Verify Ticket Number'),
          selected: custState.activeTab == CustomerWorkspaceTab.verifyTicket,
          onSelected: (_) => custCtrl.setTab(CustomerWorkspaceTab.verifyTicket),
        ),
      ],
    );
  }

  Widget _buildOverviewAndTicketsTab(
    BuildContext context,
    CustomerState custState,
    CustomerController custCtrl,
  ) {
    final dash = custState.dashboard;
    final tickets = dash?.tickets ?? const [];
    final winners = dash?.certifiedWinners ?? const [];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (custState.dashboardError != null)
          Card(
            color: Colors.red.shade50,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    custState.dashboardError!.message,
                    style: TextStyle(color: Colors.red.shade900),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: custCtrl.loadDashboard,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Retry Loading Supporter Data'),
                  ),
                ],
              ),
            ),
          ),
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: const CircleAvatar(
              child: Icon(Icons.confirmation_number_outlined),
            ),
            title: const Text(
              'My Lucky Draw Tickets',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: Text(
              dash != null
                  ? '${tickets.length} issued ticket(s) in ${dash.campaignName}'
                  : 'Digital tickets & verification',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => custCtrl.setTab(CustomerWorkspaceTab.verifyTicket),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: const CircleAvatar(
              child: Icon(Icons.shopping_bag_outlined),
            ),
            title: const Text(
              'My Orders',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: Text(
              dash != null
                  ? '${dash.orders.length} order(s) on file'
                  : 'Order & payment status history',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => custCtrl.setTab(CustomerWorkspaceTab.myOrders),
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
              'Certified Winners',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: Text(
              winners.isNotEmpty
                  ? 'Winning tickets: ${winners.map((w) => '#${w.prizeNumber} ${w.ticketNumber}').join(' • ')}'
                  : 'Public draw results (ticket-number-only privacy policy)',
            ),
          ),
        ),
        if (dash != null) ...[
          const SizedBox(height: 16),
          Text(
            'Issued Ticket History (${tickets.length})',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          if (tickets.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Text(
                  'No issued tickets yet. Tickets appear here automatically once your order payment is verified.',
                  textAlign: TextAlign.center,
                ),
              ),
            )
          else
            ...tickets.map(
              (t) => Card(
                child: ListTile(
                  leading: const Icon(Icons.confirmation_number_outlined),
                  title: Text(
                    t.ticketNumber,
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  subtitle: Text(
                    'Order: ${t.orderNumber} • Status: ${t.status}',
                  ),
                  trailing: TextButton(
                    onPressed: () {
                      _ticketVerifyCtrl.text = t.ticketNumber;
                      custCtrl.setTab(CustomerWorkspaceTab.verifyTicket);
                      custCtrl.verifyTicket(t.ticketNumber);
                    },
                    child: const Text('Verify'),
                  ),
                ),
              ),
            ),
        ],
      ],
    );
  }

  Widget _buildMyOrdersTab(
    BuildContext context,
    CustomerState custState,
    CustomerController custCtrl,
  ) {
    final orders = custState.dashboard?.orders ?? const [];

    if (orders.isEmpty) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'No orders found for your customer account yet.',
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: orders
          .map(
            (o) => Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${o.orderNumber} • ₹${o.totalAmountInr.toStringAsFixed(0)} (${o.quantity} ticket(s))',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Order Status: ${o.status} • Payment Status: ${o.paymentStatus}'
                      '${o.utrReference != null ? ' • UTR: ${o.utrReference}' : ''}',
                    ),
                    if (o.sellerCode != null)
                      Text(
                        'Attributed Seller: ${o.sellerDisplayName ?? ''} (${o.sellerCode})',
                      ),
                    if (o.rejectionReason != null)
                      Text(
                        'Payment Note: ${o.rejectionReason}',
                        style: TextStyle(color: Colors.red.shade800),
                      ),
                    if (o.tickets.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(
                        'Issued Tickets: ${o.tickets.map((t) => t.ticketNumber).join(', ')}',
                        style: TextStyle(
                          color: Colors.green.shade800,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          )
          .toList(),
    );
  }

  Widget _buildVerifyTicketTab(
    BuildContext context,
    CustomerState custState,
    CustomerController custCtrl,
  ) {
    final res = custState.verificationResult;

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
                  'Official SSFI Ticket Verification',
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
                        key: const Key('customer_ticket_verify_field'),
                        controller: _ticketVerifyCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Ticket Number (e.g. SSFI-000101)',
                          border: OutlineInputBorder(),
                          isDense: true,
                        ),
                        onSubmitted: custCtrl.verifyTicket,
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      key: const Key('customer_ticket_verify_button'),
                      onPressed: custState.isVerifyingTicket
                          ? null
                          : () => custCtrl.verifyTicket(
                                _ticketVerifyCtrl.text,
                              ),
                      child: const Text('Verify'),
                    ),
                  ],
                ),
                if (custState.verificationError != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    custState.verificationError!.message,
                    style: TextStyle(color: Colors.red.shade900),
                  ),
                ],
              ],
            ),
          ),
        ),
        if (res != null) ...[
          const SizedBox(height: 12),
          Card(
            color: res.isValid
                ? Colors.green.shade50
                : (res.isVoid ? Colors.red.shade50 : Colors.amber.shade50),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    res.isValid
                        ? 'Official Registered Ticket (${res.ticketNumber})'
                        : (res.isVoid
                            ? 'Ticket Entry Voided (${res.ticketNumber})'
                            : 'Ticket Record Pending or Not Found (${res.queriedTicketNumber})'),
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    res.isValid
                        ? 'Status: Valid & Eligible for Draw • Campaign: ${res.campaignName ?? 'SSFI Fundraising Lucky Draw'}'
                        : (res.isVoid
                            ? 'Status: VOID${res.voidReason != null ? ' • Reason: ${res.voidReason}' : ''}'
                            : 'No active issued ticket matches this number.'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }
}
