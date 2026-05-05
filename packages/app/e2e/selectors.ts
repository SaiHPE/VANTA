export const promptSelector = '[data-component="prompt-input"]'
export const sessionComposerDockSelector = '[data-component="session-prompt-dock"]'
export const questionDockSelector = '[data-component="dock-prompt"][data-kind="question"]'
export const permissionDockSelector = '[data-component="dock-prompt"][data-kind="permission"]'
export const permissionRejectSelector = `${permissionDockSelector} [data-slot="permission-footer-actions"] [data-component="button"]:nth-child(1)`
export const permissionAllowAlwaysSelector = `${permissionDockSelector} [data-slot="permission-footer-actions"] [data-component="button"]:nth-child(2)`
export const permissionAllowOnceSelector = `${permissionDockSelector} [data-slot="permission-footer-actions"] [data-component="button"]:nth-child(3)`
export const sessionTodoDockSelector = '[data-component="session-todo-dock"]'
export const sessionTodoToggleSelector = '[data-action="session-todo-toggle"]'
export const sessionTodoToggleButtonSelector = '[data-action="session-todo-toggle-button"]'
export const sessionTodoListSelector = '[data-slot="session-todo-list"]'

export const modelVariantCycleSelector = '[data-action="model-variant-cycle"]'

export const titlebarRightSelector = "#opencode-titlebar-right"

export const popoverBodySelector = '[data-slot="popover-body"]'

export const listItemSelector = '[data-slot="list-item"]'

export const listItemKeyStartsWithSelector = (prefix: string) => `${listItemSelector}[data-key^="${prefix}"]`

export const listItemKeySelector = (key: string) => `${listItemSelector}[data-key="${key}"]`
