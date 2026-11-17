import { ref } from 'vue'

/**
 * Reactive "is dark mode active" flag, owned by App.vue. Non-component code
 * (e.g. chart option factories called inside computeds) can read it and will
 * re-evaluate when the theme changes.
 */
export const isDarkTheme = ref(false)
