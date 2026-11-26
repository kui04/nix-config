# nixpkgs-unstable packages antigravity-hub, the "Antigravity App" from
# https://antigravity.google/download, but pins an older release. Its download
# URL embeds a build id next to the version, so the override sets both and
# replaces the source; the rest of the nixpkgs recipe is reused unchanged.
final: prev:
let
  version = "2.35.2";
  buildId = "4585983447007232";

  sources = {
    x86_64-linux = {
      platform = "linux-x64";
      hash = "sha256-LTPbKCsemzx1gsFA2rnoaEjxs3oFv6Sh3/f0TeG/ME8=";
    };
    aarch64-linux = {
      platform = "linux-arm";
      hash = "sha256-jevgvhGpqJq0ShAjPj/e+46K0ltc7+tY8kV9GNCrkHA=";
    };
  };

  source =
    sources.${prev.stdenv.hostPlatform.system}
      or (throw "antigravity-hub: unsupported system ${prev.stdenv.hostPlatform.system}");
in
{
  antigravity-hub = prev.antigravity-hub.overrideAttrs (oldAttrs: {
    inherit version;

    src = prev.fetchurl {
      url = "https://storage.googleapis.com/antigravity-public/antigravity-hub/${version}-${buildId}/${source.platform}/Antigravity.tar.gz";
      inherit (source) hash;
    };

    # buildId feeds the source URL, so it must match the version above; the
    # updateScript and other passthru entries come from nixpkgs
    passthru = oldAttrs.passthru // {
      inherit buildId;
    };

    # only the two systems above have a hash; do not claim Darwin support
    meta = oldAttrs.meta // {
      platforms = [
        "x86_64-linux"
        "aarch64-linux"
      ];
    };
  });
}
