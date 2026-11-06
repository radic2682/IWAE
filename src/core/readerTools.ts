export type ReaderPrimaryMode = 'idle' | 'pan' | 'text-select' | 'region-select' | 'highlight' | 'translate' | 'box-memo' | 'edit'

export interface ReaderToolState {
  readonly primary: ReaderPrimaryMode
  readonly searchPinned: boolean
  readonly searchExpanded: boolean
}

export type ReaderToolAction =
  | { readonly type: 'toggle'; readonly mode: Exclude<ReaderPrimaryMode, 'idle'> }
  | { readonly type: 'expand-search' }
  | { readonly type: 'collapse-search' }
  | { readonly type: 'set-search-pinned'; readonly pinned: boolean }
  | { readonly type: 'reset-selection' }

export const INITIAL_READER_TOOL_STATE: ReaderToolState = {
  primary: 'idle',
  searchPinned: false,
  searchExpanded: false,
}

export function readerToolReducer(state: ReaderToolState, action: ReaderToolAction): ReaderToolState {
  switch (action.type) {
    case 'toggle':
      return { ...state, primary: state.primary === action.mode ? 'idle' : action.mode }
    case 'expand-search':
      return state.searchExpanded ? state : { ...state, searchExpanded: true }
    case 'collapse-search':
      return state.searchPinned || !state.searchExpanded ? state : { ...state, searchExpanded: false }
    case 'set-search-pinned':
      return { ...state, searchPinned: action.pinned, searchExpanded: action.pinned }
    case 'reset-selection':
      return state.primary === 'idle' ? state : { ...state, primary: 'idle' }
  }
}
