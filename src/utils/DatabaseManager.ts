import { Pool } from 'pg';
import { env } from '../env'; // Assuming env.ts will be created and export necessary DB variables

// Create a new PostgreSQL connection pool
const pool = new Pool({
  user: env.DB_USER,
  host: env.DB_HOST,
  database: env.DB_NAME,
  password: env.DB_PASSWORD,
  port: parseInt(env.DB_PORT || '5432', 10), // Ensure port is a number, provide default
  // ssl: env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false, // Example SSL config
  // Note: For robust SSL, consider using an object like:
  // ssl: env.DB_SSL_MODE && env.DB_SSL_MODE !== 'disable'
  //   ? {
  //       rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
  //       ca: env.DB_SSL_CA,
  //       key: env.DB_SSL_KEY,
  //       cert: env.DB_SSL_CERT
  //     }
  //   : undefined,
});

// Listener for errors that occur on idle clients in the pool
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client in PostgreSQL pool', err);
  // Depending on the application's needs, you might want to exit if critical errors occur
  // process.exit(-1);
});

/**
 * Executes a SQL query using a client from the connection pool.
 * @param text The SQL query string. This can include placeholders like $1, $2 for parameters.
 * @param params An optional array of parameters to be safely substituted into the query.
 * @returns A Promise that resolves with the query result.
 * @throws Re-throws any error encountered during query execution.
 */
export const query = async (text: string, params?: any[]) => {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } catch (err) {
    console.error('Error executing query:', {
      query: text,
      params: params,
      error: err,
    });
    throw err; // Re-throw the error for the caller to handle
  } finally {
    client.release(); // Ensure the client is always released back to the pool
  }
};

/**
 * Optional: Export the pool itself for more complex database operations like transactions.
 * This allows services to acquire a client and manage its lifecycle for multiple operations.
 */
export const getPool = () => pool;

// Basic test query to verify connection - can be called during app startup
export const testDatabaseConnection = async () => {
  try {
    const result = await query('SELECT NOW()');
    console.log('Database connection successful. Current time from DB:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
};

// Example of how to perform a transaction if the pool is exported or a dedicated function is made
// This is more advanced and typically would live in a service layer, not directly in DatabaseManager.
// async function exampleTransaction() {
//   const client = await pool.connect();
//   try {
//     await client.query('BEGIN');
//     // Example: Insert into two tables, if the second fails, the first is rolled back.
//     const insertQuery1 = 'INSERT INTO table1 (column1) VALUES ($1) RETURNING id';
//     const result1 = await client.query(insertQuery1, ['value1']);
//     const idFromTable1 = result1.rows[0].id;
//
//     const insertQuery2 = 'INSERT INTO table2 (column1_id, column2) VALUES ($1, $2)';
//     await client.query(insertQuery2, [idFromTable1, 'value2']);
//
//     await client.query('COMMIT');
//     console.log('Transaction successful');
//   } catch (e) {
//     await client.query('ROLLBACK');
//     console.error('Transaction failed, rolled back.', e);
//     throw e;
//   } finally {
//     client.release();
//   }
// }
