---
name: financial-ui
description: >
  Defines UI and data presentation conventions for financial information
  in Lucrari. Use when displaying stocks, prices, percentages, market data,
  balance sheets, income statements, cash flows, ratios, financial charts,
  economic indicators, earnings data or financial calendars.
---

# Lucrari Financial UI

## Goal

Present financial information consistently, accurately and clearly.

## Numeric values

Use centralized formatting utilities for:

- currency
- percentages
- market capitalization
- large numbers
- ratios
- dates
- timestamps

Never manually concatenate symbols such as `%`, `$`, `₺` in multiple components.

## Financial tables

Tables and financial statements should:

- align numeric values consistently
- preserve negative signs
- distinguish missing data from zero
- support large values
- avoid unnecessary decimal precision

## Price changes

Never infer whether a value is positive or negative from formatted text.

Use the underlying numeric value.

## Missing data

Do not display missing values as zero.

Prefer:

`—`

unless the domain specifically defines another representation.

## Charts

Chart components should be reusable.

Separate:
- data preparation
- chart rendering
- labels/tooltips
- financial calculations

Do not calculate financial metrics directly inside chart JSX.

## Loading

Financial screens must explicitly support:

- loading
- error
- empty
- stale data where applicable