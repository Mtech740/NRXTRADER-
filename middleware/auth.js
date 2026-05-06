const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
    const header = req.header('Authorization');
    if (!header) return res.status(401).json({ error: 'Access denied' });

    const token = header.replace('Bearer ', '');
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};
