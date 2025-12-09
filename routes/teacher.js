const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const { verifyToken, checkRole } = require('../middleware/auth');
const { google } = require('googleapis');
const path = require('path');
const axios = require('axios');
const GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyXgNGsh6tAfVYL1Xhqnp6BDJXjxd0Z_LL1nfxtVZ8afgQstNNnjP7Rto57nXc94QA7/exec'

// Apply auth middleware to all teacher routes
router.use(verifyToken);
router.use(checkRole('teacher'));

// =====================================================
// PROFILE MANAGEMENT
// =====================================================

// @route   GET /api/teacher/profile
// @desc    Get teacher profile
// @access  Teacher
// =====================================================
// PROFILE
// =====================================================

// @route   GET /api/teacher/profile
// @desc    Get teacher profile with homeroom information
// @access  Teacher
// @route   GET /api/teacher/profile
// @desc    Get teacher profile with homeroom information
// @access  Teacher
router.get('/profile', async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        t.id,
        t.teacher_id,
        t.full_name,
        t.email,
        t.phone,
        t.profile_picture,
        t.homeroom_room_id,
        r.name as homeroom_room_name,
        r.grade_level as homeroom_grade_level,
        t.created_at
       FROM teachers t
       LEFT JOIN rooms r ON t.homeroom_room_id = r.id
       WHERE t.user_id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลครู'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Get teacher profile error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลโปรไฟล์'
    });
  }
});

// @route   PUT /api/teacher/profile
// @desc    Update teacher profile
// @access  Teacher
router.put('/profile', async (req, res) => {
  try {
    const { email, phone, profile_picture } = req.body;

    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลครู'
      });
    }

    const teacherId = teacherResult.rows[0].id;

    // Update profile
    const result = await query(
      `UPDATE teachers 
       SET email = COALESCE($1, email),
           phone = COALESCE($2, phone),
           profile_picture = COALESCE($3, profile_picture),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [email, phone, profile_picture, teacherId]
    );

    res.json({
      success: true,
      message: 'อัปเดตโปรไฟล์สำเร็จ',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update teacher profile error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการอัปเดตโปรไฟล์'
    });
  }
});

// =====================================================
// SUBJECTS MANAGEMENT
// =====================================================

// @route   GET /api/teacher/subjects
// @desc    Get teacher's subjects
// @access  Teacher
router.get('/subjects', async (req, res) => {
  try {
    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    const teacherId = teacherResult.rows[0].id;

    const result = await query(
      `SELECT s.*, ts.id as teacher_subject_id
       FROM subjects s
       INNER JOIN teacher_subjects ts ON s.id = ts.subject_id
       WHERE ts.teacher_id = $1
       ORDER BY s.subject_name`,
      [teacherId]
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('Get subjects error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลวิชา'
    });
  }
});

// @route   POST /api/teacher/subjects
// @desc    Add subject to teacher
// @access  Teacher
router.post('/subjects', [
  body('subject_id').isInt().withMessage('กรุณาเลือกวิชา')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { subject_id } = req.body;

    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    const teacherId = teacherResult.rows[0].id;

    // Add subject
    const result = await query(
      `INSERT INTO teacher_subjects (teacher_id, subject_id)
       VALUES ($1, $2)
       ON CONFLICT (teacher_id, subject_id) DO NOTHING
       RETURNING *`,
      [teacherId, subject_id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'วิชานี้ถูกเพิ่มแล้ว'
      });
    }

    res.status(201).json({
      success: true,
      message: 'เพิ่มวิชาสำเร็จ'
    });

  } catch (error) {
    console.error('Add subject error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเพิ่มวิชา'
    });
  }
});

// @route   DELETE /api/teacher/subjects/:id
// @desc    Remove subject from teacher
// @access  Teacher
router.delete('/subjects/:id', async (req, res) => {
  try {
    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    const teacherId = teacherResult.rows[0].id;

    await query(
      'DELETE FROM teacher_subjects WHERE teacher_id = $1 AND subject_id = $2',
      [teacherId, req.params.id]
    );

    res.json({
      success: true,
      message: 'ลบวิชาสำเร็จ'
    });

  } catch (error) {
    console.error('Delete subject error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการลบวิชา'
    });
  }
});

// @route   GET /api/teacher/subjects/available
// @desc    Get available subjects to add
// @access  Teacher
router.get('/subjects/available', async (req, res) => {
  try {
    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    const teacherId = teacherResult.rows[0].id;

    // Get subjects not yet added by teacher
    const result = await query(
      `SELECT s.*
       FROM subjects s
       WHERE s.id NOT IN (
         SELECT subject_id FROM teacher_subjects WHERE teacher_id = $1
       )
       ORDER BY s.subject_name`,
      [teacherId]
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('Get available subjects error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลวิชา'
    });
  }
});

// =====================================================
// ROOMS MANAGEMENT
// =====================================================

// @route   GET /api/teacher/rooms
// @desc    Get teacher's rooms
// @access  Teacher
router.get('/rooms', async (req, res) => {
  try {
    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    const teacherId = teacherResult.rows[0].id;

    const result = await query(
      `SELECT r.*, tr.is_homeroom, COUNT(s.id) as student_count
       FROM rooms r
       INNER JOIN teacher_rooms tr ON r.id = tr.room_id
       LEFT JOIN students s ON s.room_id = r.id
       WHERE tr.teacher_id = $1
       GROUP BY r.id, tr.is_homeroom
       ORDER BY tr.is_homeroom DESC, r.name`,
      [teacherId]
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลห้องเรียน'
    });
  }
});

// @route   POST /api/teacher/rooms
// @desc    Add room to teacher
// @access  Teacher
router.post('/rooms', [
  body('room_id').isInt().withMessage('กรุณาเลือกห้อง')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { room_id } = req.body;

    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    const teacherId = teacherResult.rows[0].id;

    // Add room
    const result = await query(
      `INSERT INTO teacher_rooms (teacher_id, room_id, is_homeroom)
       VALUES ($1, $2, false)
       ON CONFLICT (teacher_id, room_id) DO NOTHING
       RETURNING *`,
      [teacherId, room_id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'ห้องนี้ถูกเพิ่มแล้ว'
      });
    }

    res.status(201).json({
      success: true,
      message: 'เพิ่มห้องเรียนสำเร็จ'
    });

  } catch (error) {
    console.error('Add room error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเพิ่มห้องเรียน'
    });
  }
});

// @route   DELETE /api/teacher/rooms/:id
// @desc    Remove room from teacher (except homeroom)
// @access  Teacher
router.delete('/rooms/:id', async (req, res) => {
  try {
    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    const teacherId = teacherResult.rows[0].id;

    // Check if it's homeroom
    const checkResult = await query(
      'SELECT is_homeroom FROM teacher_rooms WHERE teacher_id = $1 AND room_id = $2',
      [teacherId, req.params.id]
    );

    if (checkResult.rows.length > 0 && checkResult.rows[0].is_homeroom) {
      return res.status(400).json({
        success: false,
        message: 'ไม่สามารถลบห้องที่ปรึกษาได้'
      });
    }

    await query(
      'DELETE FROM teacher_rooms WHERE teacher_id = $1 AND room_id = $2',
      [teacherId, req.params.id]
    );

    res.json({
      success: true,
      message: 'ลบห้องเรียนสำเร็จ'
    });

  } catch (error) {
    console.error('Delete room error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการลบห้องเรียน'
    });
  }
});

// @route   GET /api/teacher/rooms/available
// @desc    Get available rooms by grade
// @access  Teacher
router.get('/rooms/available', async (req, res) => {
  try {
    const { grade_level } = req.query;

    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    const teacherId = teacherResult.rows[0].id;

    let queryText = `
      SELECT r.*
      FROM rooms r
      WHERE r.id NOT IN (
        SELECT room_id FROM teacher_rooms WHERE teacher_id = $1
      )
    `;
    const params = [teacherId];

    if (grade_level) {
      params.push(grade_level);
      queryText += ` AND r.grade_level = $${params.length}`;
    }

    queryText += ' ORDER BY r.name';

    const result = await query(queryText, params);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('Get available rooms error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลห้องเรียน'
    });
  }
});

// =====================================================
// STUDENTS IN ROOMS
// =====================================================

// @route   GET /api/teacher/rooms/:roomId/students
// @desc    Get students in a room
// @access  Teacher
router.get('/rooms/:roomId/students', async (req, res) => {
  try {
    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    const teacherId = teacherResult.rows[0].id;

    // Check if teacher has access to this room
    const accessCheck = await query(
      'SELECT id FROM teacher_rooms WHERE teacher_id = $1 AND room_id = $2',
      [teacherId, req.params.roomId]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'คุณไม่มีสิทธิ์เข้าถึงห้องนี้'
      });
    }

    // Get students
    const result = await query(
      `SELECT s.*, p.full_name as parent_name, p.phone as parent_phone
       FROM students s
       LEFT JOIN parents p ON s.parent_id = p.id
       WHERE s.room_id = $1
       ORDER BY s.student_number`,
      [req.params.roomId]
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลนักเรียน'
    });
  }
});

// @route   GET /api/teacher/students/:studentId
// @desc    Get student details
// @access  Teacher
router.get('/students/:studentId', async (req, res) => {
  try {
    // Get teacher id
    const teacherResult = await query(
      'SELECT id, homeroom_room_id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    const teacher = teacherResult.rows[0];

    // Get student with full details
    const result = await query(
      `SELECT s.*, r.name as room_name, p.full_name as parent_name, 
              p.phone as parent_phone, p.relationship as parent_relationship,
              t.full_name as homeroom_teacher_name
       FROM students s
       LEFT JOIN rooms r ON s.room_id = r.id
       LEFT JOIN parents p ON s.parent_id = p.id
       LEFT JOIN teachers t ON s.homeroom_teacher_id = t.id
       WHERE s.id = $1`,
      [req.params.studentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลนักเรียน'
      });
    }

    const student = result.rows[0];

    // Check access - teacher must teach this student's room
    const accessCheck = await query(
      'SELECT id FROM teacher_rooms WHERE teacher_id = $1 AND room_id = $2',
      [teacher.id, student.room_id]
    );

    // For non-homeroom teachers, show limited info
    const isHomeroom = teacher.homeroom_room_id === student.room_id;
    
    if (!isHomeroom && accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'คุณไม่มีสิทธิ์เข้าถึงข้อมูลนักเรียนนี้'
      });
    }

    // If not homeroom teacher, return limited info
    if (!isHomeroom) {
      res.json({
        success: true,
        data: {
          id: student.id,
          student_id: student.student_id,
          full_name: student.full_name,
          profile_picture: student.profile_picture,
          room_name: student.room_name
        },
        isLimitedView: true
      });
    } else {
      // Full access for homeroom teacher
      res.json({
        success: true,
        data: student,
        isLimitedView: false
      });
    }

  } catch (error) {
    console.error('Get student error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลนักเรียน'
    });
  }
});

// =====================================================
// ATTENDANCE
// =====================================================

// @route   POST /api/teacher/attendance/homeroom
// @desc    Take homeroom attendance
// @access  Teacher
router.post('/attendance/homeroom', [
  body('room_id').isInt().withMessage('กรุณาเลือกห้อง'),
  body('attendance_date').isDate().withMessage('วันที่ไม่ถูกต้อง'),
  body('attendance_list').isArray().withMessage('ข้อมูลการเช็คชื่อไม่ถูกต้อง')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { room_id, attendance_date, attendance_list } = req.body;

    // Get teacher id
    const teacherResult = await query(
      'SELECT id, homeroom_room_id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    const teacher = teacherResult.rows[0];

    // Verify this is teacher's homeroom
    if (teacher.homeroom_room_id !== parseInt(room_id)) {
      return res.status(403).json({
        success: false,
        message: 'คุณไม่มีสิทธิ์เช็คชื่อห้องนี้'
      });
    }

    // Get current time for check-in
    const checkInTime = new Date().toTimeString().split(' ')[0]; // HH:MM:SS format

    // Save attendance
    await transaction(async (client) => {
      for (const record of attendance_list) {
        await client.query(
          `INSERT INTO attendance 
           (student_id, teacher_id, room_id, attendance_date, status, attendance_type, check_in_time)
           VALUES ($1, $2, $3, $4, $5, 'homeroom', $6)
           ON CONFLICT (student_id, attendance_date, attendance_type, period_number)
           DO UPDATE SET 
             status = $5, 
             teacher_id = $2,
             check_in_time = $6`,
          [record.student_id, teacher.id, room_id, attendance_date, record.status, checkInTime]
        );
      }
    });

    res.json({
      success: true,
      message: 'บันทึกการเช็คชื่อสำเร็จ'
    });

  } catch (error) {
    console.error('Homeroom attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการบันทึกการเช็คชื่อ'
    });
  }
});

// @route   POST /api/teacher/attendance/subject
// @desc    Take subject attendance
// @access  Teacher
router.post('/attendance/subject', [
  body('room_id').isInt().withMessage('กรุณาเลือกห้อง'),
  body('subject_id').isInt().withMessage('กรุณาเลือกวิชา'),
  body('attendance_date').isDate().withMessage('วันที่ไม่ถูกต้อง'),
  body('period_number').isInt({ min: 1, max: 10 }).withMessage('คาบเรียนไม่ถูกต้อง'),
  body('attendance_list').isArray().withMessage('ข้อมูลการเช็คชื่อไม่ถูกต้อง')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { room_id, subject_id, attendance_date, period_number, attendance_list } = req.body;

    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    const teacherId = teacherResult.rows[0].id;

    // Verify teacher teaches this subject and room
    const accessCheck = await query(
      `SELECT ts.id 
       FROM teacher_subjects ts
       INNER JOIN teacher_rooms tr ON ts.teacher_id = tr.teacher_id
       WHERE ts.teacher_id = $1 AND ts.subject_id = $2 AND tr.room_id = $3`,
      [teacherId, subject_id, room_id]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'คุณไม่มีสิทธิ์เช็คชื่อห้อง/วิชานี้'
      });
    }

    // Get current time for check-in
    const checkInTime = new Date().toTimeString().split(' ')[0]; // HH:MM:SS format

    // Save attendance
    await transaction(async (client) => {
      for (const record of attendance_list) {
        await client.query(
          `INSERT INTO attendance 
           (student_id, teacher_id, room_id, subject_id, attendance_date, period_number, status, attendance_type, check_in_time)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'subject', $8)
           ON CONFLICT (student_id, attendance_date, attendance_type, period_number)
           DO UPDATE SET 
             status = $7, 
             teacher_id = $2, 
             subject_id = $4,
             check_in_time = $8`,
          [record.student_id, teacherId, room_id, subject_id, attendance_date, period_number, record.status, checkInTime]
        );
      }
    });

    res.json({
      success: true,
      message: 'บันทึกการเช็คชื่อสำเร็จ'
    });

  } catch (error) {
    console.error('Subject attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการบันทึกการเช็คชื่อ'
    });
  }
});

// @route   GET /api/teacher/attendance/history
// @desc    Get attendance history
// @access  Teacher
router.get('/attendance/history', async (req, res) => {
  try {
    const { room_id, start_date, end_date, attendance_type } = req.query;

    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    const teacherId = teacherResult.rows[0].id;

    let queryText = `
      SELECT 
        a.*,
        s.full_name as student_name, 
        s.student_id,
        s.student_number,
        r.name as room_name, 
        sub.subject_name,
        sub.subject_code
      FROM attendance a
      INNER JOIN students s ON a.student_id = s.id
      INNER JOIN rooms r ON a.room_id = r.id
      LEFT JOIN subjects sub ON a.subject_id = sub.id
      WHERE a.teacher_id = $1
    `;
    const params = [teacherId];

    if (room_id) {
      params.push(room_id);
      queryText += ` AND a.room_id = $${params.length}`;
    }

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

    queryText += ' ORDER BY a.attendance_date DESC, a.period_number NULLS LAST, s.student_number';

    const result = await query(queryText, params);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('Get attendance history error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลการเช็คชื่อ'
    });
  }
});

// @route   GET /api/teacher/attendance/summary/:room_id
// @desc    Get attendance summary for a specific room
// @access  Teacher
router.get('/attendance/summary/:room_id', async (req, res) => {
  try {
    const { room_id } = req.params;
    const { start_date, end_date } = req.query;

    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    const teacherId = teacherResult.rows[0].id;

    let queryText = `
      SELECT 
        s.id as student_id,
        s.student_number,
        s.full_name as student_name,
        COUNT(CASE WHEN a.status = 'มาเรียน' THEN 1 END) as present,
        COUNT(CASE WHEN a.status = 'มาสาย' THEN 1 END) as late,
        COUNT(CASE WHEN a.status = 'ลาป่วย' THEN 1 END) as sick_leave,
        COUNT(CASE WHEN a.status = 'ลากิจ' THEN 1 END) as personal_leave,
        COUNT(CASE WHEN a.status = 'ขาดเรียน' THEN 1 END) as absent,
        COUNT(*) as total_records
      FROM students s
      LEFT JOIN attendance a ON s.id = a.student_id
      WHERE s.room_id = $1
    `;
    const params = [room_id];

    if (start_date) {
      params.push(start_date);
      queryText += ` AND a.attendance_date >= $${params.length}`;
    }

    if (end_date) {
      params.push(end_date);
      queryText += ` AND a.attendance_date <= $${params.length}`;
    }

    queryText += ' GROUP BY s.id, s.student_number, s.full_name ORDER BY s.student_number';

    const result = await query(queryText, params);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('Get attendance summary error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลสรุปการเข้าเรียน'
    });
  }
});

// =====================================================
// GRADING WITH GOOGLE SHEETS
// =====================================================

// @route   POST /api/teacher/grades/batch
// @desc    Save/update grades for multiple students
// @access  Teacher
router.post('/create-grade-sheet', async (req, res) => {
  try {
    const { room_id, subject_id } = req.body;
    
    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลครู'
      });
    }

    const teacherId = teacherResult.rows[0].id;
    
    // Get room and subject info
    const roomRes = await query('SELECT name FROM rooms WHERE id = $1', [room_id]);
    const subjectRes = await query('SELECT subject_name FROM subjects WHERE id = $1', [subject_id]);
    
    if (roomRes.rows.length === 0 || subjectRes.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'ไม่พบข้อมูลห้องหรือวิชา' 
      });
    }
    
    const roomName = roomRes.rows[0].name;
    const subjectName = subjectRes.rows[0].subject_name;
    
    // Check if sheet already exists
    const existingSheet = await query(
      'SELECT sheet_id, sheet_url FROM grade_sheets WHERE room_id = $1 AND subject_id = $2',
      [room_id, subject_id]
    );
    
    // Get students with their current grades
    const studentsRes = await query(`
      SELECT s.student_number, s.student_id, s.full_name, s.id,
              COALESCE(g.score_1, 0) as score_1,
              COALESCE(g.score_2, 0) as score_2,
              COALESCE(g.score_3, 0) as score_3,
              COALESCE(g.score_4, 0) as score_4,
              COALESCE(g.midterm_score, 0) as midterm_score,
              COALESCE(g.final_score, 0) as final_score
      FROM students s
      LEFT JOIN grades g ON s.id = g.student_id AND g.subject_id = $2
      WHERE s.room_id = $1
      ORDER BY s.student_number
    `, [room_id, subject_id]);
    
    if (!GOOGLE_APPS_SCRIPT_URL || GOOGLE_APPS_SCRIPT_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL') {
      return res.status(500).json({
        success: false,
        message: 'Google Apps Script URL is not configured. Please set GOOGLE_APPS_SCRIPT_URL in your .env file'
      });
    }

    // Call Google Apps Script to create/update sheet
    const response = await axios.post(GOOGLE_APPS_SCRIPT_URL, {
      action: 'create_or_update_sheet',
      sheet_id: existingSheet.rows.length > 0 ? existingSheet.rows[0].sheet_id : null,
      room_name: roomName,
      subject_name: subjectName,
      students: studentsRes.rows
    });
    
    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to create Google Sheet');
    }
    
    // Save sheet info to database
    await query(`
      INSERT INTO grade_sheets (room_id, subject_id, sheet_id, sheet_url, teacher_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (room_id, subject_id)
      DO UPDATE SET 
        sheet_id = $3, 
        sheet_url = $4, 
        teacher_id = $5,
        updated_at = CURRENT_TIMESTAMP
    `, [room_id, subject_id, response.data.sheet_id, response.data.sheet_url, teacherId]);
    
    res.json({
      success: true,
      sheet_id: response.data.sheet_id,
      sheet_url: response.data.sheet_url,
      message: 'สร้าง Google Sheet สำเร็จ'
    });
    
  } catch (error) {
    console.error('Create sheet error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'ไม่สามารถสร้าง Google Sheet ได้'
    });
  }
});

// @route   GET /api/teacher/grade-sheet/:room_id/:subject_id
// @desc    Get Google Sheet URL for a room+subject
// @access  Teacher
router.get('/grade-sheet/:room_id/:subject_id', async (req, res) => {
  try {
    const { room_id, subject_id } = req.params;
    
    const result = await query(
      'SELECT sheet_id, sheet_url FROM grade_sheets WHERE room_id = $1 AND subject_id = $2',
      [room_id, subject_id]
    );
    
    if (result.rows.length > 0) {
      res.json({
        success: true,
        sheet_id: result.rows[0].sheet_id,
        sheet_url: result.rows[0].sheet_url
      });
    } else {
      res.json({
        success: false,
        message: 'ไม่พบ Google Sheet สำหรับห้องและวิชานี้'
      });
    }
  } catch (error) {
    console.error('Get grade sheet error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// @route   POST /api/teacher/import-from-sheet
// @desc    Import grades from Google Sheet to database
// @access  Teacher
router.post('/import-from-sheet', async (req, res) => {
  try {
    const { room_id, subject_id } = req.body;
    
    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลครู'
      });
    }

    const teacherId = teacherResult.rows[0].id;
    
    // Get sheet ID
    const sheetRes = await query(
      'SELECT sheet_id FROM grade_sheets WHERE room_id = $1 AND subject_id = $2',
      [room_id, subject_id]
    );
    
    if (sheetRes.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'ไม่พบ Google Sheet' 
      });
    }
    
    const sheetId = sheetRes.rows[0].sheet_id;
    
    if (!GOOGLE_APPS_SCRIPT_URL || GOOGLE_APPS_SCRIPT_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL') {
      return res.status(500).json({
        success: false,
        message: 'Google Apps Script URL is not configured'
      });
    }

    // Get data from Google Sheet
    const response = await axios.post(GOOGLE_APPS_SCRIPT_URL, {
      action: 'get_grades',
      sheet_id: sheetId
    });
    
    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to fetch data from Google Sheet');
    }
    
    const grades = response.data.data;
    
    // Update database
    let updatedCount = 0;
    await transaction(async (client) => {
      for (const grade of grades) {
        // Find student by student_id
        const studentRes = await client.query(
          'SELECT id FROM students WHERE student_id = $1',
          [grade.student_id]
        );
        
        if (studentRes.rows.length > 0) {
          const studentId = studentRes.rows[0].id;
          
          // Calculate total
          const total = (parseFloat(grade.score_1) || 0) + 
                        (parseFloat(grade.score_2) || 0) + 
                        (parseFloat(grade.score_3) || 0) + 
                        (parseFloat(grade.score_4) || 0) + 
                        (parseFloat(grade.midterm_score) || 0) + 
                        (parseFloat(grade.final_score) || 0);
          
          // Calculate grade
          let letterGrade = 'F';
          if (total >= 80) letterGrade = 'A';
          else if (total >= 70) letterGrade = 'B';
          else if (total >= 60) letterGrade = 'C';
          else if (total >= 50) letterGrade = 'D';
          
          // Upsert grades
          await client.query(`
            INSERT INTO grades (
              student_id, subject_id, room_id, teacher_id,
              score_1, score_2, score_3, score_4, 
              midterm_score, final_score, total_score, grade,
              created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (student_id, subject_id)
            DO UPDATE SET 
              score_1 = $5,
              score_2 = $6,
              score_3 = $7,
              score_4 = $8,
              midterm_score = $9,
              final_score = $10,
              total_score = $11,
              grade = $12,
              room_id = $3,
              teacher_id = $4,
              updated_at = CURRENT_TIMESTAMP
          `, [
            studentId, subject_id, room_id, teacherId,
            grade.score_1, grade.score_2, grade.score_3, grade.score_4, 
            grade.midterm_score, grade.final_score, total, letterGrade
          ]);
          
          updatedCount++;
        }
      }
    });
    
    res.json({
      success: true,
      message: `นำเข้าคะแนนสำเร็จ ${updatedCount} รายการ`
    });
    
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'ไม่สามารถนำเข้าข้อมูลได้'
    });
  }
});

// @route   POST /api/teacher/grades/batch
// @desc    Save/update grades for multiple students (Custom entry)
// @access  Teacher
router.post('/grades/batch', [
  body('room_id').isInt().withMessage('กรุณาเลือกห้อง'),
  body('subject_id').isInt().withMessage('กรุณาเลือกวิชา'),
  body('grades').isArray().withMessage('ข้อมูลคะแนนไม่ถูกต้อง')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { room_id, subject_id, grades: gradesData } = req.body;

    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลครู'
      });
    }

    const teacherId = teacherResult.rows[0].id;

    // Verify teacher has access
    const accessCheck = await query(
      `SELECT ts.id 
       FROM teacher_subjects ts
       INNER JOIN teacher_rooms tr ON ts.teacher_id = tr.teacher_id
       WHERE ts.teacher_id = $1 AND ts.subject_id = $2 AND tr.room_id = $3`,
      [teacherId, subject_id, room_id]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'คุณไม่มีสิทธิ์บันทึกคะแนนห้อง/วิชานี้'
      });
    }

    // Save grades in transaction
    let savedCount = 0;
    await transaction(async (client) => {
      for (const gradeRecord of gradesData) {
        const {
          student_id,
          score_1 = 0,
          score_2 = 0,
          score_3 = 0,
          score_4 = 0,
          midterm_score = 0,
          final_score = 0
        } = gradeRecord;

        // Calculate total score
        const total_score = parseFloat(score_1) + parseFloat(score_2) + 
                           parseFloat(score_3) + parseFloat(score_4) +
                           parseFloat(midterm_score) + parseFloat(final_score);

        // Calculate grade
        let grade;
        if (total_score >= 80) grade = 'A';
        else if (total_score >= 70) grade = 'B';
        else if (total_score >= 60) grade = 'C';
        else if (total_score >= 50) grade = 'D';
        else grade = 'F';

        const result = await client.query(
          `INSERT INTO grades 
           (student_id, subject_id, teacher_id, room_id,
            score_1, score_2, score_3, score_4, 
            midterm_score, final_score, total_score, grade,
            created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (student_id, subject_id)
           DO UPDATE SET 
             score_1 = $5, 
             score_2 = $6, 
             score_3 = $7, 
             score_4 = $8,
             midterm_score = $9, 
             final_score = $10, 
             total_score = $11, 
             grade = $12,
             teacher_id = $3,
             room_id = $4,
             updated_at = CURRENT_TIMESTAMP
           RETURNING id`,
          [student_id, subject_id, teacherId, room_id,
           score_1, score_2, score_3, score_4,
           midterm_score, final_score, total_score, grade]
        );

        if (result.rows.length > 0) {
          savedCount++;
        }
      }
    });

    res.json({
      success: true,
      message: `บันทึกคะแนนสำเร็จ (${savedCount} รายการ)`
    });

  } catch (error) {
    console.error('Save grades error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการบันทึกคะแนน: ' + error.message
    });
  }
});

// @route   GET /api/teacher/grades/:roomId/:subjectId
// @desc    Get existing grades for a room and subject (for custom entry)
// @access  Teacher
router.get('/grades/:roomId/:subjectId', async (req, res) => {
  try {
    const { roomId, subjectId } = req.params;

    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );
    const teacherId = teacherResult.rows[0].id;

    // Verify teacher has access
    const accessCheck = await query(
      `SELECT ts.id 
       FROM teacher_subjects ts
       INNER JOIN teacher_rooms tr ON ts.teacher_id = tr.teacher_id
       WHERE ts.teacher_id = $1 AND ts.subject_id = $2 AND tr.room_id = $3`,
      [teacherId, subjectId, roomId]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้'
      });
    }

    // Get students in room with their grades
    const result = await query(
      `SELECT 
        s.id, s.student_id, s.student_number, s.full_name,
        g.score_1, g.score_2, g.score_3, g.score_4,
        g.midterm_score, g.final_score, g.total_score, g.grade
       FROM students s
       LEFT JOIN grades g ON s.id = g.student_id AND g.subject_id = $2
       WHERE s.room_id = $1
       ORDER BY s.student_number`,
      [roomId, subjectId]
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('Get grades error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูล'
    });
  }
});

// =====================================================
// HOME VISIT
// =====================================================
// @route   POST /api/teacher/home-visits
// @desc    Create home visit record
// @access  Teacher
router.post('/home-visits', [
  body('student_id').isInt().withMessage('กรุณาเลือกนักเรียน'),
  body('visit_date').isISO8601().withMessage('วันที่ไม่ถูกต้อง'),
  body('notes').notEmpty().withMessage('กรุณากรอกหมายเหตุการเยี่ยมบ้าน')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { student_id, visit_date, latitude, longitude, maps_url, notes, report_pdf } = req.body;

    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลครู'
      });
    }

    const teacherId = teacherResult.rows[0].id;

    const result = await query(
      `INSERT INTO home_visits 
       (student_id, teacher_id, visit_date, latitude, longitude, maps_url, notes, report_pdf, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       RETURNING *`,
      [student_id, teacherId, visit_date, latitude, longitude, maps_url, notes, report_pdf]
    );

    res.status(201).json({
      success: true,
      message: 'บันทึกการเยี่ยมบ้านสำเร็จ',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create home visit error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการบันทึกการเยี่ยมบ้าน'
    });
  }
});

// @route   GET /api/teacher/home-visits/:studentId
// @desc    Get home visits for a specific student
// @access  Teacher
router.get('/home-visits/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;

    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลครู'
      });
    }

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
// STUDENT DETAILS FOR TEACHER
// =====================================================

// @route   GET /api/teacher/students/:studentId
// @desc    Get complete student information (for teacher view)
// @access  Teacher
router.get('/students/:studentId/complete', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    console.log('Fetching details for student ID:', studentId);
    
    // Get teacher id from user
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลครู'
      });
    }

    const teacherId = teacherResult.rows[0].id;
    console.log('Teacher ID:', teacherId);

    // Verify teacher has access to this student (through rooms)
    const accessCheck = await query(
      `SELECT DISTINCT s.id 
       FROM students s
       INNER JOIN rooms r ON s.room_id = r.id
       INNER JOIN teacher_rooms tr ON r.id = tr.room_id
       WHERE s.id = $1 AND tr.teacher_id = $2`,
      [studentId, teacherId]
    );

    if (accessCheck.rows.length === 0) {
      console.log('Access denied for teacher', teacherId, 'to student', studentId);
      return res.status(403).json({
        success: false,
        message: 'คุณไม่มีสิทธิ์เข้าถึงข้อมูลนักเรียนคนนี้'
      });
    }

    console.log('Access granted, fetching data...');

    // Get student profile
    const profileResult = await query(
      `SELECT s.*, r.name as room_name, r.grade_level,
              t.full_name as homeroom_teacher_name, t.phone as teacher_phone,
              p.full_name as parent_name, p.phone as parent_phone, 
              p.relationship as parent_relationship
       FROM students s
       LEFT JOIN rooms r ON s.room_id = r.id
       LEFT JOIN teachers t ON s.homeroom_teacher_id = t.id
       LEFT JOIN parents p ON s.parent_id = p.id
       WHERE s.id = $1`,
      [studentId]
    );

    console.log('Profile fetched:', profileResult.rows.length > 0);

    // Get attendance summary
    const attendanceResult = await query(
      `SELECT 
        COUNT(CASE WHEN status = 'มาเรียน' THEN 1 END) as present,
        COUNT(CASE WHEN status = 'มาสาย' THEN 1 END) as late,
        COUNT(CASE WHEN status = 'ลาป่วย' THEN 1 END) as sick_leave,
        COUNT(CASE WHEN status = 'ลากิจ' THEN 1 END) as personal_leave,
        COUNT(CASE WHEN status = 'ขาดเรียน' THEN 1 END) as absent,
        COUNT(*) as total_days
       FROM attendance
       WHERE student_id = $1 AND attendance_type = 'homeroom'`,
      [studentId]
    );

    console.log('Attendance fetched');

    // Get grades
    const gradesResult = await query(
      `SELECT 
        g.id,
        g.score_1,
        g.score_2,
        g.score_3,
        g.score_4,
        g.midterm_score,
        g.final_score,
        g.total_score,
        g.grade,
        s.subject_name,
        s.subject_code,
        t.full_name as teacher_name,
        g.created_at,
        g.updated_at
       FROM grades g
       INNER JOIN subjects s ON g.subject_id = s.id
       LEFT JOIN teachers t ON g.teacher_id = t.id
       WHERE g.student_id = $1
       ORDER BY s.subject_name`,
      [studentId]
    );

    console.log('Grades fetched:', gradesResult.rows.length);

    // Calculate GPA
    const gpaResult = await query(
      `SELECT 
        COUNT(*) as total_subjects,
        AVG(g.total_score) as average_score,
        COUNT(CASE WHEN g.grade = 'A' THEN 1 END) as grade_a_count,
        COUNT(CASE WHEN g.grade = 'B' THEN 1 END) as grade_b_count,
        COUNT(CASE WHEN g.grade = 'C' THEN 1 END) as grade_c_count,
        COUNT(CASE WHEN g.grade = 'D' THEN 1 END) as grade_d_count,
        COUNT(CASE WHEN g.grade = 'F' THEN 1 END) as grade_f_count
       FROM grades g
       WHERE g.student_id = $1`,
      [studentId]
    );

    const stats = gpaResult.rows[0];
    const totalSubjects = parseInt(stats.total_subjects);
    let gpa = 0;
    if (totalSubjects > 0) {
      const gradePoints = 
        (parseInt(stats.grade_a_count) * 4) +
        (parseInt(stats.grade_b_count) * 3) +
        (parseInt(stats.grade_c_count) * 2) +
        (parseInt(stats.grade_d_count) * 1) +
        (parseInt(stats.grade_f_count) * 0);
      gpa = (gradePoints / totalSubjects).toFixed(2);
    }

    console.log('GPA calculated:', gpa);

    // Get health records
    const healthResult = await query(
      'SELECT * FROM health_records WHERE student_id = $1',
      [studentId]
    );

    console.log('Health fetched:', healthResult.rows.length > 0);

    // Get home visits
    const homeVisitsResult = await query(
      `SELECT hv.*, t.full_name as teacher_name
       FROM home_visits hv
       LEFT JOIN teachers t ON hv.teacher_id = t.id
       WHERE hv.student_id = $1
       ORDER BY hv.visit_date DESC`,
      [studentId]
    );

    console.log('Home visits fetched:', homeVisitsResult.rows.length);

    const responseData = {
      success: true,
      data: {
        profile: profileResult.rows[0],
        attendance: attendanceResult.rows[0],
        grades: gradesResult.rows,
        gpa: {
          gpa: parseFloat(gpa),
          total_subjects: totalSubjects,
          average_score: parseFloat(stats.average_score || 0).toFixed(2),
          grade_distribution: {
            A: parseInt(stats.grade_a_count),
            B: parseInt(stats.grade_b_count),
            C: parseInt(stats.grade_c_count),
            D: parseInt(stats.grade_d_count),
            F: parseInt(stats.grade_f_count)
          }
        },
        health: healthResult.rows[0] || null,
        homeVisits: homeVisitsResult.rows
      }
    };

    console.log('Sending response with all data');
    res.json(responseData);

  } catch (error) {
    console.error('Get student details error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลนักเรียน',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   PUT /api/teacher/students/:studentId/photo
// @desc    Update student profile picture
// @access  Teacher
router.put('/students/:studentId/photo', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { profile_picture } = req.body; // Base64 image string

    if (!profile_picture) {
      return res.status(400).json({
        success: false,
        message: 'กรุณาอัปโหลดรูปภาพ'
      });
    }

    // Get teacher id
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลครู'
      });
    }

    const teacherId = teacherResult.rows[0].id;

    // Verify teacher has access to this student
    const accessCheck = await query(
      `SELECT s.id FROM students s
       INNER JOIN teacher_rooms tr ON s.room_id = tr.room_id
       WHERE s.id = $1 AND tr.teacher_id = $2`,
      [studentId, teacherId]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'คุณไม่มีสิทธิ์แก้ไขข้อมูลนักเรียนนี้'
      });
    }

    // Update student profile picture
    const result = await query(
      `UPDATE students 
       SET profile_picture = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, profile_picture`,
      [profile_picture, studentId]
    );

    res.json({
      success: true,
      message: 'อัปเดตรูปภาพสำเร็จ',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update student photo error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการอัปเดตรูปภาพ'
    });
  }
});

module.exports = router;
