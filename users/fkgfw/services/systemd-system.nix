{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.systemd.system;
  managedUnitsDir = ".local/share/home-manager-systemd/system";
  managedUnitsPath = "home-files/${managedUnitsDir}";
  systemctl = "${pkgs.systemd}/bin/systemctl";

  serviceFiles = lib.mapAttrs' (
    name: text: lib.nameValuePair "${managedUnitsDir}/${name}.service" { inherit text; }
  ) cfg.services;
in
{
  options.systemd.system.services = lib.mkOption {
    type = lib.types.attrsOf lib.types.str;
    default = { };
    description = ''
      System-level systemd service units managed by Home Manager activation.
      Attribute names are service names without the .service suffix; values are
      complete systemd unit file contents.
    '';
  };

  config = {
    assertions = [
      {
        assertion = pkgs.stdenv.isLinux;
        message = "systemd.system.services is only available on Linux.";
      }
    ];

    home.file = serviceFiles;

    home.activation.switchSystemdSystemServices =
      lib.hm.dag.entryAfter [ "linkGeneration" "decryptAgenix" ]
        ''
          systemUnitsDir=/etc/systemd/system
          newUnitsDir="$newGenPath/${managedUnitsPath}"
          serviceChanges=
          serviceDrift=

          verboseEcho "[systemd-system] new units dir: $newUnitsDir"

          if [[ ! -d "$newUnitsDir" ]]; then
            newUnitsDir=${pkgs.emptyDirectory}
            verboseEcho "[systemd-system] no new units dir; using empty directory"
          fi

          oldUnitsDir=
          if [[ -v oldGenPath ]]; then
            oldUnitsDir="$oldGenPath/${managedUnitsPath}"
            verboseEcho "[systemd-system] old units dir: $oldUnitsDir"

            if [[ ! -d "$oldUnitsDir" ]]; then
              legacyOldUnitsDir="$oldGenPath/home-files/.config/systemd-services"
              if [[ -d "$legacyOldUnitsDir" ]]; then
                oldUnitsDir="$legacyOldUnitsDir"
                verboseEcho "[systemd-system] using legacy old units dir: $oldUnitsDir"
              else
                oldUnitsDir=${pkgs.emptyDirectory}
                verboseEcho "[systemd-system] no old units dir; using empty directory"
              fi
            fi
          else
            oldUnitsDir=${pkgs.emptyDirectory}
            verboseEcho "[systemd-system] no old generation; using empty directory"
          fi

          workDir="$(${pkgs.coreutils}/bin/mktemp -d)"

          listUnits() {
            local dir="$1"
            if [[ -d "$dir" ]]; then
              ${pkgs.findutils}/bin/find "$dir" \
                -maxdepth 1 -name '*.service' ! -name '*@.service' -exec ${pkgs.coreutils}/bin/basename '{}' ';' \
                | ${pkgs.coreutils}/bin/sort
            fi
          }

          oldServiceFiles="$workDir/old-files"
          newServiceFiles="$workDir/new-files"
          servicesDiffFile="$workDir/diff-files"

          listUnits "$oldUnitsDir" > "$oldServiceFiles"
          listUnits "$newUnitsDir" > "$newServiceFiles"

          ${pkgs.diffutils}/bin/diff \
            --new-line-format='+%L' \
            --old-line-format='-%L' \
            --unchanged-line-format=' %L' \
            "$oldServiceFiles" "$newServiceFiles" \
            > "$servicesDiffFile" || true

          mapfile -t maybeRestart < <(${pkgs.gnugrep}/bin/grep '^ ' "$servicesDiffFile" | ${pkgs.coreutils}/bin/cut -c2- || true)
          mapfile -t maybeStop < <(${pkgs.gnugrep}/bin/grep '^-' "$servicesDiffFile" | ${pkgs.coreutils}/bin/cut -c2- || true)
          mapfile -t maybeStart < <(${pkgs.gnugrep}/bin/grep '^+' "$servicesDiffFile" | ${pkgs.coreutils}/bin/cut -c2- || true)
          ${pkgs.coreutils}/bin/rm -rf "$workDir"

          needReload=
          toStart=()
          toRestart=()

          installUnit() {
            local unit="$1"
            $DRY_RUN_CMD ${pkgs.coreutils}/bin/install -Dm644 "$newUnitsDir/$unit" "$systemUnitsDir/$unit"
          }

          for unit in "''${maybeStop[@]}"; do
            _i "[systemd-system] Removing obsolete service: %s" "$unit"
            $DRY_RUN_CMD ${systemctl} disable --now "$unit" || true
            $DRY_RUN_CMD ${pkgs.coreutils}/bin/rm -f "$systemUnitsDir/$unit"
            needReload=1
            serviceChanges=1
          done

          for unit in "''${maybeStart[@]}"; do
            _i "[systemd-system] Installing new service: %s" "$unit"
            installUnit "$unit"
            toStart+=("$unit")
            needReload=1
            serviceChanges=1
          done

          for unit in "''${maybeRestart[@]}"; do
            if ! ${pkgs.diffutils}/bin/cmp --quiet "$oldUnitsDir/$unit" "$newUnitsDir/$unit"; then
              _i "[systemd-system] Updating changed service: %s" "$unit"
              installUnit "$unit"
              toRestart+=("$unit")
              needReload=1
              serviceChanges=1
            elif [[ ! -e "$systemUnitsDir/$unit" ]] || ! ${pkgs.diffutils}/bin/cmp --quiet "$newUnitsDir/$unit" "$systemUnitsDir/$unit"; then
              _i "[systemd-system] Reinstalling drifted service: %s" "$unit"
              installUnit "$unit"
              toRestart+=("$unit")
              needReload=1
              serviceDrift=1
            fi
          done

          if [[ -n "$needReload" ]]; then
            _i "[systemd-system] Reloading systemd daemon"
            $DRY_RUN_CMD ${systemctl} daemon-reload
          fi

          for unit in "''${toStart[@]}"; do
            _i "[systemd-system] Starting service: %s" "$unit"
            $DRY_RUN_CMD ${systemctl} enable --now "$unit"
          done

          for unit in "''${toRestart[@]}"; do
            _i "[systemd-system] Restarting service: %s" "$unit"
            $DRY_RUN_CMD ${systemctl} enable "$unit"
            $DRY_RUN_CMD ${systemctl} restart "$unit"
          done

          if [[ -z "$serviceChanges" && -z "$serviceDrift" ]]; then
            _i "[systemd-system] No service changes detected"
          fi

          unset newUnitsDir oldUnitsDir legacyOldUnitsDir needReload serviceChanges serviceDrift
          unset oldServiceFiles newServiceFiles servicesDiffFile workDir
        '';
  };
}
