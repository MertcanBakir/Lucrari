---
name: react-native-architecture
description: >
  Defines architecture and code organization for the Lucrari React Native
  and Expo application. Use when creating or modifying screens, components,
  hooks, services, navigation, shared modules, folder structure, state
  management, or application architecture.
---

# React Native Architecture

## Goal

Maintain a scalable, strongly typed and maintainable architecture for Lucrari.

## Core rules

- Use TypeScript.
- Use functional React components.
- Keep screen components thin.
- Do not put API networking logic directly inside UI components.
- Do not put complex business logic directly inside route files.
- Prefer small reusable components over large monolithic screens.
- Keep reusable business logic inside hooks or services.
- Avoid duplicate implementations.

## Before writing code

1. Inspect the existing project structure.
2. Search for an existing component, hook, service or utility that solves the same problem.
3. Reuse existing project conventions.
4. Inspect installed dependencies before introducing a new package.

## Separation of concerns

UI:
- Rendering
- User interaction
- Local presentation state

Hooks:
- Reusable application behavior
- Screen orchestration

Services:
- API communication
- External integrations

Utilities:
- Pure formatting and transformation functions

## Navigation

Use Expo Router conventions.

Do not implement custom navigation infrastructure when Expo Router already solves the problem.

## Dependency rule

Do not install a new dependency unless:
1. The existing stack cannot reasonably solve the task.
2. The dependency is actively maintained.
3. The dependency is compatible with the project's Expo SDK.