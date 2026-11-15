---
name: react-native-performance
description: >
  Applies React Native and Expo performance best practices in the Lucrari
  application. Use when implementing, reviewing, debugging or refactoring
  large lists, financial tables, charts, animations, frequently updating
  market data, expensive renders, memoization, image-heavy screens,
  scrolling performance, JS-thread workloads, startup performance,
  memory usage or slow React Native screens.
---

# React Native Performance

## Goal

Keep Lucrari responsive, memory-efficient and smooth on both iOS and Android,
especially on data-heavy financial screens.

Optimize based on measurable problems rather than speculative micro-optimizations.

## Core Rules

- Measure before introducing complex optimizations.
- Prefer simple and maintainable code until a measurable performance issue exists.
- Avoid unnecessary state and effects.
- Avoid unnecessary component re-renders.
- Avoid duplicating derived state.
- Keep expensive transformations outside render when appropriate.
- Do not perform heavy calculations directly inside JSX.
- Do not introduce memoization without a clear reason.
- Avoid recreating expensive objects unnecessarily.
- Keep expensive synchronous work off the JavaScript thread when possible.
- Consider both iOS and Android behavior.
- Do not sacrifice correctness or readability for insignificant performance gains.

## React Rendering

Before optimizing a component, determine what causes it to re-render.

Prefer:

- stable component boundaries
- localized state
- derived values instead of duplicated state
- stable callbacks where they materially reduce work
- splitting large screens into focused components

Use `React.memo`, `useMemo` and `useCallback` only when they solve an actual
rendering or computation problem.

Do not automatically wrap every component, callback or value in memoization.

Avoid:

- unnecessary parent-level state
- effects that only synchronize derived state
- storing values in state that can be calculated from existing state or props
- repeatedly transforming large datasets during render

## Lists

Large collections must use virtualization.

Do not render large datasets using:

```tsx
<ScrollView>
  {items.map(...)}
</ScrollView>
```

Prefer an appropriate virtualized list.

For large financial datasets such as:

- market lists
- watchlists
- search results
- economic calendars
- transaction histories
- financial statement rows

consider:

- `FlatList`
- `SectionList`
- an appropriate high-performance list library already installed in the project

Do not add a new list library unless there is a measurable need.

For virtualized lists:

- provide stable keys
- avoid complex inline rendering logic
- keep row components focused
- avoid unnecessary nested scroll containers
- paginate large remote datasets
- avoid loading the entire dataset when only a subset is visible

Use `getItemLayout` or equivalent optimizations only when item dimensions are
predictable and the optimization is useful.

## Financial Tables

Financial statements can contain large amounts of structured data.

For balance sheets, income statements and cash-flow statements:

- avoid rendering unnecessary historical periods
- avoid recalculating formatting during every render when the dataset is large
- keep row components reusable
- separate raw data transformation from presentation
- avoid deeply nested component hierarchies for simple rows
- paginate or collapse large datasets where appropriate

Do not sacrifice accounting readability merely to reduce the number of rendered
elements.

## Frequently Updating Market Data

Price updates must not cause the entire application or screen to re-render.

When handling frequently changing values:

- update only components affected by the changed data
- avoid replacing large collections unnecessarily
- avoid global state updates that invalidate unrelated screens
- batch updates where appropriate
- use reasonable refresh intervals
- prefer server-driven timestamps over unnecessary client-side timers

Do not poll aggressively without a product requirement.

When realtime subscriptions are used:

- subscribe only to required data
- unsubscribe when no longer needed
- avoid duplicate subscriptions
- prevent multiple screens from independently subscribing to identical data
  when a shared subscription is more appropriate

## Supabase Realtime

When using Supabase Realtime:

- subscribe only to necessary tables, rows or events
- always clean up subscriptions
- avoid opening duplicate channels
- avoid refreshing entire datasets after a single-row update when the local
  result can be updated safely
- do not enable realtime for data that does not require realtime behavior
- consider battery, network and rendering cost on mobile devices

## Charts

Interactive financial charts can be expensive.

For chart implementations:

- separate data preparation from chart rendering
- avoid rebuilding large chart datasets on every render
- avoid recalculating indicators on every frame
- keep tooltip state lightweight
- limit the number of simultaneously rendered data points when appropriate
- aggregate or downsample very large datasets when visual precision is unchanged
- keep chart interaction smooth on the UI thread

For example, do not attempt to render tens of thousands of raw intraday points
when the device screen can display only a small fraction of them meaningfully.

Do not alter financial values merely for performance.

Any aggregation or downsampling must preserve the intended meaning of the chart.

## Animations

Animations should not block JavaScript execution.

Prefer animation approaches that can execute outside the JavaScript thread when
appropriate.

Avoid:

- performing expensive calculations during animation frames
- updating React state every frame
- unnecessary layout animations across large component trees
- animating very large numbers of components simultaneously

Animations must remain functional when reduced-motion accessibility settings are
enabled where applicable.

## Data Transformation

Large financial datasets should be normalized or transformed before they reach
complex presentation code.

Prefer:

```text
raw data
→ transformation / selector
→ display model
→ component
```

instead of:

```text
raw data
→ large map/filter/reduce chain inside JSX
```

Expensive operations such as:

- sorting
- filtering
- grouping
- aggregation
- indicator calculation
- historical-series transformation

should not execute repeatedly without need.

## API and Supabase Queries

Performance should be addressed at the data layer before compensating in UI.

Prefer:

- selecting only required columns
- filtering on the server
- pagination
- reasonable query limits
- indexed database queries
- avoiding repeated identical requests

Avoid:

- downloading entire tables
- fetching unused columns
- client-side filtering of extremely large remote datasets
- repeating identical requests from multiple components

Do not solve inefficient queries solely with React memoization.

## Pagination

Use pagination when datasets may grow substantially.

Examples:

- economic calendar history
- company search
- financial news
- transactions
- market instruments
- historical financial records

Do not assume today's small dataset will remain small.

Pagination state should remain separate from presentation where practical.

## Images

For image-heavy screens:

- use appropriately sized assets
- avoid loading unnecessarily high-resolution images
- reuse cached images when appropriate
- lazy-load images that are not immediately visible
- avoid unnecessary image decoding and re-rendering

Do not add an image optimization package if existing Expo functionality already
solves the requirement.

## Effects and Subscriptions

Every effect must have a clear responsibility.

Avoid effects that:

- duplicate derived state
- fire on every render due to unstable dependencies
- recreate subscriptions unnecessarily
- repeatedly issue network requests
- contain unrelated responsibilities

Always clean up:

- event listeners
- timers
- subscriptions
- realtime channels
- animation resources

when they are no longer required.

## Timers and Polling

Do not create frequent timers without a clear requirement.

For market-data polling:

- use the slowest interval that satisfies the product requirement
- stop polling when appropriate
- avoid duplicate pollers
- consider application background state
- avoid fetching unchanged data unnecessarily

Do not keep high-frequency polling active while the application is backgrounded
unless explicitly required.

## Memory

Pay attention to memory usage when handling:

- long price histories
- large chart datasets
- financial statements
- images
- cached responses

Avoid retaining large objects longer than necessary.

Do not indefinitely accumulate historical data in component state.

## Navigation

Do not perform expensive initialization for screens that the user has not opened
unless preloading is intentionally required.

Avoid unnecessary refetching whenever a user navigates back to an unchanged
screen.

Preserve useful cached server state where appropriate.

## Startup Performance

Avoid performing non-critical work during initial application startup.

Startup should prioritize:

1. rendering the application shell
2. restoring essential session information
3. displaying immediately required data
4. loading secondary information afterward

Do not block initial rendering on unrelated network requests.

## Dependency Selection

Before installing a dependency for performance reasons:

1. Confirm that a measurable problem exists.
2. Check whether React Native or Expo already provides a suitable solution.
3. Verify compatibility with the project's current Expo SDK.
4. Check maintenance status.
5. Consider bundle size and native dependencies.
6. Prefer an already-installed solution when reasonable.

Never add a dependency solely because it is described as "faster."

## Financial Application Considerations

Pay particular attention to:

- large market lists
- watchlists
- frequently updating prices
- realtime feeds
- interactive charts
- long financial statements
- economic calendars
- historical price series
- company search
- portfolio screens

These screens may combine network traffic, large datasets and frequent rendering,
so optimize the entire data flow rather than only individual components.

## Performance Investigation

When a performance problem is reported:

1. Reproduce the issue.
2. Identify whether the bottleneck is:
   - network
   - database query
   - JavaScript computation
   - React rendering
   - layout
   - animation
   - image loading
   - native code
3. Measure the affected area.
4. Apply the smallest effective optimization.
5. Measure again.
6. Confirm behavior on both iOS and Android where applicable.

Do not guess the bottleneck.

## Mandatory Verification

After implementing or modifying performance-sensitive functionality:

- Run TypeScript checks.
- Run linting.
- Run relevant automated tests.
- Add or update tests when behavior is testable.
- Verify loading, error and empty states where relevant.
- Verify that subscriptions and timers are cleaned up correctly.
- Check for obvious unnecessary renders.
- Check large-list behavior when applicable.
- Check iOS and Android compatibility where applicable.

If a relevant check cannot be run, explicitly report:

- which check was not run
- why it could not be run
- what remains unverified

Do not consider a performance-related task complete while known regressions or
failing relevant tests remain unresolved.

## Completion Criteria

A performance-sensitive implementation is complete when:

- functionality remains correct
- the implementation follows existing project architecture
- unnecessary renders and work have been avoided
- large datasets are handled appropriately
- subscriptions and resources are cleaned up
- relevant tests pass
- TypeScript checks pass
- lint checks pass
- no unnecessary dependency was introduced
- any remaining performance limitation is explicitly documented