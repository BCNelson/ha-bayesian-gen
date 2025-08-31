# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Home Assistant Bayesian Sensor Generator - A Vue 3 application that analyzes Home Assistant entity histories to generate optimized Bayesian sensor configurations using WebAssembly for performance-critical calculations.

## Tech Stack

- **Frontend**: Vue 3 with TypeScript, using `<script setup>` SFCs
- **Build Tool**: Vite
- **WebAssembly**: Rust compiled to WASM via wasm-pack for Bayesian calculations
- **Testing**: Vitest with edge tests for worker functionality
- **Styling**: Scoped CSS in Vue components
- **State Management**: Vue composables pattern

## Common Commands

```bash
# Development
npm run dev              # Start Vite dev server

# Building
npm run build           # Build entire project (WASM + TypeScript + Vite)
npm run build:wasm      # Build only the WASM module

# Testing
npm test                # Run tests
npm run test:ui         # Run tests with UI

# Preview production build
npm run preview
```

## Architecture

### Core Flow
1. **Connection**: User connects to Home Assistant via `ConnectionForm.vue`
2. **Time Periods**: User defines true/false time periods via `TimePeriodSelector.vue`
3. **Analysis**: System analyzes entity histories using WebWorkers and WASM
4. **Configuration**: Generates YAML configuration for Home Assistant Bayesian sensors

### Key Components

- **`src/composables/useBayesianAnalysis.ts`**: Central state management and orchestration
  - Manages Home Assistant connection
  - Coordinates entity analysis using worker pool
  - Handles concurrent fetching and analysis with status tracking

- **`src/services/workerPool.ts`**: Web Worker management
  - Distributes analysis tasks across multiple workers
  - Each worker loads WASM module independently
  - Progress tracking and error handling

- **`src/wasm/bayesian_calculator/`**: Rust WASM module
  - High-performance Bayesian probability calculations
  - Timeline analysis and threshold detection
  - Compiled to `src/wasm/pkg/` via wasm-pack

- **`src/workers/analysisWorker.ts`**: Worker implementation
  - Loads WASM module for calculations
  - Processes entity histories in parallel
  - Reports progress back to main thread

### Data Flow
1. Home Assistant API → Entity histories fetched (2 concurrent max)
2. Fetched data → Worker pool queue
3. Workers → WASM calculations
4. Results → Immediate UI update (sorted by discrimination power)
5. User selection → YAML configuration generation

### Testing Strategy
- Unit tests: `.test.ts` files for individual functions
- Edge tests: `.edge.test.ts` files for worker/WASM integration
- Test environment: jsdom for Vue components

## Development Notes

- WASM module must be built before running the application
- Workers are terminated on component unmount to prevent memory leaks
- Entity analysis shows real-time status: queued → fetching → fetched → analyzing → completed
- Results are displayed immediately as they complete, maintaining sort order