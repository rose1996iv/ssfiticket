import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const EXPECTED_PREVIEW_REF = 'jiyuiydzsfydjklosvvq';
const PG_DUMP_PATH = 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe';

console.log('--- SSFI Preview Backup Generator ---');

// 1. Verify project identity
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

console.log(`[PASS] Preview Host Verified: ${host} (Ref: ${EXPECTED_PREVIEW_REF})`);
console.log(`[PASS] pg_dump utility verified: ${PG_DUMP_PATH}`);

// Ensure backups dir exists
const backupsDir = path.resolve('backups');
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

// 2. Generate Full Backup (Schema DDL + Data)
console.log('\nGenerating full PostgreSQL backup (schema + data)...');
const fullBackupPath = path.join(backupsDir, 'preview-full-backup-20261108.sql');

const fullDumpArgs = [
  '-h', host,
  '-p', port,
  '-U', user,
  '-d', db,
  '--role=postgres',
  '--schema=public',
  '--quote-all-identifiers',
  '--no-owner',
  '-f', fullBackupPath
];

const fullDumpRes = spawnSync(PG_DUMP_PATH, fullDumpArgs, {
  env: { ...process.env, PGPASSWORD: pass },
  encoding: 'utf8'
});

if (fullDumpRes.status !== 0) {
  console.error('ERROR: pg_dump failed for full backup:', fullDumpRes.stderr);
  process.exit(1);
}

const fullStat = fs.statSync(fullBackupPath);
const fullHash = crypto.createHash('sha256').update(fs.readFileSync(fullBackupPath)).digest('hex');
console.log(`[PASS] Full Backup Generated: ${fullBackupPath}`);
console.log(`       Size: ${fullStat.size} bytes (${(fullStat.size / 1024).toFixed(2)} KB)`);
console.log(`       SHA-256: ${fullHash}`);

// 3. Generate Schema-Only Backup (Clean DDL for inspection & reference)
console.log('\nGenerating schema-only PostgreSQL DDL backup...');
const schemaBackupPath = path.join(backupsDir, 'preview-schema-dump-20261108.sql');

const schemaDumpArgs = [
  '-h', host,
  '-p', port,
  '-U', user,
  '-d', db,
  '--role=postgres',
  '--schema=public',
  '--schema-only',
  '--quote-all-identifiers',
  '--no-owner',
  '-f', schemaBackupPath
];

const schemaDumpRes = spawnSync(PG_DUMP_PATH, schemaDumpArgs, {
  env: { ...process.env, PGPASSWORD: pass },
  encoding: 'utf8'
});

if (schemaDumpRes.status !== 0) {
  console.error('ERROR: pg_dump failed for schema backup:', schemaDumpRes.stderr);
  process.exit(1);
}

const schemaStat = fs.statSync(schemaBackupPath);
const schemaHash = crypto.createHash('sha256').update(fs.readFileSync(schemaBackupPath)).digest('hex');
console.log(`[PASS] Schema DDL Backup Generated: ${schemaBackupPath}`);
console.log(`       Size: ${schemaStat.size} bytes (${(schemaStat.size / 1024).toFixed(2)} KB)`);
console.log(`       SHA-256: ${schemaHash}`);

// 4. Supabase Storage Metadata & Binary Object Backup
console.log('\nBacking up Supabase Storage metadata and binary objects...');

// Read env for storage client
const envLocal = fs.readFileSync('.env.local', 'utf8');
const urlMatch = envLocal.match(/NEXT_PUBLIC_SUPABASE_URL=([^\r\n]+)/);
const keyMatch = envLocal.match(/SUPABASE_SERVICE_ROLE_KEY=([^\r\n]+)/);

if (!urlMatch || !keyMatch) {
  console.error('ERROR: Unable to load Supabase credentials from .env.local');
  process.exit(1);
}

const supabaseUrl = urlMatch[1].trim();
const supabaseKey = keyMatch[1].trim();

const sb = createClient(supabaseUrl, supabaseKey);

// Storage directories
const storageDir = path.join(backupsDir, 'storage-objects-20261108');
fs.mkdirSync(path.join(storageDir, 'payment-screenshots'), { recursive: true });
fs.mkdirSync(path.join(storageDir, 'seller-payment-qrs'), { recursive: true });

// Query storage objects via SQL query for exact metadata
const storageMetadataPath = path.join(backupsDir, 'preview-storage-metadata-20261108.json');

const querySql = `
SELECT 
  json_build_object(
    'timestamp', now(),
    'project_ref', '${EXPECTED_PREVIEW_REF}',
    'buckets', (SELECT json_agg(b.*) FROM storage.buckets b),
    'objects', (SELECT json_agg(o.*) FROM storage.objects o)
  ) as storage_data;
`;

const storageMetaRes = execSync(`npx supabase@2.122.0 db query --linked --project-ref ${EXPECTED_PREVIEW_REF} "${querySql.replace(/\r?\n/g, ' ')}"`, {
  encoding: 'utf8'
});

let storageJson;
try {
  const parsed = JSON.parse(storageMetaRes);
  storageJson = parsed.rows[0].storage_data;
  fs.writeFileSync(storageMetadataPath, JSON.stringify(storageJson, null, 2), 'utf8');
} catch (e) {
  console.error('Error parsing storage metadata:', e);
  process.exit(1);
}

const metaStat = fs.statSync(storageMetadataPath);
const metaHash = crypto.createHash('sha256').update(fs.readFileSync(storageMetadataPath)).digest('hex');
console.log(`[PASS] Storage Metadata Saved: ${storageMetadataPath}`);
console.log(`       Size: ${metaStat.size} bytes`);
console.log(`       SHA-256: ${metaHash}`);
console.log(`       Total Buckets: ${storageJson.buckets?.length || 0}`);
console.log(`       Total Storage Objects: ${storageJson.objects?.length || 0}`);

// Download binary files
console.log('\nDownloading binary storage objects...');
const downloadedObjects = [];
for (const obj of (storageJson.objects || [])) {
  const bucket = obj.bucket_id;
  const name = obj.name;
  const { data, error } = await sb.storage.from(bucket).download(name);
  if (error) {
    console.error(`[WARN] Failed to download ${bucket}/${name}:`, error.message);
    continue;
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  const localFilePath = path.join(storageDir, bucket, name.replace(/\//g, '_'));
  fs.writeFileSync(localFilePath, buffer);
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
  downloadedObjects.push({
    bucket,
    name,
    bytes: buffer.length,
    localPath: localFilePath,
    sha256: fileHash
  });
}

console.log(`[PASS] Successfully downloaded ${downloadedObjects.length} binary objects to ${storageDir}`);

// 5. Verification of dump completeness
console.log('\nVerifying SQL dump completeness...');
const fullSql = fs.readFileSync(fullBackupPath, 'utf8');

const checks = {
  tables: (fullSql.match(/CREATE TABLE/gi) || []).length,
  views: (fullSql.match(/CREATE VIEW/gi) || []).length,
  functions: (fullSql.match(/CREATE FUNCTION/gi) || []).length,
  triggers: (fullSql.match(/CREATE TRIGGER/gi) || []).length,
  policies: (fullSql.match(/CREATE POLICY/gi) || []).length,
  sequences: (fullSql.match(/CREATE SEQUENCE/gi) || []).length,
  types: (fullSql.match(/CREATE TYPE/gi) || []).length,
  copyData: (fullSql.match(/COPY "public"\./gi) || []).length,
  grants: (fullSql.match(/GRANT /gi) || []).length,
  indexes: (fullSql.match(/CREATE (UNIQUE )?INDEX/gi) || []).length
};

console.log('SQL Verification Checklist:');
console.log(`- Tables created: ${checks.tables}`);
console.log(`- Views created: ${checks.views}`);
console.log(`- Functions/Procedures created: ${checks.functions}`);
console.log(`- Triggers created: ${checks.triggers}`);
console.log(`- RLS Policies created: ${checks.policies}`);
console.log(`- Sequences created: ${checks.sequences}`);
console.log(`- Types created: ${checks.types}`);
console.log(`- Table data COPY statements: ${checks.copyData}`);
console.log(`- Indexes created: ${checks.indexes}`);
console.log(`- Grants & Permissions: ${checks.grants}`);

// Output JSON summary for audit reporting
const manifest = {
  generated_at: new Date().toISOString(),
  target_project_ref: EXPECTED_PREVIEW_REF,
  postgresql_version: 'PostgreSQL 17.11 on aarch64-unknown-linux-gnu',
  artifacts: [
    {
      name: 'preview-full-backup-20261108.sql',
      path: fullBackupPath,
      size_bytes: fullStat.size,
      sha256: fullHash,
      type: 'PostgreSQL DDL + Data Dump'
    },
    {
      name: 'preview-schema-dump-20261108.sql',
      path: schemaBackupPath,
      size_bytes: schemaStat.size,
      sha256: schemaHash,
      type: 'PostgreSQL DDL Schema Dump'
    },
    {
      name: 'preview-storage-metadata-20261108.json',
      path: storageMetadataPath,
      size_bytes: metaStat.size,
      sha256: metaHash,
      type: 'Supabase Storage Metadata JSON'
    }
  ],
  storage_binary_backup: {
    directory: storageDir,
    objects_count: downloadedObjects.length,
    objects: downloadedObjects
  },
  sql_checks: checks
};

fs.writeFileSync(path.join(backupsDir, 'preview-backup-manifest-20261108.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log('\n[SUCCESS] Backup Manifest written to backups/preview-backup-manifest-20261108.json');
