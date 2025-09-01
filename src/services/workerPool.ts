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
  private wasmInitPromises = new Map<Worker, Promise<void>>()

  constructor(workerCount: number = navigator.hardwareConcurrency || 4) {
    const actualWorkerCount = Math.max(2, Math.min(workerCount, 8))
    console.log(`Initializing worker pool with ${actualWorkerCount} workers`)
    
    // Initialize workers in parallel for faster startup
    const workerPromises = Array.from({ length: actualWorkerCount }, () => {
      const worker = new AnalysisWorker()
      this.workers.push(worker)
      return this.initializeWorker(worker)
    })
    
    Promise.all(workerPromises).catch(error => {
      console.error('Failed to initialize some workers:', error)
    })
  }

  private async initializeWorker(worker: Worker) {
    const initPromise = new Promise<void>((resolve, reject) => {
      const initId = `init_${Date.now()}_${Math.random()}`
      
      const messageHandler = (e: MessageEvent) => {
        if (e.data.type === 'WASM_INITIALIZED' && e.data.id === initId) {
          worker.removeEventListener('message', messageHandler)
          worker.onmessage = this.handleWorkerMessage.bind(this)
          worker.onerror = this.handleWorkerError.bind(this)
          this.availableWorkers.push(worker)
          resolve()
        } else if (e.data.type === 'ANALYSIS_ERROR' && e.data.id === initId) {
          worker.removeEventListener('message', messageHandler)
          reject(new Error(e.data.error))
        }
      }
      
      worker.addEventListener('message', messageHandler)
      
      worker.postMessage({
        type: 'INIT_WASM',
        id: initId
      })
    })
    
    this.wasmInitPromises.set(worker, initPromise)
    await initPromise
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

  private async handleWorkerError(error: ErrorEvent) {
    console.error('Worker error:', error)
    const worker = error.target as Worker
    
    const workerIndex = this.workers.indexOf(worker)
    if (workerIndex !== -1) {
      worker.terminate()
      this.wasmInitPromises.delete(worker)
      
      const newWorker = new AnalysisWorker()
      this.workers[workerIndex] = newWorker
      
      const availableIndex = this.availableWorkers.indexOf(worker)
      if (availableIndex !== -1) {
        this.availableWorkers.splice(availableIndex, 1)
      }
      
      await this.initializeWorker(newWorker)
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
    // Wait for at least one worker to be initialized
    if (this.availableWorkers.length === 0 && this.wasmInitPromises.size > 0) {
      await Promise.race(Array.from(this.wasmInitPromises.values()))
    }
    
    return new Promise((resolve, reject) => {
      const taskId = `task_${this.nextTaskId++}`
      
      const task = {
        id: taskId,
        task: { entityHistory, periods },
        resolve,
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