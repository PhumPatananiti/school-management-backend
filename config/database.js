const { Pool } = require('pg');

// Enhanced pool configuration with better defaults
const pool = new Pool({
  // Use DATABASE_URL if available (for Render), otherwise use individual variables
  connectionString: process.env.DATABASE_URL,
  // Fallback to individual variables for local development
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432, // Changed from 3000 to correct PostgreSQL port
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  
  // SSL configuration for production (Render requires this)
  ssl: process.env.DATABASE_URL ? {
    rejectUnauthorized: false
  } : false,
  
  // Connection pool settings - optimized for stability
  max: 20, // Maximum number of clients in the pool
  min: 2, // Minimum number of clients to keep
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // Increased to 10 seconds for better reliability
  maxUses: 7500, // Close and replace a connection after 7500 uses
  allowExitOnIdle: true, // Allow the pool to close all idle clients and exit
  
  // Query timeout at pool level
  statement_timeout: 30000, // 30 second query timeout
  query_timeout: 30000,
});

// Track connection metrics
let connectionMetrics = {
  totalQueries: 0,
  failedQueries: 0,
  avgQueryTime: 0,
  lastError: null,
  lastErrorTime: null
};

// Connection event handlers
pool.on('connect', (client) => {
  console.log('✅ New client connected to PostgreSQL database');
  
  // Set statement timeout for this client
  client.query('SET statement_timeout = 30000').catch(err => {
    console.error('Failed to set statement timeout:', err);
  });
});

pool.on('acquire', (client) => {
  // Client is acquired from the pool
  console.log('Client acquired from pool');
});

pool.on('remove', (client) => {
  console.log('Client removed from pool');
});

pool.on('error', (err, client) => {
  console.error('❌ Unexpected error on idle client', err);
  connectionMetrics.lastError = err.message;
  connectionMetrics.lastErrorTime = new Date();
  
  // Try to recover by creating a new connection
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
    console.log('Attempting to recover connection...');
  }
});

// Monitor pool health every minute
const poolMonitor = setInterval(() => {
  const stats = {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    metrics: {
      totalQueries: connectionMetrics.totalQueries,
      failedQueries: connectionMetrics.failedQueries,
      successRate: connectionMetrics.totalQueries > 0 
        ? ((connectionMetrics.totalQueries - connectionMetrics.failedQueries) / connectionMetrics.totalQueries * 100).toFixed(2) + '%'
        : '100%',
      avgQueryTime: connectionMetrics.avgQueryTime.toFixed(2) + 'ms'
    }
  };
  
  console.log('📊 Pool Status:', stats);
  
  // Memory usage
  const memUsage = process.memoryUsage();
  console.log('Memory Usage (MB):', {
    rss: Math.round(memUsage.rss / 1024 / 1024),
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    external: Math.round(memUsage.external / 1024 / 1024)
  });
  
  // Alert conditions
  if (pool.waitingCount > 5) {
    console.warn('⚠️  WARNING: Database pool under heavy load! Waiting clients:', pool.waitingCount);
  }
  
  if (pool.idleCount === 0 && pool.totalCount >= pool.options.max) {
    console.warn('⚠️  WARNING: Connection pool exhausted!');
  }
  
  if (connectionMetrics.failedQueries > 10) {
    console.error('🚨 ALERT: High query failure rate detected!');
  }
}, 60000); // Check every minute

// Enhanced query function with automatic retry and timeout
const query = async (text, params, retries = 2) => {
  const start = Date.now();
  let lastError;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Retry attempt ${attempt} for query`);
        // Wait before retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
      
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout after 30s')), 30000)
      );
      
      // Execute query with timeout
      const queryPromise = pool.query(text, params);
      const res = await Promise.race([queryPromise, timeoutPromise]);
      
      const duration = Date.now() - start;
      
      // Update metrics
      connectionMetrics.totalQueries++;
      connectionMetrics.avgQueryTime = 
        (connectionMetrics.avgQueryTime * (connectionMetrics.totalQueries - 1) + duration) / 
        connectionMetrics.totalQueries;
      
      console.log('Executed query', { 
        text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        duration, 
        rows: res.rowCount,
        attempt: attempt > 0 ? attempt : undefined
      });
      
      return res;
      
    } catch (error) {
      lastError = error;
      connectionMetrics.failedQueries++;
      
      console.error(`Database query error (attempt ${attempt + 1}/${retries + 1}):`, {
        message: error.message,
        code: error.code,
        query: text.substring(0, 100) + (text.length > 100 ? '...' : '')
      });
      
      // Don't retry on certain errors
      if (error.code === '23505' || // unique_violation
          error.code === '23503' || // foreign_key_violation
          error.code === '42P01' || // undefined_table
          error.code === '42703' || // undefined_column
          error.message.includes('syntax error')) {
        throw error; // These are application errors, not connection issues
      }
      
      // If this was the last attempt, throw the error
      if (attempt === retries) {
        throw error;
      }
    }
  }
  
  throw lastError;
};

// Safe transaction wrapper with timeout and proper cleanup
const transaction = async (callback, timeout = 30000) => {
  const client = await pool.connect();
  let isReleased = false;
  
  // Create timeout that will rollback and release
  const timeoutHandle = setTimeout(async () => {
    if (!isReleased) {
      console.error('⚠️  Transaction timeout - rolling back and releasing client');
      try {
        await client.query('ROLLBACK');
      } catch (err) {
        console.error('Error during timeout rollback:', err);
      }
      client.release(true); // Force release with error flag
      isReleased = true;
    }
  }, timeout);
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    
    clearTimeout(timeoutHandle);
    
    if (!isReleased) {
      client.release();
      isReleased = true;
    }
    
    return result;
    
  } catch (error) {
    clearTimeout(timeoutHandle);
    
    if (!isReleased) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error during rollback:', rollbackError);
      }
      
      client.release(true); // Release with error flag
      isReleased = true;
    }
    
    console.error('Transaction error:', error);
    throw error;
  }
};

// Safe query function that ensures client is always released
const safeClientQuery = async (callback) => {
  const client = await pool.connect();
  let isReleased = false;
  
  // Safety timeout
  const timeoutHandle = setTimeout(() => {
    if (!isReleased) {
      console.error('⚠️  Client query timeout - forcing release');
      client.release(true);
      isReleased = true;
    }
  }, 30000);
  
  try {
    const result = await callback(client);
    clearTimeout(timeoutHandle);
    
    if (!isReleased) {
      client.release();
      isReleased = true;
    }
    
    return result;
    
  } catch (error) {
    clearTimeout(timeoutHandle);
    
    if (!isReleased) {
      client.release(true);
      isReleased = true;
    }
    
    throw error;
  }
};

// Health check function
const healthCheck = async () => {
  try {
    const result = await pool.query('SELECT NOW() as time, version() as version');
    return {
      status: 'healthy',
      database: 'connected',
      timestamp: result.rows[0].time,
      version: result.rows[0].version,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
      },
      metrics: connectionMetrics
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
      }
    };
  }
};

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('🛑 Shutting down database connection pool...');
  
  clearInterval(poolMonitor);
  
  try {
    await pool.end();
    console.log('✅ Database pool closed successfully');
  } catch (error) {
    console.error('❌ Error closing database pool:', error);
  }
};

// Handle process termination
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = {
  pool,
  query,
  transaction,
  safeClientQuery,
  healthCheck,
  gracefulShutdown
};