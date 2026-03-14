{
  pkgs,
  lib,
  config,
  flakeRootPath,
  ...
}:
let
  homeDirectory = config.home.homeDirectory;
  systemctl = "${pkgs.systemd}/bin/systemctl";
in
{
  home = {
    packages = with pkgs; [
      xray
    ];
  };

  age.secrets = {
    xray-server = {
      file = flakeRootPath + "/secrets/xray-server.age";
      path = "${homeDirectory}/.config/xray/config.jsonc";
    };
  };

  home.file.".config/systemd-services/xray.service".text = ''
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

  home.activation.installXrayService = lib.hm.dag.entryAfter [ "decryptAgenix" ] ''
    $DRY_RUN_CMD ${pkgs.coreutils}/bin/install -Dm644 ${
      config.home.file.".config/systemd-services/xray.service".source
    } /etc/systemd/system/xray.service

    $DRY_RUN_CMD ${systemctl} daemon-reload
    $DRY_RUN_CMD ${systemctl} enable --now xray.service
    $DRY_RUN_CMD ${systemctl} restart xray.service
  '';
}
