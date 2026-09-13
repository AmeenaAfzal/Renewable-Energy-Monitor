// ================================================================
// Renewable Energy Monitoring Database - API Server
// Connects the Oracle database to the dashboard frontend.
// Every route below is a direct wrapper around one of the queries
// or PL/SQL programs from the sql/ folder (person1-4).
// ================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const oracledb = require('oracledb');
const path = require('path');

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const app = express();
app.use(cors());
app.use(express.json());

// Serve the dashboard frontend from this same server, on this same port,
// so the browser loads everything over http://localhost:3000 instead of
// file://. That avoids the "file: URLs are treated as unique security
// origins" error and lets fetch() calls to /api/* work normally.
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING
};

let pool;

async function startPool() {
    pool = await oracledb.createPool(dbConfig);
    console.log('Oracle connection pool ready');
}

async function query(sql, binds = {}) {
    const connection = await pool.getConnection();
    try {
        const result = await connection.execute(sql, binds);
        return result.rows;
    } finally {
        await connection.close();
    }
}

// Translates known Oracle errors from the Data Entry inserts into plain
// English. Raw ORA- messages are accurate but not user-friendly (constraint
// names, ORA-06512 stack lines, etc.) — this keeps the specific, correct
// reason for a rejection while dropping the Oracle-internal noise.
function friendlyInsertError(err) {
    const msg = err.message || '';

    if (msg.includes('CHK_GENERATION_NONNEGATIVE')) {
        return "Wind, solar, and other renewable readings all have to be zero or greater.";
    }
    if (msg.includes('CHK_DISCHARGE_LIMIT')) {
        return "Discharge can't be greater than charge plus the current storage level for that reading.";
    }
    if (msg.includes('ORA-20001')) {
        // trg_battery_valid_storage raises this itself with readable text
        // already — just strip the "ORA-20001:" code and any stack lines
        // oracledb appends after it.
        const match = msg.match(/ORA-20001:\s*(.+?)(?:\n|$)/);
        return match ? match[1].trim() : 'Battery storage cannot be negative.';
    }
    if (msg.includes('ORA-01400') || msg.toLowerCase().includes('cannot insert null')) {
        return 'One or more required fields were left empty.';
    }
    if (msg.includes('ORA-01858') || msg.includes('ORA-01861') || msg.toLowerCase().includes('not a valid month')) {
        return 'That date could not be read — please pick one with the date picker rather than typing it.';
    }
    if (msg.includes('ORA-00001')) {
        return 'Insert cannot be performed - please recheck if values are correct';
    }

    // Fallback for anything unrecognized: still trims the message down to
    // its first line rather than showing a full multi-line Oracle stack.
    return msg.split('\n')[0] || 'The database rejected this entry.';
}

// ----------------------------------------------------------------
// PERSON 1: States
// ----------------------------------------------------------------

// all states -> feeds the state dropdowns on Generation, Battery, Data Entry
app.get('/api/states', async (req, res) => {
    try {
        const rows = await query(`SELECT state_id, state_name, state_code, region FROM States ORDER BY state_name`);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ----------------------------------------------------------------
// PERSON 2: Daily Generation (solar & wind)
// ----------------------------------------------------------------

// total solar & wind per state -> feeds bar chart
app.get('/api/generation/totals', async (req, res) => {
    try {
        const rows = await query(
            `SELECT s.state_name,
                    SUM(dg.solar_energy_mwh) AS total_solar,
                    SUM(dg.wind_energy_mwh)  AS total_wind
             FROM DailyGeneration dg JOIN States s ON s.state_id = dg.state_id
             GROUP BY s.state_name ORDER BY total_solar DESC`
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// monthly totals per state -> feeds line chart, optional ?state_id=
app.get('/api/generation/monthly', async (req, res) => {
    try {
        const { state_id } = req.query;
        const sql = `SELECT s.state_name,
                            TO_CHAR(dg.reading_date, 'YYYY-MM') AS gen_month,
                            SUM(dg.total_renewable_mwh) AS monthly_total
                     FROM DailyGeneration dg JOIN States s ON s.state_id = dg.state_id
                     ${state_id ? 'WHERE dg.state_id = :state_id' : ''}
                     GROUP BY s.state_name, TO_CHAR(dg.reading_date, 'YYYY-MM')
                     ORDER BY gen_month`;
        const rows = state_id ? await query(sql, { state_id }) : await query(sql);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// top 5 states by solar generation
app.get('/api/generation/top-solar', async (req, res) => {
    try {
        const rows = await query(
            `SELECT s.state_name, SUM(dg.solar_energy_mwh) AS total_solar
             FROM DailyGeneration dg JOIN States s ON s.state_id = dg.state_id
             GROUP BY s.state_name ORDER BY total_solar DESC FETCH FIRST 5 ROWS ONLY`
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// INSERT a new generation reading. Deliberately does NOT send
// total_renewable_mwh — trg_calc_total_renewable (BEFORE INSERT) fills it
// in from wind + solar + other before the row is written, and the
// RETURNING clause hands back that trigger-computed value so the frontend
// can show it came from the database, not from client-side math.
app.post('/api/generation', async (req, res) => {
    const { state_id, reading_date, wind_energy_mwh, solar_energy_mwh, other_renewable_mwh } = req.body;
    const connection = await pool.getConnection();
    try {
        const result = await connection.execute(
            `INSERT INTO DailyGeneration
                 (state_id, reading_date, wind_energy_mwh, solar_energy_mwh, other_renewable_mwh)
             VALUES
                 (:state_id, TO_DATE(:reading_date, 'YYYY-MM-DD'), :wind_energy_mwh, :solar_energy_mwh, :other_renewable_mwh)
             RETURNING total_renewable_mwh INTO :computed_total`,
            {
                state_id,
                reading_date,
                wind_energy_mwh,
                solar_energy_mwh,
                other_renewable_mwh,
                computed_total: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
            },
            { autoCommit: true }
        );
        res.json({
            inserted: true,
            total_renewable_mwh: result.outBinds.computed_total[0]
        });
    } catch (err) {
        res.status(400).json({ error: friendlyInsertError(err), detail: err.message });
    } finally {
        await connection.close();
    }
});

// Wraps the show_running_total PL/SQL cursor procedure. That procedure
// writes each line via DBMS_OUTPUT.PUT_LINE rather than returning rows, so
// this drains the DBMS_OUTPUT buffer line-by-line to retrieve the text —
// the standard pattern for reading PUT_LINE output from a Node client.
app.get('/api/generation/running-total/:stateId', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.execute(`BEGIN DBMS_OUTPUT.ENABLE(NULL); END;`);
        await connection.execute(
            `BEGIN show_running_total(:state_id); END;`,
            { state_id: req.params.stateId }
        );

        const lines = [];
        while (true) {
            const result = await connection.execute(
                `BEGIN DBMS_OUTPUT.GET_LINE(:line, :status); END;`,
                {
                    line: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
                    status: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
                }
            );
            if (result.outBinds.status !== 0) break;
            lines.push(result.outBinds.line);
        }

        res.json({ lines });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        await connection.close();
    }
});

// ----------------------------------------------------------------
// PERSON 3: Battery Storage
// ----------------------------------------------------------------

// total charged vs discharged per state -> feeds bar chart
app.get('/api/battery/totals', async (req, res) => {
    try {
        const rows = await query(
            `SELECT s.state_name,
                    SUM(b.battery_charged_mwh)    AS total_charged,
                    SUM(b.battery_discharged_mwh) AS total_discharged
             FROM BatteryStorage b JOIN States s ON s.state_id = b.state_id
             GROUP BY s.state_name ORDER BY total_charged DESC`
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PL/SQL function battery_efficiency() -> feeds the efficiency gauge
app.get('/api/battery/efficiency', async (req, res) => {
    try {
        const { state_id, date } = req.query;
        const rows = await query(
            `SELECT battery_efficiency(:state_id, TO_DATE(:reading_date, 'YYYY-MM-DD')) AS efficiency_percent FROM dual`,
            { state_id, reading_date: date }
        );
        res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// INSERT a new battery reading. trg_battery_valid_storage (BEFORE INSERT)
// rejects a negative battery_storage_mwh with ORA-20001, and the
// chk_discharge_limit CHECK constraint rejects discharge that exceeds
// charge + storage. Both surface here as a 400 with a plain-English
// message (see friendlyInsertError) rather than the raw ORA- text.
app.post('/api/battery', async (req, res) => {
    const { state_id, reading_date, battery_charged_mwh, battery_discharged_mwh, battery_storage_mwh } = req.body;
    const connection = await pool.getConnection();
    try {
        await connection.execute(
            `INSERT INTO BatteryStorage
                 (state_id, reading_date, battery_charged_mwh, battery_discharged_mwh, battery_storage_mwh)
             VALUES
                 (:state_id, TO_DATE(:reading_date, 'YYYY-MM-DD'), :battery_charged_mwh, :battery_discharged_mwh, :battery_storage_mwh)`,
            { state_id, reading_date, battery_charged_mwh, battery_discharged_mwh, battery_storage_mwh },
            { autoCommit: true }
        );
        res.json({ inserted: true });
    } catch (err) {
        res.status(400).json({ error: friendlyInsertError(err), detail: err.message });
    } finally {
        await connection.close();
    }
});

// ----------------------------------------------------------------
// PERSON 4: Cross-table analytics & integration
// ----------------------------------------------------------------

// states above the national average generation
app.get('/api/summary/above-average', async (req, res) => {
    try {
        const rows = await query(
            `SELECT state_name, total_generation FROM (
                 SELECT state_name, SUM(total_renewable_mwh) AS total_generation
                 FROM vw_state_summary GROUP BY state_name
             )
             WHERE total_generation > (
                 SELECT AVG(total_gen) FROM (
                     SELECT SUM(total_renewable_mwh) AS total_gen
                     FROM vw_state_summary GROUP BY state_name
                 )
             )`
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// single-row national totals -> feeds the three Overview KPI cards
app.get('/api/summary/national-totals', async (req, res) => {
    try {
        const rows = await query(
            `SELECT
                 (SELECT SUM(solar_energy_mwh)    FROM DailyGeneration) AS total_solar,
                 (SELECT SUM(wind_energy_mwh)     FROM DailyGeneration) AS total_wind,
                 (SELECT SUM(battery_storage_mwh) FROM BatteryStorage)  AS total_battery_storage
             FROM dual`
        );
        res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// state rankings by total generation -> feeds the rankings table
app.get('/api/summary/rankings', async (req, res) => {
    try {
        const rows = await query(
            `SELECT state_id, state_name,
                    SUM(total_renewable_mwh) AS total_generation,
                    RANK() OVER (ORDER BY SUM(total_renewable_mwh) DESC) AS generation_rank
             FROM vw_state_summary GROUP BY state_id, state_name`
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PL/SQL procedure calculate_performance_score() -> feeds the performance score card
app.get('/api/summary/performance-score/:stateId', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const result = await connection.execute(
            `BEGIN calculate_performance_score(:state_id, :score); END;`,
            {
                state_id: req.params.stateId,
                score: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
            }
        );
        res.json({ state_id: req.params.stateId, performance_score: result.outBinds.score });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        await connection.close();
    }
});

// ----------------------------------------------------------------
// Start server
// ----------------------------------------------------------------
const PORT = process.env.PORT || 3000;

startPool().then(() => {
    app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
}).catch(err => {
    console.error('Failed to start Oracle connection pool:', err);
});