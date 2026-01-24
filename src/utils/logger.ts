interface LogStep {
  timestamp: string
  event: string
  data: Record<string, unknown>
  durationMs: number
}

/**
 * JSON logger for debugging and monitoring document processing
 * Outputs pretty-printed JSON to console
 */
export class JsonLogger {
  private docName: string
  private steps: LogStep[] = []
  private startTime: number
  private enabled: boolean

  constructor(docName: string, options?: { enabled?: boolean }) {
    this.enabled = options?.enabled ?? true
    this.docName = docName
    this.startTime = Date.now()
  }

  /**
   * Log an event with associated data
   */
  log(event: string, data: Record<string, unknown>): void {
    if (!this.enabled) return

    const step: LogStep = {
      timestamp: new Date().toISOString(),
      event,
      data,
      durationMs: Date.now() - this.startTime,
    }

    this.steps.push(step)

    // Pretty print to console
    console.log(JSON.stringify({
      doc: this.docName,
      ...step,
    }, null, 2))
  }

  /**
   * Get all logged steps
   */
  getSteps(): LogStep[] {
    return this.steps
  }

  /**
   * Get total duration
   */
  getDurationMs(): number {
    return Date.now() - this.startTime
  }

  /**
   * Check if logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }
}

/**
 * Create a JSON logger
 */
export function createLogger(
  docName: string,
  options?: { enabled?: boolean }
): JsonLogger {
  return new JsonLogger(docName, options)
}
