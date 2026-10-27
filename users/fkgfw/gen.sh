#!/usr/bin/env bash
set -euo pipefail

# Find flake.nix to determine root directory
ROOT_DIR="$PWD"
while [[ "$ROOT_DIR" != "/" ]]; do
    if [[ -f "$ROOT_DIR/flake.nix" ]]; then
        break
    fi
    ROOT_DIR=$(dirname "$ROOT_DIR")
done

if [[ ! -f "$ROOT_DIR/flake.nix" ]]; then
    echo "Error: Could not find flake.nix in current or parent directories."
    exit 1
fi

TEMPLATE_DIR="$ROOT_DIR/users/fkgfw/services/templates"
SECRETS_DIR="$ROOT_DIR/secrets"

# Certificate CN, Hysteria2 SNI, and Reality handshake target. The target
# must support TLS 1.3 and HTTP/2 and be reachable from the VPS.
TLS_SERVER_NAME="${TLS_SERVER_NAME:-www.cloudflare.com}"

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
    GREEN=$'\033[32m'
    RED=$'\033[31m'
    RESET=$'\033[0m'
else
    GREEN=""
    RED=""
    RESET=""
fi

SINGBOX_SERVER_TEMPLATE="$TEMPLATE_DIR/sing-box-server.jsonc"
MIHOMO_CLIENT_TEMPLATE="$TEMPLATE_DIR/mihomo.yaml"
SINGBOX_CLIENT_TEMPLATE="$TEMPLATE_DIR/sing-box.jsonc"

# Validate templates exist
for f in "$SINGBOX_SERVER_TEMPLATE" "$MIHOMO_CLIENT_TEMPLATE" "$SINGBOX_CLIENT_TEMPLATE"; do
    if [[ ! -f "$f" ]]; then
        echo "Error: Cannot find template file $f" >&2
        exit 1
    fi
done

if [[ ! -f "$SECRETS_DIR/secrets.nix" ]]; then
    echo "Error: Cannot find secrets.nix in $SECRETS_DIR" >&2
    exit 1
fi

sing-box() {
    nix run nixpkgs#sing-box -- "$@"
}

openssl() {
    nix run nixpkgs#openssl -- "$@"
}

# --- Generate VLESS Reality credentials ---
echo "Using TLS/Reality server name: $TLS_SERVER_NAME" >&2
echo "Generating VLESS UUID..." >&2
VLESS_UUID=$(sing-box generate uuid)

echo "Generating VLESS Reality keypair..." >&2
REALITY_OUT=$(sing-box generate reality-keypair)

VLESS_PRIVATEKEY=$(printf '%s\n' "$REALITY_OUT" | sed -nE 's/^(PrivateKey|Private key):[[:space:]]*//p' | head -n 1)
VLESS_PUBLICKEY=$(printf '%s\n' "$REALITY_OUT" | sed -nE 's/^(PublicKey|Public key|Password):[[:space:]]*//p' | head -n 1)

if [[ -z "$VLESS_PRIVATEKEY" || -z "$VLESS_PUBLICKEY" ]]; then
    echo "Error: Failed to extract Reality keys from sing-box output:" >&2
    echo "$REALITY_OUT" >&2
    exit 1
fi

# --- Generate Hysteria2 credentials ---
echo "Generating Hysteria2 password..." >&2
HY2_PASSWORD=$(openssl rand -base64 32)

# --- Generate TUIC credentials ---
echo "Generating TUIC UUID and password..." >&2
TUIC_UUID=$(sing-box generate uuid)
TUIC_PASSWORD=$(openssl rand -base64 32)

echo "Generating self-signed TLS certificate for Hysteria2..." >&2
TMP_CERT=$(mktemp)
TMP_KEY=$(mktemp)
openssl req -x509 -nodes -newkey ec:<(openssl ecparam -name prime256v1) \
    -keyout "$TMP_KEY" -out "$TMP_CERT" -days 3650 \
    -subj "/CN=$TLS_SERVER_NAME" 2>/dev/null

# Get certificate SHA256 fingerprint for mihomo client (hex over DER)
# and sing-box client (base64 over the public key DER, per sing-box
# certificate_public_key_sha256 docs).
FINGERPRINT=$(openssl x509 -noout -fingerprint -sha256 -in "$TMP_CERT" |
    sed 's/.*=//; s/://g; y/ABCDEF/abcdef/')
FINGERPRINT_PUBKEY_B64=$(openssl x509 -noout -pubkey -in "$TMP_CERT" |
    openssl pkey -pubin -outform der |
    openssl dgst -sha256 -binary |
    openssl base64 -A)

# --- Fill templates (without modifying originals) ---
echo "Filling data into templates..." >&2

TMP_SINGBOX_SERVER=$(mktemp)
TMP_SINGBOX_SERVER_CHECK=$(mktemp)
TMP_MIHOMO_CLIENT=$(mktemp)
TMP_SINGBOX_CLIENT=$(mktemp)
trap 'rm -f "$TMP_SINGBOX_SERVER" "$TMP_SINGBOX_SERVER_CHECK" "$TMP_MIHOMO_CLIENT" "$TMP_SINGBOX_CLIENT" "${TMP_CERT:-}" "${TMP_KEY:-}"' EXIT

# Sing-box server config. Comments are stripped so the encrypted file is
# plain JSON and can be validated with `sing-box check`.
sed -e "s|HY2_PASSWORD|$HY2_PASSWORD|" \
    -e "s|TUIC_PASSWORD|$TUIC_PASSWORD|" \
    -e "s|TUIC_UUID|$TUIC_UUID|" \
    -e "s|VLESS_UUID|$VLESS_UUID|" \
    -e "s|VLESS_PRIVATEKEY|$VLESS_PRIVATEKEY|" \
    -e "s|TLS_SERVER_NAME|$TLS_SERVER_NAME|" \
    "$SINGBOX_SERVER_TEMPLATE" | grep -v '^[[:space:]]*//' >"$TMP_SINGBOX_SERVER"

# Validate against the temporary certificate paths. The encrypted config keeps
# the /root paths used on the server.
sed -e "s|/root/.config/sing-box/server.crt|$TMP_CERT|" \
    -e "s|/root/.config/sing-box/server.key|$TMP_KEY|" \
    "$TMP_SINGBOX_SERVER" >"$TMP_SINGBOX_SERVER_CHECK"
sing-box check -c "$TMP_SINGBOX_SERVER_CHECK"

# Mihomo client config. SERVER_IP_OR_DOMAIN is intentionally left for vultr/oracle.
sed -e "s|HY2_PASSWORD|$HY2_PASSWORD|" \
    -e "s|TUIC_PASSWORD|$TUIC_PASSWORD|" \
    -e "s|TUIC_UUID|$TUIC_UUID|" \
    -e "s|FINGERPRINT|$FINGERPRINT|" \
    -e "s|VLESS_UUID|$VLESS_UUID|" \
    -e "s|VLESS_PUBLIC_KEY|$VLESS_PUBLICKEY|" \
    -e "s|TLS_SERVER_NAME|$TLS_SERVER_NAME|" \
    "$MIHOMO_CLIENT_TEMPLATE" >"$TMP_MIHOMO_CLIENT"

# Sing-box client config. Password goes in plain (no URL encoding);
# the cert pin uses the base64 public-key SHA256.
sed -e "s|HY2_PASSWORD|$HY2_PASSWORD|" \
    -e "s|TUIC_PASSWORD|$TUIC_PASSWORD|" \
    -e "s|TUIC_UUID|$TUIC_UUID|" \
    -e "s|FINGERPRINT_PUBKEY_B64|$FINGERPRINT_PUBKEY_B64|" \
    -e "s|VLESS_UUID|$VLESS_UUID|" \
    -e "s|VLESS_PUBLIC_KEY|$VLESS_PUBLICKEY|" \
    -e "s|TLS_SERVER_NAME|$TLS_SERVER_NAME|" \
    "$SINGBOX_CLIENT_TEMPLATE" | grep -v '^[[:space:]]*//' >"$TMP_SINGBOX_CLIENT"

# The client template uses sing-box 1.14 fields, so do not validate it with
# the stable sing-box that gen.sh uses for the server config.

# --- Encrypt with agenix ---
cd "$SECRETS_DIR"

echo "Encrypting sing-box-server.age..." >&2
rm -f sing-box-server.age
nix run github:ryantm/agenix -- -e sing-box-server.age <"$TMP_SINGBOX_SERVER" >&2

echo "Encrypting sing-box-cert.age..." >&2
rm -f sing-box-cert.age
nix run github:ryantm/agenix -- -e sing-box-cert.age <"$TMP_CERT" >&2

echo "Encrypting sing-box-key.age..." >&2
rm -f sing-box-key.age
nix run github:ryantm/agenix -- -e sing-box-key.age <"$TMP_KEY" >&2

echo "" >&2
echo "=============================================" >&2
echo "All server configs generated and encrypted:" >&2
echo "  1. $SECRETS_DIR/sing-box-server.age" >&2
echo "  2. $SECRETS_DIR/sing-box-cert.age" >&2
echo "  3. $SECRETS_DIR/sing-box-key.age" >&2
echo "=============================================" >&2
echo "" >&2
echo "${RED}These commands rotate every proxy credential.${RESET}" >&2
echo "${RED}Update the client with the config printed below.${RESET}" >&2

echo "${GREEN}========== MIHOMO CONFIG START ==========${RESET}"
cat "$TMP_MIHOMO_CLIENT"
echo "${GREEN}=========== MIHOMO CONFIG END ===========${RESET}"
echo "${RED}Save the mihomo config between the green markers as mihomo.yaml.${RESET}"
echo "${RED}Replace SERVER_IP_OR_DOMAIN with IP/domain before using it.${RESET}"
echo "${RED}Import mihomo.yaml into mihomo/Clash Meta, or start mihomo with this config file.${RESET}"

echo "" >&2
echo "${GREEN}========== SING-BOX CONFIG START ==========${RESET}"
cat "$TMP_SINGBOX_CLIENT"
echo "${GREEN}=========== SING-BOX CONFIG END ===========${RESET}"
echo "${RED}Copy the sing-box config between the green markers to /etc/sing-box/config.json.${RESET}"
echo "${RED}Replace SERVER_IP_OR_DOMAIN with the VPS IP/domain first.${RESET}"
echo "${RED}Then run: sudo sing-box check -c /etc/sing-box/config.json && sudo systemctl restart sing-box${RESET}"
