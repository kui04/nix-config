# VPS Proxy Deployment With Home Manager

I use this flake on a non-NixOS VPS. Home Manager still handles the service
definition, but I run it as `root` because the proxy services need extra
capabilities to bind to `443` and handle port hopping cleanly. Home Manager can
do user-level services just fine; the root shell is the practical way to get
the required caps here.

Run every command below as `root` unless noted.

## 1. Install Nix

```sh
sh <(curl --proto '=https' --tlsv1.2 -L https://nixos.org/nix/install) --daemon
```

## 2. Enable Flakes

```sh
cp /etc/nix/nix.conf /etc/nix/nix.conf.bak.$(date +%Y%m%d_%H%M%S)
grep -qxF 'experimental-features = nix-command flakes' /etc/nix/nix.conf || \
  echo 'experimental-features = nix-command flakes' | tee -a /etc/nix/nix.conf > /dev/null
systemctl restart nix-daemon.service
```

## 3. Clone The Repo

```sh
git clone https://github.com/kui04/nix-config /root/.nix-config
```

## 4. Prepare Secrets

If you want to reuse this flake on another VPS, update `secrets/secrets.nix`
before switching:

- add the new VPS host public key
- remove public keys that no longer need access
- if you only changed recipients, re-encrypt the existing `.age` files for the
  updated recipient list
- run `./users/fkgfw/gen.sh` only when you want fresh server credentials or a
  new mihomo config

## 5. Apply The Profile

Run this from a root shell:

```sh
nix run github:nix-community/home-manager/release-25.11 -- switch --flake /root/.nix-config#fkgfw
```

After the first switch, `home-manager` is installed by the profile and `hs`
works in new root shells.

## 6. Hysteria 2 Port Hopping

Check the default interface first:

```sh
ip route show default
```

Replace `enp1s0` with the real interface name:

```sh
iptables -t nat -A PREROUTING -i enp1s0 -p udp --dport 20000:50000 -j REDIRECT --to-ports 443
ip6tables -t nat -A PREROUTING -i enp1s0 -p udp --dport 20000:50000 -j REDIRECT --to-ports 443
```

## 7. Verify Services

```sh
systemctl status hysteria.service
systemctl status xray.service
journalctl -u hysteria.service -e
journalctl -u xray.service -e
```

## 8. Open Firewall Ports

Don't forget to open these ports in your firewall:

- 443/tcp
- 443/udp
- 20000:50000/udp
