const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Connect to MongoDB and clean up
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/exercise-tracker');

// Clear existing collections and indexes to avoid conflicts
mongoose.connection.once('open', async () => {
  try {
    await mongoose.connection.db.dropDatabase();
    console.log('Database cleared successfully');
  } catch (error) {
    console.log('Error clearing database:', error.message);
  }
});

// User Schema with embedded exercises
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: false }
});

// Exercise Schema - separate collection
const exerciseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  description: { type: String, required: true },
  duration: { type: Number, required: true },
  date: { type: Date, required: true }
});

const User = mongoose.model('User', userSchema);
const Exercise = mongoose.model('Exercise', exerciseSchema);

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/index.html');
});

// Create a new user
app.post('/api/users', async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username) {
      return res.json({ error: 'Username is required' });
    }

    const newUser = new User({ username: username });
    const savedUser = await newUser.save();
    
    res.json({
      username: savedUser.username,
      _id: savedUser._id
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.json({ error: 'Failed to create user' });
  }
});

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({});
    const userList = users.map(user => ({
      username: user.username,
      _id: user._id
    }));
    res.json(userList);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.json({ error: 'Failed to fetch users' });
  }
});

// Add exercise to user
app.post('/api/users/:_id/exercises', async (req, res) => {
  try {
    const userId = req.params._id;
    const { description, duration, date } = req.body;

    console.log('Received userId:', userId);
    console.log('Request body:', req.body);

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.json({ error: 'Invalid user ID format' });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.json({ error: 'User not found' });
    }

    // Validate required fields
    if (!description || !duration) {
      return res.json({ error: 'Description and duration are required' });
    }

    // Parse duration to number
    const durationNum = Number(duration);
    if (isNaN(durationNum)) {
      return res.json({ error: 'Duration must be a number' });
    }

    // Handle date - use UTC noon to avoid timezone issues
    let exerciseDate;
    if (date) {
      exerciseDate = new Date(date + 'T12:00:00Z');
      if (isNaN(exerciseDate.getTime())) {
        return res.json({ error: 'Invalid date format' });
      }
    } else {
      const now = new Date();
      exerciseDate = new Date(now.toISOString().split('T')[0] + 'T12:00:00Z');
    }

    // Create and save exercise
    const newExercise = new Exercise({
      userId: userId,
      description: description,
      duration: durationNum,
      date: exerciseDate
    });

    await newExercise.save();

    // Format response date without timezone issues
    const responseDate = new Date(exerciseDate.getTime() - (exerciseDate.getTimezoneOffset() * 60000))
      .toDateString();

    // Return user object with exercise fields added
    res.json({
      _id: user._id,
      username: user.username,
      description: description,
      duration: durationNum,
      date: responseDate
    });
  } catch (error) {
    console.error('Error adding exercise:', error);
    res.json({ error: 'Failed to add exercise' });
  }
});

// Get user's exercise log
app.get('/api/users/:_id/logs', async (req, res) => {
  try {
    const userId = req.params._id;
    const { from, to, limit } = req.query;

    console.log('Fetching logs for userId:', userId);
    console.log('Query params:', { from, to, limit });

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.json({ error: 'Invalid user ID format' });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.json({ error: 'User not found' });
    }

    // Build query for exercises
    let query = { userId: userId };

    // Apply date filters with better validation
    if (from || to) {
      query.date = {};
      if (from) {
        const fromDate = new Date(from + 'T00:00:00Z');
        if (!isNaN(fromDate.getTime())) {
          query.date.$gte = fromDate;
        } else {
          return res.json({ error: 'Invalid from date format' });
        }
      }
      if (to) {
        const toDate = new Date(to + 'T23:59:59Z');
        if (!isNaN(toDate.getTime())) {
          query.date.$lte = toDate;
        } else {
          return res.json({ error: 'Invalid to date format' });
        }
      }
    }

    // Find exercises
    let exerciseQuery = Exercise.find(query).sort({ date: 1 });

    // Apply limit
    if (limit) {
      const limitNum = parseInt(limit);
      if (!isNaN(limitNum) && limitNum > 0) {
        exerciseQuery = exerciseQuery.limit(limitNum);
      }
    }

    const exercises = await exerciseQuery.exec();

    console.log('Found exercises:', exercises.length);
    if (exercises.length > 0) {
      console.log('Sample exercise date:', exercises[0].date);
    }

    // Format the log array - ensure date is always a proper date string
    const log = exercises.map(exercise => {
      const dateObj = new Date(exercise.date);
      // Convert to local date string without timezone issues
      const dateString = new Date(dateObj.getTime() - (dateObj.getTimezoneOffset() * 60000))
        .toDateString();
      
      return {
        description: exercise.description,
        duration: exercise.duration,
        date: dateString
      };
    });

    // Get total count of all exercises for this user (not filtered by date/limit)
    const count = await Exercise.countDocuments({ userId: userId });

    console.log('Returning log with', log.length, 'exercises');
    if (log.length > 0) {
      console.log('Sample log entry date:', log[0].date, 'Type:', typeof log[0].date);
    }

    res.json({
      _id: user._id,
      username: user.username,
      count: count,
      log: log
    });
  } catch (error) {
    console.error('Error fetching exercise log:', error);
    res.json({ error: 'Failed to fetch exercise log' });
  }
});

const listener = app.listen(process.env.PORT || 3000, () => {
  console.log('Your app is listening on port ' + listener.address().port);
});