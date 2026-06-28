import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

export interface Config {
  BOT_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  PORT: number;
  NODE_ENV: string;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${key}. Check your .env file at ${path.resolve(__dirname, '..', '.env')}`
    );
  }
  return value.trim();
}

function validateUrl(key: string, value: string): void {
  try {
    new URL(value);
  } catch {
    throw new Error(`Invalid URL for ${key}: "${value}"`);
  }
}

const BOT_TOKEN = requireEnv('BOT_TOKEN');
const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = requireEnv('SUPABASE_SERVICE_KEY');

validateUrl('SUPABASE_URL', SUPABASE_URL);

const PORT = parseInt(process.env.PORT || '10000', 10);
if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}". Must be a number between 1 and 65535.`);
}

const NODE_ENV = process.env.NODE_ENV || 'development';

const config: Config = Object.freeze({
  BOT_TOKEN,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  PORT,
  NODE_ENV,
});

export default config;
