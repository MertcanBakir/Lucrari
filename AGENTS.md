# Expo

This project uses Expo SDK 54.

Before writing Expo-related code, consult the exact versioned documentation:
https://docs.expo.dev/versions/v54.0.0/

Do not rely on outdated Expo APIs or conventions.

# Agent Skills

Before implementation, inspect `.agents/skills/` and automatically use all skills relevant to the task.

Do not require the user to explicitly select skills.

At the end of every implementation, modification, review, debugging, testing, or refactoring task, report:

## Skills Used
- skill-name

List only skills actually used. If none were applicable:

## Skills Used
- None

# README Maintenance

`README.md` is the primary developer documentation for this project.

After every implementation, bug fix, refactor, configuration change, dependency change, or architectural change, check whether README documentation is affected.

Update `README.md` only when necessary.

Keep it accurate enough that a developer unfamiliar with the project can understand:

- project purpose and features
- technology stack
- architecture and data flow
- important project structure
- Supabase and external integrations
- environment variables
- installation and development commands
- testing procedures
- important architectural decisions and limitations

Keep documentation synchronized with the actual implementation.

Do not:
- document functionality that does not exist
- leave removed functionality documented as active
- create duplicate or contradictory sections
- update README for insignificant styling or purely internal changes

At the end of the task report:

## Documentation
- README updated: Yes

or:

## Documentation
- README updated: Not required