// server.js - Updated with Session-based Attendance
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// File upload configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = "attendance_system";

app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.get("/lecturer", (req, res) => {
  res.sendFile(__dirname + "/public/lecturer-dashboard.html");
});

let db;

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

// ==================== SESSION MANAGEMENT ====================

// 1. Create attendance session (by Dosen)
app.post("/api/sessions/create", async (req, res) => {
  try {
    const { courseCode, date } = req.body;

    // Get course info
    const course = await db.collection("courses").findOne({ courseCode });
    if (!course) {
      return res.status(404).json({
        success: false,
        error: "Course not found",
      });
    }

    // Get all enrolled students for this course
    const students = await db.collection("students").find({}).toArray();

    // Check if session already exists for this date
    const sessionDate = new Date(date);
    sessionDate.setHours(0, 0, 0, 0);

    const existingSession = await db.collection("attendance_sessions").findOne({
      courseCode,
      date: sessionDate,
    });

    if (existingSession) {
      return res.json({
        success: false,
        error: "Session already exists for this date",
        sessionId: existingSession._id,
      });
    }

    // Create session
    const session = {
      courseCode,
      courseName: course.courseName,
      lecturerName: course.lecturerName,
      date: sessionDate,
      createdAt: new Date(),
      status: "active",
    };

    const sessionResult = await db
      .collection("attendance_sessions")
      .insertOne(session);
    const sessionId = sessionResult.insertedId;

    // Create attendance records for all students
    const attendanceRecords = students.map((student) => ({
      sessionId,
      courseCode,
      courseName: course.courseName,
      npm: student.npm,
      studentName: student.name,
      status: "Belum Absen", // Default status
      checkInTime: null,
      confidence: null,
      recognitionMethod: null,
      notes: null,
      attachmentPath: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    await db.collection("attendances").insertMany(attendanceRecords);

    res.json({
      success: true,
      message: "Attendance session created",
      sessionId,
      totalStudents: students.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 2. Get active session
app.get("/api/sessions/active", async (req, res) => {
  try {
    const { courseCode, date } = req.query;

    const query = { status: "active" };
    if (courseCode) query.courseCode = courseCode;
    if (date) {
      const sessionDate = new Date(date);
      sessionDate.setHours(0, 0, 0, 0);
      query.date = sessionDate;
    }

    const session = await db.collection("attendance_sessions").findOne(query, {
      sort: { createdAt: -1 },
    });

    if (!session) {
      return res.json({
        success: false,
        message: "No active session found",
      });
    }

    res.json({
      success: true,
      session,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 3. Get attendance list for session
app.get("/api/sessions/:sessionId/attendances", async (req, res) => {
  try {
    const sessionId = new ObjectId(req.params.sessionId);

    const attendances = await db
      .collection("attendances")
      .find({ sessionId })
      .sort({ studentName: 1 })
      .toArray();

    // Calculate statistics
    const stats = {
      total: attendances.length,
      hadir: attendances.filter((a) => a.status === "Hadir").length,
      izin: attendances.filter((a) => a.status === "Izin").length,
      sakit: attendances.filter((a) => a.status === "Sakit").length,
      alpha: attendances.filter((a) => a.status === "Alpha").length,
      belumAbsen: attendances.filter((a) => a.status === "Belum Absen").length,
    };

    res.json({
      success: true,
      attendances,
      stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 4. Update attendance status (Face Recognition)
app.post("/api/attendances/mark-present", async (req, res) => {
  try {
    const { sessionId, npm, confidence } = req.body;

    const result = await db.collection("attendances").updateOne(
      {
        sessionId: new ObjectId(sessionId),
        npm,
      },
      {
        $set: {
          status: "Hadir",
          checkInTime: new Date(),
          confidence,
          recognitionMethod: "Face Recognition",
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: "Attendance record not found",
      });
    }

    // Get updated record
    const attendance = await db.collection("attendances").findOne({
      sessionId: new ObjectId(sessionId),
      npm,
    });

    res.json({
      success: true,
      message: "Attendance marked as Hadir",
      attendance,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 5. Update attendance status manually (by Dosen)
app.put("/api/attendances/:id/status", async (req, res) => {
  try {
    const { status, notes } = req.body;

    const validStatuses = ["Hadir", "Izin", "Sakit", "Alpha", "Belum Absen"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status",
      });
    }

    const updateData = {
      status,
      updatedAt: new Date(),
    };

    if (notes) updateData.notes = notes;

    // If changing from Izin/Sakit to other status, remove attachment
    if (status !== "Izin" && status !== "Sakit") {
      updateData.attachmentPath = null;
    }

    const result = await db
      .collection("attendances")
      .updateOne({ _id: new ObjectId(req.params.id) }, { $set: updateData });

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: "Attendance not found",
      });
    }

    const attendance = await db
      .collection("attendances")
      .findOne({ _id: new ObjectId(req.params.id) });

    res.json({
      success: true,
      message: "Status updated",
      attendance,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 6. Upload permission letter (PDF)
app.post(
  "/api/attendances/:id/upload",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No file uploaded",
        });
      }

      const attendance = await db
        .collection("attendances")
        .findOne({ _id: new ObjectId(req.params.id) });

      if (!attendance) {
        return res.status(404).json({
          success: false,
          error: "Attendance not found",
        });
      }

      // Update attendance with file path
      await db.collection("attendances").updateOne(
        { _id: new ObjectId(req.params.id) },
        {
          $set: {
            attachmentPath: `/uploads/${req.file.filename}`,
            updatedAt: new Date(),
          },
        }
      );

      res.json({
        success: true,
        message: "File uploaded successfully",
        filePath: `/uploads/${req.file.filename}`,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// 7. Close session
app.put("/api/sessions/:sessionId/close", async (req, res) => {
  try {
    // Update all "Belum Absen" to "Alpha"
    await db.collection("attendances").updateMany(
      {
        sessionId: new ObjectId(req.params.sessionId),
        status: "Belum Absen",
      },
      {
        $set: {
          status: "Alpha",
          updatedAt: new Date(),
        },
      }
    );

    // Close session
    await db.collection("attendance_sessions").updateOne(
      { _id: new ObjectId(req.params.sessionId) },
      {
        $set: {
          status: "closed",
          closedAt: new Date(),
        },
      }
    );

    res.json({
      success: true,
      message: "Session closed, Belum Absen changed to Alpha",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ==================== EXISTING ENDPOINTS ====================

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

app.get("/api/stats", async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const totalStudents = await db.collection("students").countDocuments();

    const presentToday = await db.collection("attendances").distinct("npm", {
      status: "Hadir",
      checkInTime: {
        $gte: today,
      },
    });

    const totalCourses = await db.collection("courses").countDocuments();

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

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "API is running",
    timestamp: new Date(),
    mongodb: db ? "connected" : "disconnected",
  });
});

// Create uploads directory if not exists
const fs = require("fs");
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Lecturer Dashboard: http://localhost:${PORT}/lecturer`);
    console.log(`📱 Student Dashboard: http://localhost:${PORT}`);
  });
});
