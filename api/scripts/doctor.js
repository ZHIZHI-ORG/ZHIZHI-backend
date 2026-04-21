const fs = require('fs');
const path = require('path');

const apiRoot = __dirname ? path.resolve(__dirname, '..') : process.cwd();
const envPath = path.join(apiRoot, '.env');

const requiredVars = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY',
];

const optionalVars = [
  'GEMINI_API_KEY',
];

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const values = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    values[key] = value;
  }

  return values;
}

function hasValue(key, fileValues) {
  const processValue = process.env[key];
  if (processValue && processValue.trim().length > 0) {
    return true;
  }

  const fileValue = fileValues[key];
  return Boolean(fileValue && fileValue.trim().length > 0);
}

const envValues = readEnvFile(envPath);
const missingRequired = requiredVars.filter((key) => !hasValue(key, envValues));
const missingOptional = optionalVars.filter((key) => !hasValue(key, envValues));

console.log('\nZHIZHI API local doctor\n');
console.log(`API root: ${apiRoot}`);
console.log(`.env file: ${fs.existsSync(envPath) ? envPath : 'missing'}`);

if (missingRequired.length === 0) {
  console.log('\nRequired configuration: OK');
} else {
  console.log('\nRequired configuration: MISSING');
  for (const key of missingRequired) {
    console.log(`- ${key}`);
  }
}

if (missingOptional.length === 0) {
  console.log('\nOptional configuration: OK');
} else {
  console.log('\nOptional configuration: PARTIAL');
  for (const key of missingOptional) {
    console.log(`- ${key} (fortune / insights will use sample fallback data)`);
  }
}

console.log('\nRecommended next step:');
if (!fs.existsSync(envPath)) {
  console.log('- Run: cp .env.example .env');
}

if (missingRequired.length > 0) {
  console.log('- Fill the required Supabase values before running npm run dev:node');
  process.exitCode = 1;
} else {
  console.log('- Run: npm run dev:node');
}
