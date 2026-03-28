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

// 2. SERVE THE PAGES
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/public/login.html', (req, res) => res.redirect('/login'));
app.get('/welcome', (req, res) => res.sendFile(path.join(__dirname, 'public', 'welcome.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/trophies', (req, res) => res.sendFile(path.join(__dirname, 'public', 'trophy.html')));
app.use(express.static('public', { index: false }));

// 3. AUTHENTICATION / LOGIN ROUTE
app.post('/api/login', (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "Username required" });

    // Check if user exists
    db.query("SELECT user_id FROM Users WHERE username = ?", [username], (err, rows) => {
        if (err) return res.status(500).send(err);

        if (rows.length > 0) {
            // User exists
            return res.json({ userId: rows[0].user_id, username });
        } else {
            // New user, insert them
            db.query("INSERT INTO Users (username, email) VALUES (?, ?)", [username, username + '@gym.com'], (err, result) => {
                if (err) return res.status(500).send(err);
                res.json({ userId: result.insertId, username });
            });
        }
    });
});

// Helper function to get or create today's workout for a user
const getOrCreateWorkout = (userId, callback) => {
    db.query("SELECT workout_id FROM Workouts WHERE user_id = ? AND workout_date = CURDATE()", [userId], (err, rows) => {
        if (err) return callback(err);
        if (rows.length > 0) return callback(null, rows[0].workout_id);

        db.query("INSERT INTO Workouts (user_id, workout_date) VALUES (?, CURDATE())", [userId], (err, result) => {
            if (err) return callback(err);
            callback(null, result.insertId);
        });
    });
};

// 4. LOG A SET
app.post('/api/add-set', (req, res) => {
    const { user_id, exercise_name, weight, reps } = req.body;
    if (!user_id || !exercise_name || !weight || !reps) return res.status(400).json({ error: "Missing fields" });

    // 1. Get Workout ID for this user
    getOrCreateWorkout(user_id, (err, workout_id) => {
        if (err) return res.status(500).send({ error: err });

        // 2. Check if exercise exists globally
        db.query("SELECT exercise_id FROM Exercises WHERE exercise_name = ?", [exercise_name], (err, rows) => {
            if (err) return res.status(500).send({ error: err });

            const saveSet = (exercise_id) => {
                const setSql = "INSERT INTO Sets (workout_id, exercise_id, weight_lifted, reps_done) VALUES (?, ?, ?, ?)";
                db.query(setSql, [workout_id, exercise_id, weight, reps], (err, result) => {
                    if (err) return res.status(500).send({ error: err });

                    // Check if PR for this specific user
                    const prSql = `SELECT MAX(s.weight_lifted) as maxWeight FROM Sets s 
                                   JOIN Workouts w ON s.workout_id = w.workout_id 
                                   WHERE s.exercise_id = ? AND w.user_id = ? AND s.set_id != ?`;
                    db.query(prSql, [exercise_id, user_id, result.insertId], (err, prRows) => {
                        const previousMax = prRows[0]?.maxWeight || 0;
                        const isPR = parseFloat(weight) > previousMax;
                        res.json({ message: "Success", isPR: isPR });
                    });
                });
            };

            if (rows.length > 0) saveSet(rows[0].exercise_id);
            else {
                db.query("INSERT INTO Exercises (exercise_name) VALUES (?)", [exercise_name], (err, result) => {
                    if (err) return res.status(500).send({ error: err });
                    saveSet(result.insertId);
                });
            }
        });
    });
});

// 5. GET ALL PRs FOR TROPHY ROOM
app.get('/api/personal-records', (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: "No userId" });

    const sql = `SELECT e.exercise_name, MAX(s.weight_lifted) as max_weight 
                 FROM Exercises e 
                 JOIN Sets s ON e.exercise_id = s.exercise_id 
                 JOIN Workouts w ON s.workout_id = w.workout_id 
                 WHERE w.user_id = ? 
                 GROUP BY e.exercise_name`;

    db.query(sql, [userId], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

// 6. GET RECENT SETS (FOR DELETION UI)
app.get('/api/recent-sets', (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: "No userId" });

    const sql = `SELECT s.set_id, e.exercise_name, s.weight_lifted, s.reps_done 
                 FROM Sets s 
                 JOIN Exercises e ON s.exercise_id = e.exercise_id 
                 JOIN Workouts w ON s.workout_id = w.workout_id 
                 WHERE w.user_id = ? 
                 ORDER BY s.set_id DESC LIMIT 10`;

    db.query(sql, [userId], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

// 7. DELETE A SET
app.delete('/api/delete-set/:setId', (req, res) => {
    const setId = req.params.setId;
    db.query("DELETE FROM Sets WHERE set_id = ?", [setId], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json({ success: true });
    });
});

// 8. START ENGINE
app.listen(3000, () => {
    console.log("Server is live at http://localhost:3000");
});