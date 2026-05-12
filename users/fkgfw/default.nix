{
  lib,
  pkgs,
  config,
  agenix,
  username,
  homeDirectory,
  ...
}: {
  imports = [
    ./services/hysteria.nix
    ./services/xray.nix
  ];

  home = {
    inherit username;
    inherit homeDirectory;

    packages = with pkgs; [
      zellij
      libcap
      helix
      nil
      agenix.packages.x86_64-linux.default
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
    hs = "home-manager switch --flake /root/.nix-config#fkgfw";
  };

  # let hm install and manage itself
  programs.home-manager.enable = true;

  # The agenix home-manager module defaults to $XDG_RUNTIME_DIR/agenix. Root
  # does not reliably have that directory, so keep its generation state stable.
  age = {
    identityPaths = ["/etc/ssh/ssh_host_ed25519_key"];
    secretsDir = "${homeDirectory}/.local/share/agenix";
    secretsMountPoint = "${homeDirectory}/.local/share/agenix.d";
  };

  # Root cannot start user-level services, so decrypt during activation.
  home.activation.decryptAgenix = lib.hm.dag.entryAfter ["writeBoundary"] ''
    ${lib.concatStringsSep " " (lib.toList config.systemd.user.services.agenix.Service.ExecStart)}
  '';

  # This value determines the Home Manager release that your configuration is
  # compatible with. This helps avoid breakage when a new Home Manager release
  # introduces backwards incompatible changes.
  #
  # You should not change this value, even if you update Home Manager. If you do
  # want to update the value, then make sure to first check the Home Manager
  # release notes.
  home.stateVersion = "25.11"; # Please read the comment before changing.
}
