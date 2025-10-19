// server.js - REST API for Face Recognition Attendance System
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = "attendance_system";

// Serve static files
app.use(express.static("public"));

// Serve dashboard
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

let db;

// Connect to MongoDB
async function connectDB() {
  try {
    const client = await MongoClient.connect(MONGODB_URI);
    db = client.db(DB_NAME);
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
}

// ==================== API ENDPOINTS ====================

// 1. Get all attendances with filters
app.get("/api/attendances", async (req, res) => {
  try {
    const { courseCode, date, npm } = req.query;

    let query = {};

    // Filter by course
    if (courseCode) {
      query.courseCode = courseCode;
    }

    // Filter by NPM
    if (npm) {
      query.npm = npm;
    }

    // Filter by date
    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      query.checkInTime = {
        $gte: startOfDay,
        $lte: endOfDay,
      };
    }

    const attendances = await db
      .collection("attendances")
      .find(query)
      .sort({ checkInTime: -1 })
      .toArray();

    res.json({
      success: true,
      count: attendances.length,
      data: attendances,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 2. Get latest attendances (FIXED - without optional parameter)
app.get("/api/attendances/latest", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20; // Get from query string instead

    const attendances = await db
      .collection("attendances")
      .find({})
      .sort({ checkInTime: -1 })
      .limit(limit)
      .toArray();

    res.json({
      success: true,
      count: attendances.length,
      data: attendances,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 3. Get attendance by course and date
app.get("/api/attendances/course/:courseCode", async (req, res) => {
  try {
    const { courseCode } = req.params;
    const { date } = req.query;

    let query = { courseCode };

    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      query.checkInTime = {
        $gte: startOfDay,
        $lte: endOfDay,
      };
    }

    const attendances = await db
      .collection("attendances")
      .find(query)
      .sort({ checkInTime: -1 })
      .toArray();

    res.json({
      success: true,
      count: attendances.length,
      data: attendances,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 4. Get attendance by ID
app.get("/api/attendances/:id", async (req, res) => {
  try {
    const attendance = await db
      .collection("attendances")
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!attendance) {
      return res.status(404).json({
        success: false,
        error: "Attendance not found",
      });
    }

    res.json({
      success: true,
      data: attendance,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 5. Get all students
app.get("/api/students", async (req, res) => {
  try {
    const students = await db
      .collection("students")
      .find({})
      .sort({ name: 1 })
      .toArray();

    res.json({
      success: true,
      count: students.length,
      data: students,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 6. Get student by NPM
app.get("/api/students/:npm", async (req, res) => {
  try {
    const student = await db
      .collection("students")
      .findOne({ npm: req.params.npm });

    if (!student) {
      return res.status(404).json({
        success: false,
        error: "Student not found",
      });
    }

    res.json({
      success: true,
      data: student,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 7. Get all courses
app.get("/api/courses", async (req, res) => {
  try {
    const courses = await db
      .collection("courses")
      .find({})
      .sort({ courseCode: 1 })
      .toArray();

    res.json({
      success: true,
      count: courses.length,
      data: courses,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 8. Get statistics
app.get("/api/stats", async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Total students
    const totalStudents = await db.collection("students").countDocuments();

    // Present today (distinct students)
    const presentToday = await db.collection("attendances").distinct("npm", {
      checkInTime: {
        $gte: today,
        $lt: tomorrow,
      },
    });

    // Total courses
    const totalCourses = await db.collection("courses").countDocuments();

    // Attendance rate
    const attendanceRate =
      totalStudents > 0
        ? Math.round((presentToday.length / totalStudents) * 100)
        : 0;

    res.json({
      success: true,
      data: {
        totalStudents,
        presentToday: presentToday.length,
        totalCourses,
        attendanceRate: attendanceRate + "%",
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 9. Get today's attendances (for real-time monitoring)
app.get("/api/attendances/today", async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const attendances = await db
      .collection("attendances")
      .find({
        checkInTime: {
          $gte: today,
          $lt: tomorrow,
        },
      })
      .sort({ checkInTime: -1 })
      .toArray();

    res.json({
      success: true,
      count: attendances.length,
      data: attendances,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 10. Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "API is running",
    timestamp: new Date(),
    mongodb: db ? "connected" : "disconnected",
  });
});

// Start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔌 API endpoints: http://localhost:${PORT}/api`);
    console.log(`\n📡 Available endpoints:`);
    console.log(`   GET  /api/health`);
    console.log(`   GET  /api/stats`);
    console.log(`   GET  /api/attendances`);
    console.log(`   GET  /api/attendances/latest?limit=20`);
    console.log(`   GET  /api/attendances/today`);
    console.log(`   GET  /api/students`);
    console.log(`   GET  /api/courses`);
  });
});
