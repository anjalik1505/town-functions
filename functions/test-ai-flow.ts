#!/usr/bin/env node

// Load environment variables from .env file
require('dotenv').config();

import * as fs from 'fs';
import * as flows from './src/ai/flows';

// Define interface for test data
interface TestData {
  flow: string;
  params: Record<string, any>;
  last_result?: Record<string, any>;
}

// Check if a file path was provided
if (process.argv.length < 3) {
  console.error('Please provide a path to a test data file');
  console.error('Usage: npx ts-node test-ai-flow.ts <path-to-test-data-file>');
  process.exit(1);
}

// Get the file path from command line arguments
const filePath = process.argv[2];

// Read the test data file
try {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const testData = JSON.parse(fileContent) as TestData;

  // Extract flow name and parameters
  const { flow, params } = testData;

  if (!flow || !params) {
    console.error('Test data file must contain "flow" and "params" fields');
    process.exit(1);
  }

  // Check if the flow exists in the flows module and is a function
  if (!(flow in flows) || typeof (flows as Record<string, any>)[flow] !== 'function') {
    console.error(`Flow "${flow}" not found in flows.ts`);
    process.exit(1);
  }

  console.log(`Running flow: ${flow}`);
  console.log('Parameters:', JSON.stringify(params, null, 2));

  // Execute the flow function
  // Check if the flow property is a function and call it
  const flowFunction = flows[flow as keyof typeof flows];
  if (typeof flowFunction === 'function') {
    // Use type assertion to tell TypeScript that params matches the expected type
    (flowFunction as any)(params)
      .then((result: Record<string, any>) => {
        console.log('Result:', JSON.stringify(result, null, 2));

        // Add the result to the test data
        testData.last_result = result;

        // Write the updated test data back to the file
        fs.writeFileSync(filePath, JSON.stringify(testData, null, 2));

        console.log(`Updated test data written to ${filePath}`);
      })
      .catch((error: Error) => {
        console.error('Error executing flow:', error);
        process.exit(1);
      });
  } else {
    console.error(`Flow "${flow}" is not a function`);
    process.exit(1);
  }
} catch (error: unknown) {
  console.error('Error reading or parsing test data file:', error instanceof Error ? error.message : error);
  process.exit(1);
}