# AlphaESS BAT-006 PDF asset verification

Do NOT merge or deploy this draft until both missing original PDFs are copied byte-for-byte to these locations. The manifest already records the hashes of the actual user-uploaded PDFs. Never create placeholders.

1. Battery uploaded file: Alpha M-Bat 13.9(1).pdf
   Repository path: assets/battery-quote-documents/alphaess/alphaess-smile-m-bat-13-9p-uploaded.pdf
   Bytes: 406115; SHA-256: a8951936ab300d6a68b7c859f48cfb8c2615b52daa6e8febaee1b42aa93cc51d
   STATUS: MISSING; original upload required.

2. Inverter uploaded file: Datasheet_SMILE-M10_M9_M8-INV_V01_30.06.pdf
   Repository path: assets/battery-quote-documents/alphaess/alphaess-smile-m10-s-inverter-20260630.pdf
   Bytes: 580581; SHA-256: 2af539406c4fdf5a4eba94fcc3bcf7ee5ee727764226e41fc003a8f3a3cb142f
   STATUS: PRESENT; existing GitHub blob was reused byte-for-byte.

3. Warranty uploaded file: Warranty_Terms_Conditions-AU-SMILE-M10-S-INV.pdf
   Repository path: assets/battery-quote-documents/alphaess/alphaess-au-warranty-20260130.pdf
   Bytes: 333100; SHA-256: 619ce8782785e9ff15fc95a617d56101bff3af685d6eb413c4ee9b28a6f47127
   STATUS: MISSING; original upload required.

The prior BAT-006 battery PDF is a different binary (139598 bytes, SHA-256 7bd32fe12b44a1a8534d2a62efeb514e5309ab93bd3afd9ede14465d2ab2b3f8). It stays registered for historic saved quotes only.

After uploading original PDFs:
- Verify exact bytes and SHA-256 checksums and that all three resolve in preview deployment.
- Check Step 2 label/subtitle and 146 STCs.
- Test administrator package price save, refresh, quote totals and staff PDF; leave OOP at 0 until priced.
- Test customer downloads and emailed links with a controlled test recipient.
- Test saved quote reopen and resend for same price/document versions.
- Run npm test before merging.

Database migration: NONE expected. Existing BAT-006 package row and save-package action are reused.

Administrator authentication: the editor reuses the existing DASHBOARD_PASSWORD; no separate battery quotation administrator environment variable is required. Server-issued signed sessions still protect privileged actions.
