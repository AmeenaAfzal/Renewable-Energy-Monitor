
CREATE TABLE States (
    state_id     NUMBER PRIMARY KEY,
    state_name   VARCHAR2(50) NOT NULL UNIQUE,
    state_code   NUMBER NOT NULL,
    region       VARCHAR2(30) NOT NULL
);

CREATE TABLE DailyGeneration (
    reading_id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    state_id             NUMBER NOT NULL REFERENCES States(state_id),
    reading_date         DATE NOT NULL,
    wind_energy_mwh      NUMBER(10,2) NOT NULL CHECK (wind_energy_mwh >= 0),
    solar_energy_mwh     NUMBER(10,2) NOT NULL CHECK (solar_energy_mwh >= 0),
    other_renewable_mwh  NUMBER(10,2) DEFAULT 0 NOT NULL CHECK (other_renewable_mwh >= 0),
    total_renewable_mwh  NUMBER(10,2) NOT NULL CHECK (total_renewable_mwh >= 0),
    CONSTRAINT uq_state_date UNIQUE (state_id, reading_date)
);

CREATE TABLE BatteryStorage (
    battery_id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    state_id                NUMBER NOT NULL REFERENCES States(state_id),
    reading_date            DATE NOT NULL,
    battery_charged_mwh     NUMBER(10,2) NOT NULL CHECK (battery_charged_mwh >= 0),
    battery_discharged_mwh  NUMBER(10,2) NOT NULL CHECK (battery_discharged_mwh >= 0),
    battery_storage_mwh     NUMBER(10,2) NOT NULL CHECK (battery_storage_mwh >= 0),
    CONSTRAINT uq_state_date_batt UNIQUE (state_id, reading_date)
);
