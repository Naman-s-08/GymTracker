// ─── GymTracker Server — Production Build ─────────────────────────────────
require('dotenv').config();

const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, param, validationResult } = require('express-validator');

const app = express();

// ─── Security Middleware ───────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net"]
    }
  }
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.ALLOWED_ORIGIN : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '1mb' }));

// General rate limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

// Strict rate limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' }
});

app.use(generalLimiter);

// ─── Database Connection Pool ──────────────────────────────────────────────
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'GymTrackerDB',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Verify DB connection on startup
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Connected to MySQL Database (pool)');
    conn.release();
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }
})();

// ─── JWT Constants ─────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = '24h';

if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET is not set in .env');
  process.exit(1);
}

// ─── JWT Authentication Middleware ─────────────────────────────────────────
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { userId, username }
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// ─── Validation Error Handler ──────────────────────────────────────────────
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(e => e.msg)
    });
  }
  next();
};

// ─── Serve Static Pages ────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/public/login.html', (req, res) => res.redirect('/login'));
app.get('/welcome', (req, res) => res.sendFile(path.join(__dirname, 'public', 'welcome.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/trophies', (req, res) => res.sendFile(path.join(__dirname, 'public', 'trophy.html')));
app.use(express.static('public', { index: false }));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ─── Register ──────────────────────────────────────────────────────────────
app.post('/api/register',
  authLimiter,
  [
    body('username')
      .trim().isLength({ min: 3, max: 30 }).withMessage('Username must be 3–30 characters')
      .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores'),
    body('email')
      .trim().isEmail().withMessage('Valid email is required')
      .normalizeEmail(),
    body('password')
      .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { username, email, password } = req.body;

      // Check if username or email already exists
      const [existing] = await pool.query(
        'SELECT user_id FROM Users WHERE username = ? OR email = ?',
        [username, email]
      );

      if (existing.length > 0) {
        return res.status(409).json({ error: 'Username or email already exists' });
      }

      // Hash password
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Insert user
      const [result] = await pool.query(
        'INSERT INTO Users (username, email, password) VALUES (?, ?, ?)',
        [username, email, hashedPassword]
      );

      // Generate token
      const token = jwt.sign(
        { userId: result.insertId, username },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      );

      res.status(201).json({
        message: 'Account created successfully',
        token,
        user: { userId: result.insertId, username }
      });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ error: 'Server error during registration' });
    }
  }
);

// ─── Login ─────────────────────────────────────────────────────────────────
app.post('/api/login',
  authLimiter,
  [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { username, password } = req.body;

      const [rows] = await pool.query(
        'SELECT user_id, username, password FROM Users WHERE username = ?',
        [username]
      );

      if (rows.length === 0) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      const user = rows[0];

      // Check if user has a password set
      if (!user.password) {
        return res.status(401).json({
          error: 'Account needs password reset. Please register again or contact admin.'
        });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      const token = jwt.sign(
        { userId: user.user_id, username: user.username },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      );

      res.json({
        message: 'Login successful',
        token,
        user: { userId: user.user_id, username: user.username }
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Server error during login' });
    }
  }
);

// ─── Get Current User ──────────────────────────────────────────────────────
app.get('/api/me', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT user_id, username, email FROM Users WHERE user_id = ?',
      [req.user.userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Get Dashboard Stats ──────────────────────────────────────────────────
app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Total workouts
    const [workouts] = await pool.query(
      'SELECT COUNT(*) as total FROM Workouts WHERE user_id = ?',
      [userId]
    );

    // Total sets logged
    const [sets] = await pool.query(
      `SELECT COUNT(*) as total FROM Sets s
       JOIN Workouts w ON s.workout_id = w.workout_id
       WHERE w.user_id = ?`,
      [userId]
    );

    // Unique exercises
    const [exercises] = await pool.query(
      `SELECT COUNT(DISTINCT s.exercise_id) as total FROM Sets s
       JOIN Workouts w ON s.workout_id = w.workout_id
       WHERE w.user_id = ?`,
      [userId]
    );

    // Top PR (heaviest lift)
    const [topPR] = await pool.query(
      `SELECT e.exercise_name, MAX(s.weight_lifted) as max_weight
       FROM Sets s
       JOIN Exercises e ON s.exercise_id = e.exercise_id
       JOIN Workouts w ON s.workout_id = w.workout_id
       WHERE w.user_id = ?
       GROUP BY e.exercise_name
       ORDER BY max_weight DESC LIMIT 1`,
      [userId]
    );

    res.json({
      totalWorkouts: workouts[0].total,
      totalSets: sets[0].total,
      uniqueExercises: exercises[0].total,
      topPR: topPR.length > 0 ? topPR[0] : null
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Server error fetching stats' });
  }
});

// ─── Log a Set ─────────────────────────────────────────────────────────────
app.post('/api/add-set',
  authenticateToken,
  [
    body('exercise_name')
      .trim().isLength({ min: 1, max: 50 }).withMessage('Exercise name is required (max 50 chars)'),
    body('weight')
      .isFloat({ min: 0, max: 999.99 }).withMessage('Weight must be between 0 and 999.99 kg'),
    body('reps')
      .isInt({ min: 1, max: 999 }).withMessage('Reps must be between 1 and 999')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { exercise_name, weight, reps } = req.body;

      // Get or create today's workout
      let workoutId;
      const [existingWorkout] = await pool.query(
        'SELECT workout_id FROM Workouts WHERE user_id = ? AND workout_date = CURDATE()',
        [userId]
      );

      if (existingWorkout.length > 0) {
        workoutId = existingWorkout[0].workout_id;
      } else {
        const [newWorkout] = await pool.query(
          'INSERT INTO Workouts (user_id, workout_date) VALUES (?, CURDATE())',
          [userId]
        );
        workoutId = newWorkout.insertId;
      }

      // Get or create exercise
      let exerciseId;
      const [existingExercise] = await pool.query(
        'SELECT exercise_id FROM Exercises WHERE exercise_name = ?',
        [exercise_name]
      );

      if (existingExercise.length > 0) {
        exerciseId = existingExercise[0].exercise_id;
      } else {
        const [newExercise] = await pool.query(
          'INSERT INTO Exercises (exercise_name) VALUES (?)',
          [exercise_name]
        );
        exerciseId = newExercise.insertId;
      }

      // Insert the set
      const [setResult] = await pool.query(
        'INSERT INTO Sets (workout_id, exercise_id, weight_lifted, reps_done) VALUES (?, ?, ?, ?)',
        [workoutId, exerciseId, weight, reps]
      );

      // Check if this is a PR for this user + exercise
      const [prRows] = await pool.query(
        `SELECT MAX(s.weight_lifted) as maxWeight FROM Sets s
         JOIN Workouts w ON s.workout_id = w.workout_id
         WHERE s.exercise_id = ? AND w.user_id = ? AND s.set_id != ?`,
        [exerciseId, userId, setResult.insertId]
      );

      const previousMax = prRows[0]?.maxWeight || 0;
      const isPR = parseFloat(weight) > parseFloat(previousMax);

      res.status(201).json({
        message: 'Set logged successfully',
        isPR,
        setId: setResult.insertId
      });
    } catch (err) {
      console.error('Add set error:', err);
      res.status(500).json({ error: 'Server error logging set' });
    }
  }
);

// ─── Get Personal Records ──────────────────────────────────────────────────
app.get('/api/personal-records', authenticateToken, async (req, res) => {
  try {
    const [results] = await pool.query(
      `SELECT e.exercise_name, MAX(s.weight_lifted) as max_weight
       FROM Exercises e
       JOIN Sets s ON e.exercise_id = s.exercise_id
       JOIN Workouts w ON s.workout_id = w.workout_id
       WHERE w.user_id = ?
       GROUP BY e.exercise_name
       ORDER BY max_weight DESC`,
      [req.user.userId]
    );

    res.json(results);
  } catch (err) {
    console.error('PR fetch error:', err);
    res.status(500).json({ error: 'Server error fetching records' });
  }
});

// ─── Get Recent Sets ───────────────────────────────────────────────────────
app.get('/api/recent-sets', authenticateToken, async (req, res) => {
  try {
    const [results] = await pool.query(
      `SELECT s.set_id, e.exercise_name, s.weight_lifted, s.reps_done
       FROM Sets s
       JOIN Exercises e ON s.exercise_id = e.exercise_id
       JOIN Workouts w ON s.workout_id = w.workout_id
       WHERE w.user_id = ?
       ORDER BY s.set_id DESC LIMIT 10`,
      [req.user.userId]
    );

    res.json(results);
  } catch (err) {
    console.error('Recent sets error:', err);
    res.status(500).json({ error: 'Server error fetching recent sets' });
  }
});

// ─── Update a Set (with ownership check) ───────────────────────────────────
app.put('/api/update-set/:setId',
  authenticateToken,
  [
    param('setId').isInt({ min: 1 }).withMessage('Invalid set ID'),
    body('weight')
      .isFloat({ min: 0, max: 999.99 }).withMessage('Weight must be between 0 and 999.99 kg'),
    body('reps')
      .isInt({ min: 1, max: 999 }).withMessage('Reps must be between 1 and 999')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const setId = parseInt(req.params.setId);
      const userId = req.user.userId;
      const { weight, reps } = req.body;

      // Verify ownership and get exercise_id
      const [ownership] = await pool.query(
        `SELECT s.set_id, s.exercise_id, e.exercise_name FROM Sets s
         JOIN Workouts w ON s.workout_id = w.workout_id
         JOIN Exercises e ON s.exercise_id = e.exercise_id
         WHERE s.set_id = ? AND w.user_id = ?`,
        [setId, userId]
      );

      if (ownership.length === 0) {
        return res.status(404).json({ error: 'Set not found or access denied' });
      }

      // Update the set
      await pool.query(
        'UPDATE Sets SET weight_lifted = ?, reps_done = ? WHERE set_id = ?',
        [weight, reps, setId]
      );

      // Check if the updated weight is now a PR
      const exerciseId = ownership[0].exercise_id;
      const [prRows] = await pool.query(
        `SELECT MAX(s.weight_lifted) as maxWeight FROM Sets s
         JOIN Workouts w ON s.workout_id = w.workout_id
         WHERE s.exercise_id = ? AND w.user_id = ? AND s.set_id != ?`,
        [exerciseId, userId, setId]
      );

      const previousMax = prRows[0]?.maxWeight || 0;
      const isPR = parseFloat(weight) > parseFloat(previousMax);

      res.json({
        success: true,
        message: 'Set updated successfully',
        isPR,
        exerciseName: ownership[0].exercise_name
      });
    } catch (err) {
      console.error('Update set error:', err);
      res.status(500).json({ error: 'Server error updating set' });
    }
  }
);

// ─── Delete a Set (with ownership check) ───────────────────────────────────
app.delete('/api/delete-set/:setId',
  authenticateToken,
  [
    param('setId').isInt({ min: 1 }).withMessage('Invalid set ID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const setId = parseInt(req.params.setId);
      const userId = req.user.userId;

      // Verify ownership before deleting
      const [ownership] = await pool.query(
        `SELECT s.set_id FROM Sets s
         JOIN Workouts w ON s.workout_id = w.workout_id
         WHERE s.set_id = ? AND w.user_id = ?`,
        [setId, userId]
      );

      if (ownership.length === 0) {
        return res.status(404).json({ error: 'Set not found or access denied' });
      }

      await pool.query('DELETE FROM Sets WHERE set_id = ?', [setId]);
      res.json({ success: true, message: 'Set deleted' });
    } catch (err) {
      console.error('Delete set error:', err);
      res.status(500).json({ error: 'Server error deleting set' });
    }
  }
);

// ─── Global Error Handler ──────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'An unexpected error occurred' });
});

// ─── Start Server ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`🚀 GymTracker server live at http://localhost:${PORT}`);
});