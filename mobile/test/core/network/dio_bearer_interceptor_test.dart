import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ssfi_lucky_draw_mobile/core/errors/app_failure.dart';
import 'package:ssfi_lucky_draw_mobile/core/network/dio_client.dart';

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this._handler);

  final Future<ResponseBody> Function(RequestOptions options) _handler;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) =>
      _handler(options);

  @override
  void close({bool force = false}) {}
}

void main() {
  group('BearerAuthInterceptor & HTTP Error Mapping', () {
    test('attaches Bearer JWT header on outgoing requests', () async {
      String? capturedAuth;
      final dio = createMobileDioClient(
        apiBaseUrl: 'https://preview.example.test',
        getAccessToken: () async => 'test.jwt.token',
        refreshAccessToken: () async => null,
        httpClientAdapter: _FakeAdapter((options) async {
          capturedAuth = options.headers['Authorization'] as String?;
          return ResponseBody.fromString(
            jsonEncode({'apiVersion': 'v1', 'data': {}}),
            200,
            headers: {
              Headers.contentTypeHeader: ['application/json'],
            },
          );
        }),
      );

      final res = await dio.get<dynamic>('/me');
      expect(res.statusCode, 200);
      expect(capturedAuth, 'Bearer test.jwt.token');
    });

    test('performs single-flight refresh and retries once on HTTP 401', () async {
      var callCount = 0;
      var refreshCount = 0;
      String? retriedAuth;

      final dio = createMobileDioClient(
        apiBaseUrl: 'https://preview.example.test',
        getAccessToken: () async => 'expired.jwt.token',
        refreshAccessToken: () async {
          refreshCount += 1;
          return 'fresh.jwt.token';
        },
        httpClientAdapter: _FakeAdapter((options) async {
          callCount += 1;
          if (callCount == 1) {
            return ResponseBody.fromString(
              jsonEncode({
                'apiVersion': 'v1',
                'error': {'code': 'UNAUTHORIZED', 'message': 'Expired'},
              }),
              401,
              headers: {
                Headers.contentTypeHeader: ['application/json'],
              },
            );
          }
          retriedAuth = options.headers['Authorization'] as String?;
          return ResponseBody.fromString(
            jsonEncode({'apiVersion': 'v1', 'data': {'ok': true}}),
            200,
            headers: {
              Headers.contentTypeHeader: ['application/json'],
            },
          );
        }),
      );

      final res = await dio.get<dynamic>('/me');
      expect(res.statusCode, 200);
      expect(refreshCount, 1);
      expect(callCount, 2);
      expect(retriedAuth, 'Bearer fresh.jwt.token');
    });

    test('maps 401, 403, 429, and 503 responses to typed AppFailures', () {
      DioException makeErr(
        int status, {
        Map<String, dynamic>? body,
        String? retryAfter,
      }) {
        final req = RequestOptions(path: '/me');
        return DioException(
          requestOptions: req,
          type: DioExceptionType.badResponse,
          response: Response<dynamic>(
            requestOptions: req,
            statusCode: status,
            data: body,
            headers: Headers.fromMap({
              if (retryAfter != null) 'retry-after': [retryAfter],
            }),
          ),
        );
      }

      expect(mapDioException(makeErr(401)), isA<UnauthorizedFailure>());
      expect(mapDioException(makeErr(403)), isA<ForbiddenFailure>());

      final f429 = mapDioException(makeErr(429, retryAfter: '90'));
      expect(f429, isA<RateLimitedFailure>());
      expect((f429 as RateLimitedFailure).retryAfterSeconds, 90);

      final f503 = mapDioException(makeErr(503, retryAfter: '60'));
      expect(f503, isA<ServiceUnavailableFailure>());
      expect((f503 as ServiceUnavailableFailure).retryAfterSeconds, 60);
    });
  });
}
