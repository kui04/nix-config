{
  pkgs,
  config,
  hostname,
  ...
}: {
  config = {
    # networking
    networking.firewall.enable = true;
    networking.hostName = hostname;
    networking.networkmanager.enable = true;
    networking.firewall.trustedInterfaces = ["tailscale0"];
    networking.firewall.allowedTCPPorts = [
      22 # OpenSSH
      7897 # Clash Verge
    ];
    networking.firewall.allowedUDPPorts = [
      config.services.tailscale.port # Tailscale
      53 # DNS
      67 # DHCP server
    ];

    # bluetooth
    hardware.bluetooth.enable = true;

    # clash-verge-rev
    programs.clash-verge.package = pkgs.clash-verge-rev;
    programs.clash-verge.enable = true;
    programs.clash-verge.autoStart = true;
    programs.clash-verge.serviceMode = true;
    # networking.proxy.allProxy = "http://127.0.0.1:7897";

    # tailscale
    services.tailscale.enable = true;
  };
}
