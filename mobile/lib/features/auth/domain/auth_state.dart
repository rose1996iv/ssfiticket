import '../../../core/errors/app_failure.dart';
import 'auth_identity.dart';

/// Deterministic state machine for authentication, session restoration,
/// and authoritative role authorization.
sealed class AuthState {
  const AuthState();
}

final class AuthInitializing extends AuthState {
  const AuthInitializing();
}

final class AuthUnauthenticated extends AuthState {
  const AuthUnauthenticated({this.message});

  final String? message;
}

final class AuthAuthenticated extends AuthState {
  const AuthAuthenticated({
    required this.identity,
    required this.activeWorkspace,
  });

  final AuthIdentity identity;
  final AppWorkspace activeWorkspace;
}

final class AuthUnauthorized extends AuthState {
  const AuthUnauthorized({required this.reason});

  final String reason;
}

final class AuthNetworkError extends AuthState {
  const AuthNetworkError({
    required this.failure,
    required this.hasSession,
  });

  final AppFailure failure;
  final bool hasSession;
}
