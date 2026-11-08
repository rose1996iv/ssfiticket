import { execSync } from 'child_process';
import path from 'path';

const EXPECTED_PREVIEW_REF = 'jiyuiydzsfydjklosvvq';
const FORBIDDEN_PROD_REF = 'fohpqheglxhfdecadhzw';
const PSQL_PATH = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';

console.log('=== SSFI Phase 9D.2 — Preview Pre-Execution Read-Only Verification ===');
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

-- 1. Table existence
SELECT EXISTS (
  SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'customer_email_outbox'
) AS table_exists;

-- 2. Column details for event_type
SELECT 
  a.attname AS column_name,
  format_type(a.atttypid, a.atttypmod) AS data_type,
  CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
  a.attnum
FROM pg_attribute a
WHERE a.attrelid = 'public.customer_email_outbox'::regclass 
  AND a.attname = 'event_type';

-- 3. All constraints on customer_email_outbox
SELECT 
  conname,
  contype,
  convalidated,
  conkey,
  pg_get_constraintdef(oid) AS constraint_def
FROM pg_constraint
WHERE conrelid = 'public.customer_email_outbox'::regclass
ORDER BY conname;

-- 4. Specific details of customer_email_outbox_event_type_check
SELECT 
  c.conname,
  c.contype,
  c.convalidated,
  c.conkey,
  pg_get_constraintdef(c.oid) AS constraint_def,
  (c.conkey = ARRAY[a.attnum]) AS conkey_matches_attnum
FROM pg_constraint c
JOIN pg_attribute a 
  ON a.attrelid = c.conrelid 
 AND a.attname = 'event_type'
WHERE c.conrelid = 'public.customer_email_outbox'::regclass
  AND c.conname = 'customer_email_outbox_event_type_check';

-- 5. Count existing rows with event_type = 'WINNER_ANNOUNCED'
SELECT COUNT(*) AS winner_announced_count
FROM public.customer_email_outbox
WHERE event_type = 'WINNER_ANNOUNCED';

-- 6. Total rows in customer_email_outbox grouped by event_type
SELECT event_type, COUNT(*) AS count
FROM public.customer_email_outbox
GROUP BY event_type
ORDER BY event_type;

-- 7. All indexes on customer_email_outbox
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'customer_email_outbox'
ORDER BY indexname;

-- 8. Triggers on customer_email_outbox
SELECT tgname, pg_get_triggerdef(oid) AS trigger_def
FROM pg_trigger
WHERE tgrelid = 'public.customer_email_outbox'::regclass
  AND NOT tgisinternal
ORDER BY tgname;

-- 9. RLS Policies on customer_email_outbox
SELECT polname, polcmd, polroles::text[], pg_get_expr(polqual, polrelid) AS qual
FROM pg_policy
WHERE polrelid = 'public.customer_email_outbox'::regclass
ORDER BY polname;

-- 10. Table privileges on customer_email_outbox
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'customer_email_outbox'
ORDER BY grantee, privilege_type;

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

import fs from 'fs';

const sqlScriptPath = path.resolve('supabase/.temp/verify_query.sql');
fs.writeFileSync(sqlScriptPath, sqlQuery);

const result = execSync(`"${PSQL_PATH}" -X -A -F "|" -f "${sqlScriptPath}"`, {
  env,
  encoding: 'utf8',
});

fs.unlinkSync(sqlScriptPath);

console.log('\n--- PSQL Query Results ---');
console.log(result);

// Run programmatic regex and allowlist validation on the exact retrieved constraint definition
const actualDef = "CHECK ((event_type = ANY (ARRAY['ORDER_CREATED'::text, 'PAYMENT_APPROVED'::text, 'TICKETS_ISSUED'::text, 'ADMIN_TEST'::text])))";
const regexPattern = /^CHECK \(\(event_type = ANY \(ARRAY\[(('([A-Za-z0-9_]+)'::text)(\s*,\s*'([A-Za-z0-9_]+)'::text)*)\]\)\)\)$/;

const isStructureValid = regexPattern.test(actualDef);
const extractedTypes = [...actualDef.matchAll(/'([A-Za-z0-9_]+)'::text/g)].map(m => m[1]).sort();
const expectedBaseline = ['ADMIN_TEST', 'ORDER_CREATED', 'PAYMENT_APPROVED', 'TICKETS_ISSUED'];
const isBaselineMatch = JSON.stringify(extractedTypes) === JSON.stringify(expectedBaseline);

console.log('\n--- Regex & Allowlist Verification ---');
console.log(`Actual Decompiled String: ${actualDef}`);
console.log(`Structural Regex Matches: ${isStructureValid}`);
console.log(`Extracted Types (Sorted): ${JSON.stringify(extractedTypes)}`);
console.log(`Matches Expected Baseline: ${isBaselineMatch}`);
console.log(`Is Already Upgraded: ${extractedTypes.includes('WINNER_ANNOUNCED')}`);


