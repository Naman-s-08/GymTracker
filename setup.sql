-- GymTracker Database Setup
-- Run this in MySQL Workbench or via: mysql -u root -p < setup.sql

CREATE DATABASE IF NOT EXISTS GymTrackerDB;
USE GymTrackerDB;

-- 1. Users
CREATE TABLE IF NOT EXISTS Users (
    user_id    INT           NOT NULL AUTO_INCREMENT,
    username   VARCHAR(50)   NOT NULL,
    email      VARCHAR(100)  NOT NULL,
    password   VARCHAR(255)  NULL,
    PRIMARY KEY (user_id),
    UNIQUE KEY (email),
    UNIQUE KEY (username)
);

-- 2. Exercises
CREATE TABLE IF NOT EXISTS Exercises (
    exercise_id   INT          NOT NULL AUTO_INCREMENT,
    exercise_name VARCHAR(50)  NOT NULL,
    muscle_group  VARCHAR(50)  NULL,
    PRIMARY KEY (exercise_id)
);

-- 3. Workouts
CREATE TABLE IF NOT EXISTS Workouts (
    workout_id   INT   NOT NULL AUTO_INCREMENT,
    user_id      INT   NULL,
    workout_date DATE  DEFAULT (CURDATE()),
    PRIMARY KEY (workout_id),
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
);

-- 4. Sets
CREATE TABLE IF NOT EXISTS Sets (
    set_id         INT           NOT NULL AUTO_INCREMENT,
    workout_id     INT           NULL,
    exercise_id    INT           NULL,
    weight_lifted  DECIMAL(5,2)  NULL,
    reps_done      INT           NULL,
    PRIMARY KEY (set_id),
    FOREIGN KEY (workout_id)  REFERENCES Workouts(workout_id)  ON DELETE CASCADE,
    FOREIGN KEY (exercise_id) REFERENCES Exercises(exercise_id) ON DELETE CASCADE
);
