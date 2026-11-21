import 'auth_identity.dart';

enum AuthSessionEventType {
  signedIn,
  tokenRefreshed,
  signedOut,
}

class AuthSessionEvent {
  const AuthSessionEvent(this.type);

  final AuthSessionEventType type;
}

/// Abstract authentication and authoritative identity repository.
/// Allows clean dependency injection via Riverpod and full mocking in tests.
abstract interface class AuthRepository {
  /// Returns true if a persisted Supabase session currently exists.
  Future<bool> hasActiveSession();

  /// Stream of auth lifecycle events from Supabase Auth.
  Stream<AuthSessionEvent> authEvents();

  /// Signs in with email and password through Supabase Auth (never stores password).
  Future<void> signInWithPassword({
    required String email,
    required String password,
  });

  /// Fetches the authoritative user identity and roles from `GET /api/mobile/v1/me`.
  Future<AuthIdentity> fetchAuthoritativeIdentity();

  /// Refreshes the active session and re-fetches authoritative roles from `/api/mobile/v1/me`.
  Future<AuthIdentity> refreshSessionAndIdentity();

  /// Signs out locally and wipes persisted tokens from secure storage.
  Future<void> signOut();
}
