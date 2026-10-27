{
  pkgs,
  config,
  flakeRootPath,
  ...
}:
let
  homeDirectory = config.home.homeDirectory;
  configDirectory = "${homeDirectory}/.config/sing-box";
  configFile = "${configDirectory}/config.json";
  certificateFile = "${configDirectory}/server.crt";
  keyFile = "${configDirectory}/server.key";
in
{
  home = {
    packages = with pkgs; [
      sing-box
    ];
  };

  age.secrets = {
    sing-box-server = {
      file = flakeRootPath + "/secrets/sing-box-server.age";
      path = configFile;
      symlink = false;
    };
    sing-box-cert = {
      file = flakeRootPath + "/secrets/sing-box-cert.age";
      path = certificateFile;
      symlink = false;
    };
    sing-box-key = {
      file = flakeRootPath + "/secrets/sing-box-key.age";
      path = keyFile;
      symlink = false;
    };
  };

  systemd.system.services.sing-box = ''
    [Unit]
    Description=sing-box proxy server
    Documentation=https://sing-box.sagernet.org/
    After=network.target

    [Service]
    Type=simple
    User=root
    Group=root
    ExecStartPre=${pkgs.sing-box}/bin/sing-box check -c ${configFile}
    ExecStart=${pkgs.sing-box}/bin/sing-box run -c ${configFile}
    Restart=on-failure
    RestartSec=5s
    LimitNPROC=10000
    LimitNOFILE=1000000
    CapabilityBoundingSet=CAP_NET_BIND_SERVICE
    AmbientCapabilities=CAP_NET_BIND_SERVICE
    NoNewPrivileges=true
    PrivateTmp=true
    ProtectSystem=full
    ProtectHome=read-only
    ProtectKernelTunables=true
    ProtectKernelModules=true
    ProtectControlGroups=true
    RestrictSUIDSGID=true
    LockPersonality=true

    [Install]
    WantedBy=multi-user.target
  '';
}
