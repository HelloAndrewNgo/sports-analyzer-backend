require('dotenv').config();

module.exports = {
  CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
  PORT: process.env.PORT || 3001,
  UPLOAD_DIR: process.env.UPLOAD_DIR || 'uploads',
  PROCESSED_DIR: process.env.PROCESSED_DIR || 'processed',
  MAX_FILE_SIZE: process.env.MAX_FILE_SIZE || 100000000,
  CLAUDE_API_URL: 'https://api.anthropic.com/v1/messages',
  DEV_MODE: process.env.DEV_MODE === 'true' || true // Set to false to use real Claude API
}; 