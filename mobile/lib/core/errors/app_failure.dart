/// Typed, sanitized failure hierarchy for the SSFI mobile application.
/// Never carries raw database errors, stack traces, or Bearer tokens.
sealed class AppFailure implements Exception {
  const AppFailure(this.message, {this.code});

  final String message;
  final String? code;

  @override
  String toString() => '$runtimeType(code: $code, message: $message)';
}

final class ValidationFailure extends AppFailure {
  const ValidationFailure([
    super.message = 'Please check your input and try again.',
  ]) : super(code: 'BAD_REQUEST');
}

final class NotFoundFailure extends AppFailure {
  const NotFoundFailure([
    super.message = 'The requested record could not be found.',
  ]) : super(code: 'NOT_FOUND');
}

final class UnauthorizedFailure extends AppFailure {
  const UnauthorizedFailure([
    super.message = 'Your session has expired. Please sign in again.',
  ]) : super(code: 'UNAUTHORIZED');
}

final class ForbiddenFailure extends AppFailure {
  const ForbiddenFailure([
    super.message =
        'Your account is inactive or does not have permission to access this area.',
  ]) : super(code: 'FORBIDDEN');
}

final class RateLimitedFailure extends AppFailure {
  const RateLimitedFailure({
    String message = 'Too many requests. Please wait before trying again.',
    this.retryAfterSeconds,
  }) : super(message, code: 'RATE_LIMITED');

  final int? retryAfterSeconds;
}

final class ServiceUnavailableFailure extends AppFailure {
  const ServiceUnavailableFailure({
    String message =
        'Service is temporarily unavailable. Please try again shortly.',
    this.retryAfterSeconds,
  }) : super(message, code: 'SERVICE_UNAVAILABLE');

  final int? retryAfterSeconds;
}

final class NetworkFailure extends AppFailure {
  const NetworkFailure([
    super.message =
        'Unable to connect to the SSFI server. Check your internet connection and try again.',
  ]) : super(code: 'NETWORK_ERROR');
}

final class InvalidResponseFailure extends AppFailure {
  const InvalidResponseFailure([
    super.message = 'Received an unexpected response from the server.',
  ]) : super(code: 'INVALID_RESPONSE');
}

final class UnknownFailure extends AppFailure {
  const UnknownFailure([
    super.message = 'An unexpected error occurred. Please try again.',
  ]) : super(code: 'UNKNOWN');
}
