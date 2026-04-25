# Database Migrations

This directory contains SQLite database migration scripts for GWS Connect.

## Running Migrations

### Individual Migration

To run a specific migration:

```bash
cd server
node migrations/001_add_admin_role_to_galacticus.js
```

### All Migrations

To run all migrations in order:

```bash
cd server
npm run migrate
```

## Creating New Migrations

1. Create a new file with naming pattern: `XXX_description.js` (e.g., `002_add_new_table.js`)
2. Use the template structure:

```javascript
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/gws-connect.db');
const db = new Database(dbPath);

console.log('Running migration: Your migration description');

try {
	db.prepare('BEGIN').run();

	// Your migration code here

	db.prepare('COMMIT').run();
	console.log('✓ Migration completed successfully');
} catch (error) {
	db.prepare('ROLLBACK').run();
	console.error('✗ Migration failed:', error.message);
	process.exit(1);
} finally {
	db.close();
}
```

## Migration Best Practices

- Always use transactions (BEGIN/COMMIT/ROLLBACK)
- Make migrations idempotent (can be run multiple times safely)
- Add clear logging for success and failure cases
- Never modify existing migrations after they've been run in production
- Number migrations sequentially (001, 002, 003, etc.)
