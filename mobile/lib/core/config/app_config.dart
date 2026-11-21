/// Runtime environment configuration supplied exclusively via `--dart-define`.
/// Never hardcode Supabase keys, API tokens, or service-role credentials.
class AppConfig {
  const AppConfig({
    required this.apiBaseUrl,
    required this.supabaseUrl,
    required this.supabasePublishableKey,
  });

  factory AppConfig.fromEnvironment() {
    return const AppConfig(
      apiBaseUrl: String.fromEnvironment(
        'API_BASE_URL',
        defaultValue:
            'https://ssfiticket-git-preview-production-mirror-rose1996ivs-projects.vercel.app',
      ),
      supabaseUrl: String.fromEnvironment('SUPABASE_URL'),
      supabasePublishableKey:
          String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY'),
    );
  }

  final String apiBaseUrl;
  final String supabaseUrl;
  final String supabasePublishableKey;

  bool get isSupabaseConfigured =>
      supabaseUrl.trim().isNotEmpty &&
      supabasePublishableKey.trim().isNotEmpty;

  String get normalizedApiBaseUrl =>
      apiBaseUrl.endsWith('/')
          ? apiBaseUrl.substring(0, apiBaseUrl.length - 1)
          : apiBaseUrl;
}
