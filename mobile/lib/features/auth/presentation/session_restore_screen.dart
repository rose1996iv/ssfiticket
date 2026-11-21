// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../../../shared/widgets/ssfi_brand_header.dart';

/// Shown while restoring a persisted Supabase session and verifying
/// authoritative roles against `GET /api/mobile/v1/me`.
class SessionRestoreScreen extends StatelessWidget {
  const SessionRestoreScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                SsfiBrandHeader(subtitle: 'Verifying secure session...'),
                SizedBox(height: 28),
                CircularProgressIndicator(),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
