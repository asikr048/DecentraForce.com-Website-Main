import { initAdminSchema } from '../lib/db.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  try {
    console.log('Initializing purchases table...');
    await initAdminSchema();
    console.log('Purchases table created successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Failed to create purchases table:', error);
    process.exit(1);
  }
}

main();