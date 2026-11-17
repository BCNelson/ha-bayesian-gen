import AnalysisWorker from '../workers/analysisWorker?worker'

interface WorkerTask {
  id: string
  task: any
  resolve: (result: any) => void
  reject: (error: Error) => void
}

/**
 * Pool of analysis workers, each running its own instance of the WASM engine.
 *
 * Lifecycle of a worker: created -> INIT_WASM handshake -> available <-> busy.
 * Tasks submitted before any worker finished initialising are queued and
 * dispatched as soon as one becomes available. Every submitted task is
 * guaranteed to settle: it is rejected if its worker crashes, if no worker
 * could be initialised, or if the pool is terminated.
 */
export class WorkerPool {
  private workers: Worker[] = []
  private availableWorkers: Worker[] = []
  private taskQueue: WorkerTask[] = []
  private activeTasks = new Map<string, WorkerTask>()
  /** Which task each busy worker is running. */
  private workerTasks = new Map<Worker, string>()
  private pendingInits = 0
  private nextTaskId = 0
  private terminated = false
  private progressCallback?: (entityId: string, status: string, message?: string) => void

  constructor(workerCount: number = navigator.hardwareConcurrency || 4) {
    const actualWorkerCount = Math.max(2, Math.min(workerCount, 8))
    for (let i = 0; i < actualWorkerCount; i++) {
      this.spawnWorker()
    }
  }

  private spawnWorker(index?: number): void {
    let worker: Worker
    try {
      worker = new AnalysisWorker()
    } catch (error) {
      console.error('Failed to create analysis worker:', error)
      if (index !== undefined) this.workers.splice(index, 1)
      this.failQueueIfNoWorkers()
      return
    }
    if (index === undefined) this.workers.push(worker)
    else this.workers[index] = worker
    this.initializeWorker(worker)
  }

  private initializeWorker(worker: Worker): void {
    this.pendingInits++
    const initId = `init_${Date.now()}_${Math.random()}`

    const onInitMessage = (e: MessageEvent) => {
      if (e.data?.id !== initId) return
      worker.removeEventListener('message', onInitMessage)
      this.pendingInits--
      if (this.terminated) return

      if (e.data.type === 'WASM_INITIALIZED') {
        worker.onmessage = this.handleWorkerMessage.bind(this)
        worker.onerror = this.handleWorkerError.bind(this)
        this.availableWorkers.push(worker)
        this.processNextTask()
      } else {
        console.error('Worker failed to initialise WASM:', e.data.error)
        worker.terminate()
        this.workers = this.workers.filter(w => w !== worker)
        this.failQueueIfNoWorkers()
      }
    }

    worker.addEventListener('message', onInitMessage)
    worker.postMessage({ type: 'INIT_WASM', id: initId })
  }

  /** Reject queued tasks when no worker exists or can still come online. */
  private failQueueIfNoWorkers(): void {
    if (this.availableWorkers.length > 0 || this.workerTasks.size > 0 || this.pendingInits > 0) return
    const queued = this.taskQueue.splice(0)
    for (const task of queued) {
      task.reject(new Error('No analysis worker could be initialised'))
    }
  }

  private handleWorkerMessage(e: MessageEvent) {
    const { type, id, data, error, progress } = e.data ?? {}
    const worker = e.target as Worker

    if (type === 'ANALYSIS_PROGRESS') {
      if (progress && this.progressCallback) {
        this.progressCallback(progress.entityId, progress.status, progress.message)
      }
      return
    }

    const task = this.activeTasks.get(id)
    if (!task) return

    this.activeTasks.delete(id)
    this.workerTasks.delete(worker)
    if (this.workers.includes(worker) && !this.availableWorkers.includes(worker)) {
      this.availableWorkers.push(worker)
    }

    if (type === 'ANALYSIS_RESULT') {
      task.resolve(data)
    } else {
      task.reject(new Error(error ?? `Unexpected worker response: ${String(type)}`))
    }

    this.processNextTask()
  }

  private handleWorkerError(event: ErrorEvent) {
    console.error('Worker error:', event.message ?? event)
    const worker = event.target as Worker

    // Fail the task the crashed worker was running.
    const taskId = this.workerTasks.get(worker)
    if (taskId !== undefined) {
      this.workerTasks.delete(worker)
      const task = this.activeTasks.get(taskId)
      this.activeTasks.delete(taskId)
      task?.reject(new Error(event.message || 'Worker crashed'))
    }

    this.availableWorkers = this.availableWorkers.filter(w => w !== worker)
    const index = this.workers.indexOf(worker)
    worker.terminate()
    if (index !== -1 && !this.terminated) {
      this.spawnWorker(index)
    }
  }

  private processNextTask() {
    while (!this.terminated && this.availableWorkers.length > 0 && this.taskQueue.length > 0) {
      const worker = this.availableWorkers.pop()!
      const task = this.taskQueue.shift()!

      this.activeTasks.set(task.id, task)
      this.workerTasks.set(worker, task.id)

      worker.postMessage({
        type: 'ANALYZE_ENTITY',
        id: task.id,
        data: task.task
      })
    }
  }

  analyzeEntity(entityHistory: any, periods: any): Promise<any> {
    if (this.terminated) {
      return Promise.reject(new Error('Worker pool has been terminated'))
    }
    return new Promise((resolve, reject) => {
      const taskId = `task_${this.nextTaskId++}`
      this.taskQueue.push({ id: taskId, task: { entityHistory, periods }, resolve, reject })
      this.processNextTask()
      this.failQueueIfNoWorkers()
    })
  }

  terminate() {
    this.terminated = true
    this.workers.forEach(worker => worker.terminate())
    const error = new Error('Worker pool has been terminated')
    for (const task of [...this.taskQueue, ...this.activeTasks.values()]) {
      task.reject(error)
    }
    this.workers = []
    this.availableWorkers = []
    this.taskQueue = []
    this.activeTasks.clear()
    this.workerTasks.clear()
  }

  getStatus() {
    return {
      totalWorkers: this.workers.length,
      availableWorkers: this.availableWorkers.length,
      queuedTasks: this.taskQueue.length,
      activeTasks: this.activeTasks.size
    }
  }

  setProgressCallback(callback: (entityId: string, status: string, message?: string) => void) {
    this.progressCallback = callback
  }
}
