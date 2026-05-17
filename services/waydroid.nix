{pkgs, ...}: {
  virtualisation.waydroid.enable = true;
  virtualisation.waydroid.package = pkgs.waydroid-nftables;
  
  environment.systemPackages = with pkgs; [
    # enable clipboard sharing
    wl-clipboard
    # user-friendly way to configure Waydroid and install extensions, including Magisk and ARM translation
    waydroid-helper
  ];
}
