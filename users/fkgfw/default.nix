{
  lib,
  config,
  pkgs,
  agenix,
  username,
  ...
}: let
  homeDirectory = "/home/${username}";
in {
  home = {
    inherit username;
    inherit homeDirectory;

    packages = with pkgs; [
      zellij
      libcap
      helix
      xray
      nil
      agenix.packages.x86_64-linux.default

      (writeShellScriptBin "start-xray" ''
        echo "Starting xray service in background..."
        sudo sh -c "${xray}/bin/xray run -c ${config.age.secrets.xray-server.path} > /tmp/xray.log 2>&1 &"
        echo "Xray started. Use 'logs-xray' to view logs."
      '')

      (writeShellScriptBin "stop-xray" ''
        echo "Stopping xray service..."
        sudo pkill -f "${xray}/bin/xray" || echo "Xray is not running."
      '')

      (writeShellScriptBin "restart-xray" ''
        stop-xray
        sleep 1
        start-xray
      '')

      (writeShellScriptBin "logs-xray" ''
        echo "Showing logs from /tmp/xray.log (Ctrl+C to exit):"
        cat /tmp/xray.log
        tail -f /tmp/xray.log
      '')
    ];

    sessionVariables = {
      EDITOR = "helix";
    };
  };

  programs.bash.enable = true;
  programs.bash.shellAliases = {
    l = "ls -alh";
    ll = "ls -l";
    ls = "ls --color=tty";
    hs = "home-manager switch --flake ~/.nix-config";
  };

  age.identityPaths = ["${homeDirectory}/.ssh/id_ed25519"];
  age.secrets.xray-server = {
    file = ../../secrets/xray-server.age;
    path = "${homeDirectory}/.xray-config.json";
  };

  home.activation.restartXray = lib.hm.dag.entryAfter ["writeBoundary"] ''
    echo "Restarting xray via activation script..."
    $DRY_RUN_CMD /usr/bin/sudo pkill -f "${pkgs.xray}/bin/xray" || true
    $DRY_RUN_CMD /usr/bin/sudo sh -c "${pkgs.xray}/bin/xray run -c ${config.age.secrets.xray-server.path} > /tmp/xray.log 2>&1 &"
  '';

  # Let Home Manager install and manage itself.
  programs.home-manager.enable = true;

  # This value determines the Home Manager release that your configuration is
  # compatible with. This helps avoid breakage when a new Home Manager release
  # introduces backwards incompatible changes.
  #
  # You should not change this value, even if you update Home Manager. If you do
  # want to update the value, then make sure to first check the Home Manager
  # release notes.
  home.stateVersion = "25.11"; # Please read the comment before changing.
}
