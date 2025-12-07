
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'ไม่พบ Token กรุณาเข้าสู่ระบบ'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // ✅ ADD TIMEOUT
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Auth query timeout')), 5000)
    );
    
    const queryPromise = query(
      'SELECT id, phone, role, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );
    
    const result = await Promise.race([queryPromise, timeoutPromise]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'ไม่พบผู้ใช้งาน'
      });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'บัญชีผู้ใช้ถูกระงับ'
      });
    }

    req.user = {
      id: user.id,
      phone: user.phone,
      role: user.role
    };
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Token ไม่ถูกต้อง'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token หมดอายุ กรุณาเข้าสู่ระบบใหม่'
      });
    }
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์'
    });
  }
};

const checkRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'กรุณาเข้าสู่ระบบ'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้'
      });
    }

    next();
  };
};

module.exports = {
  verifyToken,
  checkRole
};
