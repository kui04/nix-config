# Combined agent skills: local skills from users/.config/agents/skills plus
# third-party skills (see https://www.skills.sh/) fetched and pinned by Nix.
# To add one: add an entry to `thirdParty`, set `hash = lib.fakeHash`, rebuild,
# then paste the hash from the error. To update: bump `rev` and the hash.
{ pkgs }:
let
  inherit (pkgs) lib;

  localSkills = ../../.config/agents/skills;

  anthropicsSkills = pkgs.fetchFromGitHub {
    owner = "anthropics";
    repo = "skills";
    rev = "dbd4588f9e1033efb41dad4bef2f7947c8993d44";
    hash = "sha256-+UIqBnzyeIOvJSKYaDaE3GYPEpLw7qQqyUw5S971AfU=";
  };

  # name -> path to the skill directory
  thirdParty = {
    skill-creator = "${anthropicsSkills}/skills/skill-creator";
  };
in
pkgs.runCommand "agent-skills" { } ''
  mkdir -p $out
  cp -r ${localSkills}/. $out/
  ${lib.concatStringsSep "\n" (
    lib.mapAttrsToList (name: path: "ln -s ${path} $out/${name}") thirdParty
  )}
''
