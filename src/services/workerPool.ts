import AnalysisWorker from '../workers/analysisWorker?worker'

interface WorkerTask {
  id: string
  task: any
  resolve: (result: any) => void
  reject: (error: Error) => void
}

export class WorkerPool {
  private workers: Worker[] = []
  private availableWorkers: Worker[] = []
  private taskQueue: WorkerTask[] = []
  private activeTasks = new Map<string, WorkerTask>()
  private nextTaskId = 0
  private progressCallback?: (entityId: string, status: string, message?: string) => void

  constructor(workerCount: number = 8) {
    const actualWorkerCount = Math.max(2, Math.min(workerCount, 8))
    console.log(`Initializing worker pool with ${actualWorkerCount} workers`)
    
    for (let i = 0; i < actualWorkerCount; i++) {
      const worker = new AnalysisWorker()
      worker.onmessage = this.handleWorkerMessage.bind(this)
      worker.onerror = this.handleWorkerError.bind(this)
      
      this.workers.push(worker)
      this.availableWorkers.push(worker)
    }
  }

  private handleWorkerMessage(e: MessageEvent) {
    const { type, id, data, error, progress } = e.data
    const worker = e.target as Worker

    // Handle progress messages
    if (type === 'ANALYSIS_PROGRESS' && progress && this.progressCallback) {
      this.progressCallback(progress.entityId, progress.status, progress.message)
      return
    }

    const task = this.activeTasks.get(id)
    if (!task) return

    this.activeTasks.delete(id)

    this.availableWorkers.push(worker)

    if (type === 'ANALYSIS_RESULT') {
      task.resolve(data)
    } else if (type === 'ANALYSIS_ERROR') {
      task.reject(new Error(error))
    }

    this.processNextTask()
  }

  private handleWorkerError(error: ErrorEvent) {
    console.error('Worker error:', error)
    const worker = error.target as Worker
    
    
    const workerIndex = this.workers.indexOf(worker)
    if (workerIndex !== -1) {
      worker.terminate()
      
      const newWorker = new AnalysisWorker()
      newWorker.onmessage = this.handleWorkerMessage.bind(this)
      newWorker.onerror = this.handleWorkerError.bind(this)
      
      this.workers[workerIndex] = newWorker
      
      const availableIndex = this.availableWorkers.indexOf(worker)
      if (availableIndex !== -1) {
        this.availableWorkers[availableIndex] = newWorker
      }
      
      console.log('Worker recovered after error')
    }
  }

  private processNextTask() {
    if (this.availableWorkers.length === 0 || this.taskQueue.length === 0) {
      return
    }

    const worker = this.availableWorkers.pop()!
    const task = this.taskQueue.shift()!
    
    this.activeTasks.set(task.id, task)
    
    worker.postMessage({
      type: 'ANALYZE_ENTITY',
      id: task.id,
      data: task.task
    })
  }

  async analyzeEntity(entityHistory: any, periods: any): Promise<any> {
    const startTime = performance.now()
    
    return new Promise((resolve, reject) => {
      const taskId = `task_${this.nextTaskId++}`
      
      const task = {
        id: taskId,
        task: { entityHistory, periods },
        resolve: (result: any) => {
          const duration = performance.now() - startTime
          if (duration > 1000) {
            console.log(`Worker task ${taskId} took ${duration.toFixed(0)}ms`)
          }
          resolve(result)
        },
        reject
      }

      this.taskQueue.push(task)
      this.processNextTask()
    })
  }

  terminate() {
    this.workers.forEach(worker => worker.terminate())
    this.workers = []
    this.availableWorkers = []
    this.taskQueue = []
    this.activeTasks.clear()
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