export type Palette = 'fire' | 'rainbow' | 'ice' | 'matrix'

declare module 'claude-code' {
  interface PluginState {
    'power-mode': { isActive: boolean; isEnabled: boolean; isTall: boolean }
  }
}
