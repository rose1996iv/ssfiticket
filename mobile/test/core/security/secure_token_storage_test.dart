import 'package:flutter_test/flutter_test.dart';
import 'package:ssfi_lucky_draw_mobile/core/security/secure_token_storage.dart';

class _InMemorySecureStore implements SecureKeyValueStore {
  final Map<String, String> _data = {};

  @override
  Future<bool> containsKey(String key) async => _data.containsKey(key);

  @override
  Future<void> delete(String key) async => _data.remove(key);

  @override
  Future<String?> read(String key) async => _data[key];

  @override
  Future<void> write(String key, String value) async => _data[key] = value;
}

void main() {
  test('SecureSupabaseLocalStorage persists, reads, and deletes session via SecureKeyValueStore', () async {
    final store = _InMemorySecureStore();
    final localStorage = SecureSupabaseLocalStorage(store);

    await localStorage.initialize();
    expect(await localStorage.hasAccessToken(), isFalse);
    expect(await localStorage.accessToken(), isNull);

    await localStorage.persistSession('{"access_token":"synthetic"}');
    expect(await localStorage.hasAccessToken(), isTrue);
    expect(await localStorage.accessToken(), '{"access_token":"synthetic"}');

    await localStorage.removePersistedSession();
    expect(await localStorage.hasAccessToken(), isFalse);
    expect(await localStorage.accessToken(), isNull);
  });
}
