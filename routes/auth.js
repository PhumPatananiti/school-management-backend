const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const { verifyToken } = require('../middleware/auth');

// In-memory OTP storage (use Redis in production)
const otpStore = new Map();

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// =====================================================
// SEND OTP (Registration Step 1)
// =====================================================
router.post('/send-otp', [
  body('phone').matches(/^[0-9]{10}$/).withMessage('หมายเลขโทรศัพท์ไม่ถูกต้อง'),
  body('role').isIn(['admin', 'teacher', 'student']).withMessage('กรุณาเลือกบทบาท')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { phone, role } = req.body;

    // Check if phone already exists
    const existingUser = await query(
      'SELECT id FROM users WHERE phone = $1',
      [phone]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'หมายเลขโทรศัพท์นี้ถูกใช้งานแล้ว'
      });
    }

    // Check role-specific requirements
    if (role === 'student') {
      // Check if student_id exists in students table
      const studentCheck = await query(
        'SELECT id FROM students WHERE phone = $1 AND user_id IS NULL',
        [phone]
      );

      if (studentCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'ไม่พบข้อมูลนักเรียนในระบบ กรุณาติดต่อแอดมิน'
        });
      }
    }

    if (role === 'teacher') {
      // Check if teacher exists in teachers table
      const teacherCheck = await query(
        'SELECT id FROM teachers WHERE phone = $1 AND user_id IS NULL',
        [phone]
      );

      if (teacherCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'ไม่พบข้อมูลครูในระบบ กรุณาติดต่อแอดมิน'
        });
      }
    }

    // Generate and store OTP
    const otp = generateOTP();
    otpStore.set(phone, {
      otp,
      role,
      expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes
    });

    // TODO: Send OTP via SMS service (e.g., Twilio, AWS SNS)
    console.log(`OTP for ${phone}: ${otp}`); // For development only

    res.json({
      success: true,
      message: 'ส่ง OTP ไปยังหมายเลขโทรศัพท์แล้ว',
      // Include OTP in development mode only
      ...(process.env.NODE_ENV === 'development' && { otp })
    });

  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการส่ง OTP'
    });
  }
});

// =====================================================
// VERIFY OTP (Registration Step 2)
// =====================================================
router.post('/verify-otp', [
  body('phone').matches(/^[0-9]{10}$/).withMessage('หมายเลขโทรศัพท์ไม่ถูกต้อง'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP ต้องเป็นตัวเลข 6 หลัก'),
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

    const { phone, otp, password } = req.body;

    // Verify OTP
    const storedData = otpStore.get(phone);
    if (!storedData) {
      return res.status(400).json({
        success: false,
        message: 'OTP หมดอายุหรือไม่ถูกต้อง'
      });
    }

    if (storedData.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: 'OTP ไม่ถูกต้อง'
      });
    }

    if (Date.now() > storedData.expiresAt) {
      otpStore.delete(phone);
      return res.status(400).json({
        success: false,
        message: 'OTP หมดอายุ กรุณาขอ OTP ใหม่'
      });
    }

    const role = storedData.role;

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user and link to teacher/student
    const result = await transaction(async (client) => {
      // Create user
      const userResult = await client.query(
        `INSERT INTO users (phone, password_hash, role, is_first_login, is_active)
         VALUES ($1, $2, $3, true, true)
         RETURNING id`,
        [phone, hashedPassword, role]
      );

      const userId = userResult.rows[0].id;

      // Link to teacher or student table
      if (role === 'teacher') {
        await client.query(
          'UPDATE teachers SET user_id = $1 WHERE phone = $2',
          [userId, phone]
        );
      } else if (role === 'student') {
        await client.query(
          'UPDATE students SET user_id = $1 WHERE phone = $2',
          [userId, phone]
        );
      }

      return { userId, role };
    });

    // Clear OTP
    otpStore.delete(phone);

    res.status(201).json({
      success: true,
      message: 'ลงทะเบียนสำเร็จ กรุณาเข้าสู่ระบบ'
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการยืนยัน OTP'
    });
  }
});

// =====================================================
// LOGIN
// =====================================================
router.post('/login', [
  body('phone').matches(/^[0-9]{10}$/).withMessage('หมายเลขโทรศัพท์ไม่ถูกต้อง'),
  body('password').notEmpty().withMessage('กรุณาใส่รหัสผ่าน'),
  body('role').isIn(['admin', 'teacher', 'student']).withMessage('กรุณาเลือกบทบาท')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { phone, password, role } = req.body;

    // Find user
    const userResult = await query(
      'SELECT id, phone, password_hash, role, is_first_login, is_active FROM users WHERE phone = $1',
      [phone]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'หมายเลขโทรศัพท์หรือรหัสผ่านไม่ถูกต้อง'
      });
    }

    const user = userResult.rows[0];

    // Check if account is active
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'บัญชีของคุณถูกระงับ กรุณาติดต่อแอดมิน'
      });
    }

    // Check role match
    if (user.role !== role) {
      return res.status(401).json({
        success: false,
        message: 'บทบาทไม่ถูกต้อง'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'หมายเลขโทรศัพท์หรือรหัสผ่านไม่ถูกต้อง'
      });
    }

    // Get additional user info based on role
    let userData = {
      id: user.id,
      phone: user.phone,
      role: user.role,
      isFirstLogin: user.is_first_login
    };

    if (role === 'teacher') {
      const teacherResult = await query(
        'SELECT id, full_name, subject_group, profile_picture FROM teachers WHERE user_id = $1',
        [user.id]
      );
      if (teacherResult.rows.length > 0) {
        userData = { ...userData, ...teacherResult.rows[0] };
      }
    } else if (role === 'student') {
      const studentResult = await query(
        'SELECT id, student_id, full_name, profile_picture FROM students WHERE user_id = $1',
        [user.id]
      );
      if (studentResult.rows.length > 0) {
        userData = { ...userData, ...studentResult.rows[0] };
      }
    } else if (role === 'admin') {
      userData.full_name = 'ผู้ดูแลระบบ';
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'เข้าสู่ระบบสำเร็จ',
      token,
      user: userData
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ'
    });
  }
});

// =====================================================
// CHANGE PASSWORD
// =====================================================
router.post('/change-password', verifyToken, [
  body('oldPassword').optional().notEmpty().withMessage('กรุณาใส่รหัสผ่านเก่า'),
  body('newPassword').isLength({ min: 6 }).withMessage('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Get current password
    const userResult = await query(
      'SELECT password_hash, is_first_login FROM users WHERE id = $1',
      [userId]
    );

    const user = userResult.rows[0];

    // If not first login, verify old password
    if (!user.is_first_login && oldPassword) {
      const isPasswordValid = await bcrypt.compare(oldPassword, user.password_hash);
      if (!isPasswordValid) {
        return res.status(400).json({
          success: false,
          message: 'รหัสผ่านเก่าไม่ถูกต้อง'
        });
      }
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and set is_first_login to false
    await query(
      'UPDATE users SET password_hash = $1, is_first_login = false WHERE id = $2',
      [hashedPassword, userId]
    );

    res.json({
      success: true,
      message: 'เปลี่ยนรหัสผ่านสำเร็จ'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน'
    });
  }
});

// =====================================================
// GET CURRENT USER
// =====================================================
router.get('/me', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    let userData = {
      id: userId,
      phone: req.user.phone,
      role: role
    };

    if (role === 'teacher') {
      const result = await query(
        'SELECT id, full_name, email, phone, subject_group, profile_picture FROM teachers WHERE user_id = $1',
        [userId]
      );
      if (result.rows.length > 0) {
        userData = { ...userData, ...result.rows[0] };
      }
    } else if (role === 'student') {
      const result = await query(
        'SELECT id, student_id, full_name, phone, profile_picture FROM students WHERE user_id = $1',
        [userId]
      );
      if (result.rows.length > 0) {
        userData = { ...userData, ...result.rows[0] };
      }
    } else if (role === 'admin') {
      userData.full_name = 'ผู้ดูแลระบบ';
    }

    res.json({
      success: true,
      data: userData
    });

  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลผู้ใช้'
    });
  }
});

// =====================================================
// LOGOUT (Clear token on client side)
// =====================================================
router.post('/logout', verifyToken, (req, res) => {
  res.json({
    success: true,
    message: 'ออกจากระบบสำเร็จ'
  });
});

module.exports = router;