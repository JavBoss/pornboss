export function canOpenAlternatePlayer({ containerMode, clientMode, alternatePlayer }) {
  // The container flag describes the server; client MPV runs on the local machine.
  return !containerMode || (clientMode && alternatePlayer === 'mpv')
}
