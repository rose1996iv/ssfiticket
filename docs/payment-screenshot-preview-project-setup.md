# Preview Supabase Project Identity Setup

This guide prepares a future, authorized Preview verification. It does not link a project, change configuration, or perform a remote operation.

## Find the project reference

1. Sign in to the Supabase Dashboard using the organization that owns the **non-production** environment.
2. Open the intended project and copy the project reference shown in **Project Settings → General**. It is also the opaque identifier in the Dashboard project URL (`/project/<project-ref>`).
3. Record the reference in the approved environment inventory or provide it directly to the authorized operator. Do not put access tokens, database connection strings, or service-role keys in an issue, chat, committed file, or screenshot.

## Prove that the project is Preview

A display name alone is not evidence of an environment. Before any remote command, independently compare the candidate project with the approved Preview inventory:

- Supabase organization/account and project reference must match the known Preview record.
- The application URL and Vercel environment must be the Preview/test URL, not the production domain.
- Project owners should confirm it contains only the intended non-production test data and is not the Production project.
- Use a read-only dashboard/API/CLI check first; do not make a mutation merely to test access.

If any of those checks is unavailable or conflicts, stop. Treat the project as unverified and keep migrations blocked.

## Local configuration boundaries

The current `supabase/config.toml` has `project_id = "Lucky_Draw"`. This is the local Supabase CLI project label, not a hosted Supabase project reference. Do **not** replace it with a cloud project reference to try to identify Preview.

The application reads `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY` from local environment files. Keep real values in an ignored local/Preview environment source, never `.env.example` or a committed file. A project reference is not a credential; if an operator needs a tracked nonsecret deployment inventory, it should be stored in the organization’s approved secret/configuration system, not inferred from these variables.

After the Supabase CLI is deliberately installed by an authorized operator, enter the verified reference only through the CLI's explicit link workflow, for example:

```powershell
supabase link --project-ref <verified-preview-project-ref>
```

Run that command only after the identity checks above. Do not run it as part of this guide, and do not run `db push`, `db reset`, or a migration command afterward without separate authorization. CLI linkage metadata is environment-specific and should not be used to point this workspace at Production.

## Safe preflight for future remote operations

Before any future read-only schema inspection:

1. Reconfirm the project reference with the approved Preview inventory.
2. Confirm the selected account/session has the intended read-only scope or obtain an operator-mediated read-only report.
3. Verify the current Vercel/app environment resolves to Preview and does not use Production URLs or credentials.
4. Read only migration history, schema metadata, bucket metadata, and policies; do not select customer data or storage objects.
5. Have a second reviewer confirm the displayed project reference before a separately authorized migration or integration test.

For the payment screenshot feature, do not proceed past this preflight until the Preview reference, migration history through `202611011100_payment_recovery_tokens.sql`, and the target environment designation are all verified.

## Secret-handling checklist

- Never echo, paste, log, commit, or screenshot service-role keys, access tokens, database passwords, or full connection strings.
- Keep `.env.local` and any Preview-only environment file untracked.
- Use secret managers or Vercel/Supabase environment settings for sensitive values.
- Redact credentials from terminal output and review `git diff` before any future commit.
