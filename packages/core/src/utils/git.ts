import type { StatusResult } from 'simple-git'
import { simpleGit } from 'simple-git'

export function createRepositoryGit(baseDir: string) {
  return simpleGit({ baseDir, maxConcurrentProcesses: 1, trimmed: true })
}

export function formatGitStatus(status: StatusResult | undefined) {
  if (!status) {
    return '(unknown)'
  }

  const lines = [
    `branch: ${status.current ?? '(unknown)'}`,
    `tracking: ${status.tracking ?? '(none)'}`,
    `ahead: ${status.ahead}`,
    `behind: ${status.behind}`,
    ...status.files.map(file => `${file.index}${file.working_dir} ${file.path}`),
  ]

  return lines.join('\n') || '(clean)'
}
