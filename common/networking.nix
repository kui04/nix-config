{
  pkgs,
  config,
  hostname,
  ...
}: let
  xrayConfigPath = "/etc/xray/config.json";
in {
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
    programs.clash-verge.autoStart = false;
    programs.clash-verge.serviceMode = true;

    # tailscale
    services.tailscale.enable = true;

    # xray
    age.secrets.xray-client.file = ../secrets/xray-client.age;
    age.secrets.xray-client.path = xrayConfigPath;
    services.xray.enable = true;
    services.xray.settingsFile = xrayConfigPath;
    networking.proxy.allProxy = "socks5://127.0.0.1:10808";
  };
}
