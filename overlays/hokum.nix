final: prev: {
  hokum = final.callPackage (
    {
      lib,
      stdenv,
      fetchurl,
      dpkg,
      autoPatchelfHook,
      makeWrapper,
      libxkbcommon,
      pipewire,
      vulkan-loader,
      wayland,
    }:
    let
      version = "0.1.3";
      hashes = {
        x86_64-linux = "sha256-EUJOKy1Pmxne/MbuveByW8WJY3d2OD1wFkjqz/cNq9A=";
        aarch64-linux = "sha256-VtpZ1cu+VnpbOjIlJyqAaVvi4AigmA/23HMh4l6J1TM=";
      };
      arch =
        if stdenv.hostPlatform.system == "x86_64-linux" then
          "x64"
        else if stdenv.hostPlatform.system == "aarch64-linux" then
          "arm64"
        else
          throw "Unsupported system: ${stdenv.hostPlatform.system}";
    in
    stdenv.mkDerivation {
      pname = "hokum";
      inherit version;

      src = fetchurl {
        url = "https://github.com/anomalyco/hokum/releases/download/v${version}/hokum-${version}-linux-${arch}.deb";
        hash =
          hashes.${stdenv.hostPlatform.system} or (throw "Unsupported system: ${stdenv.hostPlatform.system}");
      };

      nativeBuildInputs = [
        dpkg
        autoPatchelfHook
        makeWrapper
      ];

      buildInputs = [
        libxkbcommon
        pipewire
        vulkan-loader
        wayland
        stdenv.cc.cc.lib
      ];

      runtimeDependencies = [
        libxkbcommon
        pipewire
        vulkan-loader
        wayland
      ];

      unpackPhase = "dpkg-deb -x $src .";

      installPhase = ''
        runHook preInstall
        mkdir -p $out
        cp -r usr/* $out/
        substituteInPlace $out/lib/systemd/user/hokum.service \
          --replace-fail "/usr/bin/hokum" "$out/bin/hokum"
        substituteInPlace $out/share/dbus-1/services/app.hokum.Notifications.service \
          --replace-fail "/usr/bin/hokum" "$out/bin/hokum"
        wrapProgram $out/bin/hokum \
          --prefix XDG_DATA_DIRS : "/run/current-system/sw/share/X11"
        runHook postInstall
      '';

      meta = with lib; {
        description = "Control center for Wayland (notifications, sound, Bluetooth)";
        homepage = "https://hokum.app";
        license = licenses.mit;
        sourceProvenance = [ sourceTypes.binaryNativeCode ];
        platforms = [
          "x86_64-linux"
          "aarch64-linux"
        ];
        mainProgram = "hokum";
      };
    }
  ) { };
}
