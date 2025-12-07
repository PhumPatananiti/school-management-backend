const { Pool } = require('pg');

const pool = new Pool({
  // Use DATABASE_URL if available (for Render), otherwise use individual variables
  connectionString: process.env.DATABASE_URL,
  
  // Fallback to individual variables for local development
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3000,
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  
  // SSL configuration for production (Render requires this)
  ssl: process.env.DATABASE_URL ? {
    rejectUnauthorized: false
  } : false,
  
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
});

// Add this after pool configuration
setInterval(() => {
  console.log('Pool Status:', {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount
  });
  
  // Alert if pool is exhausted
  if (pool.waitingCount > 5) {
    console.warn('⚠️  Database pool under heavy load!');
  }
}, 60000); // Check every minute

const query = async (text, params) => {
  const start = Date.now();
  try {
    // Add 10-second timeout
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Query timeout after 10s')), 10000)
    );
    
    const queryPromise = pool.query(text, params);
    const res = await Promise.race([queryPromise, timeoutPromise]);
    
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

const transaction = async (callback) => {
  const client = await pool.connect();
  const timeout = setTimeout(() => {
    console.error('Transaction timeout - releasing client');
    client.release();
  }, 30000); // 30 second timeout
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    clearTimeout(timeout);
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    clearTimeout(timeout);
    console.error('Transaction error:', error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  query,
  transaction
};