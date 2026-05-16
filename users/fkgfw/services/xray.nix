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
      xray
    ];
  };

  age.secrets = {
    xray-server = {
      file = flakeRootPath + "/secrets/xray-server.age";
      path = "${homeDirectory}/.config/xray/config.jsonc";
      symlink = false;
    };
  };

  systemd.system.services.xray = ''
    [Unit]
    Description=Xray Service
    Documentation=https://github.com/xtls
    After=network.target nss-lookup.target

    [Service]
    User=root
    CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW
    AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW
    NoNewPrivileges=true
    ExecStart=${pkgs.xray}/bin/xray run -config ${homeDirectory}/.config/xray/config.jsonc
    Restart=on-failure
    RestartSec=10s
    RestartPreventExitStatus=23
    LimitNPROC=10000
    LimitNOFILE=1000000
    RuntimeDirectory=xray
    RuntimeDirectoryMode=0755

    [Install]
    WantedBy=multi-user.target
  '';
}
