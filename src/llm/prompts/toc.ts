import * as v from 'valibot'

/**
 * Schema for TOC detection response
 */
export const TocDetectionSchema = v.object({
  thinking: v.string(),
  hasToc: v.boolean(),
  confidence: v.number(),
})

export type TocDetectionResult = v.InferOutput<typeof TocDetectionSchema>

/**
 * Prompt for detecting if a page contains a table of contents
 */
export function tocDetectionPrompt(pageContent: string): {
  system: string
  user: string
} {
  return {
    system: `You are analyzing document pages to detect tables of contents.

A table of contents (TOC) typically has:
- A clear header like "Table of Contents", "Contents", "Index"
- A list of section/chapter names with page numbers
- Hierarchical structure (chapters, sections, subsections)
- References to different parts of the document

Do NOT confuse with:
- Regular lists or bullet points
- Bibliographies or references
- Index pages (alphabetical term lists)
- Glossaries`,

    user: `Analyze this page and determine if it contains a table of contents:

---
${pageContent}
---

Determine if this is a TOC page.`,
  }
}

/**
 * Schema for TOC extraction response
 */
export const TocExtractionSchema = v.object({
  thinking: v.string(),
  entries: v.array(
    v.object({
      structure: v.string(),
      title: v.string(),
      page: v.optional(v.number()),
    })
  ),
  hasPageNumbers: v.boolean(),
})

export type TocExtractionResult = v.InferOutput<typeof TocExtractionSchema>

/**
 * Prompt for extracting TOC entries from content
 */
export function tocExtractionPrompt(tocContent: string): {
  system: string
  user: string
} {
  return {
    system: `You are extracting table of contents entries from document pages.

For each entry, extract:
1. The hierarchical structure (e.g., "1", "1.1", "2.3.1")
2. The section title
3. The page number (if present)

Maintain the hierarchical relationships. Use dot notation for nested levels:
- Top level: "1", "2", "3"
- Second level: "1.1", "1.2", "2.1"
- Third level: "1.1.1", "1.1.2"

If no explicit numbering, infer from indentation/position.`,

    user: `Extract all TOC entries from this content:

---
${tocContent}
---

Extract each entry with its structure, title, and page number (if available).`,
  }
}

/**
 * Schema for TOC transformation to structured format
 */
export const TocTransformSchema = v.object({
  thinking: v.string(),
  entries: v.array(
    v.object({
      structure: v.string(),
      title: v.string(),
      page: v.optional(v.number()),
    })
  ),
})

export type TocTransformResult = v.InferOutput<typeof TocTransformSchema>

/**
 * Prompt for finding page number offset (TOC page vs actual page)
 */
export function pageOffsetPrompt(
  tocEntry: { title: string; page: number },
  pageContent: string,
  actualPageIndex: number
): { system: string; user: string } {
  return {
    system: `You are analyzing documents to find the page number offset.

Documents often have different numbering:
- TOC might say "Chapter 1 starts on page 1"
- But in the PDF, it's actually on page 5 (due to preface, etc.)

The offset = actualPageIndex - tocPageNumber

Analyze if the content matches the expected section.`,

    user: `The TOC says "${tocEntry.title}" is on page ${tocEntry.page}.
We found similar content on actual page index ${actualPageIndex}.

Page content:
---
${pageContent}
---

Does this content match the section "${tocEntry.title}"?
If yes, the offset would be ${actualPageIndex - tocEntry.page}.`,
  }
}
