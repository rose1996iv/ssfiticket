import '../domain/customer_models.dart';
import '../domain/customer_repository.dart';
import 'customer_remote_datasource.dart';

class CustomerRepositoryImpl implements CustomerRepository {
  const CustomerRepositoryImpl(this._remote);

  final CustomerRemoteDataSource _remote;

  @override
  Future<CustomerDashboardData> fetchDashboard() => _remote.getDashboard();

  @override
  Future<TicketVerificationDetails> verifyTicket(String ticketNumber) =>
      _remote.verifyTicket(ticketNumber);
}
