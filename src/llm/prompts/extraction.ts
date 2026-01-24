import * as v from 'valibot'

/**
 * Schema for section extraction (when no TOC exists)
 */
export const SectionExtractionSchema = v.object({
  thinking: v.string(),
  sections: v.array(
    v.object({
      structure: v.string(),
      title: v.string(),
      startPage: v.number(),
      endPage: v.number(),
    })
  ),
})

export type SectionExtractionResult = v.InferOutput<typeof SectionExtractionSchema>

/**
 * Prompt for extracting sections from document content (no TOC)
 */
export function sectionExtractionPrompt(
  documentContent: string,
  pageRange: { start: number; end: number }
): { system: string; user: string } {
  return {
    system: `You are analyzing document content to identify its hierarchical structure.

Your task is to:
1. Identify major sections, chapters, or topics
2. Determine where each section starts and ends
3. Create a hierarchical structure

Guidelines:
- Look for headers, titles, numbered sections
- Consider visual breaks and topic changes
- Group related content together
- Use dot notation for hierarchy: "1", "1.1", "1.1.1"
- Page indices are 0-based

Output sections that would make sense as a table of contents.`,

    user: `Analyze this document content (pages ${pageRange.start}-${pageRange.end}) and identify its structure:

---
${documentContent}
---

Extract the hierarchical sections with their page ranges.`,
  }
}

/**
 * Schema for page matching (find which page contains a section)
 */
export const PageMatchSchema = v.object({
  thinking: v.string(),
  pageIndex: v.number(),
  confidence: v.number(),
  appearsAtStart: v.boolean(),
})

export type PageMatchResult = v.InferOutput<typeof PageMatchSchema>

/**
 * Prompt for finding which page contains a specific section
 */
export function pageMatchPrompt(
  sectionTitle: string,
  pagesContent: Array<{ index: number; content: string }>
): { system: string; user: string } {
  const pagesText = pagesContent
    .map((p) => `=== PAGE ${p.index} ===\n${p.content}`)
    .join('\n\n')

  return {
    system: `You are finding which page contains a specific section title.

Guidelines:
- Look for exact or near-exact matches of the section title
- The title might be a header, chapter name, or major topic
- Consider formatting differences (caps, spacing)
- Determine if the section starts at the beginning of the page or mid-page`,

    user: `Find which page contains the section: "${sectionTitle}"

Pages to search:
${pagesText}

Identify the page index (0-based) where this section appears.`,
  }
}

/**
 * Schema for title appearance verification
 */
export const TitleVerificationSchema = v.object({
  thinking: v.string(),
  found: v.boolean(),
  appearsAtStart: v.boolean(),
  matchType: v.picklist(['exact', 'fuzzy', 'not_found']),
})

export type TitleVerificationResult = v.InferOutput<typeof TitleVerificationSchema>

/**
 * Prompt for verifying if a title appears on a specific page
 */
export function titleVerificationPrompt(
  title: string,
  pageContent: string
): { system: string; user: string } {
  return {
    system: `You are verifying if a section title appears on a document page.

Guidelines:
- Check for exact matches first
- Allow for minor formatting differences (whitespace, capitalization)
- Determine if the title is at the start of the page content
- The title might be a header, not just inline text`,

    user: `Does the title "${title}" appear on this page?

Page content:
---
${pageContent}
---

Verify if this title is present and where it appears.`,
  }
}

/**
 * Schema for continuation detection (large document processing)
 */
export const ContinuationSchema = v.object({
  thinking: v.string(),
  isComplete: v.boolean(),
  lastProcessedStructure: v.optional(v.string()),
})

export type ContinuationResult = v.InferOutput<typeof ContinuationSchema>
