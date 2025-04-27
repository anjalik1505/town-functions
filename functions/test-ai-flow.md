# AI Flow Test Wrapper

A simple wrapper script to test AI flows locally using test data from the `ai-flow-test-data` directory.

## Prerequisites

- Download and install Node.js and npm from https://nodejs.org/en/download
- A `.env` file with your `GEMINI_API_KEY` (copy from `.env.example`)

## Usage

Run the script from the functions directory:

```bash
npx ts-node --transpile-only test-ai-flow.ts ../ai-flow-test-data/generateCreatorProfileFlow.json
```

## How It Works

1. The script reads the specified test data file
2. It extracts the flow name and parameters from the file
3. It calls the corresponding flow function from `src/ai/flows.ts`
4. It adds the result to the test data with a `last_result` attribute
5. It writes the updated test data back to the file

## Test Data Format

Test data files should be in JSON format with the following structure:

```json
{
  "flow": "flowFunctionName",
  "params": {
    "param1": "value1",
    "param2": "value2",
    "param3": "value3"
  }
}
```

Where:
- `flow` is the name of the flow function to call (e.g., `generateCreatorProfileFlow`)
- `params` is an object containing the parameters to pass to the flow function

After running the script, the test data file will be updated with a `last_result` attribute containing the result of the flow execution.

## Example

Before:
```json
{
  "flow": "generateCreatorProfileFlow",
  "params": {
    "existingSummary": "User has been active.",
    "updateContent": "I had a great week at work.",
    "sentiment": "positive",
    "gender": "female"
  }
}
```

After:
```json
{
  "flow": "generateCreatorProfileFlow",
  "params": {
    "existingSummary": "User has been active.",
    "updateContent": "I had a great week at work.",
    "sentiment": "positive",
    "gender": "female"
  },
  "last_result": {
    "summary": "User has been active and had a great week at work.",
    "suggestions": "Consider sharing more details about your work achievements.",
    "emotional_overview": "Generally positive and enthusiastic about work."
  }
}
```