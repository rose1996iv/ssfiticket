import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const EXPECTED_PREVIEW_REF = 'jiyuiydzsfydjklosvvq';
const FORBIDDEN_PROD_REF = 'fohpqheglxhfdecadhzw';
const PSQL_PATH = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';

console.log('=== SSFI Phase 9F — Preview System-Wide Read-Only Audit ===');
console.log(`Timestamp: ${new Date().toISOString()}`);

// 1. Verify project identity via Supabase CLI dry-run
const dryRunOutput = execSync(`npx supabase@2.122.0 db dump --linked --project-ref ${EXPECTED_PREVIEW_REF} --dry-run`, {
  encoding: 'utf8'
});

const hostMatch = dryRunOutput.match(/export PGHOST="([^"]+)"/);
const portMatch = dryRunOutput.match(/export PGPORT="([^"]+)"/);
const userMatch = dryRunOutput.match(/export PGUSER="([^"]+)"/);
const passMatch = dryRunOutput.match(/export PGPASSWORD="([^"]+)"/);
const dbMatch = dryRunOutput.match(/export PGDATABASE="([^"]+)"/);

if (!hostMatch || !passMatch) {
  console.error('ERROR: Failed to extract connection details from Supabase CLI dry-run.');
  process.exit(1);
}

const host = hostMatch[1];
const port = portMatch[1] || '5432';
const user = userMatch[1] || 'postgres';
const pass = passMatch[1];
const db = dbMatch[1] || 'postgres';

if (!host.includes(EXPECTED_PREVIEW_REF)) {
  console.error(`SECURITY ERROR: Host ${host} does not match expected Preview ref ${EXPECTED_PREVIEW_REF}`);
  process.exit(1);
}

if (host.includes(FORBIDDEN_PROD_REF)) {
  console.error(`CRITICAL SECURITY VIOLATION: Host ${host} matches Production ref ${FORBIDDEN_PROD_REF}! Aborting immediately.`);
  process.exit(1);
}

console.log(`[PASS] Preview Host Identity Confirmed: ${host} (Ref: ${EXPECTED_PREVIEW_REF})`);
console.log(`[PASS] Production Air-Gap Confirmed: No match with ${FORBIDDEN_PROD_REF}`);

// SQL Query to execute inside a strictly READ ONLY transaction
const sqlQuery = `
BEGIN TRANSACTION READ ONLY;
SET ROLE postgres;

-- 1. All public tables and RLS status
SELECT 
  tablename, 
  rowsecurity AS rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;

-- 2. Storage buckets configuration
SELECT 
  id, 
  name, 
  public, 
  file_size_limit, 
  allowed_mime_types
FROM storage.buckets 
ORDER BY id;

-- 3. Storage RLS policies
SELECT 
  polname, 
  polcmd, 
  polroles::text[] AS roles, 
  pg_get_expr(polqual, polrelid) AS qual,
  pg_get_expr(polwithcheck, polrelid) AS with_check
FROM pg_policy 
WHERE polrelid = 'storage.objects'::regclass 
ORDER BY polname;

-- 4. Public RLS policies count and details by table
SELECT 
  c.relname AS table_name,
  p.polname AS policy_name,
  p.polcmd AS cmd,
  p.polroles::text[] AS roles,
  pg_get_expr(p.polqual, p.polrelid) AS qual,
  pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
ORDER BY c.relname, p.polname;

-- 5. Privileges granted to anon and authenticated on public tables
SELECT 
  table_name, 
  grantee, 
  privilege_type 
FROM information_schema.role_table_grants 
WHERE table_schema = 'public' 
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;

-- 6. SECURITY DEFINER functions in public schema, search_path, and execution privileges
SELECT 
  p.proname AS function_name,
  p.prosecdef AS is_security_definer,
  p.proconfig AS config_settings,
  pg_get_userbyid(p.proowner) AS owner
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    p.proname LIKE '%issue%' 
    OR p.proname LIKE '%verify%' 
    OR p.proname LIKE '%draw%' 
    OR p.proname LIKE '%token%' 
    OR p.proname LIKE '%order%' 
    OR p.proname LIKE '%snapshot%' 
    OR p.proname LIKE '%payment%'
    OR p.proname LIKE '%protect%'
    OR p.prosecdef = true
  )
ORDER BY p.proname;

-- 7. Routine execution privileges for anon and authenticated
SELECT 
  routine_name, 
  grantee, 
  privilege_type 
FROM information_schema.routine_privileges 
WHERE specific_schema = 'public' 
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
  AND routine_name IN (
    'admin_lock_eligibility_snapshot',
    'admin_request_first_prize_approval',
    'admin_record_first_prize_approval',
    'execute_draw_winner_selection',
    'admin_stamp_winner_notification',
    'verify_payment_and_issue',
    'issue_tickets',
    'issue_customer_order_access_token',
    'verify_order_payment_access',
    'consume_order_write_token',
    'protect_draw_results_immutability',
    'protect_order_payment_snapshot'
  )
ORDER BY routine_name, grantee;

-- 8. Triggers in public schema
SELECT 
  c.relname AS table_name,
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- 9. Check system_settings table contents
SELECT * FROM public.system_settings;

-- 10. Sequence parameters for ssfi_ticket_number_sequence
SELECT 
  sequencename, 
  start_value, 
  min_value, 
  max_value, 
  increment_by, 
  cycle, 
  last_value 
FROM pg_sequences 
WHERE schemaname = 'public' 
  AND sequencename = 'ssfi_ticket_number_sequence';

-- 11. Constraints on draw tables
SELECT 
  c.relname AS table_name,
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  con.convalidated AS is_validated,
  pg_get_constraintdef(con.oid) AS constraint_def
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname LIKE 'draw_%'
ORDER BY c.relname, con.conname;

ROLLBACK;
`;

const env = {
  ...process.env,
  PGHOST: host,
  PGPORT: port,
  PGUSER: user,
  PGPASSWORD: pass,
  PGDATABASE: db,
};

const tempDir = path.resolve('supabase/.temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}
const sqlScriptPath = path.resolve(tempDir, 'audit_preview_query.sql');
fs.writeFileSync(sqlScriptPath, sqlQuery);

const result = execSync(`"${PSQL_PATH}" -X -A -F "|" -f "${sqlScriptPath}"`, {
  env,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024
});

fs.unlinkSync(sqlScriptPath);

const outputPath = path.resolve('supabase/.temp/preview_audit_results.txt');
fs.writeFileSync(outputPath, result);
console.log(`[PASS] Read-only audit query completed. Output written to ${outputPath}`);

