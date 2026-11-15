---
name: react-native-performance
description: >
  Applies React Native performance best practices. Use when implementing or
  reviewing large lists, charts, animations, expensive renders, memoization,
  image-heavy screens, scrolling performance, JS-thread workloads,
  performance regressions or slow React Native screens.
---

# React Native Performance

## Rules

- Measure before introducing complex optimizations.
- Avoid unnecessary state and effects.
- Avoid unnecessary component re-renders.
- Keep expensive transformations outside render where appropriate.
- Use virtualized lists for large collections.
- Do not render large datasets with ScrollView + map.
- Avoid recreating expensive objects unnecessarily.
- Keep animation work off the JS thread when appropriate.

## Financial application considerations

Pay special attention to:
- large market lists
- watchlists
- frequently updating prices
- interactive charts
- long financial statements
- economic calendars