---
name: supabase-client
description: >
  Handles data access between the Lucrari React Native application and Supabase.
  Use whenever implementing, modifying, debugging or reviewing database queries,
  Supabase client configuration, authentication, financial data fetching,
  realtime subscriptions, pagination, filtering, caching or data access.
---

# Lucrari Supabase Client

## Architecture

Lucrari mobile application reads application data directly from Supabase.

Python backend jobs are responsible for collecting, processing and writing
financial data into Supabase.

Expected flow:

External financial sources
→ Python jobs
→ Supabase
→ React Native application

## Rules

- Use `@supabase/supabase-js`.
- Centralize Supabase client configuration.
- Do not create Supabase clients inside screen components.
- Keep Supabase queries outside presentation components.
- Use typed database models.
- Keep database querying inside the data/service layer.
- Never expose service-role keys in the mobile application.
- Only public/publishable client credentials may exist in the application.
- Assume every client credential shipped with the mobile app can be extracted.

## Security

- Row Level Security must be enabled for client-accessible tables.
- Access must be controlled through RLS policies.
- Never bypass RLS from the mobile application.
- Never embed admin or service-role credentials.

## Data fetching

Screen
→ hook/query layer
→ Supabase service
→ Supabase

Every query should account for:

- loading
- error
- empty result
- pagination where applicable
- stale data where applicable

## Financial data

Do not format currencies, percentages or financial values inside database queries.

Return typed raw data and format it through centralized UI utilities.