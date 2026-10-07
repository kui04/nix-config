{
  pkgs,
  ...
}:
{
  services.sing-box = {
    enable = true;
    # unstable carries 1.14.x; stable is still 1.13.x.
    package = pkgs.unstable.sing-box;
    # live config is hand-managed at /etc/sing-box/config.json so node
    # secrets stay out of /nix/store and git. settings stays empty, so
    # the module reads /etc/sing-box and needs no secret substitution.
    settings = { };
  };

  # create the directory; you place config.json by hand.
  # validate with `sing-box check -c`, apply with a service restart.
  systemd.tmpfiles.rules = [ "d /etc/sing-box 0755 root root -" ];

  # TUN plus process-name rules need these caps. Same set as the
  # upstream sing-box.service; the NixOS module does not add any.
  # 9090 needs no firewall rule: clash api binds 127.0.0.1 and
  # loopback bypasses the NixOS firewall.
  systemd.services.sing-box.serviceConfig = {
    AmbientCapabilities = [
      "CAP_NET_ADMIN"
      "CAP_NET_RAW"
      "CAP_NET_BIND_SERVICE"
      "CAP_SYS_PTRACE"
      "CAP_DAC_READ_SEARCH"
    ];
    CapabilityBoundingSet = [
      "CAP_NET_ADMIN"
      "CAP_NET_RAW"
      "CAP_NET_BIND_SERVICE"
      "CAP_SYS_PTRACE"
      "CAP_DAC_READ_SEARCH"
    ];
  };
}
