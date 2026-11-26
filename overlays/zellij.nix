# nixpkgs-unstable packages zellij 0.46.0, but zellij-mcp-server needs the
# `zellij events` command that landed in 0.46.1. The wrapper has no build
# attributes of its own, so swap its unwrapped input for a newer build.
final: prev:
let
  version = "0.46.1";

  zellij-unwrapped = prev.zellij-unwrapped.overrideAttrs (oldAttrs: {
    inherit version;

    src = prev.fetchFromGitHub {
      owner = "zellij-org";
      repo = "zellij";
      tag = "v${version}";
      hash = "sha256-sLH3ox4DY6JkrQAaI8IxnA7or1458gF4nEKBuPuQPI8=";
    };

    cargoHash = "sha256-qkXg4Vt+x3r1zka5htPtlO28B6bh+oiKGsinCdBASFA=";

    # nixpkgs cargo hooks export AWS_LC_SYS_USE_SYSTEM=1 for every Rust build.
    # zellij 0.46.1 moved to aws-lc-sys 0.47.0, whose build script refuses to
    # compile from source in that mode, so link the system aws-lc instead.
    buildInputs = oldAttrs.buildInputs ++ [ prev.aws-lc ];
  });
in
{
  zellij = prev.zellij.override { inherit zellij-unwrapped; };
}
