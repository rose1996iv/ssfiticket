import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import '../../../core/errors/app_failure.dart';
import '../../../core/security/secure_token_storage.dart';
import '../domain/auth_identity.dart';
import '../domain/auth_repository.dart';
import 'auth_remote_datasource.dart';

/// Production implementation combining Supabase Auth with the authoritative
/// Next.js `/api/mobile/v1/me` endpoint. Never trusts JWT metadata for roles.
class SupabaseAuthRepository implements AuthRepository {
  SupabaseAuthRepository({
    required sb.SupabaseClient supabaseClient,
    required AuthRemoteDataSource remoteDataSource,
    required this.secureStore,
    this.sessionKey = 'ssfi_supabase_persist_session_v1',
  })  : _supabase = supabaseClient,
        _remote = remoteDataSource;

  final sb.SupabaseClient _supabase;
  final AuthRemoteDataSource _remote;
  final SecureKeyValueStore secureStore;
  final String sessionKey;

  @override
  Future<bool> hasActiveSession() async {
    final session = _supabase.auth.currentSession;
    return session != null && session.accessToken.isNotEmpty;
  }

  @override
  Stream<AuthSessionEvent> authEvents() {
    return _supabase.auth.onAuthStateChange.map((data) {
      switch (data.event) {
        case sb.AuthChangeEvent.signedIn:
        case sb.AuthChangeEvent.initialSession:
          return data.session != null
              ? const AuthSessionEvent(AuthSessionEventType.signedIn)
              : const AuthSessionEvent(AuthSessionEventType.signedOut);
        case sb.AuthChangeEvent.tokenRefreshed:
        case sb.AuthChangeEvent.userUpdated:
          return const AuthSessionEvent(AuthSessionEventType.tokenRefreshed);
        case sb.AuthChangeEvent.signedOut:
        case sb.AuthChangeEvent.passwordRecovery:
        case sb.AuthChangeEvent.mfaChallengeVerified:
          return const AuthSessionEvent(AuthSessionEventType.signedOut);
        default:
          return const AuthSessionEvent(AuthSessionEventType.signedOut);
      }
    });
  }

  @override
  Future<void> signInWithPassword({
    required String email,
    required String password,
  }) async {
    try {
      final response = await _supabase.auth.signInWithPassword(
        email: email.trim(),
        password: password,
      );
      if (response.session == null) {
        throw const UnauthorizedFailure('Unable to establish an active session.');
      }
    } on sb.AuthException catch (e) {
      final lower = e.message.toLowerCase();
      if (lower.contains('invalid login credentials') ||
          lower.contains('invalid_credentials')) {
        throw const UnauthorizedFailure('Invalid email or password.');
      }
      if (lower.contains('rate limit') || e.statusCode == '429') {
        throw const RateLimitedFailure();
      }
      throw UnauthorizedFailure(e.message);
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const NetworkFailure();
    }
  }

  @override
  Future<AuthIdentity> fetchAuthoritativeIdentity() {
    return _remote.getMe();
  }

  @override
  Future<AuthIdentity> refreshSessionAndIdentity() async {
    try {
      final refreshed = await _supabase.auth.refreshSession();
      if (refreshed.session == null) {
        throw const UnauthorizedFailure();
      }
    } on sb.AuthException {
      throw const UnauthorizedFailure();
    }
    return _remote.getMe();
  }

  @override
  Future<void> signOut() async {
    try {
      await _supabase.auth.signOut(scope: sb.SignOutScope.local);
    } finally {
      await secureStore.delete(sessionKey);
    }
  }
}
