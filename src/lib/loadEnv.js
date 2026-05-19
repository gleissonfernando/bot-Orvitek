const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const localEnvPath = path.resolve(__dirname, '..', '..', '.env');
const parentEnvPath = path.resolve(__dirname, '..', '..', '..', '.env');

const envPath = fs.existsSync(localEnvPath)
  ? localEnvPath
  : fs.existsSync(parentEnvPath)
    ? parentEnvPath
    : localEnvPath;

dotenv.config({ path: envPath });
