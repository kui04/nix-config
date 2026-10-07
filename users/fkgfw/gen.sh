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

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
    GREEN=$'\033[32m'
    RED=$'\033[31m'
    RESET=$'\033[0m'
else
    GREEN=""
    RED=""
    RESET=""
fi

XRAY_SERVER_TEMPLATE="$TEMPLATE_DIR/xray.jsonc"
HY2_SERVER_TEMPLATE="$TEMPLATE_DIR/hy2.yaml"
MIHOMO_CLIENT_TEMPLATE="$TEMPLATE_DIR/mihomo.yaml"
SINGBOX_CLIENT_TEMPLATE="$TEMPLATE_DIR/sing-box.jsonc"

# Validate templates exist
for f in "$XRAY_SERVER_TEMPLATE" "$HY2_SERVER_TEMPLATE" "$MIHOMO_CLIENT_TEMPLATE" "$SINGBOX_CLIENT_TEMPLATE"; do
    if [[ ! -f "$f" ]]; then
        echo "Error: Cannot find template file $f" >&2
        exit 1
    fi
done

if [[ ! -f "$SECRETS_DIR/secrets.nix" ]]; then
    echo "Error: Cannot find secrets.nix in $SECRETS_DIR" >&2
    exit 1
fi

# --- Generate Xray credentials ---
echo "Generating Xray UUID..." >&2
VLESS_UUID=$(nix run nixpkgs#xray -- uuid)

echo "Generating Xray X25519 keys..." >&2
X25519_OUT=$(nix run nixpkgs#xray -- x25519)

VLESS_PRIVATEKEY=$(printf '%s\n' "$X25519_OUT" | sed -nE 's/^(PrivateKey|Private key):[[:space:]]*//p' | head -n 1)
VLESS_PUBLICKEY=$(printf '%s\n' "$X25519_OUT" | sed -nE 's/^(PublicKey|Public key|Password):[[:space:]]*//p' | head -n 1)

if [[ -z "$VLESS_PRIVATEKEY" || -z "$VLESS_PUBLICKEY" ]]; then
    echo "Error: Failed to extract X25519 keys from xray output:" >&2
    echo "$X25519_OUT" >&2
    exit 1
fi

# --- Generate Hysteria2 credentials ---
echo "Generating Hysteria2 password..." >&2
HY2_PASSWORD=$(nix run nixpkgs#openssl -- rand -base64 32)

echo "Generating self-signed TLS certificate for Hysteria2..." >&2
TMP_CERT=$(mktemp)
TMP_KEY=$(mktemp)
nix run nixpkgs#openssl -- req -x509 -nodes -newkey ec:<(nix run nixpkgs#openssl -- ecparam -name prime256v1) \
    -keyout "$TMP_KEY" -out "$TMP_CERT" -days 3650 \
    -subj "/CN=www.bing.com" 2>/dev/null

# Get certificate SHA256 fingerprint for mihomo client (hex over DER)
# and sing-box client (base64 over the public key DER, per sing-box
# certificate_public_key_sha256 docs).
FINGERPRINT=$(nix run nixpkgs#openssl -- x509 -noout -fingerprint -sha256 -in "$TMP_CERT" |
    sed 's/.*=//; s/://g; y/ABCDEF/abcdef/')
FINGERPRINT_PUBKEY_B64=$(nix run nixpkgs#openssl -- x509 -noout -pubkey -in "$TMP_CERT" | nix run nixpkgs#openssl -- pkey -pubin -outform der | nix run nixpkgs#openssl -- dgst -sha256 -binary | nix run nixpkgs#coreutils -- base64 -w0)

# --- Fill templates (without modifying originals) ---
echo "Filling data into templates..." >&2

TMP_XRAY_SERVER=$(mktemp)
TMP_HY2_SERVER=$(mktemp)
TMP_MIHOMO_CLIENT=$(mktemp)
TMP_SINGBOX_CLIENT=$(mktemp)
trap 'rm -f "$TMP_XRAY_SERVER" "$TMP_HY2_SERVER" "$TMP_MIHOMO_CLIENT" "$TMP_SINGBOX_CLIENT" "${TMP_CERT:-}" "${TMP_KEY:-}"' EXIT

# Xray server config
sed -e "s|VLESS_UUID|$VLESS_UUID|" \
    -e "s|VLESS_PRIVATEKEY|$VLESS_PRIVATEKEY|" \
    "$XRAY_SERVER_TEMPLATE" >"$TMP_XRAY_SERVER"

# Hysteria2 server config
sed -e "s|HY2_PASSWORD|$HY2_PASSWORD|" \
    "$HY2_SERVER_TEMPLATE" >"$TMP_HY2_SERVER"

# Mihomo client config. SERVER_IP_OR_DOMAIN is intentionally left for vultr/oracle.
sed -e "s|HY2_PASSWORD|$HY2_PASSWORD|" \
    -e "s|FINGERPRINT|$FINGERPRINT|" \
    -e "s|VLESS_UUID|$VLESS_UUID|" \
    -e "s|VLESS_PUBLIC_KEY|$VLESS_PUBLICKEY|" \
    "$MIHOMO_CLIENT_TEMPLATE" >"$TMP_MIHOMO_CLIENT"

# Sing-box client config. Password goes in plain (no URL encoding);
# the cert pin uses the base64 public-key SHA256.
sed -e "s|HY2_PASSWORD|$HY2_PASSWORD|" \
    -e "s|FINGERPRINT_PUBKEY_B64|$FINGERPRINT_PUBKEY_B64|" \
    -e "s|VLESS_UUID|$VLESS_UUID|" \
    -e "s|VLESS_PUBLIC_KEY|$VLESS_PUBLICKEY|" \
    "$SINGBOX_CLIENT_TEMPLATE" | grep -v '^[[:space:]]*//' >"$TMP_SINGBOX_CLIENT"

# --- Encrypt with agenix ---
cd "$SECRETS_DIR"

echo "Encrypting xray-server.age..." >&2
rm -f xray-server.age
EDITOR="cp $TMP_XRAY_SERVER" nix run github:ryantm/agenix -- -e xray-server.age >&2

echo "Encrypting hysteria-server.age..." >&2
rm -f hysteria-server.age
EDITOR="cp $TMP_HY2_SERVER" nix run github:ryantm/agenix -- -e hysteria-server.age >&2

echo "Encrypting hysteria-server-cert.age..." >&2
rm -f hysteria-server-cert.age
EDITOR="cp $TMP_CERT" nix run github:ryantm/agenix -- -e hysteria-server-cert.age >&2

echo "Encrypting hysteria-server-key.age..." >&2
rm -f hysteria-server-key.age
EDITOR="cp $TMP_KEY" nix run github:ryantm/agenix -- -e hysteria-server-key.age >&2

echo "" >&2
echo "=============================================" >&2
echo "All server configs generated and encrypted:" >&2
echo "  1. $SECRETS_DIR/xray-server.age" >&2
echo "  2. $SECRETS_DIR/hysteria-server.age" >&2
echo "  3. $SECRETS_DIR/hysteria-server-cert.age" >&2
echo "  4. $SECRETS_DIR/hysteria-server-key.age" >&2
echo "=============================================" >&2
echo "" >&2

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
