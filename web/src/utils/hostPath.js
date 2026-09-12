export function hostPathsEnabled(config) {
  const value = config?.host_path_prefix_enabled
  const flag = value == null || value === '' ? config?.runtime_container : value
  if (flag == null || flag === '') return false
  return !['0', 'false', 'no', 'off'].includes(String(flag).trim().toLowerCase())
}

export function displayHostPath(value, enabled = false) {
  const raw = String(value || '')
  if (!enabled) return raw
  if (raw === '/host') return '/'
  if (raw.startsWith('/host/')) return raw.slice('/host'.length)
  return raw
}

export function apiHostPath(value, enabled = false) {
  const raw = String(value || '').trim()
  if (!enabled || !raw || raw === '/host' || raw.startsWith('/host/')) return raw
  if (raw === '/') return '/host'
  if (raw.startsWith('/')) return `/host${raw}`
  return raw
}
