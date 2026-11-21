import 'dart:async';

import 'package:dio/dio.dart';

import '../errors/app_failure.dart';

typedef AccessTokenProvider = Future<String?> Function();
typedef SessionRefresher = Future<String?> Function();

/// Dio interceptor that attaches `Authorization: Bearer <access_token>` from
/// the active Supabase session and performs a single serialized refresh retry
/// on HTTP 401 responses without leaking tokens into logs or errors.
class BearerAuthInterceptor extends Interceptor {
  BearerAuthInterceptor({
    required this.dio,
    required this.getAccessToken,
    required this.refreshAccessToken,
    this.onSessionExpired,
  });

  final Dio dio;
  final AccessTokenProvider getAccessToken;
  final SessionRefresher refreshAccessToken;
  final Future<void> Function()? onSessionExpired;

  static const _retryKey = '_ssfi_auth_retried';

  Completer<String?>? _refreshCompleter;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    try {
      // Preserve refreshed Authorization header on 401 retry requests
      if (options.extra[_retryKey] != true) {
        final token = await getAccessToken();
        if (token != null && token.trim().isNotEmpty) {
          options.headers['Authorization'] = 'Bearer ${token.trim()}';
        }
      }
      options.headers['Accept'] = 'application/json';
      handler.next(options);
    } catch (_) {
      handler.next(options);
    }
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final statusCode = err.response?.statusCode;
    final alreadyRetried = err.requestOptions.extra[_retryKey] == true;

    if (statusCode != 401 || alreadyRetried) {
      handler.next(err);
      return;
    }

    final refreshedToken = await _singleFlightRefresh();
    if (refreshedToken == null || refreshedToken.trim().isEmpty) {
      if (onSessionExpired != null) {
        await onSessionExpired!();
      }
      handler.next(err);
      return;
    }

    try {
      final retryOptions = err.requestOptions;
      retryOptions.extra[_retryKey] = true;
      retryOptions.headers['Authorization'] = 'Bearer ${refreshedToken.trim()}';
      final response = await dio.fetch<dynamic>(retryOptions);
      handler.resolve(response);
    } on DioException catch (retryErr) {
      if (retryErr.response?.statusCode == 401 && onSessionExpired != null) {
        await onSessionExpired!();
      }
      handler.next(retryErr);
    }
  }

  Future<String?> _singleFlightRefresh() async {
    if (_refreshCompleter != null) {
      return _refreshCompleter!.future;
    }
    final completer = Completer<String?>();
    _refreshCompleter = completer;
    try {
      final nextToken = await refreshAccessToken();
      completer.complete(nextToken);
      return nextToken;
    } catch (_) {
      completer.complete(null);
      return null;
    } finally {
      _refreshCompleter = null;
    }
  }
}

/// Converts [DioException] into a sanitized [AppFailure], honoring HTTP
/// 400, 401, 403, 404, 409, 422, 429, 503, and `Retry-After` headers.
AppFailure mapDioException(DioException error) {
  final response = error.response;
  if (response == null) {
    return const NetworkFailure();
  }

  final status = response.statusCode;
  final retryAfterRaw = response.headers.value('retry-after');
  final retryAfterSeconds =
      retryAfterRaw != null ? int.tryParse(retryAfterRaw.trim()) : null;

  String? serverMessage;
  final body = response.data;
  if (body is Map<String, dynamic>) {
    final errObj = body['error'];
    if (errObj is Map<String, dynamic> && errObj['message'] is String) {
      serverMessage = (errObj['message'] as String).trim();
    } else if (body['message'] is String) {
      serverMessage = (body['message'] as String).trim();
    }
  }

  switch (status) {
    case 400:
    case 409:
    case 422:
      return ValidationFailure(
        serverMessage?.isNotEmpty == true
            ? serverMessage!
            : 'Please check your input and try again.',
      );
    case 401:
      return UnauthorizedFailure(
        serverMessage?.isNotEmpty == true
            ? serverMessage!
            : 'Your session is invalid or expired. Please sign in again.',
      );
    case 403:
      return ForbiddenFailure(
        serverMessage?.isNotEmpty == true
            ? serverMessage!
            : 'Your account is inactive or unauthorized.',
      );
    case 404:
      return NotFoundFailure(
        serverMessage?.isNotEmpty == true
            ? serverMessage!
            : 'The requested record could not be found.',
      );
    case 429:
      return RateLimitedFailure(
        message: serverMessage?.isNotEmpty == true
            ? serverMessage!
            : 'Too many requests. Please try again later.',
        retryAfterSeconds: retryAfterSeconds,
      );
    case 503:
      return ServiceUnavailableFailure(
        message: serverMessage?.isNotEmpty == true
            ? serverMessage!
            : 'Service temporarily unavailable. Please try again shortly.',
        retryAfterSeconds: retryAfterSeconds,
      );
    default:
      if (status != null && status >= 500) {
        return const ServiceUnavailableFailure();
      }
      return const InvalidResponseFailure();
  }
}

/// Builds a configured [Dio] instance pointing to `/api/mobile/v1`.
Dio createMobileDioClient({
  required String apiBaseUrl,
  required AccessTokenProvider getAccessToken,
  required SessionRefresher refreshAccessToken,
  Future<void> Function()? onSessionExpired,
  HttpClientAdapter? httpClientAdapter,
}) {
  final cleanBase = apiBaseUrl.endsWith('/')
      ? apiBaseUrl.substring(0, apiBaseUrl.length - 1)
      : apiBaseUrl;

  final dio = Dio(
    BaseOptions(
      baseUrl: '$cleanBase/api/mobile/v1',
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 15),
      sendTimeout: const Duration(seconds: 15),
      responseType: ResponseType.json,
    ),
  );

  if (httpClientAdapter != null) {
    dio.httpClientAdapter = httpClientAdapter;
  }

  dio.interceptors.add(
    BearerAuthInterceptor(
      dio: dio,
      getAccessToken: getAccessToken,
      refreshAccessToken: refreshAccessToken,
      onSessionExpired: onSessionExpired,
    ),
  );

  return dio;
}
