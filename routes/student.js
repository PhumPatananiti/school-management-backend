const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { verifyToken, checkRole } = require('../middleware/auth');

// Apply auth middleware to all student routes
router.use(verifyToken);
router.use(checkRole('student'));

// =====================================================
// PROFILE
// =====================================================

// @route   GET /api/student/profile
// @desc    Get student profile
// @access  Student
router.get('/profile', async (req, res) => {
  try {
    const result = await query(
      `SELECT s.*, r.name as room_name, r.grade_level,
              t.full_name as homeroom_teacher_name, t.phone as teacher_phone,
              p.full_name as parent_name, p.phone as parent_phone, p.relationship as parent_relationship
       FROM students s
       LEFT JOIN rooms r ON s.room_id = r.id
       LEFT JOIN teachers t ON s.homeroom_teacher_id = t.id
       LEFT JOIN parents p ON s.parent_id = p.id
       WHERE s.user_id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลนักเรียน'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูล'
    });
  }
});

// =====================================================
// ATTENDANCE SUMMARY - FIXED VERSION
// =====================================================

// @route   GET /api/student/attendance/summary
// @desc    Get attendance summary (includes both homeroom and subject attendance)
// @access  Student
router.get('/attendance/summary', async (req, res) => {
  try {
    const { academic_year, semester, attendance_type } = req.query;

    // Get student id
    const studentResult = await query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.id]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลนักเรียน'
      });
    }

    const studentId = studentResult.rows[0].id;

    let queryText = `
      SELECT 
        COUNT(CASE WHEN status = 'มาเรียน' THEN 1 END) as present,
        COUNT(CASE WHEN status = 'มาสาย' THEN 1 END) as late,
        COUNT(CASE WHEN status = 'ลาป่วย' THEN 1 END) as sick_leave,
        COUNT(CASE WHEN status = 'ลากิจ' THEN 1 END) as personal_leave,
        COUNT(CASE WHEN status = 'ขาดเรียน' THEN 1 END) as absent,
        COUNT(*) as total_days
      FROM attendance
      WHERE student_id = $1
    `;
    const params = [studentId];

    // Optional: Filter by attendance type
    if (attendance_type) {
      params.push(attendance_type);
      queryText += ` AND attendance_type = $${params.length}`;
    }

    if (academic_year) {
      params.push(academic_year);
      queryText += ` AND EXTRACT(YEAR FROM attendance_date + INTERVAL '543 years') = $${params.length}`;
    }

    const result = await query(queryText, params);

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Get attendance summary error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลการเข้าเรียน'
    });
  }
});

// @route   GET /api/student/attendance/detail
// @desc    Get detailed attendance records
// @access  Student
router.get('/attendance/detail', async (req, res) => {
  try {
    const { start_date, end_date, attendance_type } = req.query;

    // Get student id
    const studentResult = await query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.id]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลนักเรียน'
      });
    }

    const studentId = studentResult.rows[0].id;

    let queryText = `
      SELECT 
        a.id,
        a.student_id,
        a.teacher_id,
        a.room_id,
        a.subject_id,
        a.attendance_date,
        a.period_number,
        a.status,
        a.attendance_type,
        a.notes as note,
        a.created_at as check_in_time,
        sub.subject_name,
        sub.subject_code,
        t.full_name as teacher_name,
        r.name as room_name
      FROM attendance a
      LEFT JOIN subjects sub ON a.subject_id = sub.id
      LEFT JOIN teachers t ON a.teacher_id = t.id
      LEFT JOIN rooms r ON a.room_id = r.id
      WHERE a.student_id = $1
    `;
    const params = [studentId];

    if (start_date) {
      params.push(start_date);
      queryText += ` AND a.attendance_date >= $${params.length}`;
    }

    if (end_date) {
      params.push(end_date);
      queryText += ` AND a.attendance_date <= $${params.length}`;
    }

    if (attendance_type) {
      params.push(attendance_type);
      queryText += ` AND a.attendance_type = $${params.length}`;
    }

    queryText += ' ORDER BY a.attendance_date DESC, a.period_number NULLS LAST';

    const result = await query(queryText, params);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('Get attendance detail error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลการเข้าเรียน'
    });
  }
});

// @route   GET /api/student/attendance/stats
// @desc    Get attendance statistics breakdown by type
// @access  Student
router.get('/attendance/stats', async (req, res) => {
  try {
    const { academic_year } = req.query;

    // Get student id
    const studentResult = await query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.id]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลนักเรียน'
      });
    }

    const studentId = studentResult.rows[0].id;

    let queryText = `
      SELECT 
        attendance_type,
        COUNT(CASE WHEN status = 'มาเรียน' THEN 1 END) as present,
        COUNT(CASE WHEN status = 'มาสาย' THEN 1 END) as late,
        COUNT(CASE WHEN status = 'ลาป่วย' THEN 1 END) as sick_leave,
        COUNT(CASE WHEN status = 'ลากิจ' THEN 1 END) as personal_leave,
        COUNT(CASE WHEN status = 'ขาดเรียน' THEN 1 END) as absent,
        COUNT(*) as total_days
      FROM attendance
      WHERE student_id = $1
    `;
    const params = [studentId];

    if (academic_year) {
      params.push(academic_year);
      queryText += ` AND EXTRACT(YEAR FROM attendance_date + INTERVAL '543 years') = $${params.length}`;
    }

    queryText += ' GROUP BY attendance_type';

    const result = await query(queryText, params);

    // Format the response
    const stats = {
      homeroom: null,
      subject: null,
      total: {
        present: 0,
        late: 0,
        sick_leave: 0,
        personal_leave: 0,
        absent: 0,
        total_days: 0
      }
    };

    result.rows.forEach(row => {
      if (row.attendance_type === 'homeroom') {
        stats.homeroom = row;
      } else if (row.attendance_type === 'subject') {
        stats.subject = row;
      }

      // Calculate totals
      stats.total.present += parseInt(row.present);
      stats.total.late += parseInt(row.late);
      stats.total.sick_leave += parseInt(row.sick_leave);
      stats.total.personal_leave += parseInt(row.personal_leave);
      stats.total.absent += parseInt(row.absent);
      stats.total.total_days += parseInt(row.total_days);
    });

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Get attendance stats error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลสถิติการเข้าเรียน'
    });
  }
});
// =====================================================
// BEHAVIOR SCORE
// =====================================================

// @route   GET /api/student/behavior
// @desc    Get behavior score
// @access  Student
router.get('/behavior', async (req, res) => {
  try {
    const result = await query(
      'SELECT behavior_score FROM students WHERE user_id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูล'
      });
    }

    res.json({
      success: true,
      data: {
        behavior_score: result.rows[0].behavior_score
      }
    });

  } catch (error) {
    console.error('Get behavior error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลคะแนนความประพฤติ'
    });
  }
});

// =====================================================
// HEALTH RECORDS
// =====================================================

// @route   GET /api/student/health
// @desc    Get health record
// @access  Student
router.get('/health', async (req, res) => {
  try {
    // Get student id
    const studentResult = await query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.id]
    );

    const studentId = studentResult.rows[0].id;

    const result = await query(
      'SELECT * FROM health_records WHERE student_id = $1',
      [studentId]
    );

    res.json({
      success: true,
      data: result.rows[0] || null
    });

  } catch (error) {
    console.error('Get health error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลสุขภาพ'
    });
  }
});

// @route   PUT /api/student/health
// @desc    Update health record
// @access  Student
router.put('/health', async (req, res) => {
  try {
    const {
      blood_type,
      height,
      weight,
      allergies,
      chronic_diseases,
      medications,
      emergency_contact_name,
      emergency_contact_phone,
      notes
    } = req.body;

    console.log('Received health data:', req.body);

    // Get student id
    const studentResult = await query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.id]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลนักเรียน'
      });
    }

    const studentId = studentResult.rows[0].id;
    console.log('Student ID:', studentId);

    // Check if health_records table exists
    const tableCheck = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'health_records'
      );
    `);

    console.log('Health records table exists:', tableCheck.rows[0].exists);

    if (!tableCheck.rows[0].exists) {
      return res.status(500).json({
        success: false,
        message: 'ตาราง health_records ยังไม่ได้ถูกสร้าง กรุณาติดต่อผู้ดูแลระบบ'
      });
    }

    const result = await query(
      `INSERT INTO health_records 
       (student_id, blood_type, height, weight, allergies, chronic_diseases, medications, 
        emergency_contact_name, emergency_contact_phone, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
       ON CONFLICT (student_id) 
       DO UPDATE SET
         blood_type = EXCLUDED.blood_type,
         height = EXCLUDED.height,
         weight = EXCLUDED.weight,
         allergies = EXCLUDED.allergies,
         chronic_diseases = EXCLUDED.chronic_diseases,
         medications = EXCLUDED.medications,
         emergency_contact_name = EXCLUDED.emergency_contact_name,
         emergency_contact_phone = EXCLUDED.emergency_contact_phone,
         notes = EXCLUDED.notes,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [studentId, blood_type, height, weight, allergies, chronic_diseases, medications,
       emergency_contact_name, emergency_contact_phone, notes]
    );

    console.log('Health data saved successfully');

    res.json({
      success: true,
      message: 'บันทึกข้อมูลสุขภาพสำเร็จ',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update health error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail
    });
    
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูลสุขภาพ',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// =====================================================
// HOME VISITS
// =====================================================

// @route   GET /api/student/home-visits
// @desc    Get home visit records
// @access  Student
router.get('/home-visits', async (req, res) => {
  try {
    // Get student id
    const studentResult = await query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.id]
    );

    const studentId = studentResult.rows[0].id;

    const result = await query(
      `SELECT hv.*, t.full_name as teacher_name
       FROM home_visits hv
       LEFT JOIN teachers t ON hv.teacher_id = t.id
       WHERE hv.student_id = $1
       ORDER BY hv.visit_date DESC`,
      [studentId]
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('Get home visits error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลการเยี่ยมบ้าน'
    });
  }
});

// =====================================================
// TIMETABLE
// =====================================================

// @route   GET /api/student/timetable
// @desc    Get student timetable (placeholder - needs timetable table)
// @access  Student
router.get('/timetable', async (req, res) => {
  try {
    // This is a placeholder - you'll need to create a timetable table
    // For now, return empty array
    res.json({
      success: true,
      data: [],
      message: 'ตารางเรียนยังไม่ได้ถูกสร้าง'
    });

  } catch (error) {
    console.error('Get timetable error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงตารางเรียน'
    });
  }
});

// =====================================================
// CLASSMATES
// =====================================================

// @route   GET /api/student/classmates
// @desc    Get classmates
// @access  Student
router.get('/classmates', async (req, res) => {
  try {
    // Get student's room
    const studentResult = await query(
      'SELECT room_id FROM students WHERE user_id = $1',
      [req.user.id]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลนักเรียน'
      });
    }

    const roomId = studentResult.rows[0].room_id;

    // Get all students in the same room
    const result = await query(
      `SELECT s.id, s.student_id, s.full_name, s.student_number, s.profile_picture
       FROM students s
       WHERE s.room_id = $1 AND s.user_id != $2
       ORDER BY s.student_number`,
      [roomId, req.user.id]
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('Get classmates error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลเพื่อนร่วมชั้น'
    });
  }
});

module.exports = router;