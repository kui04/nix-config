final: prev: {
  codegraph = final.buildNpmPackage rec {
    pname = "codegraph";
    version = "1.2.0";

    src = final.fetchFromGitHub {
      owner = "colbymchenry";
      repo = "codegraph";
      rev = "v${version}";
      hash = "sha256-JLyu6FG74R/3RwBFNhen3U9swA0AFyJh7q5obNA/ZpE=";
    };

    nodejs = final.nodejs_24;

    npmDepsHash = "sha256-ilOWXV6PlKoY/JTpRYsmhtZuj/VfXWrUvAXC1MZVCn8=";
    npmBuildScript = "build";

    nativeBuildInputs = [ final.makeWrapper ];

    installPhase = ''
      runHook preInstall

      mkdir -p $out/lib/codegraph
      cp -r dist $out/lib/codegraph/dist
      cp package.json $out/lib/codegraph/

      npm prune --omit=dev
      find node_modules -mindepth 1 -maxdepth 1 -type d -empty -delete
      cp -r node_modules $out/lib/codegraph/node_modules

      mkdir -p $out/bin
      makeWrapper ${final.nodejs_24}/bin/node $out/bin/codegraph \
        --add-flags "--liftoff-only $out/lib/codegraph/dist/bin/codegraph.js"

      runHook postInstall
    '';

    meta = {
      description = "Local-first code intelligence for AI agents";
      homepage = "https://github.com/colbymchenry/codegraph";
      license = final.lib.licenses.mit;
      mainProgram = "codegraph";
      platforms = final.lib.platforms.unix;
    };
  };
}
