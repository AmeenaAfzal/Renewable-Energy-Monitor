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
-- ================================================================
-- SECTION 3: QUERIES
-- ================================================================

-- Q1 (simple filter): states in a given region
SELECT state_name, state_code
FROM States
WHERE region = 'Southern Region'
ORDER BY state_name;

-- Q2 (aggregation): number of states per region
SELECT region, COUNT(*) AS total_states
FROM States
GROUP BY region
ORDER BY total_states DESC;

-- Q3 (correlated subquery / NOT EXISTS): states with no generation data
SELECT s.state_name, s.region
FROM States s
WHERE NOT EXISTS (
    SELECT 1 FROM DailyGeneration dg WHERE dg.state_id = s.state_id
);

-- Q4 (JOIN + aggregation): total solar and wind generation per state
SELECT s.state_name,
       SUM(dg.solar_energy_mwh) AS total_solar,
       SUM(dg.wind_energy_mwh)  AS total_wind
FROM DailyGeneration dg
JOIN States s ON s.state_id = dg.state_id
GROUP BY s.state_name
ORDER BY total_solar DESC;

-- Q5 (ORDER BY + FETCH FIRST): top 5 states by solar generation
SELECT s.state_name, SUM(dg.solar_energy_mwh) AS total_solar
FROM DailyGeneration dg
JOIN States s ON s.state_id = dg.state_id
GROUP BY s.state_name
ORDER BY total_solar DESC
FETCH FIRST 5 ROWS ONLY;

-- Q6 (HAVING): states where average wind beats average solar
SELECT s.state_name,
       ROUND(AVG(dg.wind_energy_mwh), 2)  AS avg_wind,
       ROUND(AVG(dg.solar_energy_mwh), 2) AS avg_solar
FROM DailyGeneration dg
JOIN States s ON s.state_id = dg.state_id
GROUP BY s.state_name
HAVING AVG(dg.wind_energy_mwh) > AVG(dg.solar_energy_mwh);

-- Q7 (JOIN + aggregation): total charged vs discharged per state
SELECT s.state_name,
       SUM(b.battery_charged_mwh)    AS total_charged,
       SUM(b.battery_discharged_mwh) AS total_discharged
FROM BatteryStorage b
JOIN States s ON s.state_id = b.state_id
GROUP BY s.state_name
ORDER BY total_charged DESC;

-- Q8 (HAVING): states where discharge consistently exceeds charge
SELECT s.state_name
FROM BatteryStorage b
JOIN States s ON s.state_id = b.state_id
GROUP BY s.state_name
HAVING AVG(b.battery_discharged_mwh) > AVG(b.battery_charged_mwh);

-- Q9: create a view joining all 3 tables
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

-- Q10 (uses the view + nested subquery): states above the national average generation
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

-- Q11 (window function): rank states by total generation
SELECT state_id, state_name,
       SUM(total_renewable_mwh) AS total_generation,
       RANK() OVER (ORDER BY SUM(total_renewable_mwh) DESC) AS generation_rank
FROM vw_state_summary
GROUP BY state_id, state_name;


-- ================================================================
-- SECTION 4: PL/SQL - FUNCTIONS
-- ================================================================

-- Function 1: return the region for a given state
CREATE OR REPLACE FUNCTION get_region (p_state_id IN NUMBER)
RETURN VARCHAR2
IS
    v_region VARCHAR2(30);
BEGIN
    SELECT region INTO v_region FROM States WHERE state_id = p_state_id;
    RETURN v_region;
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        RETURN 'Unknown';
END get_region;
/

-- test
SELECT get_region(3) AS region FROM dual;


-- Function 2: battery efficiency % for a state on a given date
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
CREATE OR REPLACE TRIGGER trg_calc_total_renewable
BEFORE INSERT OR UPDATE ON DailyGeneration
FOR EACH ROW
BEGIN
    :NEW.total_renewable_mwh := :NEW.wind_energy_mwh + :NEW.solar_energy_mwh + :NEW.other_renewable_mwh;
END trg_calc_total_renewable;
/

-- Trigger 2: block invalid (negative) battery storage values
CREATE OR REPLACE TRIGGER trg_battery_valid_storage
BEFORE INSERT OR UPDATE ON BatteryStorage
FOR EACH ROW
BEGIN
    IF :NEW.battery_storage_mwh < 0 THEN
        RAISE_APPLICATION_ERROR(-20001, 'Battery storage cannot be negative.');
    END IF;
END trg_battery_valid_storage;
/