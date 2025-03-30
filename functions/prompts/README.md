# Village AI Prompts

This directory contains the prompt files used by the Village application for AI-powered content generation. These prompts are managed using Firebase GenKit's dotprompt format.

## Overview

The Village application uses AI to analyze user updates and generate personalized summaries, suggestions, and insights. The prompts in this directory define the instructions and schemas for these AI generations.

## Prompt Files

- `creator_profile.prompt`: Used to generate insights for a user's own profile based on their updates
- `friend_profile.prompt`: Used to generate summaries and suggestions for a user's friends based on shared updates

## How It Works

1. The prompts are defined in `.prompt` files with YAML front matter and Handlebars templates
2. The front matter defines the model to use and the output schema
3. The prompt content uses Handlebars syntax for dynamic content insertion
4. The prompts are loaded and executed by the `flows.ts` module

## Testing Prompts

You can test and refine prompts using the GenKit developer UI:

```bash
cd d:\Village\village_functions
npx genkit start -- tsx --watch functions/src/ai/flows.ts
```

## Environment Variables

For local development, set the `GEMINI_API_KEY` environment variable before starting the Firebase emulator:

```bash
$env:GEMINI_API_KEY="your-actual-api-key-here"
firebase emulators:start
```

## References

- [Firebase GenKit Documentation](https://firebase.google.com/docs/genkit)
- [Managing Prompts with Dotprompt](https://firebase.google.com/docs/genkit/dotprompt)
