import { describe, test, expect } from 'bun:test'
import {
  traverseTree,
  getAllNodes,
  getLeafNodes,
  findNodeById,
  getNodePath,
  isLeafNode,
  getNodeDepth,
  getParentNode,
  getSiblingNodes,
  countNodes,
  getTreeDepth,
  findNodesByTitle,
} from '../src/tree/navigation'
import type { TreeNode } from '../src/types/tree'

const createTestTree = (): TreeNode[] => [
  {
    title: 'Root 1',
    nodeId: '0000',
    startIndex: 0,
    endIndex: 20,
    nodes: [
      {
        title: 'Child 1.1',
        nodeId: '0001',
        startIndex: 1,
        endIndex: 10,
        nodes: [
          {
            title: 'Grandchild 1.1.1',
            nodeId: '0002',
            startIndex: 2,
            endIndex: 5,
          },
          {
            title: 'Grandchild 1.1.2',
            nodeId: '0003',
            startIndex: 6,
            endIndex: 10,
          },
        ],
      },
      {
        title: 'Child 1.2',
        nodeId: '0004',
        startIndex: 11,
        endIndex: 20,
      },
    ],
  },
  {
    title: 'Root 2',
    nodeId: '0005',
    startIndex: 21,
    endIndex: 30,
  },
]

describe('Tree Navigation', () => {
  describe('traverseTree', () => {
    test('visits all nodes', () => {
      const tree = createTestTree()
      const visited: string[] = []

      traverseTree(tree, (node) => {
        visited.push(node.nodeId)
        return undefined
      })

      expect(visited).toHaveLength(6)
      expect(visited).toContain('0000')
      expect(visited).toContain('0005')
    })

    test('respects maxDepth option', () => {
      const tree = createTestTree()
      const visited: string[] = []

      traverseTree(
        tree,
        (node) => {
          visited.push(node.nodeId)
          return undefined
        },
        { maxDepth: 1 }
      )

      // Should only visit root and first level children
      expect(visited).toContain('0000')
      expect(visited).toContain('0001')
      expect(visited).toContain('0004')
      expect(visited).toContain('0005')
      expect(visited).not.toContain('0002') // Grandchild
    })

    test('collects return values', () => {
      const tree = createTestTree()
      const titles = traverseTree(tree, (node) => node.title)

      expect(titles).toContain('Root 1')
      expect(titles).toContain('Child 1.1')
      expect(titles).toContain('Root 2')
    })
  })

  describe('getAllNodes', () => {
    test('returns all nodes flattened', () => {
      const tree = createTestTree()
      const all = getAllNodes(tree)

      expect(all).toHaveLength(6)
    })
  })

  describe('getLeafNodes', () => {
    test('returns only leaf nodes', () => {
      const tree = createTestTree()
      const leaves = getLeafNodes(tree)

      expect(leaves).toHaveLength(4)
      expect(leaves.every((n) => isLeafNode(n))).toBe(true)
    })
  })

  describe('findNodeById', () => {
    test('finds existing node', () => {
      const tree = createTestTree()
      const node = findNodeById(tree, '0002')

      expect(node).not.toBeNull()
      expect(node?.title).toBe('Grandchild 1.1.1')
    })

    test('returns null for non-existent node', () => {
      const tree = createTestTree()
      const node = findNodeById(tree, '9999')

      expect(node).toBeNull()
    })
  })

  describe('getNodePath', () => {
    test('returns path from root to node', () => {
      const tree = createTestTree()
      const path = getNodePath(tree, '0002')

      expect(path).toEqual(['0000', '0001', '0002'])
    })

    test('returns path for root node', () => {
      const tree = createTestTree()
      const path = getNodePath(tree, '0000')

      expect(path).toEqual(['0000'])
    })

    test('returns null for non-existent node', () => {
      const tree = createTestTree()
      const path = getNodePath(tree, '9999')

      expect(path).toBeNull()
    })
  })

  describe('isLeafNode', () => {
    test('returns true for nodes without children', () => {
      const leaf: TreeNode = {
        title: 'Leaf',
        nodeId: '0001',
        startIndex: 0,
        endIndex: 10,
      }
      expect(isLeafNode(leaf)).toBe(true)
    })

    test('returns false for nodes with children', () => {
      const parent: TreeNode = {
        title: 'Parent',
        nodeId: '0000',
        startIndex: 0,
        endIndex: 20,
        nodes: [
          { title: 'Child', nodeId: '0001', startIndex: 1, endIndex: 10 },
        ],
      }
      expect(isLeafNode(parent)).toBe(false)
    })
  })

  describe('getNodeDepth', () => {
    test('returns correct depth', () => {
      const tree = createTestTree()

      expect(getNodeDepth(tree, '0000')).toBe(0) // Root
      expect(getNodeDepth(tree, '0001')).toBe(1) // Child
      expect(getNodeDepth(tree, '0002')).toBe(2) // Grandchild
    })

    test('returns -1 for non-existent node', () => {
      const tree = createTestTree()
      expect(getNodeDepth(tree, '9999')).toBe(-1)
    })
  })

  describe('getParentNode', () => {
    test('returns parent node', () => {
      const tree = createTestTree()
      const parent = getParentNode(tree, '0002')

      expect(parent).not.toBeNull()
      expect(parent?.nodeId).toBe('0001')
    })

    test('returns null for root nodes', () => {
      const tree = createTestTree()
      const parent = getParentNode(tree, '0000')

      expect(parent).toBeNull()
    })
  })

  describe('getSiblingNodes', () => {
    test('returns sibling nodes', () => {
      const tree = createTestTree()
      const siblings = getSiblingNodes(tree, '0002')

      expect(siblings).toHaveLength(1)
      expect(siblings[0]?.nodeId).toBe('0003')
    })

    test('returns root-level siblings', () => {
      const tree = createTestTree()
      const siblings = getSiblingNodes(tree, '0000')

      expect(siblings).toHaveLength(1)
      expect(siblings[0]?.nodeId).toBe('0005')
    })
  })

  describe('countNodes', () => {
    test('counts all nodes', () => {
      const tree = createTestTree()
      expect(countNodes(tree)).toBe(6)
    })
  })

  describe('getTreeDepth', () => {
    test('returns maximum depth', () => {
      const tree = createTestTree()
      expect(getTreeDepth(tree)).toBe(2)
    })
  })

  describe('findNodesByTitle', () => {
    test('finds nodes by partial title match', () => {
      const tree = createTestTree()
      const nodes = findNodesByTitle(tree, 'Child')

      expect(nodes.length).toBeGreaterThan(0)
      // All found nodes should contain "child" (case-insensitive)
      expect(nodes.every((n) => n.title.toLowerCase().includes('child'))).toBe(true)
    })

    test('case insensitive search', () => {
      const tree = createTestTree()
      const nodes = findNodesByTitle(tree, 'root')

      expect(nodes).toHaveLength(2)
    })
  })
})
