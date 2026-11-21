import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Abstraction for hardware-backed key-value storage so session persistence
/// can be unit-tested cleanly without platform channels.
abstract interface class SecureKeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
  Future<bool> containsKey(String key);
}

/// Production implementation backed by [FlutterSecureStorage] (Android Keystore).
class FlutterSecureKeyValueStore implements SecureKeyValueStore {
  FlutterSecureKeyValueStore({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);

  @override
  Future<bool> containsKey(String key) => _storage.containsKey(key: key);
}

/// Supabase [LocalStorage] adapter storing auth session tokens exclusively in
/// [SecureKeyValueStore] rather than SharedPreferences.
class SecureSupabaseLocalStorage extends LocalStorage {
  SecureSupabaseLocalStorage(
    this._store, {
    this.sessionKey = 'ssfi_supabase_persist_session_v1',
  });

  final SecureKeyValueStore _store;
  final String sessionKey;

  @override
  Future<void> initialize() async {}

  @override
  Future<bool> hasAccessToken() => _store.containsKey(sessionKey);

  @override
  Future<String?> accessToken() => _store.read(sessionKey);

  @override
  Future<void> persistSession(String persistSessionString) =>
      _store.write(sessionKey, persistSessionString);

  @override
  Future<void> removePersistedSession() => _store.delete(sessionKey);
}
