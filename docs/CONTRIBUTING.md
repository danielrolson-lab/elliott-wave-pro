# Contributing to Elliott Wave Pro

## Project Structure

```
elliott-wave-pro/
├── apps/mobile/          # Expo React Native app
│   ├── app/              # Screen components
│   ├── components/       # Reusable UI components
│   ├── hooks/            # Custom React hooks
│   ├── stores/           # Zustand state stores
│   ├── services/         # API clients
│   ├── utils/            # Pure utility functions
│   ├── types/            # Type declarations
│   ├── navigation/       # React Navigation config
│   └── theme/            # Colors, ThemeContext
├── packages/wave-engine/ # Pure TypeScript Elliott Wave engine
│   ├── src/              # Engine source
│   └── fixtures/         # Test data
├── services/
│   ├── fastapi/          # Python wave scanner (Fly.io)
│   └── proxy/            # Vercel Edge Functions
└── docs/                 # Documentation
```

## Coding Standards

### TypeScript

- **Strict mode always**. No `any` except where unavoidable (add comment).
- All functions and components must be explicitly typed.
- No unused imports or variables (`TS6133`).
- Prefer `interface` over `type` for object shapes. Use `type` for unions/aliases.

### React Native / Expo

- **Components only read from stores**. Never write in a component.
- **Hooks compute and write**. All store writes happen in hooks or event handlers.
- **Never block the JS thread**. Heavy computation belongs in hooks, not render.
- Use `useMemo` for derived arrays/objects. Use `useCallback` for stable callbacks.
- Use `React.memo` on any component that receives props that change infrequently.
- Use `useShallow` from `zustand/react/shallow` for selectors that return objects/arrays.

### Skia / Reanimated

- All chart path computation must happen in `useDerivedValue` worklets (UI thread).
- Never call `.getState()` inside a worklet — pass values as `SharedValue`.
- Pan and pinch gesture state: `SharedValue` only, never `useState`.

### Store pattern (Zustand + Immer)

```typescript
// ✅ Correct: Write in hook
function useMyHook() {
  const { setData } = useMyStore();
  useEffect(() => { fetchData().then(setData); }, []);
}

// ❌ Wrong: Write in component render
function MyComponent() {
  const { setData } = useMyStore();
  setData(computedValue); // never do this
}
```

### Hook rules

- Each hook has a single responsibility.
- Side effects (fetch, WebSocket) go in `useEffect` with proper cleanup.
- Polling hooks clean up their `setInterval` in the effect cleanup.

### Wave engine (`packages/wave-engine`)

- Zero React Native dependencies. Must work in Node.js (Vitest).
- All exported functions are pure (no side effects, no global state).
- Every new algorithm must have a unit test in `src/__tests__/`.

## File naming

| Type | Convention | Example |
|------|-----------|---------|
| Screens | camelCase `.tsx` | `wave-grid.tsx` |
| Components | PascalCase `.tsx` | `ScenarioCard.tsx` |
| Hooks | camelCase prefix `use` | `useWaveEngine.ts` |
| Stores | camelCase suffix `Store` | `waveCount.ts` |
| Services | camelCase | `waveScanService.ts` |
| Utils | camelCase | `earningsEngine.ts` |

## Pull Request Guidelines

1. **One feature or fix per PR.** Never bundle unrelated changes.
2. **Run `pnpm typecheck` before opening a PR.** Zero TypeScript errors required.
3. **Update CLAUDE.md checklist** when completing a deliverable.
4. **PR description must include**:
   - What changed and why
   - Any external API or native module changes
   - Screenshot or video for UI changes

## Adding a new screen

1. Create `apps/mobile/app/my-screen.tsx` with a named export.
2. Add to `Phase3StackParamList` (or appropriate param list) in `AppNavigator.tsx`.
3. Register `<RootStack.Screen name="MyScreen" component={MyScreen} />`.
4. Add navigation call from Settings (if feature-gated) or the relevant trigger.

## Adding a new store

1. Create `apps/mobile/stores/my-store.ts`.
2. Use `create<MyState>()(immer((set) => ({ ... })))` pattern.
3. For persistence: wrap with `persist` middleware and `mmkvStorage`.
4. Document the state shape with a JSDoc comment block.

## Environment variables

- Client-safe vars: prefix `EXPO_PUBLIC_`.
- Server-side secrets: never prefix with `EXPO_PUBLIC_`. Store in Vercel env.
- Add to `apps/mobile/.env` with a `# comment` explaining the purpose.
- Never commit real API keys. `.env` is in `.gitignore`.

## Testing

```bash
# Wave engine unit tests
cd packages/wave-engine && pnpm test

# TypeScript check (all packages)
cd apps/mobile && pnpm typecheck
```
