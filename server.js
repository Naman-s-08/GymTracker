const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 1. DATABASE CONNECTION
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'naman@123',
    database: 'GymTrackerDB'
});

db.connect(err => {
    if (err) console.error('Database failed: ' + err.stack);
    else console.log('Connected to MySQL Database!');
});

// 2. SERVE THE LOGIN PAGE FIRST
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 3. SERVE THE DASHBOARD
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 4. SERVE THE TROPHY ROOM
app.get('/trophies', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'trophy.html'));
});

// 5. SERVE STATIC FILES (CSS/JS)
app.use(express.static('public', { index: false }));

// 6. THE "INFINITE WORKOUT" LOGIC (THE FIX)
app.post('/api/add-set', (req, res) => {
    const { exercise_name, weight, reps } = req.body;

    // A. Check if the exercise already exists
    const checkSql = "SELECT exercise_id FROM Exercises WHERE exercise_name = ?";

    db.query(checkSql, [exercise_name], (err, rows) => {
        if (err) return res.status(500).send(err);

        // Helper function to save the weights once we have the ID
        const saveSet = (id) => {
            const setSql = "INSERT INTO Sets (workout_id, exercise_id, weight_lifted, reps_done) VALUES (1, ?, ?, ?)";
            db.query(setSql, [id, weight, reps], (err) => {
                if (err) return res.status(500).send(err);

                // Check if this is a new PR
                db.query("SELECT MAX(weight_lifted) as maxWeight FROM Sets WHERE exercise_id = ?", [id], (err, prRows) => {
                    const isPR = parseFloat(weight) >= (prRows[0].maxWeight || 0);
                    res.json({ message: "Success", isPR: isPR });
                });
            });
        };

        if (rows.length > 0) {
            saveSet(rows[0].exercise_id); // Exercise exists
        } else {
            // Exercise is NEW - Create it
            db.query("INSERT INTO Exercises (exercise_name) VALUES (?)", [exercise_name], (err, result) => {
                if (err) return res.status(500).send(err);
                saveSet(result.insertId); // Use the new ID
            });
        }
    });
});

// 7. GET ALL PRs FOR TROPHY ROOM
app.get('/api/personal-records', (req, res) => {
    const sql = "SELECT e.exercise_name, MAX(s.weight_lifted) as max_weight FROM Exercises e JOIN Sets s ON e.exercise_id = s.exercise_id GROUP BY e.exercise_name";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

// 8. START ENGINE
app.listen(3000, () => {
    console.log("Server is live at http://localhost:3000");
});