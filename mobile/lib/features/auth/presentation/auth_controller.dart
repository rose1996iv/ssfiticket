import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import '../../../core/config/app_config.dart';
import '../../../core/errors/app_failure.dart';
import '../../../core/network/dio_client.dart';
import '../../../core/security/secure_token_storage.dart';
import '../data/auth_remote_datasource.dart';
import '../data/auth_repository_impl.dart';
import '../domain/auth_identity.dart';
import '../domain/auth_repository.dart';
import '../domain/auth_state.dart';

sb.SupabaseClient? _tryGetSupabaseClient() {
  try {
    return sb.Supabase.instance.client;
  } catch (_) {
    return null;
  }
}

final appConfigProvider = Provider<AppConfig>(
  (ref) => AppConfig.fromEnvironment(),
);

final secureKeyValueStoreProvider = Provider<SecureKeyValueStore>(
  (ref) => FlutterSecureKeyValueStore(),
);

final mobileDioProvider = Provider<Dio>((ref) {
  final config = ref.watch(appConfigProvider);
  final supabase = _tryGetSupabaseClient();

  return createMobileDioClient(
    apiBaseUrl: config.normalizedApiBaseUrl,
    getAccessToken: () async => supabase?.auth.currentSession?.accessToken,
    refreshAccessToken: () async {
      if (supabase == null) return null;
      final res = await supabase.auth.refreshSession();
      return res.session?.accessToken;
    },
    onSessionExpired: () async {
      await supabase?.auth.signOut(scope: sb.SignOutScope.local);
    },
  );
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final store = ref.watch(secureKeyValueStoreProvider);
  final supabase = sb.Supabase.instance.client;
  final dio = ref.watch(mobileDioProvider);

  return SupabaseAuthRepository(
    supabaseClient: supabase,
    remoteDataSource: AuthRemoteDataSource(dio),
    secureStore: store,
  );
});

final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);

/// Centralized authentication, session restoration, and authoritative RBAC
/// state controller. Widgets observe [authControllerProvider] and never hold
/// authentication or role-resolution business logic.
class AuthController extends Notifier<AuthState> {
  StreamSubscription<AuthSessionEvent>? _authSub;
  bool _isBusy = false;

  @override
  AuthState build() {
    final repo = ref.watch(authRepositoryProvider);

    _authSub?.cancel();
    _authSub = repo.authEvents().listen(_handleSessionEvent);
    ref.onDispose(() {
      _authSub?.cancel();
    });

    Future<void>.microtask(restoreSession);
    return const AuthInitializing();
  }

  Future<void> restoreSession() async {
    final repo = ref.read(authRepositoryProvider);
    state = const AuthInitializing();
    try {
      final hasSession = await repo.hasActiveSession();
      if (!hasSession) {
        state = const AuthUnauthenticated();
        return;
      }
      await _resolveAndApplyIdentity(repo);
    } on UnauthorizedFailure catch (e) {
      await _safeSignOut(repo);
      state = AuthUnauthenticated(message: e.message);
    } on ForbiddenFailure catch (e) {
      state = AuthUnauthorized(reason: e.message);
    } on AppFailure catch (e) {
      state = AuthNetworkError(failure: e, hasSession: true);
    } catch (_) {
      state = const AuthNetworkError(
        failure: UnknownFailure(),
        hasSession: true,
      );
    }
  }

  Future<AppFailure?> signIn({
    required String email,
    required String password,
  }) async {
    if (_isBusy) return null;
    _isBusy = true;
    final repo = ref.read(authRepositoryProvider);
    try {
      await repo.signInWithPassword(email: email, password: password);
      await _resolveAndApplyIdentity(repo);
      return null;
    } on UnauthorizedFailure catch (e) {
      state = AuthUnauthenticated(message: e.message);
      return e;
    } on ForbiddenFailure catch (e) {
      state = AuthUnauthorized(reason: e.message);
      return e;
    } on AppFailure catch (e) {
      state = AuthNetworkError(failure: e, hasSession: false);
      return e;
    } catch (_) {
      const failure = UnknownFailure();
      state = const AuthNetworkError(failure: failure, hasSession: false);
      return failure;
    } finally {
      _isBusy = false;
    }
  }

  /// Refreshes Supabase session tokens and re-queries `/api/mobile/v1/me`
  /// so server-side role changes take effect immediately.
  Future<void> refreshRoles() async {
    final repo = ref.read(authRepositoryProvider);
    try {
      final identity = await repo.refreshSessionAndIdentity();
      _applyIdentity(identity);
    } on UnauthorizedFailure catch (e) {
      await _safeSignOut(repo);
      state = AuthUnauthenticated(message: e.message);
    } on ForbiddenFailure catch (e) {
      state = AuthUnauthorized(reason: e.message);
    } on AppFailure catch (e) {
      state = AuthNetworkError(failure: e, hasSession: true);
    }
  }

  /// Switches active workspace ONLY if permitted by the authoritative [AuthIdentity].
  bool switchWorkspace(AppWorkspace target) {
    final current = state;
    if (current is! AuthAuthenticated) return false;
    if (!current.identity.canAccessWorkspace(target)) return false;
    state = AuthAuthenticated(
      identity: current.identity,
      activeWorkspace: target,
    );
    return true;
  }

  Future<void> signOut() async {
    final repo = ref.read(authRepositoryProvider);
    await _safeSignOut(repo);
    state = const AuthUnauthenticated();
  }

  Future<void> _resolveAndApplyIdentity(AuthRepository repo) async {
    final identity = await repo.fetchAuthoritativeIdentity();
    _applyIdentity(identity);
  }

  void _applyIdentity(AuthIdentity identity) {
    if (!identity.isAccountActive) {
      state = const AuthUnauthorized(
        reason: 'Your account is currently inactive. Please contact SSFI administration.',
      );
      return;
    }

    final defaultWorkspace = identity.defaultWorkspace;
    if (defaultWorkspace == null) {
      state = const AuthUnauthorized(
        reason: 'Your account does not have an authorized SSFI role assigned.',
      );
      return;
    }

    // Preserve current workspace if still authorized after role refresh
    final current = state;
    final nextWorkspace =
        current is AuthAuthenticated &&
                identity.canAccessWorkspace(current.activeWorkspace)
            ? current.activeWorkspace
            : defaultWorkspace;

    state = AuthAuthenticated(
      identity: identity,
      activeWorkspace: nextWorkspace,
    );
  }

  Future<void> _handleSessionEvent(AuthSessionEvent event) async {
    if (event.type == AuthSessionEventType.signedOut) {
      if (state is! AuthUnauthenticated) {
        state = const AuthUnauthenticated();
      }
    } else if (event.type == AuthSessionEventType.tokenRefreshed &&
        state is AuthAuthenticated) {
      final repo = ref.read(authRepositoryProvider);
      try {
        await _resolveAndApplyIdentity(repo);
      } on UnauthorizedFailure catch (e) {
        await _safeSignOut(repo);
        state = AuthUnauthenticated(message: e.message);
      } on ForbiddenFailure catch (e) {
        state = AuthUnauthorized(reason: e.message);
      } catch (_) {
        // Keep current state on transient background refresh error
      }
    }
  }

  Future<void> _safeSignOut(AuthRepository repo) async {
    try {
      await repo.signOut();
    } catch (_) {
      // Ignore sign-out cleanup failures
    }
  }
}
