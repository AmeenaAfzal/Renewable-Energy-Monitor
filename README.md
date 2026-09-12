# Renewable Energy Monitoring Database — Setup Guide

## Folder contents

```
sql/
  person1_states.sql        -> States table: DDL, DML, queries, PL/SQL
  person2_generation.sql    -> DailyGeneration table: DDL, DML, queries, PL/SQL
  person3_battery.sql       -> BatteryStorage table: DDL, DML, queries, PL/SQL
  person4_integration.sql   -> Cross-table view, queries, PL/SQL
backend/
  server.js                 -> API that connects to Oracle and serves the frontend
  package.json
  .env.example
frontend/
  index.html
  styles.css
  app.js
```

You should also already have `schema_oracle.sql` (creates the 3 base tables) from earlier — run that first.

## Step 1: Set up the database

In SQL Developer, connected to your Oracle schema, run in this exact order:

1. `schema_oracle.sql` (creates States, DailyGeneration, BatteryStorage)
2. `sql/person1_states.sql`
3. `sql/person2_generation.sql`
4. `sql/person3_battery.sql`
5. `sql/person4_integration.sql`

Each file only needs the tables/data created by the files before it — nobody needs to touch another person's file to test their own part.

If you want the **full CSV datasets** loaded (not just the sample rows in the .sql files), use SQL Developer's **Import Data** wizard on each table (right-click table → Import Data) and point it at `states_import.csv`, `daily_generation_import.csv`, and `battery_storage_import.csv`.

## Step 2: Set up the backend

1. Open a terminal in the `backend/` folder.
2. Run `npm install`
3. Copy `.env.example` to `.env` and fill in your real Oracle username, password, and connection string (the same ones you use to log into SQL Developer).
4. Run `npm start`
5. You should see: `Oracle connection pool ready` and `API running on http://localhost:3000`

## Step 3: Open the frontend

Just open `frontend/index.html` in a browser (double-click it, or use a simple local server like VS Code's "Live Server" extension). It will automatically call the API on `http://localhost:3000` and load real data from your database.

## What each screen shows

- **Overview** — total states, total solar/wind generated, total battery storage, top 5 solar states, states-by-region chart.
- **States** — full state list with a region filter dropdown.
- **Generation** — monthly generation trend per state, solar vs. wind totals, states where wind output beats solar.
- **Battery Storage** — efficiency gauge per state/date, charged vs. discharged totals, average storage trend by month.
- **Rankings** — states ranked by total generation, alongside each state's combined performance score.

## For screenshots / report

Take screenshots of:
- Each `.sql` file's output in SQL Developer (queries, function/procedure test calls, trigger test)
- The running frontend for each of the 5 screens above
