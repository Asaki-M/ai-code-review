export interface MarkdownWithFrontmatter {
  metadata: Record<string, string>
  content: string
}

export function parseMarkdownFrontmatter(markdown: string): MarkdownWithFrontmatter {
  const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)

  if (!frontmatterMatch) {
    throw new Error('Markdown must start with YAML frontmatter.')
  }

  return {
    metadata: parseYamlLikeMetadata(frontmatterMatch[1]),
    content: frontmatterMatch[2].trim(),
  }
}

function parseYamlLikeMetadata(source: string) {
  return Object.fromEntries(
    source
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separatorIndex = line.indexOf(':')

        if (separatorIndex === -1) {
          throw new Error(`Invalid frontmatter line: ${line}`)
        }

        return [
          line.slice(0, separatorIndex).trim(),
          line.slice(separatorIndex + 1).trim(),
        ]
      }),
  )
}
