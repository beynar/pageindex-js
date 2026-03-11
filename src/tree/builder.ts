import type { LanguageModel } from "ai";
import type { TreeNode } from "../types/tree.js";
import type { DocumentInput, IndexingStats } from "../types/document.js";
import type { ProcessingOptions } from "../types/config.js";
import {
	processMarkdown,
	type MarkdownProcessingOptions,
} from "../processing/markdown.js";
import { PdfProcessor, type PdfProcessingOptions } from "../processing/pdf.js";
import { countTokens } from "../llm/tokens.js";
import { getAllNodes } from "./navigation.js";

/**
 * Result from tree building
 */
export interface TreeBuildResult {
	/** The generated tree structure */
	tree: TreeNode[];

	/** Page/section content (for separate storage) */
	pages: Array<{ index: number; text: string; tokenCount: number }>;

	/** Building statistics */
	stats: Omit<IndexingStats, "llmCalls" | "llmTokensUsed" | "durationMs">;
}

/**
 * Tree builder for documents
 */
export class TreeBuilder {
	constructor(
		private model: LanguageModel,
		private options: ProcessingOptions,
	) {}

	/**
	 * Build tree from document input
	 */
	async build(document: DocumentInput): Promise<TreeBuildResult> {
		if (document.type === "markdown") {
			return this.buildFromMarkdown(document);
		} else if (document.type === "pdf") {
			return this.buildFromPdf(document);
		}

		throw new Error(`Unsupported document type: ${document.type}`);
	}

	/**
	 * Build tree from markdown content
	 */
	private async buildFromMarkdown(
		document: DocumentInput,
	): Promise<TreeBuildResult> {
		const content =
			typeof document.content === "string"
				? document.content
				: new TextDecoder().decode(document.content);

		const mdOptions: MarkdownProcessingOptions = {};
		if (this.options.enableTreeThinning !== undefined) {
			mdOptions.enableThinning = this.options.enableTreeThinning;
		}
		if (this.options.thinningThreshold !== undefined) {
			mdOptions.thinningThreshold = this.options.thinningThreshold;
		}

		const tree = processMarkdown(content, mdOptions);

		// Assign node IDs if needed (BEFORE extracting pages so nodeIds match)
		if (this.options.addNodeId) {
			this.assignNodeIds(tree);
		}

		// Generate pages from tree nodes (AFTER nodeId assignment)
		const pages = this.extractPagesFromMarkdownTree(tree, content);

		return {
			tree,
			pages,
			stats: {
				pageCount: pages.length,
				tokenCount: countTokens(content),
				nodeCount: getAllNodes(tree).length,
			},
		};
	}

	/**
	 * Extract pages from markdown tree
	 * Uses nodeId as index for proper mapping in postprocess.
	 * Also updates node startIndex/endIndex to match sequential storage indices.
	 */
	private extractPagesFromMarkdownTree(
		tree: TreeNode[],
		_content: string,
	): Array<{
		index: number;
		text: string;
		tokenCount: number;
		nodeId?: string;
	}> {
		const pages: Array<{
			index: number;
			text: string;
			tokenCount: number;
			nodeId?: string;
		}> = [];

		function extractFromNode(node: TreeNode, index: number): number {
			// Use the text already extracted during markdown parsing
			const text = node.text ?? "";

			// Store the node's own index as startIndex
			const nodeStartIndex = index;

			pages.push({
				index,
				text,
				tokenCount: countTokens(text),
				nodeId: node.nodeId,
			});

			let nextIndex = index + 1;
			if (node.nodes) {
				for (const child of node.nodes) {
					nextIndex = extractFromNode(child, nextIndex);
				}
			}

			// Update node's startIndex/endIndex to match storage indices
			// startIndex = this node's index, endIndex = last child's index (or own index if no children)
			node.startIndex = nodeStartIndex;
			node.endIndex = nextIndex - 1;

			return nextIndex;
		}

		let idx = 0;
		for (const node of tree) {
			idx = extractFromNode(node, idx);
		}

		return pages;
	}

	/**
	 * Build tree from PDF content
	 */
	private async buildFromPdf(
		document: DocumentInput,
	): Promise<TreeBuildResult> {
		const pdfData =
			document.content instanceof ArrayBuffer
				? document.content
				: new TextEncoder().encode(document.content).buffer;

		const pdfOptions: PdfProcessingOptions = {};
		if (this.options.tocCheckPages !== undefined) {
			pdfOptions.tocCheckPages = this.options.tocCheckPages;
		}
		if (this.options.maxTokensPerNode !== undefined) {
			pdfOptions.maxTokensPerNode = this.options.maxTokensPerNode;
		}

		const processor = new PdfProcessor(this.model, pdfOptions);

		const { tree, pages } = await processor.process(pdfData as ArrayBuffer);

		// Assign node IDs if needed
		if (this.options.addNodeId) {
			this.assignNodeIds(tree);
		}

		return {
			tree,
			pages: pages.map((p) => ({
				index: p.index,
				text: p.text,
				tokenCount: p.tokenCount,
			})),
			stats: {
				pageCount: pages.length,
				tokenCount: pages.reduce((sum, p) => sum + p.tokenCount, 0),
				nodeCount: getAllNodes(tree).length,
			},
		};
	}

	/**
	 * Assign sequential node IDs
	 */
	private assignNodeIds(tree: TreeNode[]): void {
		let counter = 0;

		function assign(nodes: TreeNode[]): void {
			for (const node of nodes) {
				node.nodeId = String(counter++).padStart(4, "0");
				if (node.nodes) {
					assign(node.nodes);
				}
			}
		}

		assign(tree);
	}
}

/**
 * Create a tree builder
 */
export function createTreeBuilder(
	model: LanguageModel,
	options: ProcessingOptions,
): TreeBuilder {
	return new TreeBuilder(model, options);
}
