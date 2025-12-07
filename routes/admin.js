const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const { verifyToken, checkRole } = require('../middleware/auth');

// Apply auth middleware to all admin routes
router.use(verifyToken);
router.use(checkRole('admin'));

// =====================================================
// DASHBOARD STATISTICS
// =====================================================

router.get('/statistics', async (req, res) => {
  try {
    const stats = await Promise.all([
      query('SELECT COUNT(*) as count FROM teachers WHERE user_id IS NOT NULL'),
      query('SELECT COUNT(*) as count FROM students WHERE user_id IS NOT NULL'),
      query('SELECT COUNT(*) as count FROM rooms'),
      query('SELECT COUNT(*) as count FROM users WHERE is_active = true'),
      query('SELECT COUNT(*) as count FROM parents'),
      query(`SELECT COUNT(DISTINCT student_id) as count FROM attendance 
             WHERE attendance_date = CURRENT_DATE AND status = 'มาเรียน'`),
      query(`SELECT r.name, COUNT(s.id) as student_count 
             FROM rooms r LEFT JOIN students s ON r.id = s.room_id 
             GROUP BY r.id ORDER BY student_count DESC LIMIT 5`)
    ]);

    res.json({
      success: true,
      data: {
        totalTeachers: parseInt(stats[0].rows[0].count),
        totalStudents: parseInt(stats[1].rows[0].count),
        totalRooms: parseInt(stats[2].rows[0].count),
        activeUsers: parseInt(stats[3].rows[0].count),
        totalParents: parseInt(stats[4].rows[0].count),
        presentToday: parseInt(stats[5].rows[0].count),
        topRooms: stats[6].rows
      }
    });
  } catch (error) {
    console.error('Get statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลสถิติ'
    });
  }
});

// =====================================================
// TEACHER MANAGEMENT
// =====================================================

router.get('/teachers', async (req, res) => {
  try {
    const { search, subject_group } = req.query;
    
    let queryText = `
      SELECT t.*, r.name as homeroom_room_name, u.phone as user_phone, u.is_active,
             CASE WHEN t.user_id IS NULL THEN false ELSE true END as is_registered
      FROM teachers t
      LEFT JOIN rooms r ON t.homeroom_room_id = r.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    
    if (search) {
      params.push(`%${search}%`);
      queryText += ` AND (t.full_name ILIKE $${params.length} OR t.teacher_code ILIKE $${params.length} OR t.phone ILIKE $${params.length})`;
    }
    
    if (subject_group) {
      params.push(subject_group);
      queryText += ` AND t.subject_group = $${params.length}`;
    }
    
    queryText += ' ORDER BY t.full_name';
    
    const result = await query(queryText, params);
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get teachers error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลครู'
    });
  }
});

router.get('/teachers/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT t.*, r.name as homeroom_room_name, r.id as homeroom_room_id,
              u.phone as user_phone, u.is_active,
              CASE WHEN t.user_id IS NULL THEN false ELSE true END as is_registered
       FROM teachers t
       LEFT JOIN rooms r ON t.homeroom_room_id = r.id
       LEFT JOIN users u ON t.user_id = u.id
       WHERE t.id = $1`,
      [req.params.id]
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
    console.error('Get teacher error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลครู'
    });
  }
});

router.post('/teachers', [
  body('full_name').notEmpty().withMessage('กรุณาใส่ชื่อ-นามสกุล'),
  body('phone').matches(/^[0-9]{10}$/).withMessage('หมายเลขโทรศัพท์ไม่ถูกต้อง'),
  body('email').optional().isEmail().withMessage('อีเมลไม่ถูกต้อง'),
  body('subject_group').notEmpty().withMessage('กรุณาเลือกกลุ่มสาระการเรียนรู้'),
  body('password').isLength({ min: 6 }).withMessage('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { full_name, phone, email, address, subject_group, password, teacher_code } = req.body;

    const phoneCheck = await query(
      'SELECT id FROM users WHERE phone = $1',
      [phone]
    );

    if (phoneCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'หมายเลขโทรศัพท์นี้ถูกใช้งานแล้ว'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await transaction(async (client) => {
      const userResult = await client.query(
        `INSERT INTO users (phone, password_hash, role, is_first_login)
         VALUES ($1, $2, 'teacher', true)
         RETURNING id`,
        [phone, hashedPassword]
      );

      const userId = userResult.rows[0].id;

      const teacherResult = await client.query(
        `INSERT INTO teachers (user_id, teacher_code, full_name, email, phone, address, subject_group)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [userId, teacher_code, full_name, email, phone, address, subject_group]
      );

      return teacherResult.rows[0];
    });

    res.status(201).json({
      success: true,
      message: 'เพิ่มข้อมูลครูสำเร็จ',
      data: result
    });
  } catch (error) {
    console.error('Create teacher error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเพิ่มข้อมูลครู'
    });
  }
});

router.put('/teachers/:id', [
  body('full_name').optional().notEmpty().withMessage('กรุณาใส่ชื่อ-นามสกุล'),
  body('email').optional().isEmail().withMessage('อีเมลไม่ถูกต้อง'),
  body('subject_group').optional().notEmpty().withMessage('กรุณาเลือกกลุ่มสาระการเรียนรู้')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { full_name, email, address, subject_group, teacher_code } = req.body;

    const result = await query(
      `UPDATE teachers 
       SET full_name = COALESCE($1, full_name),
           email = COALESCE($2, email),
           address = COALESCE($3, address),
           subject_group = COALESCE($4, subject_group),
           teacher_code = COALESCE($5, teacher_code),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [full_name, email, address, subject_group, teacher_code, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลครู'
      });
    }

    res.json({
      success: true,
      message: 'แก้ไขข้อมูลครูสำเร็จ',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update teacher error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการแก้ไขข้อมูลครู'
    });
  }
});

router.delete('/teachers/:id', async (req, res) => {
  try {
    const result = await transaction(async (client) => {
      const teacherResult = await client.query(
        'SELECT user_id FROM teachers WHERE id = $1',
        [req.params.id]
      );

      if (teacherResult.rows.length === 0) {
        throw new Error('ไม่พบข้อมูลครู');
      }

      const userId = teacherResult.rows[0].user_id;

      if (userId) {
        await client.query('DELETE FROM users WHERE id = $1', [userId]);
      } else {
        await client.query('DELETE FROM teachers WHERE id = $1', [req.params.id]);
      }

      return true;
    });

    res.json({
      success: true,
      message: 'ลบข้อมูลครูสำเร็จ'
    });
  } catch (error) {
    console.error('Delete teacher error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'เกิดข้อผิดพลาดในการลบข้อมูลครู'
    });
  }
});

router.put('/teachers/:id/homeroom', [
  body('room_id').isInt().withMessage('กรุณาเลือกห้องเรียน')
], async (req, res) => {
  try {
    const { room_id } = req.body;

    const result = await transaction(async (client) => {
      const roomCheck = await client.query(
        'SELECT homeroom_teacher_id FROM rooms WHERE id = $1',
        [room_id]
      );

      if (roomCheck.rows.length === 0) {
        throw new Error('ไม่พบห้องเรียน');
      }

      if (roomCheck.rows[0].homeroom_teacher_id) {
        await client.query(
          'UPDATE teachers SET homeroom_room_id = NULL WHERE id = $1',
          [roomCheck.rows[0].homeroom_teacher_id]
        );
      }

      await client.query(
        'UPDATE rooms SET homeroom_teacher_id = $1 WHERE id = $2',
        [req.params.id, room_id]
      );

      await client.query(
        'UPDATE teachers SET homeroom_room_id = $1 WHERE id = $2',
        [room_id, req.params.id]
      );

      await client.query(
        `INSERT INTO teacher_rooms (teacher_id, room_id, is_homeroom)
         VALUES ($1, $2, true)
         ON CONFLICT (teacher_id, room_id) DO UPDATE SET is_homeroom = true`,
        [req.params.id, room_id]
      );

      await client.query(
        'UPDATE students SET homeroom_teacher_id = $1 WHERE room_id = $2',
        [req.params.id, room_id]
      );

      return true;
    });

    res.json({
      success: true,
      message: 'กำหนดห้องที่ปรึกษาสำเร็จ'
    });
  } catch (error) {
    console.error('Assign homeroom error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'เกิดข้อผิดพลาดในการกำหนดห้องที่ปรึกษา'
    });
  }
});

// =====================================================
// STUDENT MANAGEMENT
// =====================================================

router.get('/students', async (req, res) => {
  try {
    const { search, room_id, grade_level } = req.query;
    
    let queryText = `
      SELECT s.*, r.name as room_name, r.grade_level, t.full_name as homeroom_teacher_name,
             p.full_name as parent_name, p.phone as parent_phone,
             CASE WHEN s.user_id IS NULL THEN false ELSE true END as is_registered
      FROM students s
      LEFT JOIN rooms r ON s.room_id = r.id
      LEFT JOIN teachers t ON s.homeroom_teacher_id = t.id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE 1=1
    `;
    const params = [];
    
    if (search) {
      params.push(`%${search}%`);
      queryText += ` AND (s.full_name ILIKE $${params.length} OR s.student_id ILIKE $${params.length})`;
    }
    
    if (room_id) {
      params.push(room_id);
      queryText += ` AND s.room_id = $${params.length}`;
    }
    
    if (grade_level) {
      params.push(grade_level);
      queryText += ` AND r.grade_level = $${params.length}`;
    }
    
    queryText += ' ORDER BY r.name, s.student_number';
    
    const result = await query(queryText, params);
    
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

router.post('/students', [
  body('full_name').notEmpty().withMessage('กรุณาใส่ชื่อ-นามสกุล'),
  body('phone').matches(/^[0-9]{10}$/).withMessage('หมายเลขโทรศัพท์ไม่ถูกต้อง'),
  body('student_id').notEmpty().withMessage('กรุณาใส่รหัสนักเรียน'),
  body('room_id').isInt().withMessage('กรุณาเลือกห้องเรียน')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { full_name, phone, student_id, room_id, student_number, parent_id } = req.body;

    const phoneCheck = await query(
      'SELECT id FROM students WHERE phone = $1',
      [phone]
    );

    if (phoneCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'หมายเลขโทรศัพท์นี้ถูกใช้งานแล้ว'
      });
    }

    const studentIdCheck = await query(
      'SELECT id FROM students WHERE student_id = $1',
      [student_id]
    );

    if (studentIdCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'รหัสนักเรียนนี้ถูกใช้งานแล้ว'
      });
    }

    const roomResult = await query(
      'SELECT homeroom_teacher_id FROM rooms WHERE id = $1',
      [room_id]
    );

    const homeroom_teacher_id = roomResult.rows[0]?.homeroom_teacher_id;

    const result = await query(
      `INSERT INTO students (student_id, full_name, phone, room_id, student_number, parent_id, homeroom_teacher_id, behavior_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 100)
       RETURNING *`,
      [student_id, full_name, phone, room_id, student_number, parent_id, homeroom_teacher_id]
    );

    res.status(201).json({
      success: true,
      message: 'เพิ่มข้อมูลนักเรียนสำเร็จ',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create student error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเพิ่มข้อมูลนักเรียน'
    });
  }
});

router.put('/students/:id', async (req, res) => {
  try {
    const { full_name, room_id, student_number, parent_id } = req.body;

    const result = await query(
      `UPDATE students 
       SET full_name = COALESCE($1, full_name),
           room_id = COALESCE($2, room_id),
           student_number = COALESCE($3, student_number),
           parent_id = COALESCE($4, parent_id),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [full_name, room_id, student_number, parent_id, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลนักเรียน'
      });
    }

    res.json({
      success: true,
      message: 'แก้ไขข้อมูลนักเรียนสำเร็จ',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update student error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการแก้ไขข้อมูลนักเรียน'
    });
  }
});

router.delete('/students/:id', async (req, res) => {
  try {
    const result = await transaction(async (client) => {
      const studentResult = await client.query(
        'SELECT user_id FROM students WHERE id = $1',
        [req.params.id]
      );

      if (studentResult.rows.length === 0) {
        throw new Error('ไม่พบข้อมูลนักเรียน');
      }

      const userId = studentResult.rows[0].user_id;

      if (userId) {
        await client.query('DELETE FROM users WHERE id = $1', [userId]);
      } else {
        await client.query('DELETE FROM students WHERE id = $1', [req.params.id]);
      }

      return true;
    });

    res.json({
      success: true,
      message: 'ลบข้อมูลนักเรียนสำเร็จ'
    });
  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'เกิดข้อผิดพลาดในการลบข้อมูลนักเรียน'
    });
  }
});

// =====================================================
// PARENT MANAGEMENT
// =====================================================

router.get('/parents', async (req, res) => {
  try {
    const result = await query(
      `SELECT p.*, COUNT(s.id) as children_count
       FROM parents p
       LEFT JOIN students s ON p.id = s.parent_id
       GROUP BY p.id
       ORDER BY p.full_name`
    );
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get parents error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลผู้ปกครอง'
    });
  }
});

router.post('/parents', [
  body('full_name').notEmpty().withMessage('กรุณาใส่ชื่อ-นามสกุล'),
  body('phone').matches(/^[0-9]{10}$/).withMessage('หมายเลขโทรศัพท์ไม่ถูกต้อง')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { full_name, phone, relationship, email, address } = req.body;

    const result = await query(
      `INSERT INTO parents (full_name, phone, relationship, email, address)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [full_name, phone, relationship, email, address]
    );

    res.status(201).json({
      success: true,
      message: 'เพิ่มข้อมูลผู้ปกครองสำเร็จ',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create parent error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเพิ่มข้อมูลผู้ปกครอง'
    });
  }
});

router.put('/parents/:id', async (req, res) => {
  try {
    const { full_name, phone, relationship, email, address } = req.body;

    const result = await query(
      `UPDATE parents
       SET full_name = COALESCE($1, full_name),
           phone = COALESCE($2, phone),
           relationship = COALESCE($3, relationship),
           email = COALESCE($4, email),
           address = COALESCE($5, address),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [full_name, phone, relationship, email, address, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลผู้ปกครอง'
      });
    }

    res.json({
      success: true,
      message: 'แก้ไขข้อมูลผู้ปกครองสำเร็จ',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update parent error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการแก้ไขข้อมูลผู้ปกครอง'
    });
  }
});

router.delete('/parents/:id', async (req, res) => {
  try {
    const childrenCheck = await query(
      'SELECT COUNT(*) as count FROM students WHERE parent_id = $1',
      [req.params.id]
    );

    if (parseInt(childrenCheck.rows[0].count) > 0) {
      return res.status(400).json({
        success: false,
        message: 'ไม่สามารถลบผู้ปกครองที่มีลูกในระบบได้'
      });
    }

    await query('DELETE FROM parents WHERE id = $1', [req.params.id]);

    res.json({
      success: true,
      message: 'ลบข้อมูลผู้ปกครองสำเร็จ'
    });
  } catch (error) {
    console.error('Delete parent error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการลบข้อมูลผู้ปกครอง'
    });
  }
});

// =====================================================
// ROOM MANAGEMENT
// =====================================================

router.get('/rooms', async (req, res) => {
  try {
    const result = await query(
      `SELECT r.*, t.full_name as homeroom_teacher_name,
              COUNT(s.id) as student_count
       FROM rooms r
       LEFT JOIN teachers t ON r.homeroom_teacher_id = t.id
       LEFT JOIN students s ON s.room_id = r.id
       GROUP BY r.id, t.full_name
       ORDER BY r.grade_level, r.room_number`
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

router.post('/rooms', [
  body('name').notEmpty().withMessage('กรุณาใส่ชื่อห้อง'),
  body('grade_level').isInt().withMessage('กรุณาเลือกระดับชั้น'),
  body('room_number').isInt().withMessage('กรุณาใส่เลขห้อง'),
  body('academic_year').notEmpty().withMessage('กรุณาใส่ปีการศึกษา')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { name, grade_level, room_number, capacity, academic_year } = req.body;

    const result = await query(
      `INSERT INTO rooms (name, grade_level, room_number, capacity, academic_year)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, grade_level, room_number, capacity || 40, academic_year]
    );

    res.status(201).json({
      success: true,
      message: 'เพิ่มห้องเรียนสำเร็จ',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเพิ่มห้องเรียน'
    });
  }
});

router.put('/rooms/:id', async (req, res) => {
  try {
    const { name, grade_level, room_number, capacity, academic_year } = req.body;

    const result = await query(
      `UPDATE rooms
       SET name = COALESCE($1, name),
           grade_level = COALESCE($2, grade_level),
           room_number = COALESCE($3, room_number),
           capacity = COALESCE($4, capacity),
           academic_year = COALESCE($5, academic_year),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [name, grade_level, room_number, capacity, academic_year, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบห้องเรียน'
      });
    }

    res.json({
      success: true,
      message: 'แก้ไขห้องเรียนสำเร็จ',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update room error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการแก้ไขห้องเรียน'
    });
  }
});

router.delete('/rooms/:id', async (req, res) => {
  try {
    const studentCheck = await query(
      'SELECT COUNT(*) as count FROM students WHERE room_id = $1',
      [req.params.id]
    );

    if (parseInt(studentCheck.rows[0].count) > 0) {
      return res.status(400).json({
        success: false,
        message: 'ไม่สามารถลบห้องเรียนที่มีนักเรียนอยู่ได้'
      });
    }

    await query('DELETE FROM rooms WHERE id = $1', [req.params.id]);

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

// Remove homeroom teacher from a room
router.delete('/rooms/:roomId/homeroom', async (req, res) => {
  try {
    const { roomId } = req.params;

    const result = await transaction(async (client) => {
      const roomResult = await client.query(
        'SELECT homeroom_teacher_id FROM rooms WHERE id = $1',
        [roomId]
      );

      if (roomResult.rows.length === 0) {
        throw new Error('ไม่พบห้องเรียน');
      }

      const teacherId = roomResult.rows[0].homeroom_teacher_id;

      if (!teacherId) {
        throw new Error('ห้องนี้ยังไม่มีครูประจำชั้น');
      }

      await client.query(
        'UPDATE rooms SET homeroom_teacher_id = NULL WHERE id = $1',
        [roomId]
      );

      await client.query(
        'UPDATE teachers SET homeroom_room_id = NULL WHERE id = $1',
        [teacherId]
      );

      await client.query(
        'UPDATE teacher_rooms SET is_homeroom = false WHERE teacher_id = $1 AND room_id = $2',
        [teacherId, roomId]
      );

      await client.query(
        'UPDATE students SET homeroom_teacher_id = NULL WHERE room_id = $1',
        [roomId]
      );

      return true;
    });

    res.json({
      success: true,
      message: 'ยกเลิกการกำหนดครูประจำชั้นสำเร็จ'
    });
  } catch (error) {
    console.error('Remove homeroom error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'เกิดข้อผิดพลาดในการยกเลิกการกำหนดครูประจำชั้น'
    });
  }
});

module.exports = router;