import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WorkerPool } from './workerPool'

/**
 * Mock analysis worker implementing the INIT_WASM handshake used by
 * WorkerPool. `autoInit` controls whether it acknowledges initialisation.
 */
class MockWorker {
  static instances: MockWorker[] = []
  static autoInit: 'ok' | 'fail' | 'never' = 'ok'

  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminate = vi.fn()
  posted: any[] = []
  private listeners = new Set<(e: MessageEvent) => void>()

  constructor() {
    MockWorker.instances.push(this)
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (type === 'message') this.listeners.add(fn)
  }

  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (type === 'message') this.listeners.delete(fn)
  }

  postMessage(msg: any) {
    this.posted.push(msg)
    if (msg.type === 'INIT_WASM' && MockWorker.autoInit !== 'never') {
      const reply = MockWorker.autoInit === 'ok'
        ? { type: 'WASM_INITIALIZED', id: msg.id }
        : { type: 'ANALYSIS_ERROR', id: msg.id, error: 'wasm failed' }
      this.emit(reply)
    }
  }

  /** Deliver a message from the "worker" to the pool. */
  emit(data: any) {
    const event = { target: this, data } as unknown as MessageEvent
    for (const fn of [...this.listeners]) fn(event)
    this.onmessage?.(event)
  }

  crash(message = 'boom') {
    this.onerror?.({ target: this, message } as unknown as ErrorEvent)
  }

  analyzeRequests() {
    return this.posted.filter(m => m.type === 'ANALYZE_ENTITY')
  }
}

vi.mock('../workers/analysisWorker?worker', () => ({
  default: vi.fn().mockImplementation(function () { return new MockWorker() })
}))

const busyWorkers = () => MockWorker.instances.filter(w => w.analyzeRequests().length > 0)

/** Reply to the most recent ANALYZE_ENTITY request a worker received. */
function respond(worker: MockWorker, data: any = [], type = 'ANALYSIS_RESULT') {
  const req = worker.analyzeRequests().at(-1)
  worker.emit(type === 'ANALYSIS_RESULT'
    ? { type, id: req.id, data }
    : { type, id: req.id, error: data })
}

describe('WorkerPool', () => {
  let pool: WorkerPool
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    MockWorker.instances = []
    MockWorker.autoInit = 'ok'
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    pool?.terminate()
    // only restore the console spy; restoreAllMocks would also wipe the worker mock
    errorSpy.mockRestore()
  })

  describe('constructor', () => {
    it('creates the requested number of workers and makes them available after INIT_WASM', () => {
      pool = new WorkerPool(3)
      expect(pool.getStatus()).toMatchObject({ totalWorkers: 3, availableWorkers: 3 })
      expect(MockWorker.instances.every(w => w.posted[0].type === 'INIT_WASM')).toBe(true)
    })

    it('enforces a minimum of 2 and a maximum of 8 workers', () => {
      pool = new WorkerPool(1)
      expect(pool.getStatus().totalWorkers).toBe(2)
      pool.terminate()
      pool = new WorkerPool(10)
      expect(pool.getStatus().totalWorkers).toBe(8)
    })

    it('does not mark workers available until they acknowledge initialisation', () => {
      MockWorker.autoInit = 'never'
      pool = new WorkerPool(2)
      expect(pool.getStatus()).toMatchObject({ totalWorkers: 2, availableWorkers: 0 })
    })
  })

  describe('analyzeEntity', () => {
    it('dispatches a task and resolves with the worker result', async () => {
      pool = new WorkerPool(2)
      const promise = pool.analyzeEntity({ 'sensor.a': [] }, [])
      expect(pool.getStatus().activeTasks).toBe(1)

      const [worker] = busyWorkers()
      expect(worker.analyzeRequests()[0].data).toEqual({ entityHistory: { 'sensor.a': [] }, periods: [] })
      respond(worker, [{ entityId: 'sensor.a' }])

      await expect(promise).resolves.toEqual([{ entityId: 'sensor.a' }])
      expect(pool.getStatus()).toMatchObject({ activeTasks: 0, availableWorkers: 2 })
    })

    it('rejects with the error reported by the worker', async () => {
      pool = new WorkerPool(2)
      const promise = pool.analyzeEntity({}, [])
      respond(busyWorkers()[0], 'Test error message', 'ANALYSIS_ERROR')
      await expect(promise).rejects.toThrow('Test error message')
    })

    it('queues tasks while all workers are busy and drains the queue as they free up', async () => {
      pool = new WorkerPool(2)
      const promises = Array.from({ length: 5 }, (_, i) => pool.analyzeEntity({ [`sensor.${i}`]: [] }, []))
      expect(pool.getStatus()).toMatchObject({ activeTasks: 2, queuedTasks: 3 })

      for (let done = 0; done < 5; done++) {
        const worker = MockWorker.instances.find(w => {
          const last = w.analyzeRequests().at(-1)
          return last && !(last as any).answered
        })!
        const req = worker.analyzeRequests().at(-1) as any
        req.answered = true
        worker.emit({ type: 'ANALYSIS_RESULT', id: req.id, data: [req.id] })
      }

      const results = await Promise.all(promises)
      expect(results.map(r => r[0]).sort()).toEqual(['task_0', 'task_1', 'task_2', 'task_3', 'task_4'])
      expect(pool.getStatus()).toMatchObject({ activeTasks: 0, queuedTasks: 0 })
    })

    it('holds tasks submitted before initialisation and dispatches them once a worker is ready', async () => {
      MockWorker.autoInit = 'never'
      pool = new WorkerPool(2)
      const promise = pool.analyzeEntity({}, [])
      expect(pool.getStatus().queuedTasks).toBe(1)

      const worker = MockWorker.instances[0]
      worker.emit({ type: 'WASM_INITIALIZED', id: worker.posted[0].id })
      expect(pool.getStatus()).toMatchObject({ queuedTasks: 0, activeTasks: 1 })

      respond(worker, ['ok'])
      await expect(promise).resolves.toEqual(['ok'])
    })

    it('forwards progress messages without settling the task', () => {
      pool = new WorkerPool(2)
      const progress = vi.fn()
      pool.setProgressCallback(progress)
      pool.analyzeEntity({}, []).catch(() => {}) // rejected by terminate() in afterEach
      const worker = busyWorkers()[0]
      worker.emit({ type: 'ANALYSIS_PROGRESS', id: 'x', progress: { entityId: 'sensor.a', status: 'analyzing' } })
      expect(progress).toHaveBeenCalledWith('sensor.a', 'analyzing', undefined)
      expect(pool.getStatus().activeTasks).toBe(1)
    })

    it('ignores responses for unknown task ids', () => {
      pool = new WorkerPool(2)
      const worker = MockWorker.instances[0]
      expect(() => worker.emit({ type: 'ANALYSIS_RESULT', id: 'nope', data: [] })).not.toThrow()
      expect(pool.getStatus()).toMatchObject({ availableWorkers: 2, activeTasks: 0 })
    })
  })

  describe('termination', () => {
    it('terminates all workers, clears state and rejects pending tasks', async () => {
      pool = new WorkerPool(2)
      const promises = Array.from({ length: 3 }, () => pool.analyzeEntity({}, []))
      pool.terminate()

      expect(MockWorker.instances.every(w => w.terminate.mock.calls.length === 1)).toBe(true)
      expect(pool.getStatus()).toEqual({ totalWorkers: 0, availableWorkers: 0, queuedTasks: 0, activeTasks: 0 })
      for (const p of promises) await expect(p).rejects.toThrow('terminated')
    })

    it('rejects tasks submitted after termination', async () => {
      pool = new WorkerPool(2)
      pool.terminate()
      await expect(pool.analyzeEntity({}, [])).rejects.toThrow('terminated')
    })
  })

  describe('failure handling', () => {
    it('rejects the running task when its worker crashes and replaces the worker', async () => {
      pool = new WorkerPool(2)
      const promise = pool.analyzeEntity({}, [])
      const crashed = busyWorkers()[0]
      crashed.crash('segfault')

      await expect(promise).rejects.toThrow('segfault')
      expect(crashed.terminate).toHaveBeenCalled()
      expect(MockWorker.instances).toHaveLength(3) // replacement spawned
      expect(pool.getStatus()).toMatchObject({ totalWorkers: 2, availableWorkers: 2, activeTasks: 0 })
    })

    it('keeps processing other tasks after a crash', async () => {
      pool = new WorkerPool(2)
      const a = pool.analyzeEntity({ a: [] }, [])
      const b = pool.analyzeEntity({ b: [] }, [])
      const workerFor = (key: string) =>
        busyWorkers().find(w => key in w.analyzeRequests()[0].data.entityHistory)!
      workerFor('a').crash()
      respond(workerFor('b'), ['b'])
      await expect(a).rejects.toThrow()
      await expect(b).resolves.toEqual(['b'])
    })

    it('handles out-of-order completion', async () => {
      pool = new WorkerPool(3)
      const promises = [0, 1, 2].map(i => pool.analyzeEntity({ [i]: [] }, []))
      const workers = busyWorkers()
      for (const w of [...workers].reverse()) {
        const req = w.analyzeRequests()[0]
        w.emit({ type: 'ANALYSIS_RESULT', id: req.id, data: Object.keys(req.data.entityHistory) })
      }
      await expect(Promise.all(promises)).resolves.toEqual([['0'], ['1'], ['2']])
    })

    it('rejects queued tasks when every worker fails to initialise', async () => {
      MockWorker.autoInit = 'fail'
      pool = new WorkerPool(2)
      expect(pool.getStatus().totalWorkers).toBe(0)
      await expect(pool.analyzeEntity({}, [])).rejects.toThrow('No analysis worker')
    })

    it('rejects queued tasks once the last pending initialisation fails', async () => {
      MockWorker.autoInit = 'never'
      pool = new WorkerPool(2)
      const promise = pool.analyzeEntity({}, [])
      for (const w of MockWorker.instances) {
        w.emit({ type: 'ANALYSIS_ERROR', id: w.posted[0].id, error: 'no wasm' })
      }
      await expect(promise).rejects.toThrow('No analysis worker')
    })

    it('treats an unexpected response type as an error', async () => {
      pool = new WorkerPool(2)
      const promise = pool.analyzeEntity({}, [])
      const worker = busyWorkers()[0]
      worker.emit({ type: 'SOMETHING_ELSE', id: worker.analyzeRequests()[0].id })
      await expect(promise).rejects.toThrow('Unexpected worker response')
    })

    it('tolerates malformed messages', () => {
      pool = new WorkerPool(2)
      const worker = MockWorker.instances[0]
      expect(() => worker.emit(null)).not.toThrow()
      expect(() => worker.emit({})).not.toThrow()
    })

    it('handles a large burst of tasks', async () => {
      pool = new WorkerPool(4)
      const promises = Array.from({ length: 200 }, (_, i) => pool.analyzeEntity({ [i]: [] }, []))
      let pending = true
      while (pending) {
        pending = false
        for (const w of MockWorker.instances) {
          const req = w.analyzeRequests().at(-1) as any
          if (req && !req.answered) {
            req.answered = true
            pending = true
            w.emit({ type: 'ANALYSIS_RESULT', id: req.id, data: req.id })
          }
        }
      }
      const results = await Promise.all(promises)
      expect(new Set(results).size).toBe(200)
      expect(pool.getStatus()).toMatchObject({ queuedTasks: 0, activeTasks: 0, availableWorkers: 4 })
    })
  })
})
