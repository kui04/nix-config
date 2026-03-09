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

SERVER_TEMPLATE="$ROOT_DIR/users/.config/xray/server.jsonc"
CLIENT_TEMPLATE="$ROOT_DIR/users/.config/xray/client.jsonc"
SECRETS_DIR="$ROOT_DIR/secrets"
SERVER_SECRET_FILE="xray-server.age"
CLIENT_SECRET_FILE="xray-client.age"

if [[ ! -f "$SERVER_TEMPLATE" ]]; then
    echo "Error: Cannot find template file $SERVER_TEMPLATE"
    exit 1
fi

if [[ ! -f "$CLIENT_TEMPLATE" ]]; then
    echo "Error: Cannot find template file $CLIENT_TEMPLATE"
    exit 1
fi

if [[ ! -f "$SECRETS_DIR/secrets.nix" ]]; then
    echo "Error: Cannot find secrets.nix in $SECRETS_DIR"
    exit 1
fi

echo -n "Please enter the server IP or domain for the client config: "
read IPORDOMAIN
echo "You entered: $IPORDOMAIN"
echo ""

echo "Generating Xray UUID..."
SERVERID=$(nix run nixpkgs#xray uuid)

echo "Generating Xray X25519 keys..."
X25519_OUT=$(nix run nixpkgs#xray x25519)

PRIVATEKEY=$(echo "$X25519_OUT" | grep -iE 'Private[Kk]ey|Private key' | sed 's/.*:[[:space:]]*//')
PUBLICKEY=$(echo "$X25519_OUT" | grep -i 'Password' | sed 's/.*:[[:space:]]*//')
HASH32=$(echo "$X25519_OUT" | grep -i 'Hash32' | sed 's/.*:[[:space:]]*//')

if [[ -z "$PRIVATEKEY" ]]; then
    echo "Error: Failed to extract PrivateKey from generator output."
    exit 1
fi

TMP_SERVER_FILE=$(mktemp)
TMP_CLIENT_FILE=$(mktemp)

echo "Filling data into templates (will not modify original templates)..."

# Server json replacement
sed -e "s/SERVERID/$SERVERID/" \
    -e "s/PRIVATEKEY/$PRIVATEKEY/" \
    "$SERVER_TEMPLATE" > "$TMP_SERVER_FILE"

# Client json replacement
sed -e "s/IPORDOMAIN/$IPORDOMAIN/" \
    -e "s/SERVERID/$SERVERID/" \
    -e "s/PUBLICKEY/$PUBLICKEY/" \
    "$CLIENT_TEMPLATE" > "$TMP_CLIENT_FILE"

cd "$SECRETS_DIR"

echo "Encrypting server config with agenix..."
rm -f "$SERVER_SECRET_FILE"
EDITOR="cp $TMP_SERVER_FILE" nix run github:ryantm/agenix -- -e "$SERVER_SECRET_FILE"

echo "Encrypting client config with agenix..."
rm -f "$CLIENT_SECRET_FILE"
EDITOR="cp $TMP_CLIENT_FILE" nix run github:ryantm/agenix -- -e "$CLIENT_SECRET_FILE"

rm -f "$TMP_SERVER_FILE" "$TMP_CLIENT_FILE"

echo ""
echo "============================================="
echo "Xray configuration generated and encrypted to:"
echo "Server: $SECRETS_DIR/$SERVER_SECRET_FILE"
echo "Client: $SECRETS_DIR/$CLIENT_SECRET_FILE"
echo ""
echo "Please save the following parameters (DO NOT LOSE THEM):"
echo "Password/PublicKey: $PUBLICKEY"
echo "Hash32  : $HASH32"
echo "Server UUID: $SERVERID"
echo "============================================="