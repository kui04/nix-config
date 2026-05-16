{
  pkgs,
  config,
  flakeRootPath,
  ...
}: let
  homeDirectory = config.home.homeDirectory;
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
      symlink = false;
    };
    hysteria-cert = {
      file = flakeRootPath + "/secrets/hysteria-server-cert.age";
      path = "${homeDirectory}/.config/hysteria/server.crt";
      symlink = false;
    };
    hysteria-key = {
      file = flakeRootPath + "/secrets/hysteria-server-key.age";
      path = "${homeDirectory}/.config/hysteria/server.key";
      symlink = false;
    };
  };

  systemd.system.services.hysteria = ''
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
}
