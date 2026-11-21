import 'customer_models.dart';

abstract interface class CustomerRepository {
  Future<CustomerDashboardData> fetchDashboard();

  Future<TicketVerificationDetails> verifyTicket(String ticketNumber);
}
