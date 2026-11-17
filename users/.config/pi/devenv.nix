{
  ...
}:
{
  # Node.js, npm and node_modules/.bin on PATH. npm install runs in the first
  # shell of a session, and again after package-lock.json or the Node.js version
  # changes (languages/javascript.nix keeps a checksum in node_modules).
  languages.javascript = {
    enable = true;
    npm = {
      enable = true;
      install.enable = true;
    };
  };

  # pi, rtk, rg and fd are not listed: they come from the host profile on PATH,
  # so the extension runs in the same runtime as normal use. Enabling
  # languages.typescript is also avoided, because tsc comes from the npm
  # devDependency and must be the only one on PATH.

  # Type-check, lint and format-check every extension; the npm check script runs
  # tsc, eslint and prettier.
  scripts.pi-check = {
    description = "type-check, lint and format-check ./extensions";
    exec = ''
      cd "$DEVENV_ROOT"
      exec npm run --silent check
    '';
  };

  # Discovery is off, so the read-only copy that home-manager links into
  # ~/.pi/agent/extensions does not load the same file a second time. Pi keeps
  # the normal auth and settings, but /reload does not re-read this file.
  scripts.pi-dev = {
    description = "run pi with one extension from ./extensions, discovery off";
    exec = ''
      if [ $# -lt 1 ]; then
        echo "usage: pi-dev <file.ts | extensions/file.ts> [pi args...]" >&2
        exit 2
      fi

      # node_modules/.bin/pi is the npm copy that supplies the type definitions,
      # and languages.javascript puts node_modules/.bin first on PATH. Skip it,
      # so the extension loads in the host pi, the runtime used in normal use.
      host_pi() {
        local dir
        local IFS=:
        for dir in $PATH; do
          case "$dir" in
            */node_modules/.bin) continue ;;
          esac
          [ -n "$dir" ] || continue
          if [ -x "$dir/pi" ]; then
            printf '%s\n' "$dir/pi"
            return 0
          fi
        done
        return 1
      }

      pi_bin=$(host_pi) || {
        echo "pi-dev: no pi outside node_modules/.bin on PATH" >&2
        exit 1
      }

      ext=$1
      shift
      case "$ext" in
        */*) file=$ext ;;
        *) file=$DEVENV_ROOT/extensions/$ext ;;
      esac

      if [ ! -f "$file" ]; then
        echo "pi-dev: no such extension file: $file" >&2
        exit 1
      fi

      exec "$pi_bin" -ne -e "$file" "$@"
    '';
  };
}
