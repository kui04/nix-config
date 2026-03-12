#!/usr/bin/env bash
set -e

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

XRAY_SERVER_TEMPLATE="$TEMPLATE_DIR/xray.jsonc"
HY2_SERVER_TEMPLATE="$TEMPLATE_DIR/hy2.yaml"
MIHOMO_CLIENT_TEMPLATE="$TEMPLATE_DIR/mihomo.yaml"

# Validate templates exist
for f in "$XRAY_SERVER_TEMPLATE" "$HY2_SERVER_TEMPLATE" "$MIHOMO_CLIENT_TEMPLATE"; do
    if [[ ! -f "$f" ]]; then
        echo "Error: Cannot find template file $f"
        exit 1
    fi
done

if [[ ! -f "$SECRETS_DIR/secrets.nix" ]]; then
    echo "Error: Cannot find secrets.nix in $SECRETS_DIR"
    exit 1
fi

# --- User Inputs ---
echo -n "Please enter the server IP or domain: "
read -r SERVER_ADDR
echo "You entered: $SERVER_ADDR"
echo ""

# --- Generate Xray credentials ---
echo "Generating Xray UUID..."
VLESS_UUID=$(nix run nixpkgs#xray -- uuid)

echo "Generating Xray X25519 keys..."
X25519_OUT=$(nix run nixpkgs#xray -- x25519)

VLESS_PRIVATEKEY=$(echo "$X25519_OUT" | grep -iE 'Private[Kk]ey|Private key' | sed 's/.*:[[:space:]]*//')
VLESS_PUBLICKEY=$(echo "$X25519_OUT" | grep -i 'Password' | sed 's/.*:[[:space:]]*//')

if [[ -z "$VLESS_PRIVATEKEY" || -z "$VLESS_PUBLICKEY" ]]; then
    echo "Error: Failed to extract X25519 keys from xray output:"
    echo "$X25519_OUT"
    exit 1
fi

# --- Generate Hysteria2 credentials ---
echo "Generating Hysteria2 password..."
HY2_PASSWORD=$(nix run nixpkgs#openssl -- rand -base64 32)

echo "Generating self-signed TLS certificate for Hysteria2..."
TMP_CERT=$(mktemp)
TMP_KEY=$(mktemp)
nix run nixpkgs#openssl -- req -x509 -nodes -newkey ec:<(nix run nixpkgs#openssl -- ecparam -name prime256v1) \
    -keyout "$TMP_KEY" -out "$TMP_CERT" -days 3650 \
    -subj "/CN=www.bing.com" 2>/dev/null

# Get certificate SHA256 fingerprint for mihomo client
FINGERPRINT=$(nix run nixpkgs#openssl -- x509 -noout -fingerprint -sha256 -in "$TMP_CERT" \
    | sed 's/.*=//; s/://g; y/ABCDEF/abcdef/')

# --- Fill templates (without modifying originals) ---
echo "Filling data into templates..."

TMP_XRAY_SERVER=$(mktemp)
TMP_HY2_SERVER=$(mktemp)
TMP_MIHOMO_CLIENT=$(mktemp)

# Xray server config
sed -e "s|VLESS_UUID|$VLESS_UUID|" \
    -e "s|VLESS_PRIVATEKEY|$VLESS_PRIVATEKEY|" \
    "$XRAY_SERVER_TEMPLATE" > "$TMP_XRAY_SERVER"

# Hysteria2 server config
sed -e "s|HY2_PASSWORD|$HY2_PASSWORD|" \
    "$HY2_SERVER_TEMPLATE" > "$TMP_HY2_SERVER"

# Mihomo client config
sed -e "s|SERVER_IP_OR_DOMAIN|$SERVER_ADDR|g" \
    -e "s|HY2_PASSWORD|$HY2_PASSWORD|" \
    -e "s|FINGERPRINT|$FINGERPRINT|" \
    -e "s|VLESS_UUID|$VLESS_UUID|" \
    -e "s|VLESS_PUBLIC_KEY|$VLESS_PUBLICKEY|" \
    "$MIHOMO_CLIENT_TEMPLATE" > "$TMP_MIHOMO_CLIENT"

# --- Encrypt with agenix ---
cd "$SECRETS_DIR"

echo "Encrypting xray-server.age..."
rm -f xray-server.age
EDITOR="cp $TMP_XRAY_SERVER" nix run github:ryantm/agenix -- -e xray-server.age

echo "Encrypting hysteria-server.age..."
rm -f hysteria-server.age
EDITOR="cp $TMP_HY2_SERVER" nix run github:ryantm/agenix -- -e hysteria-server.age

echo "Encrypting hysteria-server-cert.age..."
rm -f hysteria-server-cert.age
EDITOR="cp $TMP_CERT" nix run github:ryantm/agenix -- -e hysteria-server-cert.age

echo "Encrypting hysteria-server-key.age..."
rm -f hysteria-server-key.age
EDITOR="cp $TMP_KEY" nix run github:ryantm/agenix -- -e hysteria-server-key.age

echo "Encrypting mihomo-client.age..."
rm -f mihomo-client.age
EDITOR="cp $TMP_MIHOMO_CLIENT" nix run github:ryantm/agenix -- -e mihomo-client.age

cat "$TMP_XRAY_SERVER" "$TMP_HY2_SERVER" "$TMP_MIHOMO_CLIENT" "$TMP_CERT" "$TMP_KEY"

# --- Cleanup ---
rm -f "$TMP_XRAY_SERVER" "$TMP_HY2_SERVER" "$TMP_MIHOMO_CLIENT" "$TMP_CERT" "$TMP_KEY"

echo ""
echo "============================================="
echo "All configs generated and encrypted:"
echo "  1. $SECRETS_DIR/xray-server.age"
echo "  2. $SECRETS_DIR/hysteria-server.age"
echo "  3. $SECRETS_DIR/hysteria-server-cert.age"
echo "  4. $SECRETS_DIR/hysteria-server-key.age"
echo "  5. $SECRETS_DIR/mihomo-client.age"
echo ""
echo "Parameters (SAVE THESE):"
echo "  Server Address   : $SERVER_ADDR"
echo "  Xray UUID        : $VLESS_UUID"
echo "  Xray Public Key  : $VLESS_PUBLICKEY"
echo "  Xray Private Key : $VLESS_PRIVATEKEY"
echo "  HY2 Password     : $HY2_PASSWORD"
echo "  HY2 Cert SHA256  : $FINGERPRINT"
echo "============================================="