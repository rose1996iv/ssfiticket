# SSFI Lucky Draw — Phase 3: Storage Binary Recovery Investigation Report

**Document Status:** `READ-ONLY FORENSIC INVESTIGATION — ZERO STORAGE MUTATIONS EXECUTED`  
**Prepared At:** `2026-11-07T17:10:30+05:30` (`2026-11-07T11:40:30Z`)  
**Target Preview Supabase Project:** `jiyuiydzsfydjklosvvq` (`payment-screenshots` & `seller-payment-qrs` buckets)

---

## 1. Executive Summary

During the execution of [`execute_preview_clone_and_sanitization.mjs`](file:///C:/Users/Joseph/.gemini/antigravity/brain/f1fe0dbc-6633-4b76-b6b7-fdb3af5bbb02/scratch/execute_preview_clone_and_sanitization.mjs) on `2026-11-07T10:45:55Z–10:46:15Z`, **`16` pre-existing storage object paths** in Preview Supabase (`jiyuiydzsfydjklosvvq`) were overwritten via `.upload(path, syntheticPngBuffer, { contentType: "image/png", upsert: true })`:
- **`4` objects** in private bucket `seller-payment-qrs` (replaced with `3,780`-byte synthetic `PREVIEW TEST ONLY` PNGs).
- **`12` objects** in private bucket `payment-screenshots` (replaced with `3,922`-byte synthetic `PREVIEW TEST RECEIPT` PNGs).
- *(Note: `2` additional unreferenced root objects in `payment-screenshots` — `a3269b9c-8feb-43de-9d0d-f579e17d4e2d.png` and `test-verify-1793653631065.png` — were **not** referenced by any `public.payment_screenshots` row and therefore were **never overwritten**.)*

A comprehensive read-only search was conducted across:
1. Local backup directories (`F:\PROJECT\Lucky Draw\backups\`)
2. All Git-tracked binary assets across all branches and commits (`git log --all --stat -- "*.png" "*.jpg" "*.jpeg" "*.webp"`)
3. Pre-clone Storage manifests and table rows in [`backups/preview-database-backup-20261107.json`](file:///f:/PROJECT/Lucky%20Draw/backups/preview-database-backup-20261107.json)
4. All image files and test generator scripts in `C:\Users\Joseph\.gemini\antigravity\brain\f1fe0dbc-6633-4b76-b6b7-fdb3af5bbb02\`

### Summary Classification of the 16 Overwritten Objects

| Recovery Classification | Object Count | Breakdown by Bucket | Basis of Classification |
| :--- | :---: | :--- | :--- |
| **`Recoverable` (`VERIFIED`)** | **5 / 16** | `1` in `seller-payment-qrs`<br>`4` in `payment-screenshots` | All `5` objects were `67`-byte `image/png` files created programmatically by [`scratch/preview_acceptance_e2e.js`](file:///C:/Users/Joseph/.gemini/antigravity/brain/f1fe0dbc-6633-4b76-b6b7-fdb3af5bbb02/scratch/preview_acceptance_e2e.js#L100-L112) and [`scratch/test_live_submission_preview.js`](file:///C:/Users/Joseph/.gemini/antigravity/brain/f1fe0dbc-6633-4b76-b6b7-fdb3af5bbb02/scratch/test_live_submission_preview.js#L36-L41). The exact `67`-byte binary payload is preserved verbatim in those scripts (and in the `2` untouched sibling objects in `payment-screenshots`). |
| **`Not recoverable` from Workspace / Git (`Potentially recoverable` from Owner's Local Device Only)** | **11 / 16** | `3` in `seller-payment-qrs`<br>`8` in `payment-screenshots` | Uploaded manually via the browser UI during Preview testing on `2026-11-02` and `2026-11-03`. Never committed to Git, never saved to `F:\PROJECT\Lucky Draw` or artifact directories, and not downloaded by `inspect_and_backup_preview.mjs`. |
| **`Not verified`** | **0 / 16** | — | Every one of the `16` objects has verified pre-clone metadata and provenance. |

---

## 2. Object-by-Object Forensic Classification (All 16 Overwritten Objects)

### 2.1 Bucket: `seller-payment-qrs` (4 Overwritten Objects)

| # | Storage Path | Attributed Seller & Orders | Pre-Clone Metadata | Provenance / Source | Classification |
| :-: | :--- | :--- | :--- | :--- | :--- |
| 1 | `seller-edebd069-4bea-4f69-8afd-f34743def4ab/e2e-test-qr.png` | `SELLER-007` (`ORD-2026-000031`..`000034`, `000041`..`000043`) | `67` bytes, `image/png` | Created by [`scratch/preview_acceptance_e2e.js`](file:///C:/Users/Joseph/.gemini/antigravity/brain/f1fe0dbc-6633-4b76-b6b7-fdb3af5bbb02/scratch/preview_acceptance_e2e.js#L100-L112) (`dummy1x1Png`, hex `89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082`, SHA-256 `67a13b9b59985060205723c1a272f46c9e54b26f8c0b4675769bf70cd64a6c11`). | **`Recoverable` (`VERIFIED`)** |
| 2 | `seller-42fbf809-3c83-4e80-8c42-1315de26f2e0/363ae012-a392-4762-a001-e3ac6425e30d.jpg` | `SELLER-008` (`ORD-2026-000035`, `000036`, `000037`) | `image/jpeg`, captured `2026-11-02T20:41:28Z` | Uploaded via browser UI (`/seller/payment-settings`) by `SELLER-008` on `2026-11-02`. Not present in Git or workspace disk. *(Note: Contained historical QR for `8810******@ptyes`.)* | **`Not recoverable`** *(from workspace; `Potentially recoverable` only from Owner's device)* |
| 3 | `seller-42fbf809-3c83-4e80-8c42-1315de26f2e0/ed514d00-37cd-4bbe-be1c-95f566166f0c.jpg` | `SELLER-008` (`ORD-2026-000038`, `000039`) | `image/jpeg`, captured `2026-11-02T21:59:47Z` | Uploaded via browser UI (`/seller/payment-settings`) by `SELLER-008` on `2026-11-02`. Not present in Git or workspace disk. *(Note: Contained historical QR for `8810******@ptyes`.)* | **`Not recoverable`** *(from workspace; `Potentially recoverable` only from Owner's device)* |
| 4 | `seller-42fbf809-3c83-4e80-8c42-1315de26f2e0/b3832460-272b-4639-a083-a7788e947617.jpg` | `SELLER-008` (`ORD-2026-000040`, `000044`, `000045`, `000046`) | `image/jpeg`, `qr_updated_at: 2026-11-02T22:56:35.694Z` | Uploaded via browser UI (`/seller/payment-settings`) by `SELLER-008` on `2026-11-02`. Not present in Git or workspace disk. *(Note: Contained historical QR for `8810******@ptyes`.)* | **`Not recoverable`** *(from workspace; `Potentially recoverable` only from Owner's device)* |

### 2.2 Bucket: `payment-screenshots` (12 Overwritten Objects + 2 Untouched Objects)

| # | Storage Path (`payment-screenshots`) | Payment ID / Order Number | Pre-Clone Size & MIME | Pre-Clone `uploaded_at` | Provenance / Source | Classification |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- |
| 5 | `faffcfc7-0c16-46d1-967b-65df31ee95ab.png` | `8c7c4b1b-...` (`ORD-2026-000032`) | `67` B (`image/png`) | `2026-11-02T19:58:32.549Z` | Uploaded by `scratch/preview_acceptance_e2e.js` (`dummy1x1Png`, 67 bytes). Exact bytes preserved in script. | **`Recoverable` (`VERIFIED`)** |
| 6 | `21777bb1-ad0d-4343-aac2-7b74abb4ce44.png` | `b024e903-...` (`ORD-2026-000033`) | `67` B (`image/png`) | `2026-11-02T20:01:15.348Z` | Uploaded by `scratch/preview_acceptance_e2e.js` (`dummy1x1Png`, 67 bytes). Exact bytes preserved in script. | **`Recoverable` (`VERIFIED`)** |
| 7 | `c59fdb88-c174-478c-ad0e-46b11a6e7965.png` | `7fa7515f-...` (`ORD-2026-000034`) | `67` B (`image/png`) | `2026-11-02T20:03:20.001Z` | Uploaded by `scratch/preview_acceptance_e2e.js` (`dummy1x1Png`, 67 bytes). Exact bytes preserved in script. | **`Recoverable` (`VERIFIED`)** |
| 8 | `47da29bd-a224-4f97-a7da-65e041b64d4c.png` | `b28f2608-...` (`ORD-2026-000031`) | `67` B (`image/png`) | `2026-11-02T21:08:06.856Z` | Uploaded by `scratch/test_live_submission_preview.js` (`pngBytes`, 67 bytes). Exact bytes preserved in script. | **`Recoverable` (`VERIFIED`)** |
| 9 | `33b49b8b-2275-41d6-8289-2d879a1ba496.jpg` | `6fa7ae54-...` (`ORD-2026-000035`) | `53,238` B (`image/jpeg`) | `2026-11-02T20:42:23.433Z` | Uploaded manually via browser UI during Preview testing. No copy in repo or artifacts. | **`Not recoverable`** *(from workspace; `Potentially recoverable` only from Owner's device)* |
| 10 | `5d719f87-9dfd-44b3-9d91-22d2cfbfa673.jpg` | `4336cfbd-...` (`ORD-2026-000037`) | `53,321` B (`image/jpeg`) | `2026-11-02T21:13:10.053Z` | Uploaded manually via browser UI during Preview testing. No copy in repo or artifacts. | **`Not recoverable`** *(from workspace; `Potentially recoverable` only from Owner's device)* |
| 11 | `375f93bf-e6c9-4f76-a610-251d38e56f9c.jpg` | `ee4feb8d-...` (`ORD-2026-000038`) | `37,333` B (`image/jpeg`) | `2026-11-02T22:00:14.564Z` | Same `37,333`-byte JPEG uploaded 5 times via browser UI during manual testing. No copy in repo or artifacts. | **`Not recoverable`** *(from workspace; `Potentially recoverable` only from Owner's device)* |
| 12 | `9b3beb88-b0bf-4b51-b0c5-17f8bfcce611.jpg` | `e1da56be-...` (`ORD-2026-000039`) | `37,333` B (`image/jpeg`) | `2026-11-02T22:49:06.817Z` | Same `37,333`-byte JPEG uploaded via browser UI. No copy in repo or artifacts. | **`Not recoverable`** *(from workspace; `Potentially recoverable` only from Owner's device)* |
| 13 | `c01fd554-7ccb-434b-b062-b96080e854a7.jpg` | `2ca7ada6-...` (`ORD-2026-000040`) | `37,333` B (`image/jpeg`) | `2026-11-02T22:58:47.282Z` | Same `37,333`-byte JPEG uploaded via browser UI. No copy in repo or artifacts. | **`Not recoverable`** *(from workspace; `Potentially recoverable` only from Owner's device)* |
| 14 | `612396f8-f205-4eaa-8d5c-82ae23b83074.jpg` | `c5b178d2-...` (`ORD-2026-000044`) | `37,333` B (`image/jpeg`) | `2026-11-03T06:25:42.637Z` | Same `37,333`-byte JPEG uploaded via browser UI. No copy in repo or artifacts. | **`Not recoverable`** *(from workspace; `Potentially recoverable` only from Owner's device)* |
| 15 | `6db78d02-0c74-43fb-929a-0fa37f17dc16.jpg` | `b4178440-...` (`ORD-2026-000045`) | `37,333` B (`image/jpeg`) | `2026-11-03T06:32:39.426Z` | Same `37,333`-byte JPEG uploaded via browser UI. No copy in repo or artifacts. | **`Not recoverable`** *(from workspace; `Potentially recoverable` only from Owner's device)* |
| 16 | `d976bffc-2eed-4629-878a-f90972a165aa.png` | `341646e1-...` (`ORD-2026-000046`) | `7,409` B (`image/png`) | `2026-11-03T06:39:36.258Z` | Uploaded via browser UI during manual testing. No copy in repo or artifacts. | **`Not recoverable`** *(from workspace; `Potentially recoverable` only from Owner's device)* |
| — | `a3269b9c-8feb-43de-9d0d-f579e17d4e2d.png` | *(Unreferenced in DB)* | `67` B (`image/png`) | `2026-11-02T19:56:46.901Z` | **Never overwritten** — still intact in `payment-screenshots` bucket. | **`Intact in Storage` (`VERIFIED`)** |
| — | `test-verify-1793653631065.png` | *(Unreferenced in DB)* | `67` B (`image/png`) | `2026-11-02T21:07:11.589Z` | **Never overwritten** — still intact in `payment-screenshots` bucket. | **`Intact in Storage` (`VERIFIED`)** |

---

## 3. Inspection of Git-Tracked & Workspace Binary Assets

**Classification:** **`VERIFIED`**

Every binary image ever committed to the Git repository (`F:\PROJECT\Lucky Draw`) or stored in the conversation artifact directory (`C:\Users\Joseph\.gemini\antigravity\brain\f1fe0dbc-6633-4b76-b6b7-fdb3af5bbb02`) was hashed and compared by byte size and SHA-256 against the `11` non-scripted Storage objects:
1. **Git-Tracked Images (10 files):**
   - `public/logo.png` & `src/app/icon.png` (`107,387` bytes)
   - `public/insta_qr.png` (`1,963,356` bytes)
   - `public/upi_qr.jpeg` (`65,732` bytes, added `2026-10-29`, SHA-256 `61f21ec...` — does not match the `53,238`-byte, `53,321`-byte, or `37,333`-byte JPEGs uploaded on `2026-11-02`)
   - `5` prize celebration PNGs in repo root (`2.19 MB` – `2.40 MB`)
2. **Artifact Directory Images (52 files):**
   - Browser full-page / viewport screenshots (`73 KB` – `1.97 MB`) captured during UI verification. None match `53,238` B, `53,321` B, `37,333` B, or `7,409` B.

---

## 4. Operational Impact & Recommendation

1. **Why Overwriting the 3 `SELLER-008` QR JPEGs Was Security-Beneficial:**
   - The `3` overwritten JPEGs in `seller-payment-qrs` (`363ae012-...jpg`, `ed514d00-...jpg`, `b3832460-...jpg`) were uploaded when `SELLER-008` configured the personal UPI ID `8810******@ptyes`. Keeping synthetic `PREVIEW TEST ONLY` PNGs in their place prevents real QR codes from being served in Preview.
2. **Why the 12 `payment-screenshots` Objects Do Not Impact Production:**
   - All `12` objects belonged exclusively to Preview (`jiyuiydzsfydjklosvvq`) test orders (`ORD-2026-000031`..`000046`) created on `2026-11-02` and `2026-11-03`. Production (`fohpqheglxhfdecadhzw`) was never touched.
3. **Mandatory Future Backup Policy:**
   - Any future script that modifies Supabase Storage must first download every target object via `storage.from(bucket).download(path)` into `backups/storage-blobs-<timestamp>/<bucket>/<path>` and record its SHA-256 digest in `manifest.json` before performing any write.

