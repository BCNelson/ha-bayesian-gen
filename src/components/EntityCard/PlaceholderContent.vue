<template>
  <div class="entity-analyzing-placeholder">
    <div class="placeholder-content">
      <div class="placeholder-line"></div>
      <div class="placeholder-line short"></div>
      <div class="placeholder-line medium"></div>
    </div>
  </div>
</template>

<style scoped>
.entity-analyzing-placeholder {
  padding: 1.5rem;
  background: var(--app-surface-muted);
  border-radius: 6px;
}

.placeholder-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.placeholder-line {
  height: 16px;
  background: linear-gradient(
    90deg,
    var(--app-surface-hover) 25%,
    var(--app-surface-muted) 50%,
    var(--app-surface-hover) 75%
  );
  background-size: 200% 100%;
  border-radius: 4px;
  animation: shimmer 2s infinite;
}

.placeholder-line.short {
  width: 60%;
}

.placeholder-line.medium {
  width: 80%;
}

@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}
</style>