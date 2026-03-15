{
  pkgs,
  lib,
  config,
  flakeRootPath,
  ...
}: let
  homeDirectory = config.home.homeDirectory;
  iptables = "${pkgs.iptables}/bin/iptables";
  ip6tables = "${pkgs.iptables}/bin/ip6tables";
  systemctl = "${pkgs.systemd}/bin/systemctl";
in {
  home = {
    packages = with pkgs; [
      hysteria
    ];
  };

  age.secrets = {
    hysteria-server = {
      file = flakeRootPath + "/secrets/hysteria-server.age";
      path = "${homeDirectory}/.config/hysteria/config.yaml";
    };
    hysteria-cert = {
      file = flakeRootPath + "/secrets/hysteria-server-cert.age";
      path = "${homeDirectory}/.config/hysteria/server.crt";
    };
    hysteria-key = {
      file = flakeRootPath + "/secrets/hysteria-server-key.age";
      path = "${homeDirectory}/.config/hysteria/server.key";
    };
  };

  home.file.".config/systemd-services/hysteria.service".text = ''
    [Unit]
    Description=Hysteria Server Service
    After=network.target

    [Service]
    Type=simple
    User=root
    CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW
    AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW
    NoNewPrivileges=true
    ExecStart=${pkgs.hysteria}/bin/hysteria server --config ${homeDirectory}/.config/hysteria/config.yaml
    Restart=on-failure
    RestartSec=10s
    LimitNPROC=10000
    LimitNOFILE=1000000
    RuntimeDirectory=hysteria
    RuntimeDirectoryMode=0755

    [Install]
    WantedBy=multi-user.target
  '';

  home.activation.installHysteriaService = lib.hm.dag.entryAfter ["decryptAgenix"] ''
    $DRY_RUN_CMD ${pkgs.coreutils}/bin/install -Dm644 ${
      config.home.file.".config/systemd-services/hysteria.service".source
    } /etc/systemd/system/hysteria.service

    $DRY_RUN_CMD ${systemctl} daemon-reload
    $DRY_RUN_CMD ${systemctl} enable hysteria.service
    $DRY_RUN_CMD ${systemctl} restart hysteria.service
  '';

  home.activation.portHopping = lib.hm.dag.entryAfter ["installHysteriaService"] ''
    ${iptables} -t nat -C PREROUTING -i enp1s0 -p udp --dport 20000:50000 -j REDIRECT --to-ports 443 2>/dev/null \
      || ${iptables} -t nat -A PREROUTING -i enp1s0 -p udp --dport 20000:50000 -j REDIRECT --to-ports 443

    ${ip6tables} -t nat -C PREROUTING -i enp1s0 -p udp --dport 20000:50000 -j REDIRECT --to-ports 443 2>/dev/null \
      || ${ip6tables} -t nat -A PREROUTING -i enp1s0 -p udp --dport 20000:50000 -j REDIRECT --to-ports 443
  '';
}
