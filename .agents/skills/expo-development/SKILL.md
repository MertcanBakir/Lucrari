---
name: expo-development
description: >
  Applies Expo and Expo Router best practices in the Lucrari mobile app.
  Use when working with Expo SDK APIs, Expo Router, app configuration,
  permissions, native capabilities, navigation, platform-specific behavior,
  builds, development clients, or Expo packages.
---

# Expo Development

## Goal

Use Expo APIs and conventions correctly without unnecessarily ejecting
or adding custom native code.

## Rules

- Prefer Expo-supported packages when an official Expo solution exists.
- Use `npx expo install` instead of plain `npm install` for Expo/native dependencies.
- Verify compatibility with the installed Expo SDK.
- Prefer Expo Router for navigation.
- Avoid editing native iOS or Android projects unless required.
- Prefer managed Expo APIs before custom native modules.

## Before installing a package

Check:
1. Is there an Expo SDK package for this?
2. Is it compatible with the current SDK?
3. Does it work on both iOS and Android?
4. Does it require a development build?

## Platform behavior

Always consider:
- iOS
- Android
- safe areas
- keyboard behavior
- permissions
- status bar
- device size differences