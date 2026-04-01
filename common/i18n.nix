{pkgs, ...}: {
  config = {
    # set your time zone
    time.timeZone = "Asia/Shanghai";
    time.hardwareClockInLocalTime = true;

    # select internationalisation properties
    i18n.defaultLocale = "en_US.UTF-8";
    i18n.extraLocaleSettings = {
      LC_ADDRESS = "zh_CN.UTF-8";
      LC_IDENTIFICATION = "zh_CN.UTF-8";
      LC_MEASUREMENT = "zh_CN.UTF-8";
      LC_MONETARY = "zh_CN.UTF-8";
      LC_NAME = "zh_CN.UTF-8";
      LC_NUMERIC = "zh_CN.UTF-8";
      LC_PAPER = "zh_CN.UTF-8";
      LC_TELEPHONE = "zh_CN.UTF-8";
      LC_TIME = "zh_CN.UTF-8";
    };

    # system-wide fonts settings
    fonts.enableDefaultPackages = true;

    fonts.packages = with pkgs; [
      adwaita-fonts
      nerd-fonts.fira-code
      nerd-fonts.zed-mono
      nerd-fonts.adwaita-mono
      nerd-fonts.iosevka
      noto-fonts
      noto-fonts-cjk-sans
      noto-fonts-cjk-serif
      noto-fonts-color-emoji
      font-awesome
      windows-fonts
    ];

    fonts.fontconfig = {
      enable = true;
      defaultFonts = {
        serif = [
          "Liberation Serif"
          "Noto Serif CJK SC"
        ];
        sansSerif = [
          "Adwaita Sans"
          "Noto Sans CJK SC"
        ];
        monospace = [
          "AdwaitaMono Nerd Font"
          "Iosevka NF"
        ];
      };
    };

    # configure keymap in X11
    services.xserver.xkb = {
      layout = "us";
      variant = "";
    };
  };
}
