{username, ...}: {
  config = {
    # related issue: https://github.com/NixOS/nixpkgs/issues/455737
    hardware.uinput.enable = true;
    users.users.${username}.extraGroups = [
      "uinput"
      "video"
      "render"
    ];

    # user sunshine service
    services.sunshine = {
      enable = true;
      autoStart = false;
      capSysAdmin = true;
      openFirewall = true;
    };

    # open required ports only when Sunshine is enabled and allowed to open firewall
    networking.firewall = {
      allowedTCPPorts = [
        47984
        47989
        47990
        48010
      ];
      allowedUDPPortRanges = [
        {
          from = 8000;
          to = 8010;
        }
        {
          from = 47998;
          to = 48000;
        }
      ];
    };
  };
}
