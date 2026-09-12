#!/usr/bin/env bash
set -euo pipefail

REPO="Solr159/JavBoss"
VERSION="v2.1.0"
INSTALL_DIR=""
TMP_DIR=""

prefers_chinese() {
  local locale_text
  locale_text="${JAVBOSS_LANG:-} ${LANGUAGE:-} ${LC_ALL:-} ${LC_MESSAGES:-} ${LANG:-}"
  case "$locale_text" in
    *zh*|*ZH*) return 0 ;;
    *) return 1 ;;
  esac
}

log() {
  printf '[javboss] %s\n' "$*"
}

die() {
  printf '[javboss] ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "${TMP_DIR:-}" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

path_has_dir() {
  case ":$PATH:" in
    *":$1:"*) return 0 ;;
    *) return 1 ;;
  esac
}

command_link_dir() {
  if [[ -n "${JAVBOSS_LINK_DIR:-}" ]]; then
    printf '%s' "$JAVBOSS_LINK_DIR"
    return
  fi

  if [[ "$(uname -s)" == "Darwin" ]]; then
    printf '/usr/local/bin'
    return
  fi

  printf '%s/.local/bin' "$HOME"
}

path_profile_file() {
  if [[ -n "${JAVBOSS_PROFILE:-}" ]]; then
    printf '%s' "$JAVBOSS_PROFILE"
    return
  fi

  case "$(basename "${SHELL:-}")" in
    zsh) printf '%s/.zprofile' "$HOME" ;;
    bash)
      if [[ "$(uname -s)" == "Darwin" ]]; then
        printf '%s/.bash_profile' "$HOME"
      else
        printf '%s/.bashrc' "$HOME"
      fi
      ;;
    *) printf '%s/.profile' "$HOME" ;;
  esac
}

path_entry_for_profile() {
  local link_dir="$1"
  case "$link_dir" in
    "$HOME"/*) printf '$HOME/%s' "${link_dir#"$HOME/"}" ;;
    *) printf '%s' "$link_dir" ;;
  esac
}

download_file() {
  local url="$1"
  local dest="$2"
  if command_exists curl; then
    curl -fL --retry 3 -o "$dest" "$url"
    return
  fi
  if command_exists wget; then
    wget --tries=3 -O "$dest" "$url"
    return
  fi
  die "curl or wget is required"
}

detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux)
      case "$arch" in
        x86_64|amd64) printf 'linux-x86_64' ;;
        *) die "unsupported Linux architecture: $arch" ;;
      esac
      ;;
    Darwin)
      case "$arch" in
        x86_64|amd64) printf 'macos-x86_64' ;;
        arm64|aarch64) printf 'macos-arm64' ;;
        *) die "unsupported macOS architecture: $arch" ;;
      esac
      ;;
    *)
      die "unsupported OS: $os. Use scripts/install.ps1 on Windows"
      ;;
  esac
}

default_install_dir() {
  case "$(uname -s)" in
    Darwin) printf '%s/Applications/JavBoss' "$HOME" ;;
    *) printf '%s/.local/share/javboss' "$HOME" ;;
  esac
}

version_file_path() {
  printf '%s/.version' "$1"
}

installed_version() {
  local install_dir="$1"
  local version_file
  version_file="$(version_file_path "$install_dir")"
  if [[ -f "$install_dir/javboss" && -f "$version_file" ]]; then
    head -n 1 "$version_file" | tr -d '[:space:]'
  fi
}

write_installed_version() {
  local install_dir="$1"
  local tag="$2"
  printf '%s\n' "$tag" >"$(version_file_path "$install_dir")"
}

canonical_path() {
  local target="$1"
  local dir base
  dir="$(dirname "$target")"
  base="$(basename "$target")"
  if [[ -d "$dir" ]]; then
    (cd "$dir" && printf '%s/%s' "$(pwd -P)" "$base")
  else
    printf '%s' "$target"
  fi
}

running_javboss_pids() {
  local install_dir="$1"
  local exe
  exe="$(canonical_path "$install_dir/javboss")"

  if [[ "$(uname -s)" == "Linux" && -d /proc ]]; then
    local pid proc_exe
    for pid in $(pgrep -x javboss 2>/dev/null || true); do
      proc_exe="$(readlink "/proc/$pid/exe" 2>/dev/null || true)"
      if [[ "$proc_exe" == "$exe" ]]; then
        printf '%s\n' "$pid"
      fi
    done
    return
  fi

  if command_exists pgrep; then
    pgrep -f "$exe" 2>/dev/null || true
  fi
}

ensure_not_running() {
  local install_dir="$1"
  local pids
  if [[ ! -e "$install_dir/javboss" ]]; then
    return
  fi
  pids="$(running_javboss_pids "$install_dir" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  if [[ -n "$pids" ]]; then
    if prefers_chinese; then
      die "JavBoss 已经从 $install_dir 启动（PID：$pids）。安装或升级前请先退出 JavBoss。"
    fi
    die "JavBoss is already running from $install_dir (pid: $pids). Please exit JavBoss before installing or upgrading."
  fi
}

copy_release_files() {
  local src="$1"
  local dest="$2"
  local protected_config=""

  mkdir -p "$dest"
  if [[ -f "$dest/config.toml" ]]; then
    protected_config="$(mktemp)"
    cp "$dest/config.toml" "$protected_config"
  fi

  rm -rf "$dest/internal" "$dest/web" "$dest/modernz"
  rm -f "$dest/javboss" "$dest/javboss.exe" "$dest/javboss.command"
  cp -R "$src"/. "$dest"/

  if [[ -n "$protected_config" ]]; then
    cp "$protected_config" "$dest/config.toml"
    rm -f "$protected_config"
  fi
}

create_command_link() {
  local install_dir="$1"
  local link_dir
  link_dir="$(command_link_dir)"
  local link_path="$link_dir/javboss"
  local wrapper

  wrapper="$(printf '#!/usr/bin/env bash\ncd %q || exit 1\nexec ./javboss "$@"\n' "$install_dir")"

  if ! mkdir -p "$link_dir" 2>/dev/null; then
    command_exists sudo || die "cannot create command directory: $link_dir"
    log "permission is required to create command directory: $link_dir"
    sudo mkdir -p "$link_dir" || die "cannot create command directory: $link_dir"
  fi

  if ! {
    rm -f "$link_path" &&
      printf '%s\n' "$wrapper" >"$link_path" &&
      chmod 0755 "$link_path"
  } 2>/dev/null; then
    command_exists sudo || die "cannot create command link: $link_path"
    log "permission is required to create command link: $link_path"
    sudo rm -f "$link_path" || die "cannot replace command link: $link_path"
    printf '%s\n' "$wrapper" | sudo tee "$link_path" >/dev/null || die "cannot create command link: $link_path"
    sudo chmod 0755 "$link_path" || die "cannot make command link executable: $link_path"
  fi

  log "command installed: $link_path"
}

ensure_command_on_path() {
  local link_dir
  local profile
  local profile_dir
  local path_entry
  local marker
  link_dir="$(command_link_dir)"
  profile="$(path_profile_file)"
  profile_dir="$(dirname "$profile")"
  path_entry="$(path_entry_for_profile "$link_dir")"
  marker="# Added by JavBoss installer: $path_entry"

  if path_has_dir "$link_dir"; then
    log "command directory already on PATH: $link_dir"
    return
  fi

  export PATH="$link_dir:$PATH"

  if [[ -f "$profile" ]] && grep -Fq "$path_entry" "$profile"; then
    log "PATH already configured in $profile"
    return
  fi

  mkdir -p "$profile_dir" || die "cannot create profile directory: $profile_dir"
  if [[ ! -e "$profile" ]]; then
    touch "$profile" || die "cannot create profile: $profile"
  fi

  {
    printf '\n%s\n' "$marker"
    printf 'case ":$PATH:" in\n'
    printf '  *":%s:"*) ;;\n' "$path_entry"
    printf '  *) export PATH="%s:$PATH" ;;\n' "$path_entry"
    printf 'esac\n'
  } >>"$profile" || die "cannot update PATH in $profile"

  log "PATH configured in $profile"
}

start_javboss() {
  local install_dir="$1"
  if [[ -e /dev/tty ]] && { : </dev/tty; } 2>/dev/null; then
    (cd "$install_dir" && ./javboss) </dev/tty
    return
  fi
  (cd "$install_dir" && ./javboss)
}

main() {
  command_exists unzip || die "unzip is required"

  local platform tag filename url zip_file extract_dir release_dir
  platform="$(detect_platform)"
  INSTALL_DIR="$(default_install_dir)"

  tag="$VERSION"
  if [[ "$(installed_version "$INSTALL_DIR")" == "$tag" ]]; then
    create_command_link "$INSTALL_DIR"
    ensure_command_on_path
    log "JavBoss $tag is already installed; no update needed"
    return
  fi

  ensure_not_running "$INSTALL_DIR"

  filename="javboss-${tag}-${platform}.zip"
  url="https://github.com/${REPO}/releases/download/${tag}/${filename}"

  TMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  zip_file="$TMP_DIR/$filename"
  extract_dir="$TMP_DIR/extract"
  mkdir -p "$extract_dir"

  log "downloading $url"
  download_file "$url" "$zip_file"

  log "extracting release package"
  unzip -q "$zip_file" -d "$extract_dir"
  release_dir="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d -print -quit)"
  [[ -n "$release_dir" && -f "$release_dir/javboss" ]] || die "release package layout is invalid"

  log "installing to $INSTALL_DIR"
  copy_release_files "$release_dir" "$INSTALL_DIR"
  chmod +x "$INSTALL_DIR/javboss" 2>/dev/null || true
  [[ ! -f "$INSTALL_DIR/javboss.command" ]] || chmod +x "$INSTALL_DIR/javboss.command" 2>/dev/null || true

  if command_exists xattr; then
    xattr -dr com.apple.quarantine "$INSTALL_DIR" >/dev/null 2>&1 || true
  fi

  create_command_link "$INSTALL_DIR"
  ensure_command_on_path
  write_installed_version "$INSTALL_DIR" "$tag"

  log "installed JavBoss $tag"
  log "starting JavBoss"
  start_javboss "$INSTALL_DIR"
}

main "$@"
