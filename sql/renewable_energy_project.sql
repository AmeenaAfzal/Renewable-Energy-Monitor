-- ================================================================
-- RENEWABLE ENERGY MONITORING DATABASE 
-- ================================================================
-- SECTION 1: DDL - extra constraints and indexes
-- ================================================================

ALTER TABLE States ADD CONSTRAINT chk_state_code CHECK (state_code > 0);
CREATE INDEX idx_states_region ON States(region);

CREATE INDEX idx_dailygen_date ON DailyGeneration(reading_date);

ALTER TABLE DailyGeneration ADD CONSTRAINT chk_generation_nonnegative
    CHECK (wind_energy_mwh >= 0 AND solar_energy_mwh >= 0 AND other_renewable_mwh >= 0);

ALTER TABLE BatteryStorage ADD CONSTRAINT chk_discharge_limit
    CHECK (battery_discharged_mwh <= battery_charged_mwh + battery_storage_mwh);
CREATE INDEX idx_battery_date ON BatteryStorage(reading_date);


-- ================================================================
-- SECTION 2: DML - INSERT, UPDATE, DELETE
-- ================================================================

-- INSERT: a new state
INSERT INTO States (state_id, state_name, state_code, region)
VALUES (100, 'Union Territory Demo', 99, 'Central Region');

-- INSERT: a generation reading and a battery reading for that new state
INSERT INTO DailyGeneration (state_id, reading_date, wind_energy_mwh, solar_energy_mwh, other_renewable_mwh, total_renewable_mwh)
VALUES (100, DATE '2030-01-01', 1.50, 2.00, 0.00, 3.50);

INSERT INTO BatteryStorage (state_id, reading_date, battery_charged_mwh, battery_discharged_mwh, battery_storage_mwh)
VALUES (100, DATE '2030-01-01', 1.00, 0.80, 10.00);
COMMIT;

SELECT * FROM States WHERE state_id = 100;

-- UPDATE: correct the demo state's region
UPDATE States SET region = 'Union Territory Region' WHERE state_id = 100;
COMMIT;

SELECT * FROM States WHERE state_id = 100;

-- DELETE: remove the demo rows (child rows first, then parent, to respect the foreign keys)
DELETE FROM DailyGeneration WHERE state_id = 100;
DELETE FROM BatteryStorage WHERE state_id = 100;
DELETE FROM States WHERE state_id = 100;
COMMIT;

SELECT * FROM States WHERE state_id = 100;

-- INSERT ... RETURNING INTO: this is the exact pattern the Data Entry tab's
-- "Add a generation reading" form uses (POST /api/generation). Note that
-- total_renewable_mwh is never supplied here -- trg_calc_total_renewable
-- (Section 7) computes it BEFORE the row is written, and RETURNING hands
-- that trigger-computed value straight back without a second SELECT.
INSERT INTO States (state_id, state_name, state_code, region)
VALUES (101, 'RETURNING Demo State', 98, 'Central Region');

VARIABLE computed_total NUMBER;

INSERT INTO DailyGeneration (state_id, reading_date, wind_energy_mwh, solar_energy_mwh, other_renewable_mwh)
VALUES (101, DATE '2031-01-01', 2.00, 3.00, 0.50)
RETURNING total_renewable_mwh INTO :computed_total;

PRINT computed_total;
-- expected: 5.5 (2.00 + 3.00 + 0.50) -- calculated by the trigger, not typed by hand

-- clean up the demo rows
DELETE FROM DailyGeneration WHERE state_id = 101;
DELETE FROM States WHERE state_id = 101;
COMMIT;
-- ================================================================
-- SECTION 3: QUERIES
-- ================================================================

-- Q1 (simple SELECT): every tracked state, alphabetical
-- -> feeds every state dropdown across the app (Generation, Battery,
--    Data Entry) and the "States tracked" KPI on Overview, via GET /api/states
SELECT state_id, state_name, state_code, region
FROM States
ORDER BY state_name;

-- Q2 (JOIN + aggregation): total solar and wind generation per state
-- -> feeds the "Total solar/wind generated" KPIs on Overview and the
--    "Solar vs. wind totals" chart on Generation, via GET /api/generation/totals
SELECT s.state_name,
       SUM(dg.solar_energy_mwh) AS total_solar,
       SUM(dg.wind_energy_mwh)  AS total_wind
FROM DailyGeneration dg
JOIN States s ON s.state_id = dg.state_id
GROUP BY s.state_name
ORDER BY total_solar DESC;

-- Q3 (JOIN + date grouping): total generation per state, per calendar month
-- -> feeds the "Monthly generation trend" line chart on the Generation tab,
--    filtered to one state at a time via GET /api/generation/monthly?state_id=
SELECT s.state_name,
       TO_CHAR(dg.reading_date, 'YYYY-MM') AS gen_month,
       SUM(dg.total_renewable_mwh) AS monthly_total
FROM DailyGeneration dg
JOIN States s ON s.state_id = dg.state_id
GROUP BY s.state_name, TO_CHAR(dg.reading_date, 'YYYY-MM')
ORDER BY gen_month;

-- Q4 (ORDER BY + FETCH FIRST): top 5 states by solar generation
-- -> feeds the "Top 5 states by solar generation" chart on Overview,
--    via GET /api/generation/top-solar
SELECT s.state_name, SUM(dg.solar_energy_mwh) AS total_solar
FROM DailyGeneration dg
JOIN States s ON s.state_id = dg.state_id
GROUP BY s.state_name
ORDER BY total_solar DESC
FETCH FIRST 5 ROWS ONLY;

-- Q6 (JOIN + aggregation): total charged vs discharged per state
-- -> feeds the "Total battery storage" KPI on Overview and the "Charged
--    vs. discharged by state" chart on Battery, via GET /api/battery/totals
SELECT s.state_name,
       SUM(b.battery_charged_mwh)    AS total_charged,
       SUM(b.battery_discharged_mwh) AS total_discharged
FROM BatteryStorage b
JOIN States s ON s.state_id = b.state_id
GROUP BY s.state_name
ORDER BY total_charged DESC;

-- Q8: create a view joining all 3 tables
-- -> not queried directly by any endpoint itself; Q9 and Q10 both select
--    from this view instead of repeating the 3-way join
CREATE OR REPLACE VIEW vw_state_summary AS
SELECT
    s.state_id,
    s.state_name,
    s.region,
    dg.reading_date,
    dg.solar_energy_mwh,
    dg.wind_energy_mwh,
    dg.other_renewable_mwh,
    dg.total_renewable_mwh,
    b.battery_charged_mwh,
    b.battery_discharged_mwh,
    b.battery_storage_mwh
FROM States s
JOIN DailyGeneration dg ON dg.state_id = s.state_id
JOIN BatteryStorage b   ON b.state_id = s.state_id AND b.reading_date = dg.reading_date;

-- Q9 (uses the view + nested subquery): states above the national average generation
-- -> feeds "States above average generation" on Overview and the matching
--    table on Insights, via GET /api/summary/above-average
SELECT state_name, total_generation
FROM (
    SELECT state_name, SUM(total_renewable_mwh) AS total_generation
    FROM vw_state_summary
    GROUP BY state_name
)
WHERE total_generation > (
    SELECT AVG(total_gen) FROM (
        SELECT SUM(total_renewable_mwh) AS total_gen
        FROM vw_state_summary
        GROUP BY state_name
    )
);

-- Q10 (window function): rank states by total generation
-- -> feeds the Rankings tab table (rank + total generation columns),
--    via GET /api/summary/rankings
SELECT state_id, state_name,
       SUM(total_renewable_mwh) AS total_generation,
       RANK() OVER (ORDER BY SUM(total_renewable_mwh) DESC) AS generation_rank
FROM vw_state_summary
GROUP BY state_id, state_name;

-- Q11 (aggregate, no grouping): single-row national totals
-- -> feeds the "Total solar generated", "Total wind generated", and
--    "Total battery storage" KPI cards on Overview, via
--    GET /api/summary/national-totals. Previously these three numbers were
--    computed by summing Q2's per-state rows in the browser; this replaces
--    that client-side aggregation with one server-computed row.
SELECT
    (SELECT SUM(solar_energy_mwh)    FROM DailyGeneration) AS total_solar,
    (SELECT SUM(wind_energy_mwh)     FROM DailyGeneration) AS total_wind,
    (SELECT SUM(battery_storage_mwh) FROM BatteryStorage)  AS total_battery_storage
FROM dual;


-- ================================================================
-- SECTION 4: PL/SQL - FUNCTIONS
-- ================================================================

-- Function 2: battery efficiency % for a state on a given date
-- -> feeds the "Battery efficiency" gauge on the Battery Storage tab,
--    via GET /api/battery/efficiency?state_id=&date=
CREATE OR REPLACE FUNCTION battery_efficiency (p_state_id IN NUMBER, p_date IN DATE)
RETURN NUMBER
IS
    v_charged    NUMBER;
    v_discharged NUMBER;
BEGIN
    SELECT battery_charged_mwh, battery_discharged_mwh
    INTO v_charged, v_discharged
    FROM BatteryStorage
    WHERE state_id = p_state_id AND reading_date = p_date;

    IF v_charged = 0 THEN
        RETURN 0;
    END IF;

    RETURN ROUND((v_discharged / v_charged) * 100, 2);
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        RETURN NULL;
    WHEN TOO_MANY_ROWS THEN
        RETURN NULL;  -- duplicate reading for this state/date; treat as unavailable rather than erroring
    WHEN OTHERS THEN
        RETURN NULL;
END battery_efficiency;
/

-- test (use a date that actually exists in your imported data)
SELECT battery_efficiency(1, DATE '2025-02-01') AS efficiency_percent FROM dual;


-- ================================================================
-- SECTION 5: PL/SQL - PROCEDURE WITH CURSOR
-- ================================================================
-- -> feeds the "Running total explorer" table on the Insights tab, via
--    GET /api/generation/running-total/:stateId, which drains this
--    procedure's DBMS_OUTPUT.PUT_LINE output line by line

CREATE OR REPLACE PROCEDURE show_running_total (p_state_id IN NUMBER)
IS
    CURSOR c_gen IS
        SELECT reading_date, total_renewable_mwh
        FROM DailyGeneration
        WHERE state_id = p_state_id
        ORDER BY reading_date;
    v_date    DailyGeneration.reading_date%TYPE;
    v_total   DailyGeneration.total_renewable_mwh%TYPE;
    v_running NUMBER := 0;
BEGIN
    OPEN c_gen;
    LOOP
        FETCH c_gen INTO v_date, v_total;
        EXIT WHEN c_gen%NOTFOUND;
        v_running := v_running + v_total;
        DBMS_OUTPUT.PUT_LINE(TO_CHAR(v_date, 'YYYY-MM-DD') || ' | Daily: ' || v_total || ' | Running total: ' || v_running);
    END LOOP;
    CLOSE c_gen;
END show_running_total;
/

-- test
SET SERVEROUTPUT ON;
EXEC show_running_total(1);


-- ================================================================
-- SECTION 6: PL/SQL - PROCEDURE WITH OUT PARAMETER (performance score)
-- ================================================================
-- -> feeds the "Performance score" column on the Rankings tab, via
--    GET /api/summary/performance-score/:stateId

CREATE OR REPLACE PROCEDURE calculate_performance_score (
    p_state_id IN  NUMBER,
    p_score    OUT NUMBER
)
IS
    v_total_gen       NUMBER;
    v_total_charge    NUMBER;
    v_total_discharge NUMBER;
    v_battery_eff     NUMBER;
BEGIN
    SELECT NVL(SUM(total_renewable_mwh), 0) INTO v_total_gen
    FROM DailyGeneration WHERE state_id = p_state_id;

    SELECT NVL(SUM(battery_charged_mwh), 0), NVL(SUM(battery_discharged_mwh), 0)
    INTO v_total_charge, v_total_discharge
    FROM BatteryStorage WHERE state_id = p_state_id;

    IF v_total_charge = 0 THEN
        v_battery_eff := 0;
    ELSE
        v_battery_eff := (v_total_discharge / v_total_charge) * 100;
    END IF;

    p_score := ROUND((v_total_gen * 0.7) + (v_battery_eff * 0.3), 2);
END calculate_performance_score;
/

-- test
VARIABLE v_score NUMBER;
EXEC calculate_performance_score(1, :v_score);
PRINT v_score;


-- ================================================================
-- SECTION 7: PL/SQL - TRIGGERS
-- ================================================================

-- Trigger 1: auto-calculate total_renewable_mwh so it's never entered by hand incorrectly
-- -> fires on the "Add a generation reading" form (Data Entry tab), via
--    POST /api/generation; the computed value is read back with
--    RETURNING total_renewable_mwh INTO ... and shown in the success message
CREATE OR REPLACE TRIGGER trg_calc_total_renewable
BEFORE INSERT OR UPDATE ON DailyGeneration
FOR EACH ROW
BEGIN
    :NEW.total_renewable_mwh := :NEW.wind_energy_mwh + :NEW.solar_energy_mwh + :NEW.other_renewable_mwh;
END trg_calc_total_renewable;
/

-- Trigger 2: block invalid (negative) battery storage values
-- -> fires on the "Add a battery reading" form (Data Entry tab), via
--    POST /api/battery; a rejection surfaces as a plain-English error
--    message via friendlyInsertError() in server.js
CREATE OR REPLACE TRIGGER trg_battery_valid_storage
BEFORE INSERT OR UPDATE ON BatteryStorage
FOR EACH ROW
BEGIN
    IF :NEW.battery_storage_mwh < 0 THEN
        RAISE_APPLICATION_ERROR(-20001, 'Battery storage cannot be negative.');
    END IF;
END trg_battery_valid_storage;
/