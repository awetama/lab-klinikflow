#!/usr/bin/env bash
# PoC F-03: endpoint pasien/kunjungan/tagihan tanpa autentikasi.
# Pemakaian: BASE=http://localhost:3000 ./02_unauth_pii.sh
set -euo pipefail
BASE="${BASE:-http://localhost:3000}"

for path in /api/patients /api/visits /api/invoices; do
  echo "=== GET $path (tanpa token) ==="
  curl -s -o /tmp/kf_poc.json -w "status HTTP %{http_code}\n" "$BASE$path"
  head -c 300 /tmp/kf_poc.json; echo; echo
done
