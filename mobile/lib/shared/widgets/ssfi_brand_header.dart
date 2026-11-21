// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../../app/theme/app_theme.dart';

/// Accessible SSFI Lucky Draw branding header placeholder.
class SsfiBrandHeader extends StatelessWidget {
  const SsfiBrandHeader({
    super.key,
    this.subtitle = 'Official Fundraising Lucky Draw Portal',
  });

  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Semantics(
          label: 'SSFI Lucky Draw emblem',
          child: Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: AppTheme.ssfiCrimson,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppTheme.ssfiGold, width: 2),
            ),
            alignment: Alignment.center,
            child: const Icon(
              Icons.confirmation_number_outlined,
              color: Color(0xFFF3CE75),
              size: 36,
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text(
          'SSFI Lucky Draw',
          style: textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 4),
        Text(
          subtitle,
          style: textTheme.bodyMedium?.copyWith(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}
