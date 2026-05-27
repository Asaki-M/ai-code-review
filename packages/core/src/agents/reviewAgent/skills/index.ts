import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMarkdownFrontmatter } from '../../../utils/frontmatter.js'

export type ReviewSkillName = 'common' | 'frontend' | 'backend' | 'sql' | 'commit'

export interface ReviewSkill {
  name: ReviewSkillName
  description: string
  content: string
}

const skillFileNames = ['common.md', 'frontend.md', 'backend.md', 'sql.md', 'commit.md'] as const

function parseSkillMarkdown(markdown: string): ReviewSkill {
  const { metadata, content } = parseMarkdownFrontmatter(markdown)

  const name = metadata.name
  const description = metadata.description

  if (!isReviewSkillName(name)) {
    throw new Error(`Invalid review skill name: ${name}`)
  }

  if (!description) {
    throw new Error(`Review skill ${name} must include a description.`)
  }

  return {
    name,
    description,
    content,
  }
}

function isReviewSkillName(value: unknown): value is ReviewSkillName {
  return value === 'common' || value === 'frontend' || value === 'backend' || value === 'sql' || value === 'commit'
}

function loadReviewSkills() {
  const skillDir = dirname(fileURLToPath(import.meta.url))

  return skillFileNames.map((fileName) => {
    const markdown = readFileSync(join(skillDir, fileName), 'utf8')
    return parseSkillMarkdown(markdown)
  })
}

export const reviewSkills = loadReviewSkills()

export const reviewSkillCatalog = reviewSkills
  .map(skill => `- ${skill.name}: ${skill.description}`)
  .join('\n')

export function getReviewSkillContent(name: ReviewSkillName) {
  return reviewSkills.find(skill => skill.name === name)?.content
}
