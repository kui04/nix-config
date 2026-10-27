# fkgfw: sing-box on a Debian VPS

Home Manager manages `root` on a non-NixOS Debian VPS. One `sing-box` process serves three inbounds:

- TUIC v5 on UDP 8443. This is the default low-latency path.
- Hysteria2 on UDP 443. This is the throughput path. The client uses port hopping on UDP 20000-50000.
- VLESS Reality Vision on TCP 443. This is the stable TCP path. It needs no domain or certificate.

The client uses a manual selector. TUIC is the default. You can force Hysteria2 or Reality at any time.

## Quick start

Run every command as `root`.

### 1. Install Nix

```sh
apt-get update
apt-get install -y curl xz-utils git openssh-server openssl

sh <(curl --proto '=https' --tlsv1.2 -L https://nixos.org/nix/install) --daemon
```

Answer `n` to the detailed list and `y` to continue. Press Enter at the end.

### 2. Enable flakes

```sh
cp /etc/nix/nix.conf /etc/nix/nix.conf.bak.$(date +%F_%H%M%S)
grep -qxF 'experimental-features = nix-command flakes' /etc/nix/nix.conf ||
  echo 'experimental-features = nix-command flakes' >>/etc/nix/nix.conf
systemctl restart nix-daemon
exec bash -l
```

### 3. Clone the repository

```sh
git clone https://github.com/kui04/nix-config /root/.nix-config
cd /root/.nix-config
```

### 4. Add the VPS host key

```sh
ls /etc/ssh/ssh_host_ed25519_key.pub || ssh-keygen -A
cat /etc/ssh/ssh_host_ed25519_key.pub
```

Add the key to `proxy-vps` in `secrets/secrets.nix`. Use only the host key from `/etc/ssh/ssh_host_ed25519_key.pub`.

### 5. Check the Reality target

```sh
TLS_SERVER_NAME="${TLS_SERVER_NAME:-www.cloudflare.com}"
openssl s_client -connect "${TLS_SERVER_NAME}:443" -servername "${TLS_SERVER_NAME}" -tls1_3 </dev/null 2>/dev/null |
  grep -E 'Protocol|Cipher'
```

The output must show `TLSv1.3`. If it does not, use another target:

```sh
export TLS_SERVER_NAME=www.apple.com
```

### 6. Generate secrets

```sh
cd /root/.nix-config
TLS_SERVER_NAME="${TLS_SERVER_NAME:-www.cloudflare.com}" ./users/fkgfw/gen.sh 2>&1 | tee /root/client-configs.txt
```

Copy the printed sing-box client config to the client. This command rotates all proxy credentials. Remove the local copy
after you save the config:

```sh
shred -u /root/client-configs.txt
```

### 7. Apply the profile

```sh
export USER=root
nix run github:nix-community/home-manager/release-26.05 -- switch -b backup \
  --flake path:/root/.nix-config#fkgfw
```

The `-b backup` flag is for the first switch. It moves Debian's existing `/root/.bashrc` and `/root/.profile` to
`.backup`.

### 8. Verify the service

```sh
systemctl status sing-box --no-pager
sing-box check -c /root/.config/sing-box/config.json
ss -lntup | grep -E ':443|:8443'
```

Expected listeners: TCP 443, UDP 443, and UDP 8443.

### 9. Configure the client

Save the printed client config as `/etc/sing-box/config.json`. Replace `SERVER_IP_OR_DOMAIN`:

```sh
sed -i 's/SERVER_IP_OR_DOMAIN/203.0.113.10/g' /etc/sing-box/config.json
sing-box check -c /etc/sing-box/config.json
systemctl restart sing-box
```

The printed client config is a manual selector with `tuic` as the default. To force another path, set `default` to
`hysteria2` or `vless-reality-vision`, or use the local API/dashboard. A selector switch interrupts existing connections
so that all traffic moves to the selected path. TUIC 0-RTT is off because the official documentation recommends it for
replay safety; TUIC is still multiplexed, so the latency impact is small.

Later switches use the `hs` alias:

```sh
hs
```

If `hs` is not defined in a login shell, run `source ~/.bashrc` once.

## Firewall

Do not replace or flush the VPS firewall. Add the required rules to the existing firewall and to the cloud security
group. Table and chain names differ between VPS images, so adjust the examples below.

Required inbound rules:

| Protocol | Port        | Purpose                    |
| -------- | ----------- | -------------------------- |
| TCP      | 22          | SSH. Change if needed.     |
| TCP      | 443         | VLESS Reality Vision       |
| UDP      | 443         | Hysteria2                  |
| UDP      | 8443        | TUIC v5                    |
| UDP      | 20000-50000 | Hysteria2 port hopping     |
| ICMP     | -           | Path MTU discovery         |
| ICMPv6   | -           | Path MTU discovery over v6 |

The cloud firewall sees the original destination port. It must allow UDP 8443 and UDP 20000-50000. On the VPS, the
port-hopping redirect runs in prerouting before the input filter, so allowing UDP 443 is usually enough for the filter.
Allowing the range is harmless.

Add the rules before any final drop or reject rule. `nft add` and `iptables -A` append; use `nft insert` or a rule
position if your chain ends with a drop.

### nftables example

Add the filter rules to the existing table and chain. Names vary; adjust them.

```sh
nft add rule inet filter input tcp dport 22 accept
nft add rule inet filter input tcp dport 443 accept
nft add rule inet filter input udp dport 443 accept
nft add rule inet filter input udp dport 8443 accept
nft add rule inet filter input udp dport 20000-50000 accept
```

Add the port-hopping redirect in a dedicated table. This does not flush existing rules.

```sh
nft add table inet sing_box_porthopping
nft add chain inet sing_box_porthopping prerouting '{ type nat hook prerouting priority dstnat; policy accept; }'
nft add rule inet sing_box_porthopping prerouting udp dport 20000-50000 counter redirect to :443
```

If the table already exists, delete or update it first.

### iptables example

```sh
iptables -A INPUT -p tcp --dport 22 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT
iptables -A INPUT -p udp --dport 443 -j ACCEPT
iptables -A INPUT -p udp --dport 8443 -j ACCEPT
iptables -A INPUT -p udp --dport 20000:50000 -j ACCEPT
iptables -t nat -A PREROUTING -p udp --dport 20000:50000 -j REDIRECT --to-ports 443
```

For IPv6, add the equivalent `ip6tables` rules:

```sh
ip6tables -A INPUT -p tcp --dport 443 -j ACCEPT
ip6tables -A INPUT -p udp --dport 443 -j ACCEPT
ip6tables -A INPUT -p udp --dport 8443 -j ACCEPT
ip6tables -A INPUT -p udp --dport 20000:50000 -j ACCEPT
ip6tables -t nat -A PREROUTING -p udp --dport 20000:50000 -j REDIRECT --to-ports 443
```

If you use `ufw`, open the same ports and add the NAT redirect separately. `ufw` only manages the filter rules.

Persist the rules with the firewall service your VPS already uses. Do not overwrite `/etc/nftables.conf` blindly.

## Problems

| Symptom                                            | Fix                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `USER: unbound variable` from Home Manager         | `export USER=root`                                                                                                 |
| `Existing file '/root/.bashrc' would be clobbered` | Use `switch -b backup` on the first switch                                                                         |
| `nix: command not found`                           | `exec bash -l`                                                                                                     |
| agenix cannot decrypt a secret                     | Add `/etc/ssh/ssh_host_ed25519_key.pub` to `secrets/secrets.nix`, then run `gen.sh` again                          |
| Reality: `reality verification failed`             | The target does not offer TLS 1.3 and HTTP/2, or the VPS cannot reach it. Change `TLS_SERVER_NAME` and regenerate. |
| TUIC connects but stalls                           | UDP 8443 is blocked. Check the cloud firewall and the local rules.                                                 |
| Hysteria2 connects but stalls                      | UDP 443 or 20000-50000 is blocked. Check the cloud firewall and the local rules.                                   |
| Port hopping fails                                 | Check the redirect table and its counter. Open 20000-50000 in the cloud firewall.                                  |
| The service still uses old credentials             | `systemctl restart sing-box`                                                                                       |
| Reality fails with TCP SYN-ACK blocked             | Reality cannot fix a TCP-layer block. Use TUIC or Hysteria2, or change IP, use IPv6, or add a relay.               |

Tested with Debian 13, Nix 2.35.4, Home Manager `release-26.05`, and sing-box 1.13.19.
