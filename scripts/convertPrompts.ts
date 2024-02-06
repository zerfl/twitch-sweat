import 'dotenv/config';

const analyzerPrompt = process.env.OPENAI_ANALYZER_PROMPT!;
const scenarioPrompt = process.env.OPENAI_SCENARIO_PROMPT!;

const analyzerPromptFormatted = analyzerPrompt.replace(/\n/g, '\\n');
const scenarioPromptFormatted = scenarioPrompt.replace(/\n/g, '\\n');

console.log(`OPENAI_ANALYZER_PROMPT=${analyzerPromptFormatted}`);
console.log(`OPENAI_SCENARIO_PROMPT=${scenarioPromptFormatted}`);
