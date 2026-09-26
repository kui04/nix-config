{
  config,
  lib,
  pkgs,
  ...
}:
let
  # stable intel igpu render node (verified: pci-0000:00:02.0-render -> renderD128).
  # do not hardcode /dev/dri/renderD12X: numbers swap across reboots on hybrid
  # intel+nvidia systems and cause surfaceflinger signal 6 crashes.
  # ref: https://github.com/pioner14/Waydroid_on_NixOS (section 9-10)
  intelRenderNode = "/dev/dri/by-path/pci-0000:00:02.0-render";
in
{
  virtualisation.waydroid.enable = true;
  # nftables backend: plain waydroid uses iptables-legacy, but kernel 6.18
  # has no legacy ip_tables support (only nf_tables), so waydroid-net.sh
  # fails with "can't initialize iptables table `mangle'".
  virtualisation.waydroid.package = pkgs.waydroid-nftables;

  # nftables firewall backend to match (nixos firewall rules are translated
  # automatically; tailscale/clash/docker keep working via nft_compat).
  networking.nftables.enable = true;

  # network configuration for waydroid
  networking.firewall.trustedInterfaces = [ "waydroid0" ];
  boot.kernel.sysctl = {
    "net.ipv4.ip_forward" = 1;
    "net.ipv4.conf.all.forwarding" = 1;
    "net.ipv6.conf.all.forwarding" = 1;
  };

  # enhance default service (no lib.mkForce: it would overwrite package-provided
  # network/cgroups settings and break the container).
  systemd.services.waydroid-container.serviceConfig = {
    # enable cgroups v2 delegation (fixes "read-only file system" errors)
    Delegate = true;
    CPUAccounting = true;
    MemoryAccounting = true;
    TasksAccounting = true;

    # gpu fix runs before container starts (no race conditions vs `waydroid prop set`
    # in a post-start service, which falls back to swiftshader after reboots).
    ExecStartPre = lib.mkAfter [
      (pkgs.writeShellScript "waydroid-gpu-fix-pre" ''
        set -e
        PROP_FILE="/var/lib/waydroid/waydroid.prop"

        mkdir -p /var/lib/waydroid
        touch "$PROP_FILE"

        # function to set properties (removes old, adds new)
        set_prop() {
          ${pkgs.gnused}/bin/sed -i "/^$1=/d" "$PROP_FILE"
          echo "$1=$2" >> "$PROP_FILE"
        }

        # force intel gpu (gbm/mesa)
        set_prop ro.hardware.gralloc gbm
        set_prop ro.hardware.egl mesa
        set_prop gralloc.gbm.device ${intelRenderNode}
        set_prop ro.hardware.vulkan intel

        # popular phone resolution (20:9, scaled for desktop)
        set_prop persist.waydroid.width 450
        set_prop persist.waydroid.height 1000

        # clean empty lines
        ${pkgs.gnused}/bin/sed -i '/^$/d' "$PROP_FILE"
      '')
    ];
  };

  # backup persistence service (runs after start as fallback)
  systemd.services.waydroid-gpu-persistence = {
    description = "Enforce Intel GPU for Waydroid (Post-Start Backup)";
    after = [ "waydroid-container.service" ];
    bindsTo = [ "waydroid-container.service" ];
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      ExecStart = pkgs.writeShellScript "waydroid-intel-fix-post" ''
        set -e
        ${pkgs.coreutils}/bin/sleep 5
        ${config.virtualisation.waydroid.package}/bin/waydroid prop set ro.hardware.gralloc gbm
        ${config.virtualisation.waydroid.package}/bin/waydroid prop set ro.hardware.egl mesa
        ${config.virtualisation.waydroid.package}/bin/waydroid prop set gralloc.gbm.device ${intelRenderNode}
        ${config.virtualisation.waydroid.package}/bin/waydroid prop set ro.hardware.vulkan intel
        ${config.virtualisation.waydroid.package}/bin/waydroid prop set persist.waydroid.width 450
        ${config.virtualisation.waydroid.package}/bin/waydroid prop set persist.waydroid.height 1000
      '';
    };
  };
}
